(() => {
  'use strict';

  // ---- config ----
  const DETECT_INTERVAL_MS = 350;
  const COOLDOWN_MS = 3000;
  const GROWTH_THRESHOLD = 1.18; // bbox height must grow 18%+ across the tracked window to count as "approaching"
  const CONFIDENCE_THRESHOLD = 0.55;
  const TRACK_STALE_MS = 1200;
  const TRACK_MATCH_MAX_DIST_FRAC = 0.18; // fraction of frame width/height for centroid matching
  const HAZARD_CLASSES = new Set(['person', 'car', 'bicycle', 'motorcycle', 'bus', 'truck', 'dog']);

  // "near" = bbox height fills this much of the frame. No real depth sensor here, so this is a
  // size-based proxy for "about 1 metre away", tuned by eye — adjust if it fires too early/late.
  const NEAR_HEIGHT_FRAC = 0.45;
  const NEAR_COOLDOWN_MS = 2500;

  const ROI_HISTORY_LEN = 12;
  const ROI_MIN_HISTORY = 6;
  const GROUND_STD_MULTIPLIER = 2.4;
  const HEAD_STD_MULTIPLIER = 2.8;
  // an anomaly must hold for this many consecutive ticks before we announce it — this is what
  // keeps the generic "obstacle ahead" alert from firing on a single noisy frame, and doubles as
  // a crude proxy for "something is close and staying close" rather than a passing glint.
  const ROI_PERSISTENCE_REQUIRED = 3;

  const STAIR_OSCILLATION_THRESHOLD = 4;
  const STAIR_MIN_AMPLITUDE = 6;
  const STAIR_PERSISTENCE_REQUIRED = 3;

  const SLOPE_DELTA_THRESHOLD_DEG = 8;
  const SLOPE_PERSISTENCE_REQUIRED = 5; // consecutive orientation samples
  const SLOPE_COOLDOWN_MS = 6000;
  const SLOPE_SMOOTHING = 0.15; // exponential moving average weight for new samples

  // ---- dom ----
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const toggleBtn = document.getElementById('toggleBtn');
  const cameraIndicator = document.getElementById('cameraIndicator');
  const statusText = document.getElementById('statusText');
  const alertLive = document.getElementById('alertLive');
  const alertLog = document.getElementById('alertLog');

  // Detection/ROI pixel sampling happens on a hidden, off-DOM canvas that holds nothing but the
  // raw video frame — kept separate from the visible canvas so our own overlay graphics (boxes,
  // dashed ROI outlines) never get sampled as if they were part of the scene.
  const sampleCanvas = document.createElement('canvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  // ---- state ----
  let stream = null;
  let model = null;
  let running = false;
  let detectTimeoutId = null;
  let rafId = null;
  let tracks = []; // { id, class, box:[x,y,w,h], score, heightHistory:[{h,t}], lastSeen }
  let nextTrackId = 1;
  const lastAnnounceAt = new Map(); // key -> timestamp
  let groundHistory = [];
  let headHistory = [];
  let groundAnomalyStreak = 0;
  let headAnomalyStreak = 0;
  let stairStreak = 0;
  let latestPredictions = []; // last completed detection, drawn every render frame regardless of detect cadence
  let roiRects = null; // computed once per camera size: { ground, head, stair }

  // phone-tilt based slope detection
  let baselineBeta = null;
  let smoothedBeta = null;
  let slopeState = 'flat';
  let slopeStreak = 0;
  let orientationEnabled = false;

  function setStatus(text) {
    statusText.textContent = text;
  }

  function setCameraOn(on) {
    cameraIndicator.textContent = on ? '● Camera active' : '● Camera off';
    cameraIndicator.classList.toggle('on', on);
  }

  function logAlert(text) {
    alertLive.textContent = text;
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString('en-GB');
    li.textContent = `${time} — ${text}`;
    alertLog.prepend(li);
    while (alertLog.children.length > 6) {
      alertLog.removeChild(alertLog.lastChild);
    }
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // a new hazard alert always interrupts whatever is currently speaking
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  }

  function announce(key, text, cooldownMs = COOLDOWN_MS) {
    const now = performance.now();
    const last = lastAnnounceAt.get(key) || 0;
    if (now - last < cooldownMs) return;
    lastAnnounceAt.set(key, now);
    speak(text);
    logAlert(text);
  }

  function positionLabel(centerXFrac) {
    if (centerXFrac < 0.33) return 'left';
    if (centerXFrac > 0.66) return 'right';
    return 'center';
  }

  // ---- naive per-class nearest-centroid tracker ----
  function updateTracks(predictions) {
    const now = performance.now();
    const w = canvas.width;
    const h = canvas.height;
    const maxDist = Math.hypot(w, h) * TRACK_MATCH_MAX_DIST_FRAC;
    const usedTrackIds = new Set();
    const results = [];

    for (const pred of predictions) {
      if (pred.score < CONFIDENCE_THRESHOLD) continue;
      const [x, y, bw, bh] = pred.bbox;
      const cx = x + bw / 2;
      const cy = y + bh / 2;

      let best = null;
      let bestDist = Infinity;
      for (const track of tracks) {
        if (track.class !== pred.class || usedTrackIds.has(track.id)) continue;
        const lastBox = track.box;
        const lcx = lastBox[0] + lastBox[2] / 2;
        const lcy = lastBox[1] + lastBox[3] / 2;
        const dist = Math.hypot(cx - lcx, cy - lcy);
        if (dist < maxDist && dist < bestDist) {
          best = track;
          bestDist = dist;
        }
      }

      if (best) {
        usedTrackIds.add(best.id);
        best.box = [x, y, bw, bh];
        best.score = pred.score;
        best.lastSeen = now;
        best.heightHistory.push({ h: bh, t: now });
        if (best.heightHistory.length > 5) best.heightHistory.shift();
        results.push(best);
      } else {
        const track = {
          id: nextTrackId++,
          class: pred.class,
          box: [x, y, bw, bh],
          score: pred.score,
          lastSeen: now,
          heightHistory: [{ h: bh, t: now }],
        };
        results.push(track);
      }
    }

    tracks = results.filter((t) => now - t.lastSeen < TRACK_STALE_MS);
    return tracks;
  }

  function classifyAndAnnounceHazards(liveTracks) {
    for (const track of liveTracks) {
      if (!HAZARD_CLASSES.has(track.class)) continue;

      const cxFrac = (track.box[0] + track.box[2] / 2) / canvas.width;
      const position = positionLabel(cxFrac);
      const heightFrac = track.box[3] / canvas.height;

      // named "very close" alert — fires once the object's box fills enough of the frame,
      // regardless of whether it's still actively closing in.
      if (heightFrac >= NEAR_HEIGHT_FRAC) {
        announce(`${track.class}-${position}-near`, `${track.class} very close, ${position}`, NEAR_COOLDOWN_MS);
      }

      if (track.heightHistory.length < 3) continue;
      const earliest = track.heightHistory[0].h;
      const latest = track.heightHistory[track.heightHistory.length - 1].h;
      if (earliest <= 0) continue;
      const growthRate = latest / earliest;

      if (growthRate >= GROWTH_THRESHOLD) {
        announce(`${track.class}-${position}`, `${track.class} approaching, ${position}`);
      }
    }
  }

  // ---- classical-CV ROI heuristics for potholes / head-height branches / stairs ----
  // All sampling below reads from sampleCtx (the hidden, overlay-free canvas) — never ctx.
  function sampleRoiMetrics(x, y, w, h, step = 4) {
    const data = sampleCtx.getImageData(x, y, w, h).data;
    let sumBrightness = 0;
    let edgeSum = 0;
    let count = 0;
    for (let row = 0; row < h; row += step) {
      let prevGray = null;
      for (let col = 0; col < w; col += step) {
        const idx = (row * w + col) * 4;
        const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        sumBrightness += gray;
        count++;
        if (prevGray !== null) edgeSum += Math.abs(gray - prevGray);
        prevGray = gray;
      }
    }
    if (count === 0) return { brightness: 0, edge: 0 };
    return { brightness: sumBrightness / count, edge: edgeSum / count };
  }

  function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function std(arr, m) {
    return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
  }

  // returns true/false only — caller owns persistence counting and announcing
  function detectRoiAnomaly(history, metrics, stdMultiplier) {
    history.push(metrics);
    while (history.length > ROI_HISTORY_LEN) history.shift();
    if (history.length < ROI_MIN_HISTORY) return false;

    const past = history.slice(0, -1);
    const bMean = mean(past.map((p) => p.brightness));
    const bStd = std(past.map((p) => p.brightness), bMean) || 1;
    const eMean = mean(past.map((p) => p.edge));
    const eStd = std(past.map((p) => p.edge), eMean) || 1;

    const brightnessDeviation = Math.abs(metrics.brightness - bMean) / bStd;
    const edgeDeviation = Math.abs(metrics.edge - eMean) / eStd;

    return brightnessDeviation > stdMultiplier || edgeDeviation > stdMultiplier;
  }

  // crude "repeated horizontal banding" check — stairs tend to produce alternating light/dark
  // rows (tread/riser shadow); regular fences, railings or tiled floors can also trigger this,
  // so treat it as a hint, not a confirmed stair detector.
  function detectStairBanding(x, y, w, h) {
    const data = sampleCtx.getImageData(x, y, w, h).data;
    const rowAverages = [];
    for (let row = 0; row < h; row += 2) {
      let sum = 0;
      let count = 0;
      for (let col = 0; col < w; col += 6) {
        const idx = (row * w + col) * 4;
        sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
      if (count > 0) rowAverages.push(sum / count);
    }
    if (rowAverages.length < 6) return false;

    const avg = mean(rowAverages);
    const amplitude = std(rowAverages, avg);
    if (amplitude < STAIR_MIN_AMPLITUDE) return false; // too flat/uniform to be banding

    let crossings = 0;
    let above = rowAverages[0] > avg;
    for (let i = 1; i < rowAverages.length; i++) {
      const isAbove = rowAverages[i] > avg;
      if (isAbove !== above) {
        crossings++;
        above = isAbove;
      }
    }
    return crossings >= STAIR_OSCILLATION_THRESHOLD;
  }

  function drawRoiOutline(x, y, w, h, label) {
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

  // Fixed regions, computed once per camera resolution (they don't depend on per-frame content).
  function computeRoiRects(w, h) {
    const groundW = Math.round(w * 0.4);
    const groundH = Math.round(h * 0.2);
    const headW = Math.round(w * 0.5);
    const headH = Math.round(h * 0.15);
    const stairW = w;
    const stairH = Math.round(h * 0.4);
    return {
      ground: { x: Math.round((w - groundW) / 2), y: h - groundH, w: groundW, h: groundH, label: 'ground check' },
      head: { x: Math.round((w - headW) / 2), y: 0, w: headW, h: headH, label: 'head check' },
      stair: { x: 0, y: h - stairH, w: stairW, h: stairH, label: 'stair check' },
    };
  }

  // Sampling only — reads the clean frame on sampleCtx and updates streak/announce state.
  // Drawing the ROI outlines happens separately, every render frame, in renderLoop.
  function runRoiHeuristics() {
    const { ground, head, stair } = roiRects;

    const groundMetrics = sampleRoiMetrics(ground.x, ground.y, ground.w, ground.h);
    const groundAnomalous = detectRoiAnomaly(groundHistory, groundMetrics, GROUND_STD_MULTIPLIER);
    groundAnomalyStreak = groundAnomalous ? groundAnomalyStreak + 1 : 0;
    if (groundAnomalyStreak >= ROI_PERSISTENCE_REQUIRED) {
      announce('ground-anomaly', 'watch your step');
      groundAnomalyStreak = 0;
    }

    // head-height strip — only announces once the anomaly has held for several ticks in a row,
    // which is our stand-in for "this is close and staying in view" rather than a single flicker.
    const headMetrics = sampleRoiMetrics(head.x, head.y, head.w, head.h);
    const headAnomalous = detectRoiAnomaly(headHistory, headMetrics, HEAD_STD_MULTIPLIER);
    headAnomalyStreak = headAnomalous ? headAnomalyStreak + 1 : 0;
    if (headAnomalyStreak >= ROI_PERSISTENCE_REQUIRED) {
      announce('head-anomaly', 'obstacle ahead, duck');
      headAnomalyStreak = 0;
    }

    // stairs — wider, lower band checked for repeated horizontal banding
    const stairsLikely = detectStairBanding(stair.x, stair.y, stair.w, stair.h);
    stairStreak = stairsLikely ? stairStreak + 1 : 0;
    if (stairStreak >= STAIR_PERSISTENCE_REQUIRED) {
      announce('stairs', 'stairs ahead');
      stairStreak = 0;
    }
  }

  function drawDetections(predictions) {
    for (const pred of predictions) {
      if (pred.score < CONFIDENCE_THRESHOLD) continue;
      const [x, y, w, h] = pred.bbox;
      ctx.strokeStyle = '#66d9ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(102, 217, 255, 0.85)';
      const label = `${pred.class} ${(pred.score * 100).toFixed(0)}%`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(x, Math.max(0, y - 16), textWidth + 8, 16);
      ctx.fillStyle = '#0b0f14';
      ctx.font = '12px system-ui';
      ctx.fillText(label, x + 4, Math.max(12, y - 4));
    }
  }

  // Runs every animation frame (~60fps) purely to keep the preview smooth: redraw the live video
  // frame plus whatever boxes/ROI outlines we currently know about. Detection itself is much
  // slower and runs on its own cadence (see scheduleDetectTick) — this loop never waits on it.
  function renderLoop() {
    if (!running) return;
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawDetections(latestPredictions);
      if (roiRects) {
        drawRoiOutline(roiRects.ground.x, roiRects.ground.y, roiRects.ground.w, roiRects.ground.h, roiRects.ground.label);
        drawRoiOutline(roiRects.head.x, roiRects.head.y, roiRects.head.w, roiRects.head.h, roiRects.head.label);
        drawRoiOutline(roiRects.stair.x, roiRects.stair.y, roiRects.stair.w, roiRects.stair.h, roiRects.stair.label);
      }
    }
    rafId = requestAnimationFrame(renderLoop);
  }

  // Self-scheduling rather than setInterval: the next detection is only queued once this one
  // (model inference + heuristics) has actually finished, so a slow frame can never cause two
  // detections to overlap or pile up a backlog.
  async function detectTick() {
    if (!running || video.readyState < 2) {
      detectTimeoutId = setTimeout(detectTick, DETECT_INTERVAL_MS);
      return;
    }

    sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);

    try {
      latestPredictions = await model.detect(video);
    } catch (err) {
      console.error('Detection failed', err);
      detectTimeoutId = setTimeout(detectTick, DETECT_INTERVAL_MS);
      return;
    }

    const liveTracks = updateTracks(latestPredictions);
    classifyAndAnnounceHazards(liveTracks);
    runRoiHeuristics();

    if (running) detectTimeoutId = setTimeout(detectTick, DETECT_INTERVAL_MS);
  }

  async function loadModel() {
    setStatus('Loading detection model…');
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    setStatus('Model ready.');
  }

  // ---- phone-tilt based uphill/downhill detection ----
  // Assumes the phone/camera is held facing forward and roughly level (e.g. chest-mounted).
  // beta = front-back tilt in degrees. The sign convention below is a best guess — if uphill
  // and downhill come out swapped on your device/mount, flip the two comparisons.
  function handleOrientation(event) {
    if (event.beta === null || event.beta === undefined) return;

    if (baselineBeta === null) {
      baselineBeta = event.beta;
      smoothedBeta = event.beta;
      return;
    }

    smoothedBeta = smoothedBeta * (1 - SLOPE_SMOOTHING) + event.beta * SLOPE_SMOOTHING;
    const delta = smoothedBeta - baselineBeta;

    let candidateState = 'flat';
    if (delta <= -SLOPE_DELTA_THRESHOLD_DEG) candidateState = 'uphill';
    else if (delta >= SLOPE_DELTA_THRESHOLD_DEG) candidateState = 'downhill';

    if (candidateState === slopeState) {
      slopeStreak = 0;
      return;
    }

    slopeStreak++;
    if (slopeStreak < SLOPE_PERSISTENCE_REQUIRED) return;

    slopeState = candidateState;
    slopeStreak = 0;
    if (slopeState === 'flat') return; // only warn about slopes starting, not flattening out
    announce(`slope-${slopeState}`, `path going ${slopeState}`, SLOPE_COOLDOWN_MS);
  }

  async function enableOrientationTracking() {
    if (typeof DeviceOrientationEvent === 'undefined') return;

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const resp = await DeviceOrientationEvent.requestPermission();
        if (resp !== 'granted') return;
      } catch (err) {
        console.warn('Device orientation permission not granted', err);
        return;
      }
    }

    baselineBeta = null;
    smoothedBeta = null;
    slopeState = 'flat';
    slopeStreak = 0;
    window.addEventListener('deviceorientation', handleOrientation);
    orientationEnabled = true;
  }

  function disableOrientationTracking() {
    if (!orientationEnabled) return;
    window.removeEventListener('deviceorientation', handleOrientation);
    orientationEnabled = false;
  }

  async function startCamera() {
    setStatus('Requesting camera access…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        setStatus('Camera permission denied. Please allow camera access and try again.');
        logAlert('Camera permission denied.');
        throw err2;
      }
    }

    video.srcObject = stream;
    await video.play();

    await new Promise((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadedmetadata = () => resolve();
    });

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    sampleCanvas.width = canvas.width;
    sampleCanvas.height = canvas.height;
    roiRects = computeRoiRects(canvas.width, canvas.height);

    setCameraOn(true);
    setStatus('Camera active. Watching for hazards…');
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCameraOn(false);
    setStatus('Camera off. Press "Start camera" to begin.');
  }

  async function handleToggle() {
    if (running) {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (detectTimeoutId !== null) clearTimeout(detectTimeoutId);
      rafId = null;
      detectTimeoutId = null;
      disableOrientationTracking();
      stopCamera();
      toggleBtn.textContent = 'Start camera';
      toggleBtn.setAttribute('aria-pressed', 'false');
      return;
    }

    toggleBtn.disabled = true;
    try {
      if (!model) {
        await loadModel();
      }
      await startCamera();
      await enableOrientationTracking();
      running = true;
      tracks = [];
      groundHistory = [];
      headHistory = [];
      groundAnomalyStreak = 0;
      headAnomalyStreak = 0;
      stairStreak = 0;
      latestPredictions = [];
      lastAnnounceAt.clear();
      rafId = requestAnimationFrame(renderLoop);
      detectTimeoutId = setTimeout(detectTick, 0);
      toggleBtn.textContent = 'Stop camera';
      toggleBtn.setAttribute('aria-pressed', 'true');
    } catch (err) {
      console.error(err);
    } finally {
      toggleBtn.disabled = false;
    }
  }

  toggleBtn.addEventListener('click', handleToggle);
})();
