import { haversineMeters } from './geoUtils';
import { geocodeSearch, type LatLon } from '../api/client';

export interface ResolvedDestination {
  id: string;
  name: string;
  subLabel: string;
  fullAddress: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  distanceText: string;
  spokenPrompt: string;
}

interface PhotonFeature {
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    suburb?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    osm_id?: number | string;
    osm_type?: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number]; // [lon, lat]
  };
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} metres`;
  }
  return `${(meters / 1000).toFixed(1)} kilometres`;
}

function formatShortDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Searches real locations biased by the user's live coordinates.
 * Tries the high-performance Photon API first (OSM geocoder with coordinate bias),
 * then seamlessly falls back to backend Nominatim if needed.
 * Returns distinct, closest matches sorted by distance.
 */
export async function searchClosestDestinations(
  query: string,
  userOrigin: LatLon,
  maxOptions = 3
): Promise<ResolvedDestination[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const rawCandidates: Array<{
    name: string;
    subLabel: string;
    fullAddress: string;
    lat: number;
    lon: number;
    osmId: string;
  }> = [];

  // 1. Try Photon Geocoder (Free OpenStreetMap API with native lat/lon distance weighting)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3800);
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      cleanQuery
    )}&lat=${userOrigin.lat}&lon=${userOrigin.lon}&limit=10`;

    const res = await fetch(photonUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { features?: PhotonFeature[] };
      if (data.features && data.features.length > 0) {
        for (const feat of data.features) {
          const props = feat.properties;
          const [lon, lat] = feat.geometry.coordinates;

          // Build clear, human-friendly title
          const name = props.name || props.street || cleanQuery;
          const streetPart = props.street
            ? `${props.housenumber ? props.housenumber + ' ' : ''}${props.street}`
            : '';
          const districtPart = props.district || props.suburb || props.city || '';
          const subLabelParts = [streetPart, districtPart].filter(Boolean);
          const subLabel = subLabelParts.join(' · ');

          const fullAddress = [
            props.name,
            streetPart,
            props.district,
            props.city,
            props.postcode,
          ]
            .filter(Boolean)
            .join(', ');

          rawCandidates.push({
            name,
            subLabel,
            fullAddress: fullAddress || name,
            lat,
            lon,
            osmId: String(props.osm_id || `${lat},${lon}`),
          });
        }
      }
    }
  } catch (err) {
    console.warn('Photon geocode failed or timed out, trying backend geocoder:', err);
  }

  // 2. Fallback to Backend Nominatim Geocode (/api/geocode)
  if (rawCandidates.length === 0) {
    try {
      const geo = await geocodeSearch(cleanQuery, 8, userOrigin.lat, userOrigin.lon);
      if (geo.results && geo.results.length > 0) {
        for (const item of geo.results) {
          const parts = item.label.split(',').map((p) => p.trim());
          const name = parts[0] || cleanQuery;
          const subLabel = parts.slice(1, 3).join(' · ');

          rawCandidates.push({
            name,
            subLabel,
            fullAddress: item.label,
            lat: item.lat,
            lon: item.lon,
            osmId: item.osmId,
          });
        }
      }
    } catch (err) {
      console.warn('Backend geocode also failed:', err);
    }
  }

  if (rawCandidates.length === 0) {
    return [];
  }

  // 3. Compute distance for each candidate from user coordinates
  const withDistance = rawCandidates.map((c) => {
    const distanceMeters = haversineMeters(userOrigin.lat, userOrigin.lon, c.lat, c.lon);
    return {
      ...c,
      distanceMeters,
    };
  });

  // 4. Deduplicate (remove locations within 45m of each other or identical names at near distances)
  const uniqueList: typeof withDistance = [];
  for (const item of withDistance) {
    const isDuplicate = uniqueList.some(
      (existing) =>
        haversineMeters(existing.lat, existing.lon, item.lat, item.lon) < 45 ||
        (existing.name.toLowerCase() === item.name.toLowerCase() &&
          Math.abs(existing.distanceMeters - item.distanceMeters) < 70)
    );
    if (!isDuplicate) {
      uniqueList.push(item);
    }
  }

  // 5. Sort by distance ascending (closest first)
  uniqueList.sort((a, b) => a.distanceMeters - b.distanceMeters);

  // 6. Slice to top requested options
  const topMatches = uniqueList.slice(0, maxOptions);

  return topMatches.map((match, idx) => {
    const distanceText = formatDistance(match.distanceMeters);
    const shortDist = formatShortDistance(match.distanceMeters);
    const spokenPrompt = `Option ${idx + 1}: ${match.name}${
      match.subLabel ? ' on ' + match.subLabel : ''
    }, ${distanceText} away.`;

    return {
      id: `${match.osmId}-${idx}`,
      name: match.name,
      subLabel: `${match.subLabel ? match.subLabel + ' · ' : ''}${shortDist} away`,
      fullAddress: match.fullAddress,
      lat: match.lat,
      lon: match.lon,
      distanceMeters: match.distanceMeters,
      distanceText,
      spokenPrompt,
    };
  });
}
