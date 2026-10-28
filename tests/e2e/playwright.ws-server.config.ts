import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const serverPort = process.env.SABLE_WS_E2E_SERVER_PORT ?? '18009';
const serverOrigin = `http://127.0.0.1:${serverPort}`;
const dataDir = process.env.SABLE_WS_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'sable-ws-e2e-'));
const serverBinary = `${process.cwd()}/target/debug/sable-server`;

export default defineConfig({
  testDir: '.',
  testMatch: /ws-server\.spec\.ts$/,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  reporter: process.env.CI ? [['list']] : 'list',
  use: {
    baseURL: serverOrigin,
    trace: 'retain-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
      teardown: 'teardown',
      retries: 0,
      timeout: 300_000,
    },
    { name: 'teardown', testMatch: /global\.teardown\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: devices['Desktop Chrome'],
    },
  ],
  webServer: {
    cwd: process.cwd(),
    command: `SABLE_SERVER_PASSWORD_HASH="$(printf 'password\\n' | ${serverBinary} hash-password)" SABLE_SERVER_LISTEN_ADDR=127.0.0.1:${serverPort} SABLE_SERVER_PUBLIC_URL=http://127.0.0.1:${serverPort} SABLE_SERVER_USERNAME=server SABLE_SERVER_FRONTEND_DIR=${process.cwd()}/dist SABLE_SERVER_DATA_DIR=${dataDir} SABLE_SERVER_ALLOWED_PRIVATE_CIDRS='["127.0.0.1/32"]' ${serverBinary}`,
    url: `${serverOrigin}/healthz`,
    timeout: 120_000,
  },
});
