import { describe, expect, it } from 'vitest';
import { externalGraphSyncToken } from './graphSync';

describe('externalGraphSyncToken', () => {
	it('returns the generation unchanged', () => {
		expect(externalGraphSyncToken(3)).toBe(3);
	});
});
