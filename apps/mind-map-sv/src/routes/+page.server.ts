import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';	

export const load: PageServerLoad = async ({ params }) => {
	const appName = env.APP_NAME || 'No APP_NAME';
	return {appName};
};
