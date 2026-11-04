// Always same-origin: Express serves the SPA at /app in prod, and the Vite dev
// server proxies /api in dev. Relative URLs work in both.
export const API_BASE = '';
