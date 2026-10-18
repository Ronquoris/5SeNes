import { config } from '../config.js';
import { bearingDegrees, bearingToCompassLabel, haversineMeters } from './geo.js';
import { fetchWithTimeout } from './httpTimeout.js';

export interface NearbyPlace {
  id: string;
  name: string;
  category: string;
  distanceMeters: number;
  bearingDegrees: number;
  bearingLabel: string;
  accessibility: {
    wheelchair: string | null;
    tactilePaving: string | null;
    kerb: string | null;
    stepFree: boolean | null;
  };
}

interface OverpassElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const MAX_RADIUS_M = 1000;

// The free public Overpass instances are shared, best-effort infrastructure and do go down or
// 502 under load (observed during development) — try the configured one first, then fall back to
// a second public mirror rather than failing the whole feature on one server's bad day.
const OVERPASS_MIRRORS = [config.overpassBaseUrl, 'https://overpass.kumi.systems/api/interpreter'].filter(
  (url, i, arr) => arr.indexOf(url) === i
);

function buildQuery(lat: number, lon: number, radius: number, category?: string): string {
  const r = Math.min(radius, MAX_RADIUS_M);
  if (category) {
    return `[out:json][timeout:15];(node["amenity"="${category}"](around:${r},${lat},${lon});node["shop"="${category}"](around:${r},${lat},${lon}););out body 50;`;
  }
  return `[out:json][timeout:15];(node["amenity"](around:${r},${lat},${lon});node["shop"](around:${r},${lat},${lon});node["public_transport"="stop_position"](around:${r},${lat},${lon}););out body 50;`;
}

export async function findNearbyPlaces(
  lat: number,
  lon: number,
  radius: number,
  category?: string
): Promise<NearbyPlace[]> {
  const query = buildQuery(lat, lon, radius, category);

  let data: OverpassResponse | null = null;
  let lastError: unknown = null;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetchWithTimeout(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': config.osmUserAgent,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        throw new Error(`Overpass request failed: ${res.status}`);
      }
      data = (await res.json()) as OverpassResponse;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!data) {
    throw lastError instanceof Error ? lastError : new Error('All Overpass mirrors failed.');
  }

  return data.elements
    .filter((el) => el.tags?.name) // skip unnamed nodes, not useful to announce
    .map((el) => {
      const tags = el.tags ?? {};
      const category = tags.amenity ?? tags.shop ?? tags.public_transport ?? 'place';
      const distanceMeters = Math.round(haversineMeters(lat, lon, el.lat, el.lon));
      const bearing = bearingDegrees(lat, lon, el.lat, el.lon);
      const wheelchair = tags.wheelchair ?? null;

      return {
        id: `node/${el.id}`,
        name: tags.name as string,
        category,
        distanceMeters,
        bearingDegrees: Math.round(bearing),
        bearingLabel: bearingToCompassLabel(bearing),
        accessibility: {
          wheelchair,
          tactilePaving: tags.tactile_paving ?? null,
          kerb: tags.kerb ?? null,
          stepFree: wheelchair === 'yes' ? true : wheelchair === 'no' ? false : null,
        },
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
