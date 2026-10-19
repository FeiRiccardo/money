import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    // iPhone Safari engine: its date input and tap-to-zoom rules differ from Chrome's.
    { name: 'webkit-iphone', use: { ...devices['iPhone 14'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    // Shows the Google Drive rows; Google and Drive themselves are faked in e2e/drive.spec.ts.
    env: { VITE_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' },
    timeout: 120_000,
  },
});
