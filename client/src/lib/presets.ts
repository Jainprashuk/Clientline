// Ready-made answers for the profile, so a beginner picks instead of types.
// Each service carries the keywords a client's post would use, a sensible
// smallest project (INR) and the words that usually mean "not this work".

export interface ServicePreset {
  id: string;
  name: string;
  icon: string;
  keywords: string[];
  minINR: number;
  exclusions: string[];
}

export const SERVICE_PRESETS: ServicePreset[] = [
  { id: 'web-apps', name: 'Web apps (React / Next.js)', icon: 'ti-brand-react', keywords: ['react', 'next.js', 'web app', 'frontend', 'saas', 'dashboard'], minINR: 25000, exclusions: ['wordpress'] },
  { id: 'backend', name: 'Backend & APIs (Node / Python)', icon: 'ti-server', keywords: ['node.js', 'backend', 'api', 'python', 'django', 'database'], minINR: 25000, exclusions: [] },
  { id: 'websites', name: 'Websites & landing pages', icon: 'ti-world', keywords: ['website', 'landing page', 'web developer', 'web design'], minINR: 12000, exclusions: [] },
  { id: 'wordpress', name: 'WordPress', icon: 'ti-brand-wordpress', keywords: ['wordpress', 'woocommerce', 'elementor'], minINR: 10000, exclusions: [] },
  { id: 'shopify', name: 'Shopify stores', icon: 'ti-brand-shopify', keywords: ['shopify', 'online store', 'e-commerce', 'ecommerce'], minINR: 15000, exclusions: [] },
  { id: 'mobile', name: 'Mobile apps', icon: 'ti-device-mobile', keywords: ['mobile app', 'react native', 'flutter', 'android', 'ios app'], minINR: 40000, exclusions: [] },
  { id: 'uiux', name: 'UI/UX design', icon: 'ti-layout', keywords: ['ui/ux', 'figma', 'ui designer', 'ux designer', 'app design'], minINR: 15000, exclusions: [] },
  { id: 'branding', name: 'Logos & branding', icon: 'ti-palette', keywords: ['logo', 'branding', 'brand identity', 'brand designer'], minINR: 8000, exclusions: [] },
  { id: 'seo', name: 'SEO', icon: 'ti-chart-line', keywords: ['seo', 'search ranking', 'google ranking', 'organic traffic'], minINR: 10000, exclusions: [] },
  { id: 'marketing', name: 'Social media & ads', icon: 'ti-speakerphone', keywords: ['social media', 'instagram marketing', 'meta ads', 'google ads', 'performance marketing'], minINR: 12000, exclusions: [] },
  { id: 'video', name: 'Video editing', icon: 'ti-movie', keywords: ['video editor', 'video editing', 'reels', 'youtube editing'], minINR: 5000, exclusions: [] },
  { id: 'writing', name: 'Content & copywriting', icon: 'ti-writing', keywords: ['content writer', 'copywriter', 'copywriting', 'blog writing'], minINR: 5000, exclusions: [] },
  { id: 'automation', name: 'AI & automation', icon: 'ti-robot', keywords: ['automation', 'ai agent', 'chatbot', 'zapier', 'n8n', 'llm'], minINR: 20000, exclusions: [] },
  { id: 'data', name: 'Data & dashboards', icon: 'ti-chart-bar', keywords: ['data analyst', 'dashboard', 'power bi', 'excel', 'sql'], minINR: 10000, exclusions: [] },
];

export const LOCATION_OPTIONS = ['india', 'us', 'uk', 'europe', 'canada', 'australia', 'uae', 'singapore'];
export const EXCLUSION_OPTIONS = ['equity only', 'unpaid', 'revenue share', 'internship', 'full-time', 'wordpress', 'crypto', 'adult', 'gambling'];

// Rough INR → other currencies, for a default smallest project. Rounded for display.
const FROM_INR: Record<string, number> = { INR: 1, USD: 1 / 84, EUR: 1 / 91, GBP: 1 / 107 };
export function inCurrency(inr: number, currency: string): number {
  const v = inr * (FROM_INR[currency] || 1);
  const step = currency === 'INR' ? 1000 : 50;
  return Math.max(step, Math.round(v / step) * step);
}

/** Best guess at where the user is, from the browser's time zone. */
export function guessHome(): { location: string; currency: 'INR' | 'USD' | 'EUR' | 'GBP' } {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old browser */ }
  if (/Kolkata|Calcutta/.test(tz)) return { location: 'india', currency: 'INR' };
  if (/London/.test(tz)) return { location: 'uk', currency: 'GBP' };
  if (/^Europe\//.test(tz)) return { location: 'europe', currency: 'EUR' };
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix)/.test(tz)) return { location: 'us', currency: 'USD' };
  if (/Dubai/.test(tz)) return { location: 'uae', currency: 'USD' };
  if (/Singapore/.test(tz)) return { location: 'singapore', currency: 'USD' };
  if (/Australia/.test(tz)) return { location: 'australia', currency: 'USD' };
  if (/Toronto|Vancouver/.test(tz)) return { location: 'canada', currency: 'USD' };
  return { location: 'india', currency: 'INR' };
}

// Words that, in a service the user typed themselves, suggest the keywords a post would use.
const KEYWORD_HINTS: Record<string, string[]> = {
  react: ['react', 'next.js', 'frontend'], next: ['next.js', 'react'], node: ['node.js', 'backend', 'api'],
  web: ['website', 'web app', 'web developer'], website: ['website', 'landing page', 'web developer'],
  landing: ['landing page', 'website'], mobile: ['mobile app', 'react native', 'flutter'], app: ['app developer', 'mvp'],
  flutter: ['flutter', 'mobile app'], android: ['android', 'mobile app'], ios: ['ios', 'swift', 'mobile app'],
  shopify: ['shopify', 'e-commerce', 'store'], wordpress: ['wordpress', 'website'], design: ['designer', 'ui/ux', 'figma'],
  ui: ['ui/ux', 'figma', 'designer'], ux: ['ui/ux', 'figma'], brand: ['branding', 'logo', 'brand designer'],
  logo: ['logo', 'branding'], seo: ['seo', 'search ranking'], marketing: ['marketing', 'growth'], content: ['content writer', 'copywriting'],
  copy: ['copywriter', 'copywriting'], video: ['video editor', 'video editing'], data: ['data analyst', 'dashboard', 'python'],
  python: ['python', 'django', 'automation'], ai: ['ai', 'llm', 'chatbot'], automation: ['automation', 'zapier', 'workflow'],
  devops: ['devops', 'aws', 'deployment'], backend: ['backend', 'api', 'database'], dashboard: ['dashboard', 'admin panel'],
  mvp: ['mvp', 'prototype'], photo: ['photographer', 'photo editing'], illustration: ['illustrator', 'illustration'],
  excel: ['excel', 'spreadsheet'], game: ['game developer', 'unity'], blockchain: ['blockchain', 'web3', 'smart contract'],
};

// Words too general to match a post on their own.
const GENERIC = new Set(['and', 'the', 'for', 'with', 'sites', 'site', 'services', 'service', 'work', 'freelance', 'freelancer',
  'expert', 'developer', 'development', 'design', 'designer', 'apps', 'app', 'web', 'online', 'help', 'projects', 'project', 'custom']);

/** Keywords for a service the user named themselves; always includes the name itself. */
export function suggestKeywords(name: string): string[] {
  const out: string[] = [];
  const clean = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (clean && clean.length <= 40) out.push(clean);
  for (const w of clean.split(/[^a-z0-9+.#]+/)) {
    for (const k of KEYWORD_HINTS[w.replace(/\.js$/, '')] || []) if (!out.includes(k)) out.push(k);
    // The name's own distinctive words ("webflow" from "Webflow sites").
    if (w.length >= 3 && !GENERIC.has(w) && !out.includes(w)) out.push(w);
  }
  return out.slice(0, 8);
}
