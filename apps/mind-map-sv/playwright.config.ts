import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	webServer: { command: 'npm run build && npm run preview', port: 4173 }
});
