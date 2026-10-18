import { config } from '../config.js';
import { fetchWithTimeout } from './httpTimeout.js';

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  osmId: string;
}

interface NominatimSearchItem {
  display_name: string;
  lat: string;
  lon: string;
  osm_type: string;
  osm_id: number;
}

// Small in-memory cache so repeat searches during a demo don't hammer the public Nominatim
// instance — it has a strict 1 req/sec usage policy.
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function cachedFetch(url: string): Promise<unknown> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': config.osmUserAgent, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Nominatim request failed: ${res.status}`);
  }
  const value = await res.json();
  cache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function geocode(
  query: string,
  limit = 5,
  userLat?: number,
  userLon?: number
): Promise<GeocodeResult[]> {
  const url = new URL(`${config.nominatimBaseUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(limit));
  
  // Use user's live position if available (~25km bounding box), else default city viewbox
  if (userLat !== undefined && userLon !== undefined && !Number.isNaN(userLat) && !Number.isNaN(userLon)) {
    const box = `${userLon - 0.25},${userLat + 0.25},${userLon + 0.25},${userLat - 0.25}`;
    url.searchParams.set('viewbox', box);
  } else {
    url.searchParams.set('viewbox', config.manchesterViewbox);
  }
  url.searchParams.set('bounded', '0');

  const items = (await cachedFetch(url.toString())) as NominatimSearchItem[];
  return items.map((item) => ({
    label: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon),
    osmId: `${item.osm_type}/${item.osm_id}`,
  }));
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ label: string; lat: number; lon: number }> {
  const url = new URL(`${config.nominatimBaseUrl}/reverse`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');

  const item = (await cachedFetch(url.toString())) as NominatimSearchItem;
  return { label: item.display_name, lat: Number(item.lat), lon: Number(item.lon) };
}
