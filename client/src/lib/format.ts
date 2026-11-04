// From Outreach's client/src/lib/format.ts — only what the shell uses so far.

export const initials = (name: string) =>
  name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

const AVATAR_COLORS: Array<[string, string]> = [
  ['var(--blue-bg)', 'var(--blue)'],
  ['var(--green-bg)', 'var(--green)'],
  ['var(--amber-bg)', 'var(--amber)'],
  ['var(--pink-bg)', 'var(--pink)'],
  ['var(--teal-bg)', 'var(--teal)'],
];

export const avatarColor = (name: string): [string, string] =>
  AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
