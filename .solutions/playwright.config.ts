import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Run from the project root:
//   npx playwright test --config .solutions/playwright.config.ts
const PORT = 4173;
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npx tsx server.ts',
    cwd: projectRoot,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
