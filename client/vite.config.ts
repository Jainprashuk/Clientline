import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same setup as Outreach's client: the SPA is served by the Express server under
// /app, behind the same session check as the API.
const SERVER = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: 'dist',
    // Stable, non-hashed filenames so index.html always references assets that
    // exist, even when a CDN caches index.html separately from the bundle.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/app.[ext]',
      },
    },
  },
  server: {
    // 5173 is Outreach's, so both dev servers can run side by side.
    port: 5174,
    proxy: {
      // Same-origin proxy so the clientline_session cookie flows.
      '/api': SERVER,
      // In dev Vite rewrites /css/style.css under `base`; strip /app back off.
      '/app/css': { target: SERVER, rewrite: (p) => p.replace(/^\/app/, '') },
      '/css': SERVER,
      '/login': SERVER,
    },
  },
});
