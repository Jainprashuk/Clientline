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
export interface KeyView {
  saved: boolean;
  /** A key is in use: saved here, or the user's Outreach key. */
  inUse: boolean;
  from: 'clientline' | 'outreach' | null;
  last4: string;
  inOutreach: boolean;
  status: KeyStatus | null;
}
export interface Connections {
  ai: Record<AiProvider, KeyView>;
  search: Record<SearchProvider, KeyView>;
  usage: { month: string; tavily: number; serpapi: number; caps: Record<SearchProvider, number> };
  aiReady: boolean;
  outreach: { canShare: boolean; on: boolean; found: Provider[] };
  gmail: GmailView;
  warning?: string | null;
}
export interface GmailView {
  email: string; from: 'clientline' | 'outreach' | null; savedHere: boolean;
  senderName: string; bookingUrl: string; sendsPerDay: number; sentToday: number; pausedUntil: string | null;
}

export const loadConnections = () => apiFetch<Connections>('/api/connections');
export const saveKey = (p: Provider, key: string) => apiFetch<Connections>(`/api/connections/${p}`, jsonBody({ key }, 'PUT'));
export const removeKey = (p: Provider) => apiFetch<Connections>(`/api/connections/${p}`, { method: 'DELETE' });
export const connectGmail = (email: string, appPassword: string, name: string) => apiFetch<Connections>('/api/connections/gmail', jsonBody({ email, appPassword, name }, 'PUT'));
export const disconnectGmail = () => apiFetch<Connections>('/api/connections/gmail', { method: 'DELETE' });
export const testGmail = () => apiFetch<Connections & { ok: boolean; error: string | null }>('/api/connections/gmail/test', { method: 'POST' });
export const saveGmailSettings = (b: { senderName?: string; bookingUrl?: string; sendsPerDay?: number }) => apiFetch<Connections>('/api/connections/gmail/settings', jsonBody(b, 'PUT'));
export const setShareOutreach = (on: boolean) => apiFetch<Connections>('/api/connections/share', jsonBody({ on }, 'PUT'));
export const testKey = (p: Provider) => apiFetch<Connections & { ok: boolean; error: string | null }>(`/api/connections/${p}/test`, { method: 'POST' });

// ── My profile ───────────────────────────────────────────────────────────────
export interface Service { name: string; keywords: string[]; minBudget: number }
export interface Profile {
  name: string;
  headline: string;
  services: Service[];
  currency: 'INR' | 'USD' | 'EUR' | 'GBP';
  rate: number;
  minProject: number;
  clientTypes: string[];
  companySizes: string[];
  locations: string[];
  remoteOk: boolean;
  exclusions: string[];
  proof: { who: string; text: string }[];
  cases: { title: string; result: string; url: string }[];
  sources: { hn: boolean; news: boolean; web: boolean; webPerDay: number };
}
export interface ProfileView { profile: Profile; complete: boolean; missing: string[] }

export const loadProfile = () => apiFetch<ProfileView>('/api/profile');
export const saveProfile = (p: Profile) => apiFetch<ProfileView>('/api/profile', jsonBody(p, 'PUT'));

// ── Leads ────────────────────────────────────────────────────────────────────
export type LeadStatus = 'new' | 'held' | 'approved' | 'discarded';
export type LeadSource = 'paste' | 'hn' | 'news' | 'web-post';
export type DiscardReason = 'not-my-service' | 'too-small' | 'agency-or-recruiter' | 'spam' | 'already-know' | 'bad-contact' | 'other';
export interface Signal { text: string; source: string; url: string | null; at: string | null }
export interface Lead {
  id: string;
  name: string;
  person: string;
  title: string;
  email: string | null;
  emailConfidence: 'high' | 'medium' | 'low' | null;
  domain?: string | null;
  source: LeadSource;
  sourceType: 'asked' | 'trigger';
  where: string;
  postUrl?: string | null;
  postedAt: string | null;
  about?: string;
  signals: Signal[];
  budget?: { amount: number; currency: string; hourly: boolean } | null;
  service: string;
  fit: number;
  fitWhy: string[];
  opener: string;
  openerSources?: string[];
  openerState: 'none' | 'written' | 'edited' | 'failed' | 'skipped';
  openerError?: string | null;
  status: LeadStatus;
  heldReason: string;
  discardReason: DiscardReason | null;
  createdAt: string;
}
export interface LeadList {
  leads: Lead[];
  total: number; page: number; limit: number; pages: number;
  counts: Record<LeadStatus, number>;
  weakHidden: number;
}
export interface LeadQuery { status: LeadStatus; source?: LeadSource | ''; q?: string; hideWeak?: boolean; page?: number }

export function loadLeads(q: LeadQuery) {
  const p = new URLSearchParams({ status: q.status, page: String(q.page || 1), limit: '50' });
  if (q.source) p.set('source', q.source);
  if (q.q) p.set('q', q.q);
  if (q.hideWeak) p.set('hideWeak', '1');
  return apiFetch<LeadList>(`/api/leads?${p}`);
}
export const loadLead = (id: string) => apiFetch<Lead>(`/api/leads/${id}`);
export const saveOpener = (id: string, opener: string) => apiFetch<Lead>(`/api/leads/${id}`, jsonBody({ opener }, 'PATCH'));
export const writeLeadOpener = (id: string) => apiFetch<Lead & { ok: boolean; writeError: string | null }>(`/api/leads/${id}/opener`, { method: 'POST' });
export const approveLead = (id: string) => apiFetch<Lead>(`/api/leads/${id}/approve`, { method: 'POST' });
export const restoreLead = (id: string) => apiFetch<Lead>(`/api/leads/${id}/restore`, { method: 'POST' });
export const discardLead = (id: string, reason: DiscardReason) => apiFetch<Lead>(`/api/leads/${id}/discard`, jsonBody({ reason }));

// ── Sources ──────────────────────────────────────────────────────────────────
export type RunnableSource = 'hn' | 'news' | 'web-post';
export interface SourceRun {
  id: string; source: LeadSource; label: string; trigger: 'manual' | 'cron';
  status: 'running' | 'done' | 'partial' | 'failed';
  startedAt: string; finishedAt: string | null; units: number; unitsDone: number;
  read: number; created: number; held: number; updated: number; repeats: number; capped: number; dropped: number;
  credits: number; error: string | null; reasons: { reason: string; n: number }[];
  /** Its results were saved and can be opened. */
  logged: boolean;
}
export interface SourceStatus { source: LeadSource; label: string; enabled: boolean; needs: string | null; lastRun: SourceRun | null }
export interface SourcesView { profileComplete: boolean; missing: string[]; aiReady: boolean; sources: SourceStatus[] }
export interface PastePreviewRow {
  name: string; text: string; verdict: 'new' | 'held' | 'drop'; reason: string;
  fit?: number; fitWhy?: string[]; email?: string | null; emailConfidence?: string | null; service?: string;
}
export interface PastePreview { messages: number; considered: number; kept: number; held: number; dropped: number; reasons: Record<string, number>; preview: PastePreviewRow[] }

export const loadSources = () => apiFetch<SourcesView>('/api/sources');
export const runSource = (source: RunnableSource) => apiFetch<{ run: SourceRun }>('/api/sources/run', jsonBody({ source }));
export const previewPaste = (text: string) => apiFetch<PastePreview>('/api/sources/paste/preview', jsonBody({ text }));
export const importPaste = (text: string) => apiFetch<{ run: SourceRun }>('/api/sources/paste/import', jsonBody({ text }));

// ── Everything a run read ────────────────────────────────────────────────────
export type RunOutcome = 'lead' | 'held' | 'drop' | 'repeat' | 'updated' | 'capped' | 'added';
export interface RunItem {
  id: string; outcome: RunOutcome; reason: string; name: string; text: string; url: string | null;
  email: string | null; fit: number | null; leadId: string | null; source: LeadSource;
}
export interface RunItems {
  run: SourceRun; items: RunItem[]; total: number; page: number; pages: number;
  counts: { outcome: Partial<Record<RunOutcome, number>>; reasons: { reason: string; n: number }[] };
  keptDays: number;
}
export function loadRunItems(runId: string, q: { outcome?: RunOutcome | ''; reason?: string; page?: number }) {
  const p = new URLSearchParams({ page: String(q.page || 1) });
  if (q.outcome) p.set('outcome', q.outcome);
  if (q.reason) p.set('reason', q.reason);
  return apiFetch<RunItems>(`/api/sources/runs/${runId}/items?${p}`);
}
export const addRunItem = (id: string) => apiFetch<{ ok: boolean; leadId: string; status: LeadStatus; already: boolean }>(`/api/sources/items/${id}/add`, { method: 'POST' });
