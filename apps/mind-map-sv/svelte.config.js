import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
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
