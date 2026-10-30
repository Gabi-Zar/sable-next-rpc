import { defineConfig } from '@playwright/test';
import base from './playwright.timeline.config.js';

export default defineConfig({
  ...base,
  testMatch: 'drag-list.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4187' },
  webServer: {
    cwd: '../..',
    command: 'node_modules/.bin/vite dev --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
  },
});
