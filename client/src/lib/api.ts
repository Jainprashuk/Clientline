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
  portfolioUrl: string;
  howIWork: string;
  availability: string;
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
  cases: ProfileCase[];
  sources: { hn: boolean; news: boolean; web: boolean; webPerDay: number };
}
/** A piece of past work; `service` is which of your services it proves. */
export interface ProfileCase { title: string; result: string; url: string; service: string; client: string }
/** What "Fill from resume" found (lib/profile/resume.js). Nothing is saved until you save the profile. */
export interface ResumeSuggestion {
  name: string; headline: string; portfolioUrl: string; location: string; services: string[];
  projects: { title: string; result: string; url: string; service: string }[];
}
export const readResume = (text: string, services: string[]) =>
  apiFetch<{ suggestion: ResumeSuggestion }>('/api/profile/from-resume', jsonBody({ text, services }));
export interface ProfileView { profile: Profile; complete: boolean; missing: string[] }

export const loadProfile = () => apiFetch<ProfileView>('/api/profile');
export const saveProfile = (p: Profile) => apiFetch<ProfileView>('/api/profile', jsonBody(p, 'PUT'));

// ── Leads ────────────────────────────────────────────────────────────────────
export type LeadStatus = 'new' | 'held' | 'approved' | 'in-sequence' | 'replied' | 'discarded';
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
  firstEmail?: FirstEmail | null;
  /** Lead detail only: the work the first email could cite, and what would make it stronger. */
  emailHelp?: EmailHelp;
  status: LeadStatus;
  /** On In outreach / Replied lists: where the lead is in its sequence. */
  outreach?: { sequence: string; step: number; steps: number; nextAt: string; status: string; stopReason: string | null };
  heldReason: string;
  discardReason: DiscardReason | null;
  createdAt: string;
}
export interface FirstEmail {
  subject: string; body: string; shape: 'asked' | 'event' | null; caseTitle: string | null; link: string | null;
  sources: string[]; state: 'written' | 'edited' | 'failed'; error: string | null; at: string | null;
}
export interface EmailHelp { cases: string[]; matching: number; missingCaseFor: string | null; strength: string[] }
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
export const saveFirstEmail = (id: string, firstEmail: { subject: string; body: string }) => apiFetch<Lead>(`/api/leads/${id}`, jsonBody({ firstEmail }, 'PATCH'));
export const writeFirstEmail = (id: string, useCase?: string) =>
  apiFetch<Lead & { ok: boolean; writeError: string | null }>(`/api/leads/${id}/first-email`, jsonBody({ useCase: useCase || null }));
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

// ── Outreach: sequences ──────────────────────────────────────────────────────
export interface SeqStep { kind: 'email' | 'task'; dayOffset: number; subject: string; body: string; useLeadEmail?: boolean }
export interface SeqStats {
  people: number; active: number; done: number; replied: number; bounced: number; unsubscribed: number;
  sent: Record<string, number>; repliedAt: Record<string, number>;
}
export interface Sequence { id: string; name: string; active: boolean; newPerDay: number; steps: SeqStep[]; stats: SeqStats | null; canUpgrade?: boolean }
export interface Variable { key: string; label: string }
export interface StepPreview { ok: boolean; subject?: string | null; body?: string; why?: string }

export const loadSequences = () => apiFetch<{ sequences: Sequence[]; variables: Variable[]; missingYours: (Variable & { where: string })[] }>('/api/outreach/sequences');
export const upgradeSequence = (id: string) => apiFetch<Sequence>(`/api/outreach/sequences/${id}/upgrade`, { method: 'POST' });
export const createSequence = (name: string) => apiFetch<Sequence>('/api/outreach/sequences', jsonBody({ name }));
export const updateSequence = (id: string, patch: Partial<Pick<Sequence, 'name' | 'active' | 'newPerDay' | 'steps'>>) =>
  apiFetch<Sequence>(`/api/outreach/sequences/${id}`, jsonBody(patch, 'PUT'));
export const deleteSequence = (id: string) => apiFetch<{ ok: boolean }>(`/api/outreach/sequences/${id}`, { method: 'DELETE' });
export const previewSequence = (steps: SeqStep[], leadId?: string) =>
  apiFetch<{ lead: { id: string; name: string; person: string } | null; steps: StepPreview[] }>('/api/outreach/sequences/preview', jsonBody({ steps, leadId }));

// ── Outreach: enrolment ──────────────────────────────────────────────────────
export interface EnrollResult { added: string[]; skipped: { id: string; name: string; reason: string }[]; sequence: { id: string; name: string; active: boolean } }
export interface LeadEnrollment {
  status: 'active' | 'paused' | 'stopped' | 'done'; stopReason: string | null; step: number; nextAt: string; enrolledAt: string;
  sequence: { id: string; name: string; steps: number; active: boolean } | null; lastError: string | null;
}
export const enrollLeads = (leadIds: string[], sequenceId: string) => apiFetch<EnrollResult>('/api/outreach/enroll', jsonBody({ leadIds, sequenceId }));
export const stopLeads = (leadIds: string[]) => apiFetch<{ ok: boolean; stopped: number }>('/api/outreach/stop', jsonBody({ leadIds }));
export const loadLeadEnrollment = (leadId: string) => apiFetch<{ enrollment: LeadEnrollment | null }>(`/api/outreach/lead/${leadId}`);

// ── Outreach: sending ────────────────────────────────────────────────────────
export interface DueTask { enrollmentId: string; leadId: string; lead: string; sequence: string; text: string }
export interface DueEmail {
  enrollmentId: string; leadId: string; name: string; email: string; sequence: string; step: number; steps: number;
  followUp: boolean; subject: string | null; body: string | null; blocked: string | null; edited: boolean;
}
export interface DueSummary {
  first: number; followUps: number; items: DueEmail[]; tasks: DueTask[]; inPausedSequences: number;
  sentToday: number; sendsPerDay: number; roomToday: number; pausedUntil: string | null;
}
export interface SendRun {
  id: string; status: 'queued' | 'running' | 'done' | 'stopped' | 'failed'; trigger: 'manual' | 'auto';
  total: number; sent: number; skipped: { name: string; reason: string }[]; last: { name: string; email: string } | null;
  stoppedBy: string | null; stopRequested: boolean; startedAt: string; finishedAt: string | null;
}
/** Fired on window when a send run starts here (the panel shows it at once) and when one ends (the Outreach page refreshes). */
export const SEND_STARTED_EVENT = 'clientline:send-started';
export const SEND_FINISHED_EVENT = 'clientline:send-finished';
export const loadDue = () => apiFetch<DueSummary>('/api/outreach/due');
export const startSending = (only?: string[]) => apiFetch<{ run: SendRun }>('/api/outreach/send', jsonBody({ only: only || null }));
export const activeSendRun = () => apiFetch<{ run: SendRun | null }>('/api/outreach/runs/active');
export const stopSendRun = (id: string) => apiFetch<{ ok: boolean }>(`/api/outreach/runs/${id}/stop`, { method: 'POST' });
export const editDueEmail = (enrollmentId: string, patch: { subject?: string; body?: string; reset?: boolean }) =>
  apiFetch<DueSummary>(`/api/outreach/due/${enrollmentId}`, jsonBody(patch, 'PUT'));
export const removeDueLead = (enrollmentId: string) => apiFetch<DueSummary>(`/api/outreach/due/${enrollmentId}/remove`, { method: 'POST' });
export const completeTask = (enrollmentId: string) => apiFetch<{ ok: boolean; due: DueSummary }>(`/api/outreach/tasks/${enrollmentId}/done`, { method: 'POST' });

// ── Inbox ────────────────────────────────────────────────────────────────────
export type ReplyCategory = 'wants-quote' | 'wants-call' | 'samples' | 'interested' | 'not-now' | 'no' | 'auto';
export interface InboxItem {
  id: string; leadId: string; email: string; name: string; company: string;
  category: ReplyCategory | null; categoryWhy: string; needsYou: boolean; unread: boolean;
  snoozedUntil: string | null; doneAt: string | null; lastAt: string; snippet: string;
  /** Sent view only. */
  subject?: string; sentCount?: number; state?: SentState;
}
export interface SentState { key: 'replied' | 'waiting' | 'no-reply' | 'bounced' | 'stopped' | 'sent'; label: string }
export interface SentThread {
  leadId: string; name: string; company: string; email: string; subject: string; conversationId: string | null; state: SentState;
  messages: (InboxMessage & { step: number | null; kind: 'sequence' | 'reply' })[];
}
export interface InboxList {
  view: 'needs' | 'snoozed' | 'all' | 'sent'; items: InboxItem[]; counts: { needs: number; snoozed: number; all: number; sent: number };
  categories: Record<ReplyCategory, string>; lastCheckAt: string | null; lastError: string | null;
}
export interface InboxMessage { direction: 'in' | 'out'; from: string; subject: string; text: string; messageId: string | null; at: string }
export interface InboxThread extends InboxItem {
  subject: string; messages: InboxMessage[]; bookingUrl: string;
  lead: { id: string; name: string; person: string; title: string; email: string; service: string } | null;
}
export const loadInbox = (view: InboxList['view']) => apiFetch<InboxList>(`/api/inbox?view=${view}`);
export const loadSentThread = (leadId: string) => apiFetch<SentThread>(`/api/inbox/sent/${leadId}`);
export const loadThread = (id: string) => apiFetch<InboxThread>(`/api/inbox/${id}`);
export const inboxCount = () => apiFetch<{ needsYou: number }>('/api/inbox/count');
export const checkReplies = (soon = false) => apiFetch<{ ok: boolean; replies: number; bounces: number; skipped?: string; error?: string }>(`/api/inbox/check${soon ? '?soon=1' : ''}`, { method: 'POST' });
export const snoozeThread = (id: string, until: string) => apiFetch<{ ok: boolean }>(`/api/inbox/${id}/snooze`, jsonBody({ until }));
export const doneThread = (id: string) => apiFetch<{ ok: boolean }>(`/api/inbox/${id}/done`, { method: 'POST' });
export const reopenThread = (id: string) => apiFetch<{ ok: boolean }>(`/api/inbox/${id}/reopen`, { method: 'POST' });
export const setThreadCategory = (id: string, category: ReplyCategory) => apiFetch<{ ok: boolean }>(`/api/inbox/${id}/category`, jsonBody({ category }, 'PUT'));
export const draftThreadReply = (id: string) => apiFetch<{ text: string; gaps: string[] }>(`/api/inbox/${id}/draft`, { method: 'POST' });
export const sendThreadReply = (id: string, text: string) => apiFetch<{ ok: boolean }>(`/api/inbox/${id}/send`, jsonBody({ text }));
