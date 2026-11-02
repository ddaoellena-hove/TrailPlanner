import { defineConfig } from '@playwright/test';

// Ports dédiés : l'e2e peut tourner à côté d'un `npm run dev`.
const WEB_PORT = '5183';
const API_PORT = '5184';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}` },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${API_PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      TRIPS_DIR: './.e2e-trips',
      SETTINGS_FILE: './.e2e-trips/settings.json',
      WEB_PORT,
      API_PORT,
    },
  },
});
