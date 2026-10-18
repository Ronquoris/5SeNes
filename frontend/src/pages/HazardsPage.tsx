import { useEffect, useState } from 'react';
import { HazardReportForm } from '../components/HazardReportForm';
import { HazardList } from '../components/HazardList';
import { useGeolocation } from '../hooks/useGeolocation';
import { speechQueue } from '../speech/SpeechQueue';

export function HazardsPage() {
  const position = useGeolocation();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {position.isFallback && (
        <p className="muted card">
          Using Manchester city centre as your location ({position.error ? position.error : 'location unavailable'}
          ).
        </p>
      )}
      <HazardReportForm lat={position.lat} lon={position.lon} onReported={() => setReloadKey((k) => k + 1)} />
      <HazardList lat={position.lat} lon={position.lon} reloadKey={reloadKey} />
    </div>
  );
}
