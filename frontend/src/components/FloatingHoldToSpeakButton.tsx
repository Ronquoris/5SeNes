import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { speechQueue } from '../speech/SpeechQueue';
import { playTurnCue, playTapCue } from '../services/audioFeedback';

export function FloatingHoldToSpeakButton() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isDepressed, setIsDepressed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [listeningPrompt, setListeningPrompt] = useState<string | null>(null);

  const pressStartTimeRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const isHoldingToSpeakRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const finalSpeechQueryRef = useRef('');

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    handlePressStart();
  }

  function handlePointerUp() {
    handlePressEnd();
  }

  function handleTouchStart() {
    handlePressStart();
  }

  function handleTouchEnd() {
    handlePressEnd();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!isDepressed) {
        e.preventDefault();
        handlePressStart();
      }
    }
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handlePressEnd();
    }
  }

  function handlePressStart() {
    setIsDepressed(true);
    pressStartTimeRef.current = Date.now();
    isHoldingToSpeakRef.current = false;

    // Immediately silence speech and hold so no background voice can speak over the user
    speechQueue.setMicActive(true);

    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // 240ms threshold for press-and-hold (Push-to-Talk)
    holdTimerRef.current = window.setTimeout(() => {
      isHoldingToSpeakRef.current = true;
      playTurnCue();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([60]);
      }
      startVoiceRecognition();
    }, 240);
  }

  function handlePressEnd() {
    setIsDepressed(false);

    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (isHoldingToSpeakRef.current) {
      // User released while in hold-to-speak mode: finalize speech
      isHoldingToSpeakRef.current = false;
      stopVoiceRecognition();
      setTimeout(() => speechQueue.setMicActive(false), 150);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([30]);
      }
      return;
    }

    // Release speech hold if released early before hold threshold
    speechQueue.setMicActive(false);

    // Short tap (<240ms): trigger path check or navigate
    playTapCue(1);
    handleTapAction();
  }

  function handleTapAction() {
    if (location.pathname === '/' || location.pathname === '/navigate') {
      // On Home/Navigate page: trigger button tap & path check
      window.dispatchEvent(new CustomEvent('5sense:button_tap'));
      window.dispatchEvent(new CustomEvent('5sense:path_check'));
    } else {
      // On other pages: go to Home page with path check
      navigate('/?action=check');
    }
  }

  function startVoiceRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      speechQueue.release();
      speechQueue.speak('Voice recognition unavailable on this browser', 'CRITICAL');
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
          speechQueue.speak('Microphone access blocked', 'CRITICAL');
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
          processVoiceQuery(query);
        }
      };

      recognition.start();
    } catch (err) {
      console.warn('Recognition start failed:', err);
      setIsListening(false);
      setListeningPrompt(null);
      speechQueue.setMicActive(false);
    }
  }

  function stopVoiceRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.warn('Recognition stop error:', err);
      }
    }
  }

  function processVoiceQuery(query: string) {
    const lower = query.toLowerCase();

    // 1. Navigation Intent: App section navigation
    if (lower === 'home' || lower === 'go home' || lower.includes('home page') || lower === 'navigate' || lower.includes('navigation')) {
      speechQueue.speak('Going home', 'INFO');
      navigate('/');
      return;
    }
    if (lower === 'nearby' || lower.includes('what is nearby') || lower.includes('places nearby')) {
      speechQueue.speak('Showing nearby places', 'INFO');
      navigate('/nearby');
      return;
    }
    if (lower === 'hazards' || lower.includes('hazard') || lower.includes('danger')) {
      speechQueue.speak('Showing nearby hazards', 'INFO');
      navigate('/hazards');
      return;
    }
    if (lower === 'sos' || lower.includes('emergency') || lower.includes('help me')) {
      speechQueue.speak('Opening emergency SOS', 'CRITICAL');
      navigate('/sos');
      return;
    }

    // 2. Destination Search & Route Planning Intent
    if (location.pathname === '/' || location.pathname === '/navigate') {
      window.dispatchEvent(new CustomEvent('5sense:voice_search', { detail: { query } }));
    } else {
      speechQueue.speak('Finding route', 'INFO');
      navigate(`/?q=${encodeURIComponent(query)}`);
    }
  }

  const isGreen = isListening || isDepressed;
  const activeColor = isGreen ? '#00FF66' : '#38bdf8';

  return (
    <div
      className={`floating-hold-speak-btn ${isDepressed ? 'is-depressed' : ''}`}
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handlePressEnd}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      aria-label="Floating touch to speak button: Press and hold to speak destination, tap for path clearance."
      style={{
        position: 'fixed',
        bottom: '14px',
        left: '50%',
        transform: isDepressed ? 'translateX(-50%) scale(0.97)' : 'translateX(-50%) scale(1)',
        width: 'calc(100% - 24px)',
        maxWidth: '480px',
        height: '82px',
        background: isDepressed ? '#06140b' : 'rgba(9, 13, 22, 0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `3px solid ${activeColor}`,
        borderRadius: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        padding: '0.6rem 1.2rem',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        zIndex: 10010,
        boxShadow: isDepressed
          ? 'inset 0 3px 12px rgba(0,0,0,0.8), 0 0 22px rgba(0,255,102,0.45)'
          : '0 8px 30px rgba(0,0,0,0.85), 0 0 16px rgba(56, 189, 248, 0.28)',
        transition: 'transform 0.08s ease, box-shadow 0.12s ease, border-color 0.15s ease',
      }}
    >
      <div
        style={{
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          background: isGreen ? 'rgba(0, 255, 102, 0.15)' : 'rgba(56, 189, 248, 0.12)',
          border: `2px solid ${activeColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.75rem',
          flexShrink: 0,
          boxShadow: isGreen ? '0 0 12px rgba(0,255,102,0.4)' : 'none',
        }}
      >
        🎙️
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '1.2rem',
            fontWeight: 900,
            color: isGreen ? '#00FF66' : '#ffffff',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isListening
            ? (listeningPrompt || 'LISTENING… SPEAK NOW')
            : isDepressed
            ? 'RELEASE TO SEARCH'
            : 'HOLD TO SPEAK'}
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            color: '#94a3b8',
            marginTop: '2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isListening ? 'Say destination or command' : 'Hold to speak anywhere · Tap for path check'}
        </div>
      </div>
    </div>
  );
}
