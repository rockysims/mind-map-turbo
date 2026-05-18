import { env } from '$env/dynamic/private';
import type { PersistenceKind } from '$lib/persistence';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	persistenceKind: persistenceKindFromEnv(env.MIND_MAP_PERSISTENCE_KIND)
});

function persistenceKindFromEnv(value: string | undefined): PersistenceKind {
	return value === 'server' ? 'server' : 'local';
}
