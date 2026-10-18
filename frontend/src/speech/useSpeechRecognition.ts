import { useCallback, useEffect, useRef, useState } from 'react';
import { speechQueue } from './SpeechQueue';

interface SpeechRecognitionResultLike {
  transcript: string;
}

// Minimal shape of the Web Speech API's SpeechRecognition — not in lib.dom.d.ts by default.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const supported = getSpeechRecognitionCtor() !== null;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      speechQueue.setMicActive(false);
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    setError(null);
    setTranscript('');

    // Immediately silence any background speech and mark mic as active
    speechQueue.setMicActive(true);

    const recognition = new Ctor();
    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const result = event.results[0]?.[0];
      if (result) setTranscript(result.transcript);
    };
    recognition.onerror = (event) => {
      setError(event.error);
      setIsListening(false);
      speechQueue.setMicActive(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      speechQueue.setMicActive(false);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    speechQueue.setMicActive(false);
  }, []);

  return { supported, isListening, transcript, error, start, stop };
}
