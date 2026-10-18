// Priority-interrupt speech engine shared by navigation, hazard and nearby-places announcements.
// Rule: a higher-priority message always interrupts whatever is currently speaking; same/lower
// priority messages queue up FIFO (ordered by priority). Never two utterances overlap.
export type Priority = 'CRITICAL' | 'NAVIGATION' | 'INFO' | 'AMBIENT';

const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 0,
  NAVIGATION: 1,
  INFO: 2,
  AMBIENT: 3,
};

const MAX_QUEUE_LENGTH = 5;

interface QueueItem {
  id: number;
  text: string;
  priority: Priority;
  onEnd?: () => void;
}

type Listener = (text: string, priority: Priority) => void;

class SpeechQueueEngine {
  private queue: QueueItem[] = [];
  private speaking: QueueItem | null = null;
  private lastSpokenText = 'system ready';
  private nextId = 1;
  private isHeld = false;
  private isMicActive = false;
  private micActiveTimer: number | null = null;
  private watchdogTimers = new Map<number, number>();
  private activeUtterances = new Set<SpeechSynthesisUtterance>();
  private assertiveListeners = new Set<Listener>();
  private politeListeners = new Set<Listener>();

  private cachedVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // Warm up voice list
      window.speechSynthesis.onvoiceschanged = () => {
        this.cachedVoice = null;
        this.getBestHumanVoice();
      };
      this.getBestHumanVoice();

      // Chromium engine freeze watchdog: periodically resumes if paused mid-speech
      setInterval(() => {
        try {
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            }
          }
        } catch {}
      }, 2500);
    }
  }

  /**
   * Unlock SpeechSynthesis and WebAudio on user interaction (tap/click/key).
   */
  unlock(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const dummy = new SpeechSynthesisUtterance('');
      dummy.volume = 0;
      window.speechSynthesis.speak(dummy);
    } catch {}
  }

  /**
   * Automatically discovers and binds the highest-fidelity natural, neural human voice available.
   * Prioritizes Microsoft Natural, Google Neural, and Apple Enhanced voices for expressive, human-like speech.
   */
  getBestHumanVoice(): SpeechSynthesisVoice | null {
    if (this.cachedVoice) return this.cachedVoice;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;

    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    // Preference hierarchy for expressive, human-like voices
    const naturalKeywords = [
      'natural',
      'neural',
      'aria',
      'jenny',
      'guy',
      'sonia',
      'ryan',
      'google uk english female',
      'google us english',
      'samantha (enhanced)',
      'serena',
      'karen',
      'daniel',
    ];

    for (const keyword of naturalKeywords) {
      const match = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          v.name.toLowerCase().includes(keyword.toLowerCase())
      );
      if (match) {
        this.cachedVoice = match;
        return match;
      }
    }

    // High quality brand voice
    const brandMatch = voices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Google') || v.name.includes('Apple') || v.name.includes('Microsoft') || v.name.includes('Natural'))
    );
    if (brandMatch) {
      this.cachedVoice = brandMatch;
      return brandMatch;
    }

    const enVoice = voices.find((v) => v.lang.startsWith('en'));
    if (enVoice) {
      this.cachedVoice = enVoice;
      return enVoice;
    }

    return voices[0] || null;
  }

  getLastSpoken(): string {
    return this.lastSpokenText;
  }

  repeatLast(): void {
    if (this.lastSpokenText) {
      this.speak(this.lastSpokenText, 'CRITICAL');
    }
  }

  /**
   * Puts speech queue on hold or sets microphone listening active state.
   * When listening is active, background voice is silenced to prevent talking over user.
   * Includes safety watchdog to prevent permanent audio lockouts.
   */
  setMicActive(active: boolean): void {
    if (this.micActiveTimer !== null) {
      clearTimeout(this.micActiveTimer);
      this.micActiveTimer = null;
    }
    this.isMicActive = active;
    if (active) {
      this.cancel();
      // Safety auto-release: if speech recognition doesn't end cleanly, auto-release after 7s
      this.micActiveTimer = window.setTimeout(() => {
        if (this.isMicActive) {
          console.warn('Auto-releasing stuck isMicActive lock');
          this.isMicActive = false;
          // Drain any queued navigation instruction
          this.drainQueue();
        }
      }, 7000);
    } else {
      // Drain any queued speech that was pending
      this.drainQueue();
    }
  }

  isListening(): boolean {
    return this.isMicActive || this.isHeld;
  }

  hold(): void {
    this.isHeld = true;
    this.cancel();
  }

  release(): void {
    this.isHeld = false;
    this.isMicActive = false;
    if (this.micActiveTimer !== null) {
      clearTimeout(this.micActiveTimer);
      this.micActiveTimer = null;
    }
    this.drainQueue();
  }

  private drainQueue(): void {
    if (!this.speaking && this.queue.length > 0 && !this.isMicActive && !this.isHeld) {
      const next = this.queue.shift();
      if (next) this.speakNow(next);
    }
  }

  private currentUtterance: SpeechSynthesisUtterance | null = null;

  cancel(): void {
    this.queue = [];
    this.speaking = null;
    this.clearAllWatchdogs();
    if (this.currentUtterance) {
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }
    this.activeUtterances.clear();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (e) {
        console.warn('speechSynthesis cancel error:', e);
      }
    }
  }

  private clearAllWatchdogs(): void {
    this.watchdogTimers.forEach((timer) => clearTimeout(timer));
    this.watchdogTimers.clear();
  }

  speak(text: string, priority: Priority, onEnd?: () => void): void {
    if (!text || !text.trim()) return;

    // If microphone is actively recording right this millisecond
    if (this.isMicActive || this.isHeld) {
      if (priority === 'CRITICAL' || priority === 'NAVIGATION') {
        // Queue critical messages so they are spoken as soon as mic finishes
        const item: QueueItem = { id: this.nextId++, text, priority, onEnd };
        this.queue.push(item);
        this.queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
        while (this.queue.length > MAX_QUEUE_LENGTH) this.queue.pop();
      }
      return;
    }

    this.lastSpokenText = text;
    const item: QueueItem = { id: this.nextId++, text, priority, onEnd };

    // A CRITICAL message or a strictly higher-priority message always interrupts immediately
    if (this.speaking && (priority === 'CRITICAL' || PRIORITY_RANK[priority] < PRIORITY_RANK[this.speaking.priority])) {
      this.cancel();
      this.speakNow(item);
      return;
    }

    if (!this.speaking) {
      this.speakNow(item);
      return;
    }

    this.queue.push(item);
    this.queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    while (this.queue.length > MAX_QUEUE_LENGTH) this.queue.pop(); // drop lowest-priority overflow
  }

  private speakNow(item: QueueItem): void {
    this.speaking = item;
    this.notify(item);

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.onUtteranceEnd(item.id);
      return;
    }

    // Wake up speech engine if stuck in paused state
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {}

    const utter = new SpeechSynthesisUtterance(item.text);
    this.currentUtterance = utter;
    this.activeUtterances.add(utter);

    const humanVoice = this.getBestHumanVoice();
    if (humanVoice) {
      utter.voice = humanVoice;
      utter.lang = humanVoice.lang;
    }

    // Conversational parameters: clear, warm, natural cadence
    utter.rate = 1.0;
    utter.pitch = 1.04;
    utter.volume = 1.0;

    let finished = false;
    const finishUtterance = () => {
      if (finished) return;
      finished = true;
      this.activeUtterances.delete(utter);
      if (this.currentUtterance === utter) this.currentUtterance = null;
      this.onUtteranceEnd(item.id);
    };

    utter.onend = finishUtterance;
    utter.onerror = (e) => {
      console.warn('SpeechSynthesisUtterance error:', e);
      finishUtterance();
    };

    // Universal watchdog timer: clears speaking state after estimated speech time + buffer
    const wordCount = item.text.split(/\s+/).filter(Boolean).length;
    const estimatedMs = Math.max(2500, Math.ceil(wordCount / 2.2) * 1000 + 2000);
    const watchdogId = window.setTimeout(() => {
      if (this.speaking?.id === item.id) {
        console.warn('Speech watchdog auto-completing utterance:', item.text);
        finishUtterance();
      }
    }, estimatedMs);
    this.watchdogTimers.set(item.id, watchdogId);

    // Speak utterance with brief pause for audio device buffer flush
    setTimeout(() => {
      if (this.speaking?.id === item.id) {
        if (!this.isMicActive && !this.isHeld) {
          try {
            if (window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            }
            window.speechSynthesis.speak(utter);
          } catch (speakErr) {
            console.warn('speechSynthesis.speak error:', speakErr);
            finishUtterance();
          }
        } else {
          // Mic became active during delay: finish gracefully
          finishUtterance();
        }
      }
    }, 30);
  }

  private onUtteranceEnd(finishedId: number): void {
    const timer = this.watchdogTimers.get(finishedId);
    if (timer) {
      clearTimeout(timer);
      this.watchdogTimers.delete(finishedId);
    }

    if (this.speaking?.id !== finishedId) return;
    const prev = this.speaking;
    this.speaking = null;
    try {
      prev.onEnd?.();
    } catch (cbErr) {
      console.warn('Speech onEnd callback error:', cbErr);
    }
    const next = this.queue.shift();
    if (next && !this.isMicActive && !this.isHeld) {
      this.speakNow(next);
    }
  }

  private notify(item: QueueItem): void {
    const listeners = item.priority === 'CRITICAL' || item.priority === 'NAVIGATION' ? this.assertiveListeners : this.politeListeners;
    listeners.forEach((fn) => fn(item.text, item.priority));
  }

  onAssertive(fn: Listener): () => void {
    this.assertiveListeners.add(fn);
    return () => this.assertiveListeners.delete(fn);
  }

  onPolite(fn: Listener): () => void {
    this.politeListeners.add(fn);
    return () => this.politeListeners.delete(fn);
  }
}

export const speechQueue = new SpeechQueueEngine();
