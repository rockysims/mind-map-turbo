import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		version: {
			// The default version name is Date.now(), which leaks into the client
			// bundle (and the __sveltekit_* global derived from it), making every
			// build of static/offline-app-shell.html byte-different. Pin it so
			// identical sources produce identical shells; the update-detection
			// feature this feeds is unused in this offline single-file app.
			name: 'offline'
		},
		adapter: adapter({
			fallback: 'index.html',
			strict: false
		}),
		paths: {
			relative: true
		},
		router: {
			type: 'hash'
		},
		output: {
			bundleStrategy: 'inline'
		}
	}
};

export default config;
