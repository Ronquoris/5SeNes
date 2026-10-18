import { useEffect, useRef, useState } from 'react';
import type { RouteResponse, RouteStep } from '../api/client';
import { haversineMeters, bearingDegrees, headingDifference } from '../services/geoUtils';
import { playWaypointPing, playTurnCue, playHazardAlertChime, playSpatialTurnCue } from '../services/audioFeedback';
import { speechQueue } from '../speech/SpeechQueue';
import {
  ObstacleDetector,
  type Prediction,
} from '../vision/ObjectDetector';
import { RoadCrossingDetector } from '../vision/RoadCrossingDetector';
import { drawVisionHud } from '../vision/visionHudOverlay';
import { MapView } from './MapView';

/**
 * Ensures pedestrian turn directions explicitly use natural speech like 'Take right', 'Take left'.
 */
export function formatTurnInstruction(instruction: string, maneuver?: string): string {
  let text = instruction || 'Walk forward';
  text = text.replace(/^Turn right\b/i, 'Take right');
  text = text.replace(/^Turn left\b/i, 'Take left');
  text = text.replace(/^Turn slight right\b/i, 'Take slight right');
  text = text.replace(/^Turn slight left\b/i, 'Take slight left');
  text = text.replace(/^Turn sharp right\b/i, 'Take sharp right');
  text = text.replace(/^Turn sharp left\b/i, 'Take sharp left');

  if (maneuver) {
    const m = maneuver.toLowerCase();
    if (m.includes('right') && !text.toLowerCase().includes('right')) {
      text = `Take right, ${text}`;
    } else if (m.includes('left') && !text.toLowerCase().includes('left')) {
      text = `Take left, ${text}`;
    }
  }
  return text;
}

export function getTurnDirection(step?: RouteStep): 'left' | 'right' | 'ahead' {
  if (!step) return 'ahead';
  const m = (step.maneuver || '').toLowerCase();
  const inst = (step.instruction || '').toLowerCase();
  if (m.includes('right') || inst.includes('right')) return 'right';
  if (m.includes('left') || inst.includes('left')) return 'left';
  return 'ahead';
}

interface VoiceCoPilotProps {
  route: RouteResponse;
  initialOrigin?: { lat: number; lon: number };
  destinationLabel?: string;
  destinationCoords?: { lat: number; lon: number };
  onStop?: () => void;
  onArrived?: () => void;
  onCancelRoute?: () => void;
  onRecalculate?: () => void;
}

export function VoiceCoPilot({
  route,
  initialOrigin,
  destinationLabel,
  destinationCoords,
  onStop,
  onArrived,
  onCancelRoute,
  onRecalculate,
}: VoiceCoPilotProps) {
  const defaultOrigin = initialOrigin ?? (route.steps[0]?.location ? { lat: route.steps[0].location.lat, lon: route.steps[0].location.lon } : { lat: 53.4808, lon: -2.2426 });
  const lastStep = route.steps[route.steps.length - 1];
  const destCoords = destinationCoords ?? (lastStep?.location ? { lat: lastStep.location.lat, lon: lastStep.location.lon } : undefined);

  // Navigation State
  const [active, setActive] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [currentCoords, setCurrentCoords] = useState(defaultOrigin);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [distToCorner, setDistToCorner] = useState(0);
  const [remainingMeters, setRemainingMeters] = useState(route.distanceMeters);
  const [veering, setVeering] = useState<'left' | 'right' | null>(null);

  // Vision Co-Pilot State
  const [latestVisionHazard, setLatestVisionHazard] = useState<{ text: string; time: string } | null>(null);

  // Refs for tracking triggers and animation
  const activeRef = useRef(true);
  const stepIndexRef = useRef(0);
  const coordsRef = useRef(defaultOrigin);
  const alerted20mRef = useRef(false);
  const alerted8mRef = useRef(false);
  const alerted2mRef = useRef(false);
  const lastVeerAlertTimeRef = useRef(0);
  const watchIdRef = useRef<number | null>(null);
  const latestHazardRef = useRef<{ text: string; time: number } | null>(null);

  // Camera & vision refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<ObstacleDetector | null>(null);
  const crossingDetectorRef = useRef<RoadCrossingDetector | null>(null);
  const crossingTickRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const detectTimeoutRef = useRef<number | null>(null);
  const latestPredictionsRef = useRef<Prediction[]>([]);

  const currentStep: RouteStep | undefined = route.steps[stepIndex];
  const nextStep: RouteStep | undefined = route.steps[stepIndex + 1];

  // Helper to speak with priority
  function speak(text: string, priority: 'CRITICAL' | 'NAVIGATION' | 'INFO' = 'NAVIGATION') {
    speechQueue.speak(text, priority);
  }

  // Vision hazard callback
  function handleVisionHazard(text: string) {
    if (!activeRef.current || speechQueue.isListening()) return;
    playHazardAlertChime();
    speak(text, 'CRITICAL');
    const timeStr = new Date().toLocaleTimeString('en-GB');
    setLatestVisionHazard({ text, time: timeStr });
    latestHazardRef.current = { text, time: Date.now() };
  }

  if (!detectorRef.current) {
    detectorRef.current = new ObstacleDetector((text) => handleVisionHazard(text));
  }
  if (!crossingDetectorRef.current) {
    crossingDetectorRef.current = new RoadCrossingDetector((text) => {
      if (!activeRef.current || speechQueue.isListening()) return;
      playHazardAlertChime();
      speak(text, 'CRITICAL');
      setLatestVisionHazard({ text, time: new Date().toLocaleTimeString('en-GB') });
    });
  }
  if (!sampleCanvasRef.current) {
    sampleCanvasRef.current = document.createElement('canvas');
  }

  // Start Camera Stream
  async function startCamera() {
    try {
      const detector = detectorRef.current!;
      await detector.loadModel();

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
        detector.computeRoiRects(w, h);
        detector.reset();
      }

      if (video.readyState >= 2 || video.videoWidth > 0) {
        setupDimensions();
      } else {
        video.onloadedmetadata = () => setupDimensions();
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
      detectTimeoutRef.current = window.setTimeout(detectTick, 0);
    } catch (err) {
      console.warn('Camera could not start in Co-Pilot:', err);
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
  }

  function renderLoop() {
    if (!activeRef.current) return;
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
            statusText: latestVisionHazard?.text,
            showRoiGuides: true,
            targetModel: 'all',
          }
        );
      }
    }
    rafIdRef.current = requestAnimationFrame(renderLoop);
  }

  const isDetectingRef = useRef(false);

  async function detectTick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    const detector = detectorRef.current;
    if (!activeRef.current || !video || !canvas || !sampleCanvas || !detector || (video.readyState < 2 && video.videoWidth === 0)) {
      if (activeRef.current) detectTimeoutRef.current = window.setTimeout(detectTick, 80);
      return;
    }

    if (isDetectingRef.current) {
      if (activeRef.current) detectTimeoutRef.current = window.setTimeout(detectTick, 40);
      return;
    }

    isDetectingRef.current = true;
    try {
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (sampleCtx) {
        latestPredictionsRef.current = await detector.detectTick(video, sampleCtx, canvas.width, canvas.height);
        const crossingDetector = crossingDetectorRef.current;
        crossingTickRef.current = (crossingTickRef.current + 1) % 2;
        if (crossingDetector && crossingTickRef.current === 0) {
          crossingDetector.detectCrossing(
            sampleCtx,
            latestPredictionsRef.current,
            canvas.width,
            canvas.height
          );
        }
      }
    } catch {
      // Ignore background inference blips
    } finally {
      isDetectingRef.current = false;
    }

    if (activeRef.current) detectTimeoutRef.current = window.setTimeout(detectTick, 160);
  }

  // Device Orientation listener
  useEffect(() => {
    function handleOrientation(e: DeviceOrientationEvent) {
      if (!activeRef.current) return;
      let heading: number | null = null;
      if ('webkitCompassHeading' in e && typeof (e as any).webkitCompassHeading === 'number') {
        heading = (e as any).webkitCompassHeading;
      } else if (e.alpha !== null) {
        heading = 360 - e.alpha;
      }
      if (heading !== null) {
        setCompassHeading(Math.round(heading));
        checkVeering(heading);
      }
    }

    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function checkVeering(currentHeading: number) {
    if (!currentStep || !nextStep || speechQueue.isListening()) return;
    const expectedBearing = bearingDegrees(
      currentStep.location.lat,
      currentStep.location.lon,
      nextStep.location.lat,
      nextStep.location.lon
    );
    const diff = headingDifference(currentHeading, expectedBearing);
    const now = Date.now();

    if (Math.abs(diff) > 35) {
      const direction = diff > 0 ? 'right' : 'left';
      // Announce ONCE when entering veering state; suppress repetitive loop if stationary (<25s)
      if (veering !== direction || now - lastVeerAlertTimeRef.current > 25000) {
        lastVeerAlertTimeRef.current = now;
        setVeering(direction);
        speak(`Veering ${direction}. Turn slightly ${diff > 0 ? 'left' : 'right'} to stay on path.`, 'NAVIGATION');
      }
    } else if (Math.abs(diff) <= 20) {
      setVeering(null);
    }
  }

  // Process GPS position update
  function processPosition(pos: { lat: number; lon: number }) {
    setCurrentCoords(pos);
    coordsRef.current = pos;

    const step = route.steps[stepIndexRef.current];
    if (!step) return;

    const dist = Math.round(
      haversineMeters(pos.lat, pos.lon, step.location.lat, step.location.lon)
    );
    setDistToCorner(dist);

    let rem = 0;
    for (let i = stepIndexRef.current; i < route.steps.length; i++) {
      rem += route.steps[i].distanceMeters;
    }
    setRemainingMeters(rem);

    if (speechQueue.isListening()) return;

    // Hazard checks on the step
    if (step.hazardWarnings && step.hazardWarnings.length > 0 && dist < 25 && !alerted20mRef.current) {
      const topHazard = step.hazardWarnings[0];
      playHazardAlertChime();
      speak(`Caution: Reported ${topHazard.type} ahead in about ${dist} metres.`, 'CRITICAL');
    }

    // 20m warning
    if (dist <= 22 && dist > 12 && !alerted20mRef.current) {
      alerted20mRef.current = true;
      const dir = getTurnDirection(step);
      playSpatialTurnCue(dir);
      const spoken = formatTurnInstruction(step.instruction, step.maneuver);
      speak(`In 20 metres, ${spoken}.`, 'NAVIGATION');
    }

    // 8m prompt
    if (dist <= 10 && dist > 3 && !alerted8mRef.current) {
      alerted8mRef.current = true;
      const dir = getTurnDirection(step);
      playSpatialTurnCue(dir);
      const spoken = formatTurnInstruction(step.instruction, step.maneuver);
      speak(`In a few steps, ${spoken}.`, 'NAVIGATION');
    }

    // 2m transition (executing the turn)
    if (dist <= 3 && !alerted2mRef.current) {
      alerted2mRef.current = true;
      const dir = getTurnDirection(step);
      playSpatialTurnCue(dir);
      const spoken = formatTurnInstruction(step.instruction, step.maneuver);
      speak(`${spoken} now.`, 'NAVIGATION');

      const nextIdx = stepIndexRef.current + 1;
      if (nextIdx < route.steps.length) {
        stepIndexRef.current = nextIdx;
        setStepIndex(nextIdx);
        alerted20mRef.current = false;
        alerted8mRef.current = false;
        alerted2mRef.current = false;

        const following = route.steps[nextIdx];
        if (following) {
          setTimeout(() => {
            if (activeRef.current) {
              const fDir = getTurnDirection(following);
              playSpatialTurnCue(fDir);
              const fSpoken = formatTurnInstruction(following.instruction, following.maneuver);
              speak(`Then, in ${following.distanceMeters} metres: ${fSpoken}.`, 'NAVIGATION');
            }
          }, 2400);
        }
      } else {
        // Arrived at destination
        playTurnCue();
        speak('You have arrived at your destination.', 'NAVIGATION');
        handleStop();
        onArrived?.();
      }
    }
  }

  // Simulation step for testing without physical walking: advances 5m towards current step waypoint
  function handleSimulateStep() {
    const step = route.steps[stepIndexRef.current];
    if (!step) return;
    const current = coordsRef.current;
    const target = step.location;

    const bearing = bearingDegrees(current.lat, current.lon, target.lat, target.lon);
    const dLat = (5 * Math.cos((bearing * Math.PI) / 180)) / 111111;
    const dLon = (5 * Math.sin((bearing * Math.PI) / 180)) / (111111 * Math.cos((current.lat * Math.PI) / 180));
    const nextPos = { lat: current.lat + dLat, lon: current.lon + dLon };

    processPosition(nextPos);
  }

  // Advance to next turn step directly (instant turn testing)
  function handleNextTurn() {
    if (stepIndexRef.current < route.steps.length - 1) {
      const nextIdx = stepIndexRef.current + 1;
      stepIndexRef.current = nextIdx;
      setStepIndex(nextIdx);
      alerted20mRef.current = false;
      alerted8mRef.current = false;
      alerted2mRef.current = false;

      const nextSt = route.steps[nextIdx];
      if (nextSt) {
        setCurrentCoords(nextSt.location);
        coordsRef.current = nextSt.location;
        const dir = getTurnDirection(nextSt);
        playSpatialTurnCue(dir);
        const formatted = formatTurnInstruction(nextSt.instruction, nextSt.maneuver);
        speak(`${formatted}, then continue for ${nextSt.distanceMeters} metres.`, 'NAVIGATION');
      }
    }
  }

  // Return to previous turn step
  function handlePreviousTurn() {
    if (stepIndexRef.current > 0) {
      const prevIdx = stepIndexRef.current - 1;
      stepIndexRef.current = prevIdx;
      setStepIndex(prevIdx);
      alerted20mRef.current = false;
      alerted8mRef.current = false;
      alerted2mRef.current = false;

      const prevSt = route.steps[prevIdx];
      if (prevSt) {
        setCurrentCoords(prevSt.location);
        coordsRef.current = prevSt.location;
        const dir = getTurnDirection(prevSt);
        playSpatialTurnCue(dir);
        const formatted = formatTurnInstruction(prevSt.instruction, prevSt.maneuver);
        speak(`Back to previous step: ${formatted}.`, 'NAVIGATION');
      }
    }
  }

  // Repeat current step instruction with spatial cue
  function handleRepeat() {
    if (!currentStep) return;
    const dir = getTurnDirection(currentStep);
    playSpatialTurnCue(dir);
    const spoken = formatTurnInstruction(currentStep.instruction, currentStep.maneuver);
    speak(`Current instruction: ${spoken}. Corner is ${distToCorner} metres away.`, 'INFO');
  }

  // Speak current location description
  function handleWhereAmI() {
    playTurnCue();
    const step = route.steps[stepIndexRef.current];
    const remKm = (remainingMeters / 1000).toFixed(1);
    const dest = destinationLabel ? `heading towards ${destinationLabel}` : '';
    const spokenStep = step ? formatTurnInstruction(step.instruction, step.maneuver) : '';
    const text = step
      ? `You are on the path ${dest}. Next turn: ${spokenStep} in ${distToCorner} metres. ${remKm} kilometres remaining.`
      : `Walking route active, ${remKm} km to destination.`;
    speak(text, 'INFO');
  }

  // Start Voice Co-Pilot
  async function handleStart() {
    activeRef.current = true;
    setActive(true);
    stepIndexRef.current = 0;
    setStepIndex(0);
    alerted20mRef.current = false;
    alerted8mRef.current = false;
    alerted2mRef.current = false;

    // Start Camera in background
    await startCamera();

    // Start GPS Watch
    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (!activeRef.current) return;
          processPosition({ lat: position.coords.latitude, lon: position.coords.longitude });
        },
        (err) => {
          console.warn('GPS error in Co-Pilot:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 6000 }
      );
    }

    // Initial announcement
    const firstStep = route.steps[0];
    const firstDir = getTurnDirection(firstStep);
    playSpatialTurnCue(firstDir);
    const firstSpoken = firstStep ? formatTurnInstruction(firstStep.instruction, firstStep.maneuver) : 'Head forward';
    const initialPrompt = firstStep
      ? `Starting Voice Co-Pilot to ${destinationLabel ?? 'destination'}. First: ${firstSpoken}, for ${firstStep.distanceMeters} metres.`
      : 'Starting Voice Co-Pilot.';
    speak(initialPrompt, 'NAVIGATION');
  }

  // Stop Voice Co-Pilot
  function handleStop() {
    activeRef.current = false;
    setActive(false);
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    stopCamera();
    speechQueue.speak('Navigation stopped.', 'INFO');
    if (onCancelRoute) onCancelRoute();
    else if (onStop) onStop();
  }

  // Auto-start on mount
  useEffect(() => {
    handleStart();
    return () => {
      activeRef.current = false;
      setActive(false);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getManeuverIcon(maneuver: string): string {
    switch (maneuver) {
      case 'turn-left':
      case 'sharp-left':
        return '⬅️';
      case 'slight-left':
        return '↖️';
      case 'turn-right':
      case 'sharp-right':
        return '➡️';
      case 'slight-right':
        return '↗️';
      case 'straight':
        return '⬆️';
      case 'u-turn':
        return '↩️';
      default:
        return '🚶';
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        flex: 1,
        minHeight: 0,
        padding: '0.4rem 0.75rem 0.75rem',
        gap: '10px',
        overflowY: 'auto',
      }}
      aria-label="Voice Co-Pilot Walking Navigation"
    >
      {/* Slim Top Navigation Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.45rem 0.85rem',
          background: 'rgba(13, 19, 29, 0.95)',
          border: `1.5px solid ${getTurnDirection(currentStep) === 'right' ? '#00FF66' : getTurnDirection(currentStep) === 'left' ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)'}`,
          borderRadius: '14px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
          gap: '10px',
          flexShrink: 0,
          cursor: 'pointer',
        }}
        onClick={handleRepeat}
        role="region"
        aria-live="assertive"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: '1.6rem', flexShrink: 0, lineHeight: 1 }} aria-hidden="true">
            {currentStep ? getManeuverIcon(currentStep.maneuver) : '🚶'}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: '1rem',
                  fontWeight: 900,
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {currentStep ? formatTurnInstruction(currentStep.instruction, currentStep.maneuver) : 'Walk forward'}
              </span>
              {getTurnDirection(currentStep) !== 'ahead' && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 900,
                    padding: '2px 6px',
                    borderRadius: '6px',
                    background: getTurnDirection(currentStep) === 'right' ? 'rgba(0, 255, 102, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                    color: getTurnDirection(currentStep) === 'right' ? '#00FF66' : '#38bdf8',
                    border: `1px solid ${getTurnDirection(currentStep) === 'right' ? '#00FF66' : '#38bdf8'}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getTurnDirection(currentStep) === 'right' ? 'TAKE RIGHT' : 'TAKE LEFT'}
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.78rem', color: '#93c5fd', fontWeight: 700 }}>
              {distToCorner}m to turn · {remainingMeters}m to {destinationLabel ?? 'destination'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleStop();
          }}
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1.5px solid #ef4444',
            color: '#ef4444',
            padding: '5px 12px',
            borderRadius: '10px',
            fontSize: '0.82rem',
            fontWeight: 800,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          aria-label="Exit navigation"
        >
          ✕ Exit
        </button>
      </div>

      {/* 1. Live Camera Feed with YOLOv8 Overlay */}
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
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            zIndex: 10,
            background: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid rgba(0, 255, 102, 0.4)',
            color: '#00FF66',
            borderRadius: '12px',
            padding: '3px 9px',
            fontSize: '0.72rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            letterSpacing: '0.5px',
          }}
        >
          <span>●</span> CAMERA · LIVE
        </div>

        {latestVisionHazard && (
          <div
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              zIndex: 10,
              background: 'rgba(239, 68, 68, 0.92)',
              color: '#ffffff',
              borderRadius: '12px',
              padding: '3px 10px',
              fontSize: '0.75rem',
              fontWeight: 900,
              boxShadow: '0 0 12px rgba(239, 68, 68, 0.8)',
            }}
          >
            ⚠️ {latestVisionHazard.text}
          </div>
        )}

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
            zIndex: 2,
          }}
        />
      </div>

      {/* 2. Live GPS Route Map */}
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
          <span style={{ color: '#00FF66' }}>●</span> GPS ROUTE · {remainingMeters}m
        </div>
        <MapView
          origin={defaultOrigin}
          userLocation={currentCoords}
          destination={destCoords}
          routeCoordinates={route.geometry.coordinates}
          showGoogleMapsButton={false}
          followUser={true}
        />
      </div>

      {/* Navigation Control Bar: Left / Repeat / Right / Step */}
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, paddingBottom: '98px', flexWrap: 'nowrap' }}>
        <button
          type="button"
          className="btn secondary"
          onClick={handlePreviousTurn}
          disabled={stepIndex <= 0}
          style={{
            flex: 1,
            minHeight: '44px',
            fontSize: '0.8rem',
            fontWeight: 800,
            padding: '0.35rem 0.3rem',
            borderRadius: '12px',
            opacity: stepIndex <= 0 ? 0.4 : 1,
          }}
          title="Previous Turn / Step"
        >
          ⏮️ Prev Turn
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={handleRepeat}
          style={{
            flex: 1.2,
            minHeight: '44px',
            fontSize: '0.84rem',
            fontWeight: 800,
            padding: '0.35rem 0.4rem',
            borderRadius: '12px',
          }}
          title="Repeat current instruction"
        >
          🔊 Repeat
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={handleNextTurn}
          disabled={stepIndex >= route.steps.length - 1}
          style={{
            flex: 1,
            minHeight: '44px',
            fontSize: '0.8rem',
            fontWeight: 800,
            padding: '0.35rem 0.3rem',
            borderRadius: '12px',
            opacity: stepIndex >= route.steps.length - 1 ? 0.4 : 1,
          }}
          title="Next Turn / Step"
        >
          ⏭️ Next Turn
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={handleSimulateStep}
          style={{
            flex: 1,
            minHeight: '44px',
            fontSize: '0.8rem',
            fontWeight: 800,
            padding: '0.35rem 0.3rem',
            borderRadius: '12px',
          }}
          title="Simulate walking 5m forward"
        >
          🚶 Step 5m
        </button>
      </div>
    </div>
  );
}
