import { defineConfig } from 'vite';

// The page is served under /test/ by the web container, next to the app. In `npm run dev` the
// backend is the compose stack on port 8080, so /api is proxied there and the page stays same-origin.
export default defineConfig({
  base: '/test/',
  server: { host: true, port: 5174, proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', sourcemap: false },
});
