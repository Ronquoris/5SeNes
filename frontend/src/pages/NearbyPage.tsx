import { NearbyPlacesList } from '../components/NearbyPlacesList';
import { MapView } from '../components/MapView';
import { useGeolocation } from '../hooks/useGeolocation';

export function NearbyPage() {
  const position = useGeolocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {position.isFallback && (
        <p className="muted card">
          Using Manchester city centre as your location ({position.error ? position.error : 'location unavailable'}
          ).
        </p>
      )}
      <MapView origin={position} />
      <NearbyPlacesList lat={position.lat} lon={position.lon} />
    </div>
  );
}
