import { useEffect, useState } from 'react';
import { speechQueue } from '../speech/SpeechQueue';

// Mirrors every spoken announcement as real DOM text, so screen reader / braille display users
// get the same information sighted users would get from hearing the TTS. Two regions: assertive
// for CRITICAL/NAVIGATION (the stuff that matters right now), polite for INFO/AMBIENT.
export function LiveRegion() {
  const [assertiveText, setAssertiveText] = useState('');
  const [politeText, setPoliteText] = useState('');

  useEffect(() => {
    const offAssertive = speechQueue.onAssertive((text) => setAssertiveText(text));
    const offPolite = speechQueue.onPolite((text) => setPoliteText(text));
    return () => {
      offAssertive();
      offPolite();
    };
  }, []);

  return (
    <div className="live-regions card" aria-label="Spoken announcements, shown as text">
      <p aria-live="assertive" className="live-region-assertive">
        {assertiveText || 'No announcements yet.'}
      </p>
      {politeText && (
        <p aria-live="polite" className="live-region-polite">
          {politeText}
        </p>
      )}
    </div>
  );
}
