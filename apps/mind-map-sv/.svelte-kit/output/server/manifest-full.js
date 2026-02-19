export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["robots.txt"]),
	mimeTypes: {".txt":"text/plain"},
	_: {
		client: {start:"_app/immutable/entry/start.6PN_ukAX.js",app:"_app/immutable/entry/app.FShdx-TF.js",imports:["_app/immutable/entry/start.6PN_ukAX.js","_app/immutable/chunks/BqXNQgtr.js","_app/immutable/chunks/5UYW8KD-.js","_app/immutable/chunks/CJ78CxSW.js","_app/immutable/entry/app.FShdx-TF.js","_app/immutable/chunks/5UYW8KD-.js","_app/immutable/chunks/CJhCm2HQ.js","_app/immutable/chunks/CqvVyvub.js","_app/immutable/chunks/CJ78CxSW.js","_app/immutable/chunks/B9Je8yFN.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
