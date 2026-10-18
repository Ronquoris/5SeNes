const EARTH_RADIUS_M = 6371000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Compass bearing in degrees (0 = north, 90 = east) from point 1 to point 2.
// Note: this is relative to true north, not the user's facing direction — the backend has no
// way to know which way someone is facing, only their coordinates.
export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function bearingToCompassLabel(bearing: number): string {
  const index = Math.round(bearing / 45) % 8;
  return COMPASS_LABELS[index];
}

// Perpendicular distance in metres from a point to the nearest segment of a polyline,
// used to decide whether a hazard sits close enough to a route to warn about.
export function distanceToLineMeters(
  lat: number,
  lon: number,
  line: Array<[number, number]> // [lon, lat] pairs, GeoJSON order
): number {
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [lon1, lat1] = line[i];
    const [lon2, lat2] = line[i + 1];
    const d = distanceToSegmentMeters(lat, lon, lat1, lon1, lat2, lon2);
    if (d < min) min = d;
  }
  return min;
}

function distanceToSegmentMeters(
  plat: number,
  plon: number,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  // Work in a local flat-earth approximation (fine at city scale) using metres-per-degree.
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(toRad(plat));

  const toXY = (lat: number, lon: number) => ({
    x: (lon - plon) * metersPerDegLon,
    y: (lat - plat) * metersPerDegLat,
  });

  const p = { x: 0, y: 0 };
  const a = toXY(lat1, lon1);
  const b = toXY(lat2, lon2);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  let t = lengthSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closest = { x: a.x + t * abx, y: a.y + t * aby };
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}
