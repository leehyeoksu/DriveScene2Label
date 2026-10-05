import { defineConfig, devices } from '@playwright/test';

/**
 * Live integration against a running Spring backend (no route mocks). The built app is served by `vite preview`
 * with `/api` proxied to DS2L_API (default http://127.0.0.1:8080).
 *   DS2L_API=http://127.0.0.1:8080 npx playwright test -c playwright.live.config.ts
 * Optional: DS2L_LIVE_JOB_ID=<existing job> to open it; DS2L_LIVE_ALLOW_POST=1 to let the test create a recording.
 * DS2L_BASE_URL=http://127.0.0.1:5174 uses an already running app (e.g. `npm run dev`) instead of building one.
 * Job creation is never automated here: it would start a real VESPA run.
 */
const api = process.env.DS2L_API ?? 'http://127.0.0.1:8080';
const external = process.env.DS2L_BASE_URL;
export default defineConfig({
  testDir: './tests/live',
  outputDir: './test-results/live',
  reporter: [['list']],
  timeout: 90_000,
  use: { baseURL: external ?? 'http://127.0.0.1:4174', trace: 'retain-on-failure', locale: 'ko-KR', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  webServer: external ? undefined : {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { API_PROXY_TARGET: api },
  },
});
