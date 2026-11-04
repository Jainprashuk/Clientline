// Always same-origin: Express serves the SPA at /app in prod, and the Vite dev
// server proxies /api in dev. Relative URLs work in both.
export const API_BASE = '';

/** JSON in, JSON out. Throws an Error carrying the server's message, `.status` and `.code`. */
export async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* a platform error page */ }
  if (!res.ok) {
    // Signed out mid-session: the login page, not a toast.
    if (res.status === 401) { window.location.href = '/login'; }
    const e: any = new Error((data && data.error) || `Request failed (${res.status})`);
    e.code = (data && data.code) || null;
    e.status = res.status;
    throw e;
  }
  return data as T;
}

export const jsonBody = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });

// ── Free connections ─────────────────────────────────────────────────────────
export type AiProvider = 'groq' | 'gemini' | 'cerebras';
export type SearchProvider = 'tavily' | 'serpapi';
export type Provider = AiProvider | SearchProvider;
export interface KeyStatus { state: 'ok' | 'invalid' | 'quota'; checkedAt: string; error: string | null }
export interface KeyView { saved: boolean; last4: string; status: KeyStatus | null }
export interface Connections {
  ai: Record<AiProvider, KeyView>;
  search: Record<SearchProvider, KeyView>;
  usage: { month: string; tavily: number; serpapi: number; caps: Record<SearchProvider, number> };
  aiReady: boolean;
  warning?: string | null;
}

export const loadConnections = () => apiFetch<Connections>('/api/connections');
export const saveKey = (p: Provider, key: string) => apiFetch<Connections>(`/api/connections/${p}`, jsonBody({ key }, 'PUT'));
export const removeKey = (p: Provider) => apiFetch<Connections>(`/api/connections/${p}`, { method: 'DELETE' });
export const testKey = (p: Provider) => apiFetch<Connections & { ok: boolean; error: string | null }>(`/api/connections/${p}/test`, { method: 'POST' });
