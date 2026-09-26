/**
 * sosApi.ts — frontend client for the NEXORA SOS Signal backend bridge.
 *
 * - submitBeacon()    POST the one-tap SOS to the server (used by the store)
 * - fetchServerSOS()  catch-up pull of reports already on the server
 * - subscribeServerSOS()  live SSE stream so the authorities dashboard
 *                         receives new SOS reports the moment they arrive
 * - checkServerHealth()   quick connectivity check
 *
 * Backend base:  VITE_API_URL env var, or '' (same origin — proxied by Vite
 * dev server to http://localhost:3001). See .env.example.
 */

export interface BeaconPayload {
  lat: number;
  lng: number;
  accuracy?: number;
  locationName?: string;
  phone?: string;
  message?: string;
  needs?: string[];
  peopleCount?: number;
  source?: string;
}

export interface ServerSOS {
  id: string;
  type: string;
  source: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  locationName: string;
  phone: string;
  phoneMasked: string;
  peopleCount: number;
  needs: string[];
  message: string;
  priorityScore: number;
  priorityLevel: string;
  status: string;
  aiExplanation: string;
  timestamp: string;
}

export type SosServerStatus = 'CONNECTING' | 'LIVE' | 'OFFLINE';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '';

async function request<T>(path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the one-tap SOS beacon to the server. Returns the server report. */
export async function submitBeacon(payload: BeaconPayload): Promise<ServerSOS | null> {
  try {
    return await request<ServerSOS>('/api/sos', { method: 'POST', body: JSON.stringify(payload) });
  } catch {
    return null; // backend offline — caller falls back to local-only mode
  }
}

/** Pulls the latest reports already recorded by the server. */
export async function fetchServerSOS(limit = 50): Promise<ServerSOS[]> {
  try {
    return await request<ServerSOS[]>(`/api/sos?limit=${limit}`);
  } catch {
    return [];
  }
}

/** One-shot connectivity check (health endpoint). */
export async function checkServerHealth(): Promise<boolean> {
  try {
    await request<unknown>('/api/health');
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to the server's SSE stream. Returns an unsubscribe function.
 * EventSource auto-reconnects, so network blips are handled for free.
 */
export function subscribeServerSOS(handlers: {
  onReport: (report: ServerSOS) => void;
  onStatus?: (status: SosServerStatus) => void;
}): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`${API_BASE}/api/events`);
    es.onopen = () => handlers.onStatus?.('LIVE');
    es.onerror = () => handlers.onStatus?.('CONNECTING');
    es.addEventListener('sos', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data as string) as ServerSOS;
        handlers.onReport(data);
      } catch {
        /* ignore malformed payloads */
      }
    });
  } catch {
    handlers.onStatus?.('OFFLINE');
  }
  return () => {
    try {
      es?.close();
    } catch {
      /* noop */
    }
  };
}