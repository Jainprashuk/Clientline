/**
 * The sections, in the prototype's order (claudemd/clientline-prototype.html).
 * The core loop first — Leads → Outreach → Inbox — then the money end of it,
 * then setup. One list drives both the sidebar and the routes.
 */
export interface Section {
  path: string;
  icon: string;
  label: string;
  /** The sidebar tooltip and the page subtitle. */
  tip: string;
  /** Starts the second group in the sidebar. */
  group?: 'setup';
}

export const SECTIONS: Section[] = [
  { path: '/', icon: 'ti-sun', label: 'Today',
    tip: 'What needs you today: replies waiting, follow-ups due, new leads and money on the way.' },
  { path: '/leads', icon: 'ti-target-arrow', label: 'Leads',
    tip: 'People who need what you sell, found from free sources. Open one to see why it fits and a first line you can check.' },
  { path: '/outreach', icon: 'ti-send', label: 'Outreach',
    tip: 'Sequences send from your own Gmail, a few at a time, and stop for anyone who replies, bounces or unsubscribes.' },
  { path: '/inbox', icon: 'ti-inbox', label: 'Inbox',
    tip: 'Replies to your outreach, sorted by what the person wants. Drafts use only your profile and the thread.' },
  { path: '/deals', icon: 'ti-layout-kanban', label: 'Deals',
    tip: 'Conversations that could become work — talking, call booked, proposal sent. Once won, they move to Projects.' },
  { path: '/work', icon: 'ti-checklist', label: 'Projects',
    tip: 'Work you’ve won: a checklist from the proposal, payments as they come due, the target date, and progress updates to the client.' },
  { path: '/proposals', icon: 'ti-file-description', label: 'Proposals',
    tip: 'Each proposal is a page the client opens from a link. You see when they read it; they can accept on the same page.' },
  { path: '/invoices', icon: 'ti-receipt', label: 'Invoices',
    tip: 'Indian clients pay by UPI from a QR on the invoice — no gateway, no fees. Reminders go out from your Gmail.' },
  { path: '/projects', icon: 'ti-briefcase', label: 'Project boards', group: 'setup',
    tip: 'Freelance job boards. Freelancer.com through its official API; for Upwork you paste a job. You always submit yourself.' },
  { path: '/profile', icon: 'ti-user-circle', label: 'My profile', group: 'setup',
    tip: 'What you sell, who you sell to and your prices. Leads, first lines and drafts are all built from this.' },
  { path: '/connections', icon: 'ti-plug-connected', label: 'Free connections', group: 'setup',
    tip: 'Your Gmail and your own free API keys. Nothing here costs money.' },
];
