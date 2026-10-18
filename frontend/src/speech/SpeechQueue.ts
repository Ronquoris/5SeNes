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
    }
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
   * When listening is active, ALL background voice is strictly silenced.
   */
  setMicActive(active: boolean): void {
    this.isMicActive = active;
    if (active) {
      this.cancel();
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
  }

  private currentUtterance: SpeechSynthesisUtterance | null = null;

  cancel(): void {
    this.queue = [];
    this.speaking = null;
    if (this.currentUtterance) {
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          window.speechSynthesis.cancel();
        }
      } catch (e) {
        console.warn('speechSynthesis cancel error:', e);
      }
    }
  }

  speak(text: string, priority: Priority, onEnd?: () => void): void {
    // STRICT ACCESSIBILITY RULE: If the mic is active or listening is on, NO background speech can play!
    if (this.isMicActive || this.isHeld) {
      console.log('Background speech blocked because microphone/listening is active:', text);
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

    if (!('speechSynthesis' in window)) {
      this.onUtteranceEnd(item.id);
      return;
    }

    const utter = new SpeechSynthesisUtterance(item.text);
    this.currentUtterance = utter;
    const humanVoice = this.getBestHumanVoice();
    if (humanVoice) {
      utter.voice = humanVoice;
      utter.lang = humanVoice.lang;
    }

    // Human conversational parameters: warm pitch lift, natural comfortable cadence
    utter.rate = 1.0;
    utter.pitch = 1.04;
    utter.volume = 1.0;

    utter.onend = () => {
      if (this.currentUtterance === utter) this.currentUtterance = null;
      this.onUtteranceEnd(item.id);
    };
    utter.onerror = () => {
      if (this.currentUtterance === utter) this.currentUtterance = null;
      this.onUtteranceEnd(item.id);
    };

    // Safety delay of 40ms to ensure any preceding cancelled utterance is cleanly purged by the OS audio device
    setTimeout(() => {
      if (this.speaking?.id === item.id && !this.isMicActive && !this.isHeld) {
        window.speechSynthesis.speak(utter);
      }
    }, 40);

    // Safety watchdog for browser engines (Chrome bug): ensure onEnd ALWAYS fires
    if (item.onEnd) {
      const estimatedMs = Math.max(2000, Math.ceil(item.text.split(/\s+/).length / 2.0) * 1000 + 1500);
      setTimeout(() => {
        if (this.speaking?.id === item.id) {
          this.onUtteranceEnd(item.id);
        }
      }, estimatedMs);
    }
  }

  private onUtteranceEnd(finishedId: number): void {
    // Guard against a stale callback from an utterance that was interrupted mid-flight — only
    // advance the queue if this callback belongs to whatever is still marked as speaking.
    if (this.speaking?.id !== finishedId) return;
    const prev = this.speaking;
    this.speaking = null;
    try {
      prev.onEnd?.();
    } catch (cbErr) {
      console.warn('Speech onEnd callback error:', cbErr);
    }
    const next = this.queue.shift();
    if (next) this.speakNow(next);
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
