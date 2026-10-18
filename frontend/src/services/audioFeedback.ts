import { speechQueue } from '../speech/SpeechQueue';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Triggers a vibration pulse rhythm on supported devices (e.g. Android).
 */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignored if device doesn't allow vibration
    }
  }
}

/**
 * High-pitched gentle ping played when nearing a waypoint or on-path.
 */
export function playWaypointPing(): void {
  if (speechQueue.isListening()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
  osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);

  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.16);
  vibrate(50);
}

/**
 * High-pitched ascending chime indicating a completely clear pedestrian walking path ahead.
 */
export function playClearPathChime(): void {
  if (speechQueue.isListening()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(784, ctx.currentTime); // G5
  osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.16); // D6

  gain.gain.setValueAtTime(0.16, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.19);
  vibrate(40);
}

/**
 * Upward dual chime confirming a turn or completed waypoint.
 */
export function playTurnCue(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'triangle';
  osc2.type = 'sine';

  osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
  osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5

  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start();
  osc2.start(ctx.currentTime + 0.1);
  osc1.stop(ctx.currentTime + 0.12);
  osc2.stop(ctx.currentTime + 0.3);
  vibrate([80, 50, 80]);
}

/**
 * Urgent low-frequency double chime for hazard alerts.
 */
export function playHazardAlertChime(): void {
  if (speechQueue.isListening()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(350, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.18);

  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.22);
  vibrate([150, 80, 150]);
}

/**
 * Spatial Audio Obstacle Tone.
 * Uses StereoPannerNode to position the warning sound in headphones
 * (left ear = obstacle left, right ear = obstacle right, center = ahead).
 * Urgency toggles rapid pulsing haptic rhythm vs single alert pulse.
 */
export function playSpatialHazardTone(
  direction: 'left' | 'right' | 'ahead' = 'ahead',
  urgency: 'warning' | 'danger' = 'warning'
): void {
  if (speechQueue.isListening()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  const panValue = direction === 'left' ? -0.85 : direction === 'right' ? 0.85 : 0;
  let pannerNode: StereoPannerNode | null = null;
  if ('createStereoPanner' in ctx) {
    pannerNode = ctx.createStereoPanner();
    pannerNode.pan.setValueAtTime(panValue, ctx.currentTime);
  }

  if (urgency === 'danger') {
    // Sawtooth buzzing urgent tone
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(170, ctx.currentTime + 0.22);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.24);

    // Rapid urgent danger vibration pattern
    vibrate([120, 50, 120, 50, 200]);
  } else {
    // Caution tone
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(480, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    // Caution single pulse
    vibrate(80);
  }

  if (pannerNode) {
    osc.connect(gain);
    gain.connect(pannerNode);
    pannerNode.connect(ctx.destination);
  } else {
    osc.connect(gain);
    gain.connect(ctx.destination);
  }

  osc.start();
  osc.stop(ctx.currentTime + 0.25);
}

/**
 * High-intensity alternating emergency siren sound for SOS broadcast.
 */
export function playSosEmergencyAlarm(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(960, now);
  osc.frequency.setValueAtTime(700, now + 0.14);
  osc.frequency.setValueAtTime(960, now + 0.28);
  osc.frequency.setValueAtTime(700, now + 0.42);

  gain.gain.setValueAtTime(0.35, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(now + 0.6);

  // Intense SOS rhythmic pulse: [300, 100, 300, 100, 500]
  vibrate([300, 100, 300, 100, 500]);
}

/**
 * Short, distinct auditory cue played on physical touch pad taps (1, 2, or 3 taps).
 */
export function playTapCue(tapNumber: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  const freq = tapNumber === 1 ? 587.33 : tapNumber === 2 ? 783.99 : 1046.5; // D5, G5, C6
  osc.frequency.setValueAtTime(freq, ctx.currentTime);

  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.11);
  vibrate(tapNumber >= 3 ? [120, 60, 200] : 45);
}

/**
 * Earcon for swipe gestures (Swipe Up = high chirp, Swipe Down = low chime).
 */
export function playSwipeFeedback(direction: 'up' | 'down'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  if (direction === 'up') {
    osc.frequency.setValueAtTime(650, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.12);
  } else {
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(450, ctx.currentTime + 0.12);
  }

  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.15);
  vibrate([50, 40, 50]);
}
