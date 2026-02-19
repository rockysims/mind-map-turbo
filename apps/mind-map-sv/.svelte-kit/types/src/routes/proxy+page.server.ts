// @ts-nocheck
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';	

export const load = async ({ params }: Parameters<PageServerLoad>[0]) => {
	const appName = env.APP_NAME || 'Fallback APP_NAME from server';
	return {appName};
};
