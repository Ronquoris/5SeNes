import 'dotenv/config';

function requireNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: requireNumber(process.env.PORT, 4000),
  nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
  osrmBaseUrl: process.env.OSRM_BASE_URL ?? 'https://routing.openstreetmap.de/routed-foot',
  overpassBaseUrl: process.env.OVERPASS_BASE_URL ?? 'https://overpass-api.de/api/interpreter',
  osmUserAgent: process.env.OSM_USER_AGENT ?? '5Sense-AccessibleNav/0.1 (dev)',
  // Manchester city centre bounding box: left,top,right,bottom (lon,lat,lon,lat)
  manchesterViewbox: process.env.MANCHESTER_VIEWBOX ?? '-2.3200,53.5200,-2.1500,53.4300',
  defaultLat: requireNumber(process.env.DEFAULT_LAT, 53.4808),
  defaultLon: requireNumber(process.env.DEFAULT_LON, -2.2426),
  frontendDevOrigin: process.env.FRONTEND_DEV_ORIGIN ?? 'http://localhost:5173',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? '',
};
