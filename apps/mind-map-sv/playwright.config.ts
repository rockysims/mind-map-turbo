import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	// Pinned so the tests' hardcoded stage coordinates (e.g. the 640x360 centre)
	// do not depend on Playwright's default viewport.
	use: { viewport: { width: 1280, height: 720 } },
	webServer: { command: 'npm run build && npm run preview', port: 4173 }
});
