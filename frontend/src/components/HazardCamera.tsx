import { useEffect, useRef, useState } from 'react';
import { ObstacleDetector, type Prediction } from '../vision/ObjectDetector';
import { speechQueue } from '../speech/SpeechQueue';

const DETECT_INTERVAL_MS = 350;
const CONFIDENCE_THRESHOLD = 0.40;

export function HazardCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<ObstacleDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const detectTimeoutRef = useRef<number | null>(null);
  const latestPredictionsRef = useRef<Prediction[]>([]);
  const runningRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Camera hazard alerts are off.');

  function announce(text: string) {
    if (!runningRef.current) return;
    speechQueue.speak(text, 'CRITICAL');
  }

  if (!detectorRef.current) {
    detectorRef.current = new ObstacleDetector((text) => announce(text));
  }
  if (!sampleCanvasRef.current) {
    sampleCanvasRef.current = document.createElement('canvas');
  }

  function drawDetections(ctx: CanvasRenderingContext2D, predictions: Prediction[]) {
    for (const pred of predictions) {
      if (pred.score < CONFIDENCE_THRESHOLD) continue;
      const [x, y, w, h] = pred.bbox;
      const isClosedDoor = pred.class.includes('closed door');
      const isOpenDoor = pred.class.includes('open doorway') || pred.class.includes('open door');
      const isDoor = isClosedDoor || isOpenDoor;
      const isPerson = pred.class === 'person';
      const isVehicle = ['car', 'bicycle', 'motorcycle', 'bus', 'truck'].includes(pred.class);

      if (isClosedDoor) {
        ctx.strokeStyle = '#ff9900';
        ctx.fillStyle = 'rgba(255, 153, 0, 0.95)';
      } else if (isOpenDoor) {
        ctx.strokeStyle = '#00e676';
        ctx.fillStyle = 'rgba(0, 230, 118, 0.95)';
      } else if (isPerson) {
        ctx.strokeStyle = '#00e5ff';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.95)';
      } else if (isVehicle) {
        ctx.strokeStyle = '#ffd600';
        ctx.fillStyle = 'rgba(255, 214, 0, 0.95)';
      } else {
        ctx.strokeStyle = '#66d9ff';
        ctx.fillStyle = 'rgba(102, 217, 255, 0.9)';
      }

      ctx.lineWidth = isDoor ? 4 : isPerson ? 3.5 : 2.5;
      ctx.strokeRect(x, y, w, h);

      const icon = isDoor ? '🚪 ' : isPerson ? '👤 ' : isVehicle ? '🚗 ' : '';
      const label = `${icon}${pred.class} ${(pred.score * 100).toFixed(0)}%`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(x, Math.max(0, y - 18), textWidth + 8, 18);
      ctx.fillStyle = '#0b0f14';
      ctx.font = 'bold 12px system-ui';
      ctx.fillText(label, x + 4, Math.max(13, y - 4));
    }
  }

  function drawRoiOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 213, 74, 0.6)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 213, 74, 0.9)';
    ctx.font = '12px system-ui';
    ctx.fillText(label, x + 4, y + 14);
    ctx.restore();
  }

  function renderLoop() {
    if (!runningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawDetections(ctx, latestPredictionsRef.current);
        const rects = detectorRef.current?.roiRects;
        if (rects) {
          drawRoiOutline(ctx, rects.ground.x, rects.ground.y, rects.ground.w, rects.ground.h, rects.ground.label);
          drawRoiOutline(ctx, rects.head.x, rects.head.y, rects.head.w, rects.head.h, rects.head.label);
          drawRoiOutline(ctx, rects.door.x, rects.door.y, rects.door.w, rects.door.h, rects.door.label);
        }
      }
    }
    rafIdRef.current = requestAnimationFrame(renderLoop);
  }

  async function detectTick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    const detector = detectorRef.current;
    if (!runningRef.current || !video || !canvas || !sampleCanvas || !detector || video.readyState < 2) {
      if (runningRef.current) detectTimeoutRef.current = window.setTimeout(detectTick, DETECT_INTERVAL_MS);
      return;
    }
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) return;

    try {
      latestPredictionsRef.current = await detector.detectTick(video, sampleCtx, canvas.width, canvas.height);
    } catch (err) {
      console.error('Detection failed', err);
    }

    if (runningRef.current) detectTimeoutRef.current = window.setTimeout(detectTick, DETECT_INTERVAL_MS);
  }

  async function start() {
    setBusy(true);
    setStatus('Loading detection model…');
    try {
      const detector = detectorRef.current!;
      await detector.loadModel((text) => setStatus(text));

      setStatus('Requesting camera access…');
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

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) return resolve();
        video.onloadedmetadata = () => resolve();
      });

      const canvas = canvasRef.current!;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      sampleCanvasRef.current!.width = canvas.width;
      sampleCanvasRef.current!.height = canvas.height;
      detector.computeRoiRects(canvas.width, canvas.height);
      detector.reset();
      latestPredictionsRef.current = [];

      runningRef.current = true;
      setRunning(true);
      setStatus('Camera active. Watching for hazards…');
      rafIdRef.current = requestAnimationFrame(renderLoop);
      detectTimeoutRef.current = window.setTimeout(detectTick, 0);
    } catch (err) {
      console.error(err);
      setStatus('Camera permission denied. Please allow camera access and try again.');
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    runningRef.current = false;
    setRunning(false);
    speechQueue.cancel();
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    if (detectTimeoutRef.current !== null) clearTimeout(detectTimeoutRef.current);
    rafIdRef.current = null;
    detectTimeoutRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setStatus('Camera hazard alerts are off.');
  }

  useEffect(() => {
    return () => {
      if (runningRef.current) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <h2>Live hazard camera</h2>
      <p className="muted">
        Points the camera ahead and speaks an alert for approaching people/vehicles, plus generic
        warnings for ground and head-height obstacles. Nothing is recorded or sent
        anywhere — all processing happens on this device. Shares the same priority speech as
        navigation, so a hazard alert can interrupt a turn-by-turn instruction.
      </p>
      <div className="row" style={{ margin: '0.75rem 0' }}>
        <button type="button" className="btn" onClick={running ? stop : start} disabled={busy} aria-pressed={running}>
          {busy ? 'Starting…' : running ? 'Stop hazard camera' : 'Start hazard camera'}
        </button>
      </div>
      <p className="muted" aria-live="polite">
        {status}
      </p>
      <div className="map-wrap" aria-hidden="true" style={{ position: 'relative', display: running ? 'block' : 'none', minHeight: '260px' }}>
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 1 }}
        />
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
        />
      </div>
    </div>
  );
}
