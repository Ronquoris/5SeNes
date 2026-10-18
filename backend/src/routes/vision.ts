import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

interface VisionRequestBody {
  image: string; // Base64 data URL (e.g. "data:image/jpeg;base64,...")
  prompt?: string;
  provider?: 'groq' | 'gemini' | 'ollama' | 'auto';
  apiKey?: string;
  detectedSummary?: string;
}

export async function registerVisionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/vision/analyze', async (request, reply) => {
    const body = request.body as Partial<VisionRequestBody>;

    if (!body?.image) {
      return reply.code(400).send({
        error: { code: 'MISSING_IMAGE', message: 'A base64 image data URL is required.' },
      });
    }

    const customPrompt =
      body.prompt ||
      'You are 5Sense, an accessible vision assistant for a blind pedestrian. Inspect this photo carefully: 1) Identify any doors (specify whether OPEN or CLOSED), doorways, or exits, stating their direction (left, right, ahead) and approximate distance in metres. 2) Identify any obstacles or hazards in the walking path. 3) State whether the path is clear to walk. Respond in 2-3 concise, natural sentences suitable for text-to-speech audio.';

    const clientApiKey = body.apiKey || (request.headers['x-api-key'] as string);
    const chosenProvider = body.provider || 'auto';

    const groqKey = chosenProvider === 'groq' && clientApiKey ? clientApiKey : config.groqApiKey || clientApiKey;
    if ((chosenProvider === 'auto' || chosenProvider === 'groq') && groqKey) {
      try {
        const hasImage = Boolean(body.image && body.image.length > 50);
        const groqModel = hasImage ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile';
        const formattedImageUrl = hasImage
          ? body.image.startsWith('data:')
            ? body.image
            : `data:image/jpeg;base64,${body.image}`
          : null;

        const userContent = hasImage
          ? [
              {
                type: 'text',
                text: `Camera Scene Telemetry: ${body.detectedSummary || 'Pedestrian camera view'}.\nUser question: ${customPrompt}`,
              },
              {
                type: 'image_url',
                image_url: { url: formattedImageUrl! },
              },
            ]
          : `Camera Scene Telemetry: ${body.detectedSummary || 'Room view directly ahead'}.\nUser question: ${customPrompt}`;

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: groqModel,
            messages: [
              {
                role: 'system',
                content:
                  'You are 5Sense, an accessible AI vision assistant for a blind pedestrian. Synthesize the camera observations into 2 clear, direct sentences for voice text-to-speech. State distances in metres, identify any doors or obstacles, and state whether it is safe to walk.',
              },
              {
                role: 'user',
                content: userContent,
              },
            ],
            temperature: 0.2,
            max_tokens: 140,
          }),
        });

        if (groqResponse.ok) {
          const data = (await groqResponse.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          const speechText = data.choices[0]?.message?.content?.trim();
          if (speechText) {
            return {
              provider: 'Groq AI (Fast Reasoning)',
              description: speechText,
            };
          }
        } else {
          const errText = await groqResponse.text();
          request.log.warn(`Groq API returned ${groqResponse.status}: ${errText}`);
        }
      } catch (err) {
        request.log.error(err, 'Failed to call Groq API');
      }
    }

    // 2. Try Google Gemini Flash Vision (Free Tier Available)
    const geminiKey = chosenProvider === 'gemini' && clientApiKey ? clientApiKey : config.geminiApiKey || clientApiKey;
    if ((chosenProvider === 'auto' || chosenProvider === 'gemini') && geminiKey && (geminiKey.startsWith('AIza') || chosenProvider === 'gemini')) {
      try {
        const pureBase64 = body.image.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;

        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: customPrompt },
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: pureBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 160,
            },
          }),
        });

        if (geminiRes.ok) {
          const geminiData = (await geminiRes.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) {
            return {
              provider: 'Gemini 1.5 Flash Vision',
              description: text,
            };
          }
        } else {
          const errText = await geminiRes.text();
          request.log.warn(`Gemini Vision API returned ${geminiRes.status}: ${errText}`);
        }
      } catch (err) {
        request.log.error(err, 'Failed to call Gemini Vision API');
      }
    }

    // 3. Try Local Ollama (llama3.2-vision)
    if (chosenProvider === 'auto' || chosenProvider === 'ollama') {
      try {
        const pureBase64 = body.image.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        const ollamaResponse = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2-vision',
            prompt: customPrompt,
            images: [pureBase64],
            stream: false,
          }),
        });

        if (ollamaResponse.ok) {
          const data = (await ollamaResponse.json()) as { response: string };
          if (data.response) {
            return {
              provider: 'Local Ollama (Llama 3.2 Vision)',
              description: data.response.trim(),
            };
          }
        }
      } catch {
        // Ollama not active
      }
    }

    // 4. Fallback if no LLM key is configured yet
    const summary = body.detectedSummary || 'furniture and room layout';
    const fallbackDescription = `No Vision LLM key configured yet. To activate Llama 3.2 Vision or Gemini Flash, click 'AI Settings' in the HUD to paste your free API key, or set GROQ_API_KEY in backend/.env.`;

    return {
      provider: 'needs-configuration',
      description: fallbackDescription,
    };
  });
}
