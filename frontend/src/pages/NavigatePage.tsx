import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fetchRoute,
  geocodeSearch,
  analyzeVisionScene,
  startSos,
  stopSos,
  type GeocodeResult,
  type RouteResponse,
} from '../api/client';
import {
  ObstacleDetector,
  type Prediction,
  type DetectionEngine,
  TARGET_MODELS,
  type TargetModelMode,
  formatHumanObstacleSpeech,
  formatHumanClearSpeech,
} from '../vision/ObjectDetector';
import { useGeolocation } from '../hooks/useGeolocation';
import { estimateDistance } from '../vision/distanceEstimator';
import {
  playHazardAlertChime,
  playTurnCue,
  playTapCue,
  playSpatialHazardTone,
  playClearPathChime,
  playSosEmergencyAlarm,
  playSwipeFeedback,
} from '../services/audioFeedback';
import { speechQueue } from '../speech/SpeechQueue';
import { VoiceCoPilot } from '../components/VoiceCoPilot';
import { searchClosestDestinations, type ResolvedDestination } from '../services/destinationSearch';
import { useShakeDetection } from '../hooks/useShakeDetection';
import { MapView } from '../components/MapView';
import { drawVisionHud } from '../vision/visionHudOverlay';

const MANCHESTER_PRESETS: GeocodeResult[] = [
  { label: 'Manchester Piccadilly Station', lat: 53.4774, lon: -2.2312, osmId: 'quick-piccadilly' },
  { label: 'Piccadilly Gardens', lat: 53.4809, lon: -2.2374, osmId: 'quick-gardens' },
  { label: 'Manchester Arndale', lat: 53.4834, lon: -2.2426, osmId: 'quick-arndale' },
  { label: 'Manchester Victoria Station', lat: 53.4875, lon: -2.2424, osmId: 'quick-victoria' },
];

/**
 * Detects an option choice (1, 2, 3, etc.) from spoken user input.
 * Supports natural phrasings like:
 * - "I want to go to 2 number"
 * - "Option 2", "Option to", "Option too", "Go with option 2"
 * - "Number two", "Number 2", "Number to", "no 2"
 * - "Second one", "Second option", "Second", "2nd"
 * - "Select 2", "Select two", "Choose option 2", "Pick 2"
 * - "2", "two", "to", "too"
 */
export function detectOptionIndex(transcript: string, maxOptions: number = 5): number | null {
  if (!transcript) return null;
  // Convert punctuation to space, collapse whitespace, lowercase
  const norm = transcript.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return null;

  // 1. Explicit indicator + number (e.g. "option 2", "number two", "choice 3", "no 1", "route 2")
  // For Option 2 with indicator, we can accept "to" / "too" (e.g. "option to", "number to")
  const explicitMatches = [
    { num: 1, regex: /\b(option|number|no|choice|route|item)\s*(1|one|won|first|1st)\b/i },
    { num: 2, regex: /\b(option|number|no|choice|route|item)\s*(2|two|second|2nd|to|too)\b/i },
    { num: 3, regex: /\b(option|number|no|choice|route|item)\s*(3|three|third|3rd|tree|free)\b/i },
    { num: 4, regex: /\b(option|number|no|choice|route|item)\s*(4|four|fourth|4th|for)\b/i },
    { num: 5, regex: /\b(option|number|no|choice|route|item)\s*(5|five|fifth|5th)\b/i },
  ];
  for (const m of explicitMatches) {
    if (m.regex.test(norm) && m.num <= maxOptions) {
      return m.num;
    }
  }

  // 2. Number followed by indicator (e.g. "2 number", "two option", "second choice", "1st one", "second one")
  const invertedMatches = [
    { num: 1, regex: /\b(1|one|won|first|1st)\s*(number|no|choice|route|option|one)\b/i },
    { num: 2, regex: /\b(2|two|second|2nd)\s*(number|no|choice|route|option|one)\b/i },
    { num: 3, regex: /\b(3|three|third|3rd|tree)\s*(number|no|choice|route|option|one)\b/i },
    { num: 4, regex: /\b(4|four|fourth|4th)\s*(number|no|choice|route|option|one)\b/i },
    { num: 5, regex: /\b(5|five|fifth|5th)\s*(number|no|choice|route|option|one)\b/i },
  ];
  for (const m of invertedMatches) {
    if (m.regex.test(norm) && m.num <= maxOptions) {
      return m.num;
    }
  }

  // 3. Ordinals by themselves (e.g. "first", "second", "third", "fourth", "fifth")
  const ordinalMatches = [
    { num: 1, regex: /\b(first|1st)\b/i },
    { num: 2, regex: /\b(second|2nd)\b/i },
    { num: 3, regex: /\b(third|3rd)\b/i },
    { num: 4, regex: /\b(fourth|4th)\b/i },
    { num: 5, regex: /\b(fifth|5th)\b/i },
  ];
  for (const m of ordinalMatches) {
    if (m.regex.test(norm) && m.num <= maxOptions) {
      return m.num;
    }
  }

  // 4. Verbs of selection: "I want 2", "select 1", "choose 3", "pick 2", "go with 2", "take 1", "go to 2"
  // In "I want to go to 1", the target is 1. To avoid confusion with preposition "to", the target number for 2 MUST be (2|two), NOT (to|too).
  const verbMatches = [
    { num: 1, regex: /\b(select|choose|pick|take|want|go with|navigate to|go to)\s+(?:option\s+|number\s+)?(1|one|won)\b/i },
    { num: 2, regex: /\b(select|choose|pick|take|want|go with|navigate to|go to)\s+(?:option\s+|number\s+)?(2|two)\b/i },
    { num: 3, regex: /\b(select|choose|pick|take|want|go with|navigate to|go to)\s+(?:option\s+|number\s+)?(3|three|tree)\b/i },
    { num: 4, regex: /\b(select|choose|pick|take|want|go with|navigate to|go to)\s+(?:option\s+|number\s+)?(4|four)\b/i },
    { num: 5, regex: /\b(select|choose|pick|take|want|go with|navigate to|go to)\s+(?:option\s+|number\s+)?(5|five)\b/i },
  ];
  for (const m of verbMatches) {
    if (m.regex.test(norm) && m.num <= maxOptions) {
      return m.num;
    }
  }

  // 5. Standalone digits anywhere in a short utterance (e.g. "2", "just 2", "2 please", "yes 2")
  const digitMatch = norm.match(/\b([1-5])\b/);
  if (digitMatch) {
    const num = parseInt(digitMatch[1], 10);
    if (num >= 1 && num <= maxOptions) {
      return num;
    }
  }

  // 6. Standalone number words with optional politeness/affirmation (e.g. "two please", "two", "three", "one")
  const stripped = norm.replace(/\b(please|thanks|thank you|yes|yeah|sure|just|okay|ok|i want|take|pick)\b/gi, '').trim();
  const wordMap: Record<string, number> = {
    'one': 1, 'won': 1,
    'two': 2, 'to': 2, 'too': 2,
    'three': 3, 'tree': 3,
    'four': 4, 'for': 4,
    'five': 5
  };
  if (wordMap[stripped] && wordMap[stripped] <= maxOptions) {
    return wordMap[stripped];
  }

  return null;
}

export function NavigatePage() {
  const origin = useGeolocation();

  // Navigation Routing States
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vision AI & Speech States
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [listeningPrompt, setListeningPrompt] = useState<string | null>(null);
  const [voiceFallbackVisible, setVoiceFallbackVisible] = useState(false);
  const [destinationOptions, setDestinationOptions] = useState<ResolvedDestination[] | null>(null);
  const [isListeningForChoice, setIsListeningForChoice] = useState(false);

  // Ref mirror of destination options for instant access inside window event listeners
  const destinationOptionsRef = useRef<ResolvedDestination[] | null>(null);
  destinationOptionsRef.current = destinationOptions;
  const choiceRestartTimerRef = useRef<number | null>(null);
  const isChoiceActiveRef = useRef(false);

  // Unified Multi-Tap Pad Gesture State:
  // 1 Tap = Simple Detection (Vision AI / YOLO)
  // 2 Taps = Voice Navigation ("Where to?")
  // 3 Taps = Emergency SOS
  const [tapStatus, setTapStatus] = useState<'idle' | 'tap1' | 'tap2' | 'tap3'>('idle');
  const [sosActive, setSosActive] = useState(false);
  const [sosSessionId, setSosSessionId] = useState<string | null>(null);
  const [isDepressed, setIsDepressed] = useState(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<number | null>(null);

  // Camera & Detection States
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [, setCameraError] = useState<string | null>(null);
  const [latestAlert, setLatestAlert] = useState<{ text: string; time: string } | null>(null);
  const targetModelRef = useRef<TargetModelMode>('all');
  const isDetectingRef = useRef(false);

  // Press-and-Hold to Speak (Push-to-Talk) Refs
  const pressStartTimeRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const isHoldingToSpeakRef = useRef(false);
  const finalSpeechQueryRef = useRef('');

  // Refs for tracking and camera lifecycle
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<ObstacleDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const detectTimeoutRef = useRef<number | null>(null);
  const latestPredictionsRef = useRef<Prediction[]>([]);
  const recognitionRef = useRef<any>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const isSwipeRef = useRef(false);

  // Eyes-Free Shake-to-SOS trigger: vigorously shaking device triggers emergency broadcast
  useShakeDetection(handleEmergencySos, true, 22);

  // Spoken hazard alert callback (only active when not in turn-by-turn route, not speaking, not choosing options)
  function handleHazardAlert(text: string) {
    if (
      route ||
      isListening ||
      isListeningForChoice ||
      isHoldingToSpeakRef.current ||
      destinationOptions !== null ||
      destinationOptionsRef.current !== null ||
      speechQueue.isListening()
    ) {
      return;
    }
    let dir: 'left' | 'right' | 'ahead' = 'ahead';
    const top = latestPredictionsRef.current.find((p) => p.score >= 0.35);
    if (top) {
      const cx = (top.bbox[0] + top.bbox[2] / 2) / 640;
      dir = cx < 0.38 ? 'left' : cx > 0.62 ? 'right' : 'ahead';
    }
    playSpatialHazardTone(dir, 'danger');
    speechQueue.speak(text, 'CRITICAL');
    setLatestAlert({ text, time: new Date().toLocaleTimeString('en-GB') });
  }

  // Initialize Detector and Offscreen Canvas
  if (!detectorRef.current) {
    detectorRef.current = new ObstacleDetector(handleHazardAlert);
  }
  if (!sampleCanvasRef.current) {
    sampleCanvasRef.current = document.createElement('canvas');
  }

  // Camera Management
  async function startCamera() {
    setCameraStarting(true);
    setCameraError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera is not supported or requires HTTPS/Chrome flags.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { frameRate: { ideal: 30, max: 60 } },
          audio: false,
        });
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      try {
        await video.play();
      } catch (err) {
        console.warn('video.play() deferred:', err);
      }

      function setupDimensions() {
        if (!video || !canvasRef.current) return;
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 480;
        canvasRef.current.width = w;
        canvasRef.current.height = h;
        if (sampleCanvasRef.current) {
          sampleCanvasRef.current.width = w;
          sampleCanvasRef.current.height = h;
        }
        detectorRef.current?.computeRoiRects(w, h);
        detectorRef.current?.reset();
      }

      if (video.readyState >= 2 || video.videoWidth > 0) {
        setupDimensions();
      } else {
        video.onloadedmetadata = () => setupDimensions();
      }

      setCameraActive(true);
      setCameraStarting(false);
      setCameraError(null);

      // Start render and detection loop
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(renderLoop);
      }

      detectorRef.current
        ?.loadModel()
        .then(() => {
          if (detectTimeoutRef.current === null) {
            detectTimeoutRef.current = window.setTimeout(detectTick, 0);
          }
        })
        .catch((err) => {
          console.warn('Detector model load deferred:', err);
          if (detectTimeoutRef.current === null) {
            detectTimeoutRef.current = window.setTimeout(detectTick, 0);
          }
        });
    } catch (err) {
      console.warn('Camera start failed:', err);
      setCameraError(err instanceof Error ? err.message : 'Unable to access camera.');
      setCameraActive(false);
      setCameraStarting(false);
    }
  }

  function stopCamera() {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    if (detectTimeoutRef.current !== null) clearTimeout(detectTimeoutRef.current);
    rafIdRef.current = null;
    detectTimeoutRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setCameraActive(false);
  }

  // Continuous Camera Canvas Rendering
  function renderLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && (video.readyState >= 2 || video.videoWidth > 0)) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawVisionHud(
          ctx,
          video,
          canvas.width,
          canvas.height,
          latestPredictionsRef.current,
          detectorRef.current?.roiRects,
          {
            engineName: 'YOLOv8',
            statusText: latestAlert?.text,
            showRoiGuides: true,
            targetModel: 'all',
          }
        );
      }
    }
    rafIdRef.current = requestAnimationFrame(renderLoop);
  }

  // Vision Detection Tick (High-Speed Real-Time ~15 FPS)
  async function detectTick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    const detector = detectorRef.current;

    if (!video || !canvas || !sampleCanvas || !detector || (video.readyState < 2 && video.videoWidth === 0)) {
      detectTimeoutRef.current = window.setTimeout(detectTick, 80);
      return;
    }

    if (isDetectingRef.current) {
      detectTimeoutRef.current = window.setTimeout(detectTick, 40);
      return;
    }

    isDetectingRef.current = true;
    try {
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (sampleCtx) {
        const predictions = await detector.detectTick(video, sampleCtx, canvas.width, canvas.height);
        latestPredictionsRef.current = predictions;
      }
    } catch {
      // Ignore background inference blips
    } finally {
      isDetectingRef.current = false;
    }

    detectTimeoutRef.current = window.setTimeout(detectTick, 160);
  }

  // Start Camera on Mount (if not active route)
  useEffect(() => {
    if (!route) {
      startCamera();
    }
    return () => {
      stopCamera();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      if (tapTimerRef.current !== null) {
        clearTimeout(tapTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // ================= PUSH-TO-TALK (HOLD TO SPEAK) & TOUCH ENGINE =================
  // HOLD (Press & Keep Pressed > 240ms) = Voice Navigation (Listen while holding -> release to route)
  // TAP (Press & Release < 240ms) = Simple Detection (Obstacle / Path Clearance)
  // SHAKE = Emergency SOS Alert

  function handlePadPressStart() {
    setIsDepressed(true);
    pressStartTimeRef.current = Date.now();
    isHoldingToSpeakRef.current = false;

    // Immediately silence speech and hold so the assistant never speaks over the user
    speechQueue.setMicActive(true);

    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // 240ms threshold for press-and-hold (Push-to-Talk)
    holdTimerRef.current = window.setTimeout(() => {
      isHoldingToSpeakRef.current = true;
      setTapStatus('tap2');
      playTurnCue();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([60]);
      }
      startHoldVoiceRecognition();
    }, 240);
  }

  function handlePadPressEnd() {
    setIsDepressed(false);

    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (isHoldingToSpeakRef.current) {
      // User released while in hold-to-speak mode: finalize speech & process query
      isHoldingToSpeakRef.current = false;
      stopHoldVoiceRecognition();
      setTimeout(() => speechQueue.setMicActive(false), 150);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([30]);
      }
      return;
    }

    // Release speech hold if released early before hold threshold
    speechQueue.setMicActive(false);

    // If destination choices are currently displayed, tapping interrupts the voice-over and listens for choice
    if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0) {
      playTapCue(1);
      speechQueue.cancel();
      listenForOptionSelection(destinationOptionsRef.current);
      return;
    }

    // Short tap (<240ms): trigger Simple Detection (path check)
    playTapCue(1);
    setTapStatus('tap1');
    handleSimpleDetection();
    window.setTimeout(() => setTapStatus('idle'), 2000);
  }

  function startHoldVoiceRecognition() {
    if (loading) return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      speechQueue.speak('voice unavailable', 'CRITICAL');
      setVoiceFallbackVisible(true);
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = 'en-GB';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      finalSpeechQueryRef.current = '';

      recognition.onstart = () => {
        setIsListening(true);
        speechQueue.setMicActive(true);
        setListeningPrompt('Listening… speak now');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalStr = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalStr += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const text = (finalStr || interim).trim();
        if (text) {
          finalSpeechQueryRef.current = text;
          setListeningPrompt(`"${text}"`);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        speechQueue.setMicActive(false);
        if (event.error === 'not-allowed') {
          speechQueue.speak('mic blocked', 'CRITICAL');
          setVoiceFallbackVisible(true);
        }
        setIsListening(false);
        setListeningPrompt(null);
      };

      recognition.onend = () => {
        setIsListening(false);
        setListeningPrompt(null);
        speechQueue.setMicActive(false);
        const query = finalSpeechQueryRef.current.trim();
        if (query) {
          window.dispatchEvent(new CustomEvent('5sense:voice_search', { detail: { query } }));
        }
      };

      recognition.start();
    } catch (err) {
      console.warn('Speech recognition start failed:', err);
      setIsListening(false);
      setListeningPrompt(null);
      speechQueue.setMicActive(false);
    }
  }

  function stopHoldVoiceRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn('Recognition stop error:', err);
      }
    }
  }

  // ================= ACTION 1: SIMPLE DETECTION (1 TAP) =================
  async function handleSimpleDetection() {
    const activeModel = targetModelRef.current;

    try {
      // Instant spatial response using real-time local vision engine (<10ms)
      const preds = latestPredictionsRef.current.filter((p) => p.score >= 0.28);
      if (preds.length > 0) {
        // Crowd check: If surrounded by 3 or more people, guide walking path
        const personPreds = preds.filter((p) => p.class === 'person');
        if (personPreds.length >= 3 && (activeModel === 'all' || activeModel === 'person')) {
          let leftCount = 0;
          let rightCount = 0;
          let centerCount = 0;
          for (const pt of personPreds) {
            const cx = (pt.bbox[0] + pt.bbox[2] / 2) / 640;
            if (cx < 0.38) leftCount++;
            else if (cx > 0.62) rightCount++;
            else centerCount++;
          }
          let crowdMsg = 'crowd ahead';
          if (leftCount === 0 && (centerCount > 0 || rightCount > 0)) {
            crowdMsg = 'pass left';
          } else if (rightCount === 0 && (centerCount > 0 || leftCount > 0)) {
            crowdMsg = 'pass right';
          }
          playSpatialHazardTone('ahead', 'warning');
          setLatestAlert({ text: crowdMsg, time: new Date().toLocaleTimeString('en-GB') });
          speechQueue.speak(crowdMsg, 'CRITICAL');
          return;
        }

        const top = preds[0];
        const est = estimateDistance(top.bbox, top.class, 640, 480);
        const cx = (top.bbox[0] + top.bbox[2] / 2) / 640;
        const dir: 'left' | 'right' | 'ahead' = cx < 0.38 ? 'left' : cx > 0.62 ? 'right' : 'ahead';
        playSpatialHazardTone(dir, 'warning');
        const alertMsg = formatHumanObstacleSpeech(top.class, est.distanceText, dir, 'presence', activeModel);
        setLatestAlert({ text: alertMsg, time: new Date().toLocaleTimeString('en-GB') });
        speechQueue.speak(alertMsg, 'CRITICAL');
      } else {
        playClearPathChime();
        const clearMsg = formatHumanClearSpeech(activeModel);
        setLatestAlert(null);
        speechQueue.speak(clearMsg, 'CRITICAL');
      }
    } catch (err) {
      console.warn('Simple detection fallback:', err);
      playClearPathChime();
      speechQueue.speak(formatHumanClearSpeech(targetModelRef.current), 'CRITICAL');
    }
  }

  // ================= SWIPE GESTURE HANDLERS (ZERO PRECISION) =================
  // Swipe UP: Repeat last alert
  // Swipe DOWN: Announce system & path status
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length > 0) {
      touchStartYRef.current = e.touches[0].clientY;
      touchStartXRef.current = e.touches[0].clientX;
      isSwipeRef.current = false;
    }
    handlePadPressStart();
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartYRef.current !== null && touchStartXRef.current !== null && e.changedTouches.length > 0) {
      const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
      const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
      touchStartYRef.current = null;
      touchStartXRef.current = null;

      // Vertical swipe: threshold 45px
      if (Math.abs(deltaY) > 45 && Math.abs(deltaY) > Math.abs(deltaX)) {
        isSwipeRef.current = true;
        if (holdTimerRef.current !== null) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        if (isHoldingToSpeakRef.current) {
          isHoldingToSpeakRef.current = false;
          stopHoldVoiceRecognition();
        }
        setIsDepressed(false);
        if (deltaY < -45) {
          // SWIPE UP: Repeat last alert
          playSwipeFeedback('up');
          speechQueue.repeatLast();
          return;
        } else if (deltaY > 45) {
          // SWIPE DOWN: Status Check
          playSwipeFeedback('down');
          announceStatusReport();
          return;
        }
      }
    }

    if (!isSwipeRef.current) {
      handlePadPressEnd();
    }
  }

  function handlePadPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'touch') return;
    handlePadPressStart();
  }

  function handlePadPointerUp(e: React.PointerEvent) {
    if (e.pointerType === 'touch') return;
    handlePadPressEnd();
  }

  function handlePadKeyDown(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!isDepressed) {
        handlePadPressStart();
      }
    }
  }

  function handlePadKeyUp(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      handlePadPressEnd();
    }
  }

  function announceStatusReport() {
    const obstacleState = latestAlert ? latestAlert.text : 'path clear';
    speechQueue.speak(obstacleState, 'CRITICAL');
  }

  // ================= ACTION 3: EMERGENCY SOS (3 TAPS / SHAKE) =================
  async function handleEmergencySos() {
    playSosEmergencyAlarm();
    setSosActive(true);
    setTapStatus('tap3');
    speechQueue.speak('SOS active', 'CRITICAL');

    try {
      const res = await startSos({
        contactIds: [],
        initialLocation: { lat: origin.lat, lon: origin.lon },
        message: 'EMERGENCY: Pedestrian activated SOS on 5Sense navigation.',
      });
      setSosSessionId(res.sessionId);
    } catch (err) {
      console.warn('SOS start error:', err);
    }
  }

  async function handleCancelSos() {
    speechQueue.speak('SOS cancelled', 'INFO');
    setSosActive(false);
    if (sosSessionId) {
      try {
        await stopSos(sosSessionId, 'User cancelled emergency alert');
      } catch {}
      setSosSessionId(null);
    }
    setTapStatus('idle');
  }

  // Geocodes and calculates walking route using real location search
  async function searchAndRoute(query: string) {
    setLoading(true);
    setError(null);
    setDestinationOptions(null);
    destinationOptionsRef.current = null;

    try {
      const results = await searchClosestDestinations(query, { lat: origin.lat, lon: origin.lon }, 3);

      if (results.length === 0) {
        speechQueue.speak('none found', 'CRITICAL');
        setVoiceFallbackVisible(true);
        return;
      }

      if (results.length === 1) {
        // Exactly 1 closest match found -> navigate directly
        await selectDestination(results[0]);
        return;
      }

      // Multiple real options found!
      setDestinationOptions(results);
      destinationOptionsRef.current = results;
      isChoiceActiveRef.current = true;

      const optionsSpeech = results
        .map((opt, idx) => `Option ${idx + 1}: ${opt.name}.`)
        .join(' ');

      const promptSpeech = `Found ${results.length} locations. ${optionsSpeech} Say option 1, 2, or ${results.length}.`;

      // Speak out options concisely, and when finished speaking, automatically open voice listener for choice!
      speechQueue.speak(promptSpeech, 'CRITICAL', () => {
        if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
          listenForOptionSelection(destinationOptionsRef.current);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to find destination locations.';
      setError(msg);
      speechQueue.speak(msg, 'CRITICAL');
    } finally {
      setLoading(false);
    }
  }

  // Selects a specific destination, calculates walking path, and begins turn-by-turn guidance
  async function selectDestination(target: ResolvedDestination) {
    if (choiceRestartTimerRef.current) {
      clearTimeout(choiceRestartTimerRef.current);
      choiceRestartTimerRef.current = null;
    }
    isChoiceActiveRef.current = false;
    speechQueue.setMicActive(false);
    speechQueue.cancel();
    setDestinationOptions(null);
    destinationOptionsRef.current = null;
    setIsListeningForChoice(false);
    setLoading(true);
    setError(null);

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const geoTarget: GeocodeResult = {
        label: target.fullAddress || target.name,
        lat: target.lat,
        lon: target.lon,
        osmId: target.id,
      };
      setDestination(geoTarget);

      const data = await fetchRoute(
        { lat: origin.lat, lon: origin.lon },
        { lat: target.lat, lon: target.lon }
      );

      stopCamera();
      setRoute(data);

      playTurnCue();
      speechQueue.speak(
        `Route found to ${target.name}, ${target.distanceText}. Walk forward.`,
        'CRITICAL'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to calculate walking route.';
      setError(msg);
      speechQueue.speak(msg, 'CRITICAL');
    } finally {
      setLoading(false);
    }
  }

  // Voice listener for selecting options 1, 2, 3, etc.
  function listenForOptionSelection(options: ResolvedDestination[]) {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = 'en-GB';
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        speechQueue.setMicActive(true);
        setIsListeningForChoice(true);
        playTurnCue();
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([40]);
        }
      };

      recognition.onresult = (event: any) => {
        const candidates: string[] = [];
        let combined = '';
        for (let i = 0; i < (event.results?.length || 0); i++) {
          const res = event.results[i];
          combined += ' ' + (res[0]?.transcript || '');
          for (let j = 0; j < res.length; j++) {
            if (res[j]?.transcript) {
              candidates.push(res[j].transcript.trim());
            }
          }
        }
        if (combined.trim()) {
          candidates.unshift(combined.trim());
        }

        console.log('Spoken option choice candidates:', candidates);

        // Check if user requested cancellation
        for (const cand of candidates) {
          if (/\b(cancel|close|dismiss|exit|nevermind|back|stop)\b/i.test(cand)) {
            if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
            isChoiceActiveRef.current = false;
            speechQueue.setMicActive(false);
            speechQueue.cancel();
            setDestinationOptions(null);
            destinationOptionsRef.current = null;
            setIsListeningForChoice(false);
            speechQueue.speak('Cancelled destination choice', 'INFO');
            return;
          }
        }

        // Check candidate transcripts for option index
        let chosenIdx: number | null = null;
        for (const cand of candidates) {
          const detected = detectOptionIndex(cand, options.length);
          if (detected !== null) {
            chosenIdx = detected;
            break;
          }
        }

        if (chosenIdx !== null && options[chosenIdx - 1]) {
          if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
          isChoiceActiveRef.current = false;
          speechQueue.setMicActive(false);
          speechQueue.cancel();
          selectDestination(options[chosenIdx - 1]);
          return;
        }

        // Check candidate transcripts against destination names / addresses
        for (const cand of candidates) {
          const norm = cand.toLowerCase();
          for (let i = 0; i < options.length; i++) {
            const optName = options[i].name.toLowerCase();
            const optSub = options[i].subLabel.toLowerCase();
            const optWords = optName.split(/\s+/).filter((w: string) => w.length > 2);
            const normWords = norm.split(/\s+/).filter((w: string) => w.length > 2);
            const hasCommonWord = optWords.some((w: string) => norm.includes(w)) || normWords.some((w: string) => optName.includes(w));
            if (
              norm.includes(optName) ||
              optName.includes(norm) ||
              hasCommonWord ||
              optSub.split('·').some((part) => part.trim().length > 3 && (norm.includes(part.trim()) || part.trim().includes(norm)))
            ) {
              if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
              isChoiceActiveRef.current = false;
              speechQueue.setMicActive(false);
              speechQueue.cancel();
              selectDestination(options[i]);
              return;
            }
          }
        }

        // No match found -> guide user and re-listen
        speechQueue.setMicActive(false);
        speechQueue.speak(`Please say option 1, 2, or ${options.length}, or tap your choice.`, 'CRITICAL', () => {
          if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
            listenForOptionSelection(destinationOptionsRef.current);
          }
        });
      };

      recognition.onerror = (err: any) => {
        console.warn('Choice recognition error:', err?.error || err);
        // Do not abandon listening if destination options modal is still open
        if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
          if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
          choiceRestartTimerRef.current = window.setTimeout(() => {
            if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
              listenForOptionSelection(destinationOptionsRef.current);
            }
          }, 350);
        } else {
          speechQueue.setMicActive(false);
          setIsListeningForChoice(false);
        }
      };

      recognition.onend = () => {
        // If destination choices are still displayed and active, keep listener open
        if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
          if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
          choiceRestartTimerRef.current = window.setTimeout(() => {
            if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
              listenForOptionSelection(destinationOptionsRef.current);
            }
          }, 300);
        } else {
          speechQueue.setMicActive(false);
          setIsListeningForChoice(false);
        }
      };

      recognition.start();
    } catch (e) {
      console.warn('Choice speech recognition start error:', e);
      speechQueue.setMicActive(false);
      setIsListeningForChoice(false);
    }
  }

  const [searchParams, setSearchParams] = useSearchParams();

  // Listen for search params from other pages (triggered by global floating button)
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      searchAndRoute(q);
      setSearchParams({}, { replace: true });
    }
    const action = searchParams.get('action');
    if (action === 'check') {
      handleSimpleDetection();
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // Listen for custom events dispatched by the global floating button while on /navigate
  useEffect(() => {
    function onVoiceSearch(e: any) {
      const q = e.detail?.query;
      if (!q) return;

      const currentOptions = destinationOptionsRef.current;
      if (currentOptions && currentOptions.length > 0) {
        // User spoke while destination choices were displayed!
        const norm = q.toLowerCase().trim();

        // Check if user spoke to cancel
        if (/\b(cancel|close|dismiss|exit|nevermind|back|stop)\b/i.test(norm)) {
          if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
          isChoiceActiveRef.current = false;
          speechQueue.setMicActive(false);
          speechQueue.cancel();
          setDestinationOptions(null);
          destinationOptionsRef.current = null;
          setIsListeningForChoice(false);
          speechQueue.speak('Cancelled destination choice', 'INFO');
          return;
        }

        // Check if user spoke an option index (e.g. "I want to go to 2 number", "option 2", "second one", "2")
        const chosenIdx = detectOptionIndex(norm, currentOptions.length);
        if (chosenIdx !== null && currentOptions[chosenIdx - 1]) {
          if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
          isChoiceActiveRef.current = false;
          speechQueue.cancel();
          selectDestination(currentOptions[chosenIdx - 1]);
          return;
        }

        // Check if user spoke the venue name or address of any option (bidirectional and keyword matching)
        for (let i = 0; i < currentOptions.length; i++) {
          const optName = currentOptions[i].name.toLowerCase();
          const optSub = currentOptions[i].subLabel.toLowerCase();
          const optWords = optName.split(/\s+/).filter((w: string) => w.length > 2);
          const normWords = norm.split(/\s+/).filter((w: string) => w.length > 2);
          const hasCommonWord = optWords.some((w: string) => norm.includes(w)) || normWords.some((w: string) => optName.includes(w));
          if (
            norm.includes(optName) ||
            optName.includes(norm) ||
            hasCommonWord ||
            optSub.split('·').some((part) => part.trim().length > 3 && (norm.includes(part.trim()) || part.trim().includes(norm)))
          ) {
            if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
            isChoiceActiveRef.current = false;
            speechQueue.cancel();
            selectDestination(currentOptions[i]);
            return;
          }
        }

        // SAFETY: If the user said "option ...", "number ...", or "second/first/third" or any number word but it wasn't matched above,
        // DO NOT send it to Nominatim as a new location search!
        if (/\b(option|number|no|second|third|first|choice|route|item|one|two|to|too|three|tree|four|five|1|2|3|4|5|1st|2nd|3rd)\b/i.test(norm)) {
          speechQueue.cancel();
          speechQueue.speak(`Please say option 1, 2, or ${currentOptions.length}, or tap on screen.`, 'CRITICAL', () => {
            if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0 && isChoiceActiveRef.current) {
              listenForOptionSelection(destinationOptionsRef.current);
            }
          });
          return;
        }

        // User spoke a brand new query altogether -> search and route
        if (choiceRestartTimerRef.current) clearTimeout(choiceRestartTimerRef.current);
        isChoiceActiveRef.current = false;
        speechQueue.cancel();
        speechQueue.speak('finding route', 'INFO');
        searchAndRoute(q);
        return;
      }

      speechQueue.speak('finding route', 'INFO');
      searchAndRoute(q);
    }

    function onButtonTap() {
      const currentOptions = destinationOptionsRef.current;
      if (currentOptions && currentOptions.length > 0) {
        // User tapped the floating button while options are open!
        // Immediately interrupt/cancel voice-over readout and start listening for their choice!
        speechQueue.cancel();
        isChoiceActiveRef.current = true;
        listenForOptionSelection(currentOptions);
      }
    }

    function onPathCheck() {
      // Only check path clearance if destination options modal is NOT active
      if (!destinationOptionsRef.current || destinationOptionsRef.current.length === 0) {
        handleSimpleDetection();
      }
    }

    window.addEventListener('5sense:voice_search', onVoiceSearch);
    window.addEventListener('5sense:button_tap', onButtonTap);
    window.addEventListener('5sense:path_check', onPathCheck);
    return () => {
      window.removeEventListener('5sense:voice_search', onVoiceSearch);
      window.removeEventListener('5sense:button_tap', onButtonTap);
      window.removeEventListener('5sense:path_check', onPathCheck);
    };
  }, []);

  function handleSelectPreset(preset: GeocodeResult) {
    setVoiceFallbackVisible(false);
    selectDestination({
      id: preset.osmId,
      name: preset.label,
      subLabel: 'Manchester landmark',
      fullAddress: preset.label,
      lat: preset.lat,
      lon: preset.lon,
      distanceMeters: 500,
      distanceText: '~500m',
      spokenPrompt: preset.label,
    });
  }

  function handleResetRoute() {
    setRoute(null);
    setDestination(null);
    setError(null);
    // Camera restarts via useEffect([route])
  }

  const activeState: 'safe' | 'warning' | 'danger' =
    sosActive || (latestAlert && latestAlert.text.length > 0) || tapStatus === 'tap3'
      ? 'danger'
      : tapStatus === 'tap2' || isListening || aiAnalyzing || tapStatus === 'tap1'
      ? 'warning'
      : 'safe';

  const stateThemeColor =
    activeState === 'danger'
      ? '#FF1744'
      : activeState === 'warning'
      ? '#FFEA00'
      : '#00FF66';

  return (
    <div className="eyes-free-container" style={{ position: 'relative' }}>
      {/* ================= IF ROUTE ACTIVE: FULL-SCREEN VOICE CO-PILOT ================= */}
      {route ? (
        <VoiceCoPilot
          route={route}
          initialOrigin={{ lat: origin.lat, lon: origin.lon }}
          destinationLabel={destination?.label}
          destinationCoords={destination ? { lat: destination.lat, lon: destination.lon } : undefined}
          onStop={handleResetRoute}
          onArrived={handleResetRoute}
          onCancelRoute={handleResetRoute}
        />
      ) : (
        <>
          {/* Hidden ARIA Live Region for TalkBack (Android) & VoiceOver (iOS) */}
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{
              position: 'absolute',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
            }}
          >
            {sosActive
              ? 'Emergency SOS active. Broadcasting live location coordinates.'
              : latestAlert
              ? latestAlert.text
              : isListening
              ? 'Listening for destination'
              : 'Path is clear. Street camera scanning.'}
          </div>

          {/* Emergency SOS Banner (rendered only when SOS is active) */}
          {sosActive && (
            <div style={{ padding: '0.5rem 0.75rem 0' }}>
              <button
                type="button"
                onClick={handleCancelSos}
                style={{
                  width: '100%',
                  background: '#FF1744',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: '0.95rem',
                  padding: '0.55rem 1rem',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 0 16px rgba(255, 23, 68, 0.7)',
                }}
              >
                ✕ CANCEL SOS BROADCAST
              </button>
            </div>
          )}

          {/* DUAL STREAMS: LIVE STREET CAMERA (YOLOv8) ON TOP + GPS MAP DOWN BELOW */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              flex: 1,
              minHeight: 0,
              width: '100%',
              padding: '0.5rem 0.75rem 0.75rem',
              overflowY: 'auto',
            }}
          >
            {/* Top View: Live Camera Feed with YOLOv8 Overlay */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                flex: 1,
                minHeight: '180px',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '2px solid rgba(255, 255, 255, 0.16)',
                background: '#000000',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
              }}
            >
              {/* Native GPU-accelerated video element: buttery smooth 60 FPS */}
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: cameraActive ? 'block' : 'none',
                  zIndex: 1,
                }}
              />
              {/* High-contrast YOLO HUD vector canvas overlay */}
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  display: cameraActive ? 'block' : 'none',
                  zIndex: 2,
                }}
              />
            </div>

            {/* Down Below Camera: Live Google Map with GPS Dot */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                flex: 1,
                minHeight: '170px',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '2px solid rgba(37, 99, 235, 0.4)',
                background: '#0b0f14',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  zIndex: 1000,
                  background: 'rgba(0, 0, 0, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#93c5fd',
                  borderRadius: '12px',
                  padding: '3px 10px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  letterSpacing: '0.5px',
                }}
              >
                <span style={{ color: '#00FF66' }}>●</span> GPS MAP
              </div>
              <MapView
                origin={{ lat: origin.lat, lon: origin.lon }}
                userLocation={{ lat: origin.lat, lon: origin.lon }}
                showGoogleMapsButton={false}
                followUser={true}
              />
            </div>

            {/* Quick Access Services Row */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'nowrap',
                padding: '0.2rem 0',
                justifyContent: 'space-between',
              }}
            >
              <Link
                to="/nearby"
                className="btn secondary"
                style={{
                  flex: 1,
                  fontSize: '0.8rem',
                  padding: '0.45rem 0.4rem',
                  borderRadius: '10px',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                📍 Nearby
              </Link>
              <Link
                to="/hazards"
                className="btn secondary"
                style={{
                  flex: 1,
                  fontSize: '0.8rem',
                  padding: '0.45rem 0.4rem',
                  borderRadius: '10px',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                ⚠️ Hazards
              </Link>
              <Link
                to="/sos"
                className="btn secondary"
                style={{
                  flex: 1,
                  fontSize: '0.8rem',
                  padding: '0.45rem 0.4rem',
                  borderRadius: '10px',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                🆘 SOS
              </Link>
            </div>
          </div>

          {/* ================= MULTIPLE DESTINATIONS SELECTION MODAL ================= */}
          {destinationOptions && destinationOptions.length > 0 && (
            <div
              style={{
                position: 'fixed',
                bottom: '108px',
                left: '12px',
                right: '12px',
                maxWidth: '540px',
                margin: '0 auto',
                maxHeight: '48vh',
                overflowY: 'auto',
                background: '#0d131d',
                border: '3px solid #38bdf8',
                borderRadius: '20px',
                padding: '0.9rem',
                zIndex: 10000,
                boxShadow: '0 16px 40px rgba(0,0,0,0.95), 0 0 30px rgba(56, 189, 248, 0.45)',
              }}
              role="dialog"
              aria-label="Multiple destination choices found"
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.65rem',
                  borderBottom: '1px solid rgba(255,255,255,0.12)',
                  paddingBottom: '0.45rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 900, fontSize: '1.05rem', color: '#38bdf8', letterSpacing: '0.5px' }}>
                    📍 {destinationOptions.length} Locations Found
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {isListeningForChoice
                      ? `🎙️ Listening: Say "1", "2", or "${destinationOptions.length}"`
                      : 'Say number or tap your destination'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    if (choiceRestartTimerRef.current) {
                      clearTimeout(choiceRestartTimerRef.current);
                      choiceRestartTimerRef.current = null;
                    }
                    isChoiceActiveRef.current = false;
                    if (recognitionRef.current) {
                      try {
                        recognitionRef.current.abort();
                      } catch {}
                    }
                    speechQueue.setMicActive(false);
                    speechQueue.cancel();
                    setDestinationOptions(null);
                    destinationOptionsRef.current = null;
                    setIsListeningForChoice(false);
                    speechQueue.speak('Cancelled destination choice', 'INFO');
                  }}
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.85rem' }}
                  aria-label="Cancel destination selection"
                >
                  ✕ Close
                </button>
              </div>

              {/* Dedicated Speak Option button for instant voice interrupt */}
              <button
                type="button"
                onClick={() => {
                  speechQueue.cancel();
                  if (destinationOptionsRef.current && destinationOptionsRef.current.length > 0) {
                    isChoiceActiveRef.current = true;
                    listenForOptionSelection(destinationOptionsRef.current);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '0.65rem 1rem',
                  borderRadius: '12px',
                  background: isListeningForChoice
                    ? 'linear-gradient(135deg, #00FF66 0%, #00cc52 100%)'
                    : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: isListeningForChoice ? '#000000' : '#ffffff',
                  border: isListeningForChoice ? '2px solid #ffffff' : '2px solid rgba(56, 189, 248, 0.4)',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  boxShadow: isListeningForChoice
                    ? '0 0 16px rgba(0, 255, 102, 0.6)'
                    : '0 4px 12px rgba(2, 132, 199, 0.3)',
                  marginBottom: '0.65rem',
                  transition: 'all 0.2s ease',
                }}
                aria-label={isListeningForChoice ? 'Listening for your option choice' : 'Tap to speak option choice'}
              >
                <span style={{ fontSize: '1.2rem' }}>🎙️</span>
                <span>
                  {isListeningForChoice
                    ? `Listening: Say "1", "2", or "${destinationOptions.length}"`
                    : 'Tap to Speak Option Number'}
                </span>
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {destinationOptions.map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectDestination(opt)}
                    className="btn"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: '10px',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '14px',
                      background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                      border: '2px solid rgba(56, 189, 248, 0.4)',
                      textAlign: 'left',
                      minHeight: '58px',
                      cursor: 'pointer',
                    }}
                    aria-label={`Option ${idx + 1}: ${opt.name}, ${opt.subLabel}, ${opt.distanceText}`}
                  >
                    {/* Big Number Badge */}
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: '#0284c7',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '1.2rem',
                        flexShrink: 0,
                        boxShadow: '0 0 10px rgba(56, 189, 248, 0.5)',
                      }}
                    >
                      {idx + 1}
                    </div>

                    {/* Location Details */}
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                      <span
                        style={{
                          fontSize: '0.98rem',
                          fontWeight: 800,
                          color: '#ffffff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {opt.name}
                      </span>
                      <span
                        style={{
                          fontSize: '0.78rem',
                          color: '#93c5fd',
                          marginTop: '2px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        📍 {opt.subLabel}
                      </span>
                    </div>

                    {/* Distance Badge */}
                    <div
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: '#34d399',
                        background: 'rgba(16, 185, 129, 0.15)',
                        padding: '3px 7px',
                        borderRadius: '6px',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        flexShrink: 0,
                      }}
                    >
                      {opt.distanceText}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ================= VOICE FALLBACK DRAWER (IF MIC REFUSED / UNSUPPORTED) ================= */}
          {voiceFallbackVisible && (
            <div
              style={{
                position: 'fixed',
                bottom: '108px',
                left: '12px',
                right: '12px',
                maxWidth: '540px',
                margin: '0 auto',
                maxHeight: '48vh',
                overflowY: 'auto',
                background: '#151b23',
                border: '3px solid #3b82f6',
                borderRadius: '20px',
                padding: '1rem',
                zIndex: 10000,
                boxShadow: '0 16px 40px rgba(0,0,0,0.95), 0 0 30px rgba(59, 130, 246, 0.45)',
              }}
              role="dialog"
              aria-label="Select Manchester destination"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f5f7fa' }}>
                  📍 Choose Destination
                </span>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setVoiceFallbackVisible(false)}
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.85rem' }}
                >
                  ✕ Close
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {MANCHESTER_PRESETS.map((preset) => (
                  <button
                    key={preset.osmId}
                    type="button"
                    className="btn"
                    onClick={() => handleSelectPreset(preset)}
                    style={{
                      minHeight: '46px',
                      fontSize: '0.95rem',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                    }}
                  >
                    📍 {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
