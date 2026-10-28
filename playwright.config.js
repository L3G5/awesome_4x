import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const localChromium = '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  timeout: 40_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(localChromium) ? localChromium : undefined),
      args: ['--enable-unsafe-swiftshader'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: 'npm run dev -- --host 127.0.0.1 --port 5174', url: baseURL, reuseExistingServer: false },
});
