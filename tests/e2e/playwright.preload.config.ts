import { defineConfig, devices } from '@playwright/test';

const origin = 'http://127.0.0.1:4177';

export default defineConfig({
  testDir: '.',
  testMatch: 'preload-recovery.spec.ts',
  timeout: 60_000,
  use: { baseURL: origin },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    cwd: '../..',
    command:
      'pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4177 --strictPort',
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
