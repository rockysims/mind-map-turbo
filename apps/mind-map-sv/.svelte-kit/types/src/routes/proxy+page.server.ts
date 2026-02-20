// @ts-nocheck
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';	

export const load = async () => {
	const appName = env.APP_NAME || 'Fallback APP_NAME from server';
	return {appName};
};
;null as any as PageServerLoad;