import type { Currency } from './api';

/** Minor units (paise / cents) → "₹80,000". */
export const money = (minor: number, currency: Currency = 'INR') =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format((minor || 0) / 100);

/** Several currencies' totals, biggest first: "₹2,40,000 + $3,000". */
export const totals = (t: Partial<Record<Currency, number>> | undefined) =>
  Object.entries(t || {}).filter(([, v]) => v).sort((a, b) => (b[1] || 0) - (a[1] || 0)).map(([c, v]) => money(v || 0, c as Currency)).join(' + ');
