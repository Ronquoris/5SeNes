import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ObstacleDetector, type Prediction, type DetectionEngine } from '../vision/ObjectDetector';
import { estimateDistance } from '../vision/distanceEstimator';
import { speechQueue } from '../speech/SpeechQueue';

const DETECT_INTERVAL_MS = 350;
const CONFIDENCE_THRESHOLD = 0.35;

interface AlertItem {
  id: string;
  time: string;
  text: string;
}

export function HomePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<ObstacleDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const detectTimeoutRef = useRef<number | null>(null);
  const latestPredictionsRef = useRef<Prediction[]>([]);
  const runningRef = useRef(false);

  const [activeEngine, setActiveEngine] = useState<DetectionEngine>('yolov8');
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Press "Start camera" to begin obstacle detection.');
  const [currentAlert, setCurrentAlert] = useState<string | null>(null);

  async function handleToggleEngine() {
    const next: DetectionEngine = activeEngine === 'yolov8' ? 'coco-ssd' : 'yolov8';
    setActiveEngine(next);
    if (detectorRef.current) {
      await detectorRef.current.setEngine(next, (text) => setStatus(text));
      speechQueue.speak(`Detection engine switched to ${next === 'yolov8' ? 'YOLO version 8' : 'COCO SSD'}.`, 'INFO');
    }
  }
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  function announce(text: string) {
    if (!runningRef.current) return;
    speechQueue.speak(text, 'CRITICAL');
    setCurrentAlert(text);
    const time = new Date().toLocaleTimeString('en-GB');
    setAlerts((prev) => [{ id: Math.random().toString(36).substring(2, 9), time, text }, ...prev.slice(0, 7)]);
  }

  if (!detectorRef.current) {
    detectorRef.current = new ObstacleDetector((text) => announce(text));
  }
  if (!sampleCanvasRef.current) {
    sampleCanvasRef.current = document.createElement('canvas');
  }

  useEffect(() => {
    return () => {
      if (runningRef.current) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      const est = estimateDistance(pred.bbox, pred.class, ctx.canvas.width, ctx.canvas.height);
      const distStr = est ? ` ~${est.distanceText}` : '';
      const icon = isDoor ? '🚪 ' : isPerson ? '👤 ' : isVehicle ? '🚗 ' : '';
      const label = `${icon}${pred.class}${distStr} ${(pred.score * 100).toFixed(0)}%`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(x, Math.max(0, y - 20), textWidth + 10, 20);
      ctx.fillStyle = '#0b0f14';
      ctx.font = 'bold 13px system-ui';
      ctx.fillText(label, x + 5, Math.max(14, y - 5));
    }
  }

  function drawRoiOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 213, 74, 0.7)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 213, 74, 0.95)';
    ctx.font = '12px system-ui';
    ctx.fillText(label, x + 6, y + 16);
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
      console.error('Detection tick failed', err);
    }

    if (runningRef.current) detectTimeoutRef.current = window.setTimeout(detectTick, DETECT_INTERVAL_MS);
  }

  async function start() {
    setBusy(true);
    setStatus('Loading detection model (YOLOv8)…');
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
      setStatus('Camera active. Watching for obstacles & hazards…');
      rafIdRef.current = requestAnimationFrame(renderLoop);
      detectTimeoutRef.current = window.setTimeout(detectTick, 0);
    } catch (err) {
      console.error('Camera start failed:', err);
      setStatus(
        'Camera access denied or unavailable. Ensure HTTPS or camera permissions are granted in your browser settings.'
      );
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
    setStatus('Camera is off.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Hero / Obstacle Detection Controls */}
      <section className="card" aria-label="Live Obstacle Alerts">
        <h2>Live Obstacle & Hazard Detection</h2>
        <p className="muted">
          On-device camera hazard detection. Points forward to identify approaching people, vehicles, low-hanging
          branches, steps, and slopes. Nothing is recorded or sent to any server.
        </p>

        <div className="camera-controls" style={{ margin: '1rem 0 0.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={running ? stop : start}
            disabled={busy}
            aria-pressed={running}
          >
            {busy ? 'Starting camera…' : running ? '⏹ Stop camera' : '▶ Start camera'}
          </button>
          <button
            type="button"
            className="btn secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
            onClick={handleToggleEngine}
            disabled={busy}
            title="Toggle detection model between YOLOv8 and COCO-SSD"
          >
            {activeEngine === 'yolov8' ? '⚡ Engine: YOLOv8' : '🔄 Engine: COCO-SSD'}
          </button>
          <span className={`camera-indicator ${running ? 'on' : ''}`}>
            {running ? '● Camera active' : '● Camera off'}
          </span>
        </div>

        <p className="muted" aria-live="polite" style={{ marginTop: '0.4rem' }}>
          {status}
        </p>

        {/* Video / Canvas Preview */}
        <div className="camera-preview-container" aria-label="Camera preview with detection overlay" style={{ position: 'relative' }}>
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: running ? 'block' : 'none', position: 'absolute', top: 0, left: 0, zIndex: 1 }}
          />
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: running ? 'block' : 'none', position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
          />
          {!running && (
            <div className="camera-placeholder">
              <span className="camera-placeholder-icon">📷</span>
              <p>Press <strong>Start camera</strong> to begin live obstacle tracking and hazard announcements.</p>
            </div>
          )}
        </div>
      </section>

      {/* Live Alerts Section */}
      <section className="card" aria-label="Hazard alerts">
        <h2>Hazard Alerts</h2>
        <div className="alert-live-banner" aria-live="assertive">
          <span>⚠️</span>
          <span>{currentAlert ? currentAlert : 'No alerts yet. Active hazard warnings will appear here.'}</span>
        </div>

        {alerts.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--muted)', margin: '0 0 0.5rem' }}>Recent Alerts</h3>
            <ul className="alert-log-list" id="alertLog">
              {alerts.map((item) => (
                <li key={item.id} className="alert-log-item">
                  <span>{item.text}</span>
                  <span className="time-badge">{item.time}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Quick Access to other 5Sense modules */}
      <section className="card" aria-label="Quick navigation">
        <h2>More 5Sense Services</h2>
        <p className="muted">Explore turn-by-turn navigation, nearby accessible venues, hazard reporting, or emergency SOS.</p>
        <div className="row" style={{ marginTop: '0.8rem' }}>
          <Link className="btn" to="/navigate">
            🗺️ Live Voice Navigation
          </Link>
          <Link className="btn secondary" to="/nearby">
            📍 What's around me
          </Link>
          <Link className="btn secondary" to="/hazards">
            ⚠️ Hazards nearby
          </Link>
          <Link className="btn secondary" to="/sos">
            🆘 SOS Emergency
          </Link>
        </div>
      </section>

      {/* How this works */}
      <section className="card" aria-label="How detection works">
        <h2>How this works</h2>
        <ul className="help-list">
          <li>
            <strong>Approaching objects:</strong> Detects people, vehicles, cyclists, and obstacles using a state-of-the-art
            on-device YOLOv8 model (with instant COCO-SSD rollback), warning when an object is approaching or very close.
          </li>
          <li>
            <strong>Ground & Head checks:</strong> Watches a ground strip and a head-height strip of the frame for
            sudden, sustained anomalies, giving a generic <em>"watch your step"</em> or <em>"obstacle ahead, duck"</em> alert.
          </li>
          <li>
            <strong>Closed door detection:</strong> Analyzes the central corridor for vertical door frame jambs, lintel
            contrast, and solid planar barriers to warn <em>"closed door ahead"</em>.
          </li>
          <li>
            <strong>Voice & Accessibility:</strong> All hazard alerts are prioritized and spoken through speech
            synthesis, and rendered to screen readers via ARIA live regions.
          </li>
        </ul>
      </section>
    </div>
  );
}
