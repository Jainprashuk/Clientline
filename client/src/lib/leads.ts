import type { DiscardReason, Lead, LeadSource, LeadStatus } from './api';

export const SOURCE_LABEL: Record<LeadSource, string> = {
  paste: 'Pasted', hn: 'Hacker News', news: 'Funding news', 'web-post': 'Client post',
};
export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New', held: 'No contact yet', approved: 'Approved', 'in-sequence': 'In outreach', replied: 'Replied', discarded: 'Discarded',
};
export const STATUS_NOTE: Record<LeadStatus, string> = {
  new: 'Ready to review', held: 'Passed every check but has no email', approved: 'Ready for outreach',
  'in-sequence': 'Emails going out', replied: 'They answered — see Inbox', discarded: 'Hidden, with your reason',
};
export const DISCARD_LABEL: Record<DiscardReason, string> = {
  'not-my-service': 'Not my service',
  'too-small': 'Too small',
  'agency-or-recruiter': 'Agency or recruiter',
  spam: 'Spam or fake',
  'already-know': 'Already know them',
  'bad-contact': 'Wrong contact',
  other: 'Something else',
};
export const CONFIDENCE: Record<string, { label: string; cls: string; tip: string }> = {
  high: { label: 'On their post', cls: 'badge-sent', tip: 'Found on their own post or website' },
  medium: { label: 'Company inbox', cls: 'badge-pending', tip: 'A company address that accepts mail, but maybe not the person who decides' },
  low: { label: 'Guessed', cls: 'badge-rejected', tip: 'A guessed address — check it before writing' },
};

export const STRONG = 75;
export const WEAK = 50;
export const fitClass = (fit: number) => (fit >= STRONG ? 'cl-fit hi' : fit < WEAK ? 'cl-fit lo' : 'cl-fit');

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const d = Math.floor(ms / 86400000);
  if (d <= 0) { const h = Math.floor(ms / 3600000); return h <= 0 ? 'just now' : `${h}h ago`; }
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The line a list row shows under the name. */
export const whoLine = (l: Lead) => [l.person, l.title].filter(Boolean).join(', ') || l.where;
