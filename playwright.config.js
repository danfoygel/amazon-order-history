const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  fullyParallel: true,
  workers: '75%',
  use: {
    headless: true,
    baseURL: 'http://localhost:8456',
  },
  webServer: {
    command: 'python3 server.py 8456',
    port: 8456,
    reuseExistingServer: !process.env.CI,
  },
});
