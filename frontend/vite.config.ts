import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

// The browser only talks to Spring `/api/*`. In development Vite proxies it (JSON, JPG and .rrd alike);
// in deployment a same-origin reverse proxy does the same. Never point this at FastAPI or the DB.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8080';
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // The Rerun viewer loads its .wasm via `new URL(..., import.meta.url)`; pre-bundling would break that path.
    optimizeDeps: { exclude: ['@rerun-io/web-viewer'] },
    server: { port: 5173, proxy: { '/api': { target, changeOrigin: false } } },
    preview: { port: 4173, proxy: { '/api': { target, changeOrigin: false } } },
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  };
});
