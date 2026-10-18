import { useEffect, useRef } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

// GPS Live User Location Marker (Pulsing Blue Dot)
const gpsLiveIcon = L.divIcon({
  className: 'gps-live-marker',
  html: `<div style="
    width: 22px;
    height: 22px;
    background: #2563eb;
    border: 3.5px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 0 16px rgba(37, 99, 235, 0.9), 0 0 0 6px rgba(59, 130, 246, 0.35);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Destination Pin (Checkered Flag / Red Marker)
const destinationPinIcon = L.divIcon({
  className: 'dest-pin-marker',
  html: `<div style="
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: #dc2626;
    border: 2.5px solid #ffffff;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 4px 12px rgba(0,0,0,0.6);
  "><span style="transform: rotate(45deg); font-size: 13px;">🏁</span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

interface MapViewProps {
  origin?: { lat: number; lon: number };
  destination?: { lat: number; lon: number };
  userLocation?: { lat: number; lon: number };
  routeCoordinates?: Array<[number, number]>; // [lon, lat]
  showGoogleMapsButton?: boolean;
  followUser?: boolean;
}

// Auto-pans map when user walks/moves
function RecenterMap({ position, follow }: { position?: { lat: number; lon: number }; follow?: boolean }) {
  const map = useMap();
  const initialFitRef = useRef(false);

  useEffect(() => {
    if (position && follow && initialFitRef.current) {
      map.panTo([position.lat, position.lon], { animate: true, duration: 0.8 });
    }
  }, [position, follow, map]);

  useEffect(() => {
    initialFitRef.current = true;
  }, []);

  return null;
}

// Fits bounds to show both origin, destination, and path on initial load
function FitBounds({ positions }: { positions: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17 });
  }, [positions, map]);
  return null;
}

export function MapView({
  origin,
  destination,
  userLocation,
  routeCoordinates,
  showGoogleMapsButton = true,
  followUser = true,
}: MapViewProps) {
  const effectiveUser = userLocation ?? origin;
  const center: [number, number] = effectiveUser ? [effectiveUser.lat, effectiveUser.lon] : [53.4808, -2.2426];
  const routeLatLngs: Array<[number, number]> = (routeCoordinates ?? []).map(([lon, lat]) => [lat, lon]);

  const boundsPositions: Array<[number, number]> = [
    ...(effectiveUser ? [[effectiveUser.lat, effectiveUser.lon] as [number, number]] : []),
    ...(destination ? [[destination.lat, destination.lon] as [number, number]] : []),
    ...routeLatLngs,
  ];

  const googleMapsUrl = destination && origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${destination.lat},${destination.lon}&travelmode=walking`
    : undefined;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '260px',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '2px solid var(--surface-raised)',
      }}
      aria-label="Google Map GPS Navigation"
    >
      <MapContainer
        center={center}
        zoom={16}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0b0f14' }}
      >
        {/* Google Maps Standard Roadmap Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://maps.google.com">Google Maps</a>'
          url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          maxZoom={20}
        />

        {/* Outer casing polyline for high contrast readability on road maps */}
        {routeLatLngs.length > 0 && (
          <Polyline
            positions={routeLatLngs}
            color="#ffffff"
            weight={9}
            opacity={0.8}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Primary Google Blue walking path polyline */}
        {routeLatLngs.length > 0 && (
          <Polyline
            positions={routeLatLngs}
            color="#2563eb"
            weight={6}
            opacity={0.95}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Live GPS User Location (Pulsing Dot) */}
        {effectiveUser && (
          <Marker position={[effectiveUser.lat, effectiveUser.lon]} icon={gpsLiveIcon} />
        )}

        {/* Destination Pin */}
        {destination && (
          <Marker position={[destination.lat, destination.lon]} icon={destinationPinIcon} />
        )}

        {/* Bounds & Dynamic Centering */}
        {boundsPositions.length > 0 && <FitBounds positions={boundsPositions} />}
        <RecenterMap position={effectiveUser} follow={followUser} />
      </MapContainer>

      {/* External Google Maps Button */}
      {showGoogleMapsButton && googleMapsUrl && (
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn secondary"
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            zIndex: 1000,
            padding: '5px 12px',
            fontSize: '0.8rem',
            fontWeight: 700,
            background: 'rgba(11, 15, 20, 0.92)',
            border: '1.5px solid #3b82f6',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#60a5fa',
            textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
          }}
          title="Open walking directions directly in Google Maps"
        >
          <span>🗺️</span>
          <span>Open in Google Maps</span>
        </a>
      )}
    </div>
  );
}
