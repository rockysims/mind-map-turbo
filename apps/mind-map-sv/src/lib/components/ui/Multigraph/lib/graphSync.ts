/** Effect dependency token: only external graph loads should bump generation. */
export function externalGraphSyncToken(generation: number): number {
	return generation;
}
