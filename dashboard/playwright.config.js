// playwright.config.js
//
// End-to-End-Tests fahren das Dashboard-Frontend gegen dev-server.js
// (gemockte /api/*-Endpunkte, kein Authentik/LDAP/Proxmox nötig).
//
//   npm run e2e            # headless
//   npm run e2e -- --ui    # interaktiv

const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_PORT || 5173;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node dev-server.js',
    port: Number(PORT),
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), ROLE: 'admin' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
