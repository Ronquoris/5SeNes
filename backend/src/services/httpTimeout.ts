// The public OSM demo instances (Nominatim/OSRM/Overpass) are shared, free, best-effort
// services — under load they can hang instead of erroring, which would otherwise stall a
// request indefinitely. Every outbound call to them goes through this so a slow upstream fails
// fast with a clear error instead of leaving the user staring at a spinner during a live demo.
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request to ${new URL(url).host} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
