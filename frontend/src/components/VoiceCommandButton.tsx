import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../speech/useSpeechRecognition';
import { speechQueue } from '../speech/SpeechQueue';

// Simple keyword matching, not full NLU — deliberately small vocabulary so it's predictable to
// use without sight: say one of a handful of words, it either routes or asks you to try again.
function matchIntent(transcript: string): string | null {
  const text = transcript.toLowerCase();
  if (text.includes('near') || text.includes('around')) return '/nearby';
  if (text.includes('hazard')) return '/hazards';
  if (text.includes('sos') || text.includes('emergency') || text.includes('help')) return '/sos';
  if (
    text.includes('home') ||
    text.includes('navigat') ||
    text.includes('direction') ||
    text.includes('camera') ||
    text.includes('obstacle') ||
    text.includes('detect') ||
    text.includes('go somewhere')
  ) {
    return '/';
  }
  return null;
}

export function VoiceCommandButton() {
  const navigate = useNavigate();
  const { supported, isListening, transcript, error, start } = useSpeechRecognition();

  useEffect(() => {
    if (!transcript) return;
    const path = matchIntent(transcript);
    if (path) {
      navigate(path);
    } else {
      speechQueue.speak(`Sorry, I didn't catch that. You can say home, nearby, hazards, or SOS.`, 'INFO');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  useEffect(() => {
    if (error) {
      speechQueue.speak('Could not hear that, please try again.', 'INFO');
    }
  }, [error]);

  function handleClick() {
    if (!supported) {
      speechQueue.speak(
        'Voice commands are not supported in this browser. Try Chrome or Edge, or use the navigation links instead.',
        'INFO'
      );
      return;
    }
    start();
  }

  // Always render the button — a control that silently vanishes when unsupported is worse than
  // one that explains itself, especially for someone navigating by voice/screen reader who can't
  // see that it's missing. Unsupported browsers get a spoken explanation instead of a dead end.
  return (
    <button
      type="button"
      className="btn voice-command-btn"
      onClick={handleClick}
      aria-pressed={isListening}
      disabled={isListening}
    >
      {isListening ? 'Listening…' : supported ? '🎙 Say a command' : '🎙 Say a command (unsupported here)'}
    </button>
  );
}
