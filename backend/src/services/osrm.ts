import { config } from '../config.js';
import { fetchWithTimeout } from './httpTimeout.js';

export interface RouteStep {
  index: number;
  instruction: string;
  distanceMeters: number;
  maneuver: string;
  location: { lat: number; lon: number };
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  steps: RouteStep[];
}

interface OsrmStep {
  distance: number;
  maneuver: { type: string; modifier?: string; location: [number, number] };
  name: string;
}

interface OsrmResponse {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: Array<[number, number]> };
    legs: Array<{ steps: OsrmStep[] }>;
  }>;
}

function describeStep(step: OsrmStep): string {
  const { type, modifier } = step.maneuver;
  const streetName = step.name ? ` onto ${step.name}` : '';

  if (type === 'depart') return `Head ${modifier ?? 'forward'}${streetName}`;
  if (type === 'arrive') return 'Arrive at your destination';
  if (type === 'turn' && modifier) return `Turn ${modifier}${streetName}`;
  if (type === 'new name' && step.name) return `Continue onto ${step.name}`;
  if (type === 'roundabout') return `Go through the roundabout${streetName}`;
  return `Continue${streetName}`;
}

export async function getFootRoute(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number }
): Promise<RouteResult> {
  const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const url = new URL(`${config.osrmBaseUrl}/route/v1/foot/${coords}`);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'true');

  const res = await fetchWithTimeout(url.toString(), { headers: { 'User-Agent': config.osmUserAgent } });
  if (!res.ok) {
    throw new Error(`OSRM request failed: ${res.status}`);
  }
  const data = (await res.json()) as OsrmResponse;
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error(`OSRM could not find a route (code: ${data.code})`);
  }

  const route = data.routes[0];
  const steps: RouteStep[] = route.legs.flatMap((leg) => leg.steps).map((step, index) => ({
    index,
    instruction: describeStep(step),
    distanceMeters: Math.round(step.distance),
    maneuver: step.maneuver.modifier ? `${step.maneuver.type}-${step.maneuver.modifier}` : step.maneuver.type,
    location: { lat: step.maneuver.location[1], lon: step.maneuver.location[0] },
  }));

  return {
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration),
    geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
    steps,
  };
}
