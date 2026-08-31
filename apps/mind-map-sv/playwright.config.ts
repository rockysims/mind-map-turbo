import { defineConfig } from '@playwright/test';
import { devPorts } from '../../scripts/dev-ports.mjs';

// Per-worktree instead of Vite's fixed 4173. `webServer.reuseExistingServer`
// defaults to on outside CI, so on a shared port a second worktree's e2e run
// would silently test the first worktree's build.
const previewPort = devPorts.preview;

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	// Pinned so the tests' hardcoded stage coordinates (e.g. the 640x360 centre)
	// do not depend on Playwright's default viewport.
	use: { viewport: { width: 1280, height: 720 } },
	webServer: {
		command: `npm run build && npm run preview -- --port ${previewPort} --strictPort`,
		port: previewPort
	}
});
