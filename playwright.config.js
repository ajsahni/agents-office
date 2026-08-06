import { defineConfig } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'tests', '.fixture');

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  workers: 1, // one shared fixture daemon — the flow tests mutate its state
  globalSetup: './tests/global-setup.js',
  use: {
    baseURL: 'http://localhost:4478',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
    viewport: { width: 1890, height: 1060 },
  },
  webServer: {
    command: 'node bin/office start',
    port: 4478,
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      OFFICE_NO_SCHED: '1',
      OFFICE_NO_SESSIONS: '1',
      OFFICE_PORT: '4478', // the webServer can start before globalSetup writes the fixture config
      OFFICE_ROOT: fixtureRoot,
    },
  },
});
