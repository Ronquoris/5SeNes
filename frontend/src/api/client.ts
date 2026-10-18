const USER_ID_KEY = '5sense-user-id';

export function getOrCreateUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export interface ApiError {
  error: { code: string; message: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      // Fastify's JSON body parser rejects a request that declares application/json but sends
      // no body (400), so only set this header when there's actually a body to parse.
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      'X-User-Id': getOrCreateUserId(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = await res.json();
    } catch {
      // ignore parse failure, fall through to generic error
    }
    const message = body?.error?.message ?? `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  osmId: string;
}

export function geocodeSearch(
  query: string,
  limit = 5,
  userLat?: number,
  userLon?: number
): Promise<{ results: GeocodeResult[] }> {
  let url = `/api/geocode?q=${encodeURIComponent(query)}&limit=${limit}`;
  if (userLat !== undefined && userLon !== undefined) {
    url += `&lat=${userLat}&lon=${userLon}`;
  }
  return request(url);
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface HazardWarning {
  hazardId: string;
  type: string;
  severity: string;
  distanceFromStepMeters: number;
}

export interface RouteStep {
  index: number;
  instruction: string;
  distanceMeters: number;
  maneuver: string;
  location: LatLon;
  hazardWarnings: HazardWarning[];
}

export interface RouteResponse {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
  steps: RouteStep[];
}

export function fetchRoute(origin: LatLon, destination: LatLon): Promise<RouteResponse> {
  return request('/api/route', {
    method: 'POST',
    body: JSON.stringify({ origin, destination }),
  });
}

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

export function fetchNearbyPlaces(
  lat: number,
  lon: number,
  radius = 300,
  category?: string
): Promise<{ places: NearbyPlace[] }> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radius) });
  if (category) params.set('category', category);
  return request(`/api/places/nearby?${params.toString()}`);
}

export interface HazardReport {
  id: string;
  lat: number;
  lon: number;
  type: string;
  description: string | null;
  severity: string;
  confirmCount: number;
  createdAt: string;
  distanceMeters?: number;
}

export function fetchNearbyHazards(lat: number, lon: number, radius = 500): Promise<{ hazards: HazardReport[] }> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radius) });
  return request(`/api/hazards/nearby?${params.toString()}`);
}

export function reportHazard(input: {
  lat: number;
  lon: number;
  type: string;
  description?: string;
}): Promise<{ id: string; createdAt: string }> {
  return request('/api/hazards', { method: 'POST', body: JSON.stringify(input) });
}

export function confirmHazard(id: string): Promise<HazardReport> {
  return request(`/api/hazards/${id}/confirm`, { method: 'POST' });
}

export interface TrustedContact {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
}

export function fetchContacts(): Promise<{ contacts: TrustedContact[] }> {
  return request('/api/contacts');
}

export function createContact(input: { name: string; relationship?: string; phone?: string; email?: string }): Promise<TrustedContact> {
  return request('/api/contacts', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteContact(id: string): Promise<void> {
  return request(`/api/contacts/${id}`, { method: 'DELETE' });
}

export interface SosStartResponse {
  sessionId: string;
  shareUrl: string;
}

export function startSos(input: { contactIds: string[]; initialLocation: LatLon; message?: string }): Promise<SosStartResponse> {
  return request('/api/sos/start', { method: 'POST', body: JSON.stringify(input) });
}

export function pingSosLocation(sessionId: string, input: { lat: number; lon: number; accuracyMeters?: number; timestamp: string }): Promise<void> {
  return request(`/api/sos/${sessionId}/location`, { method: 'POST', body: JSON.stringify(input) });
}

export function stopSos(sessionId: string, reason: string): Promise<{ status: string }> {
  return request(`/api/sos/${sessionId}/stop`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export interface SosView {
  status: 'active' | 'stopped';
  message: string | null;
  startedAt: string;
  stoppedAt: string | null;
  lastLocation: { lat: number; lon: number; accuracyMeters: number | null; timestamp: string } | null;
}

export function fetchSosView(sessionId: string): Promise<SosView> {
  return request(`/api/sos/${sessionId}`);
}

export interface VisionAnalysisResponse {
  provider: string;
  description: string;
}

export function analyzeVisionScene(input: {
  image: string;
  prompt?: string;
  provider?: string;
  apiKey?: string;
  detectedSummary?: string;
}): Promise<VisionAnalysisResponse> {
  return request('/api/vision/analyze', { method: 'POST', body: JSON.stringify(input) });
}
