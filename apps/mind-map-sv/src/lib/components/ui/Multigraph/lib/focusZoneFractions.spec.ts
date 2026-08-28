import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '$lib/appConfig';
import { boundaryProgressDelta } from './focusEntryBoundary';
import { DEFAULT_ZOOM_SENSITIVITY } from './graphMath';
import { entryProgress, exitProgress } from './zoomBoundary';
import { wheelExitBoundaryAmount, type ZoomWorldBounds } from './zoomWorldController';

// The boundary specs always pass explicit zone fractions, so nothing else
// exercises the values the app actually ships. These do: a typo in
// appConfig.ts (0.88 -> 8.8, 0.72 -> 0.072) fails here rather than only in e2e.
const { preInscribeZoneFraction, subFitExitZoneFraction } = APP_CONFIG.multigraph.focus;

// A fine trackpad notch and a firm mouse notch, as scale factors.
const FINE_NOTCH_DELTA_Y = 40;
const FIRM_NOTCH_DELTA_Y = 600;
const scaleFactorFor = (deltaY: number) => 1 - deltaY * DEFAULT_ZOOM_SENSITIVITY;

const exitBounds: ZoomWorldBounds = {
	width: 320,
	height: 240,
	subjectWidth: 320,
	subjectHeight: 240
};

describe('shipped focus zone fractions', () => {
	it('keeps both zone fractions inside the usable (0, 1] range', () => {
		expect(preInscribeZoneFraction).toBeGreaterThan(0);
		expect(preInscribeZoneFraction).toBeLessThanOrEqual(1);
		expect(subFitExitZoneFraction).toBeGreaterThan(0);
		expect(subFitExitZoneFraction).toBeLessThanOrEqual(1);
	});

	it('ramps entry progress across the shipped pre-inscribe zone', () => {
		const inscribeScale = 3;
		const zoneStart = inscribeScale * (1 - preInscribeZoneFraction);

		expect(entryProgress(zoneStart, inscribeScale)).toBe(0);
		expect(entryProgress(inscribeScale, inscribeScale)).toBe(1);
		expect(entryProgress((zoneStart + inscribeScale) / 2, inscribeScale)).toBeCloseTo(0.5);
	});

	it('needs a deliberate scrub at the boundary rather than a single fine notch', () => {
		const lockedScale = 3;
		const fineDelta = boundaryProgressDelta(
			lockedScale * scaleFactorFor(-FINE_NOTCH_DELTA_Y),
			lockedScale
		);

		expect(fineDelta).toBeGreaterThan(0);
		expect(fineDelta).toBeLessThan(0.5);

		let progress = 0;
		let notches = 0;
		while (progress < 1 && notches < 200) {
			progress += fineDelta;
			notches += 1;
		}

		expect(notches).toBeGreaterThan(1);
		expect(notches).toBeLessThanOrEqual(40);
	});

	it('lets one firm notch at the boundary commit the entry', () => {
		const lockedScale = 3;

		expect(
			boundaryProgressDelta(lockedScale * scaleFactorFor(-FIRM_NOTCH_DELTA_Y), lockedScale)
		).toBe(1);
	});

	it('ramps exit progress across the shipped sub-fit zone', () => {
		const fitScale = 1;
		const zoneEnd = fitScale * (1 - subFitExitZoneFraction);

		expect(exitProgress(fitScale, fitScale)).toBe(1);
		expect(exitProgress(zoneEnd, fitScale)).toBe(0);
		expect(exitProgress((zoneEnd + fitScale) / 2, fitScale)).toBeCloseTo(0.5);
	});

	it('takes a multi-notch wheel-out to complete the exit scrub', () => {
		// The first wheel-out past fit seeds the amount from exit progress; every
		// later notch feeds it back through wheelExitBoundaryAmount.
		const fitScale = 1;
		let amount = 1 - exitProgress(fitScale * scaleFactorFor(FINE_NOTCH_DELTA_Y), fitScale);
		let notches = 1;

		expect(amount).toBeLessThan(1);

		while (amount < 1 && notches < 200) {
			amount = wheelExitBoundaryAmount(amount, FINE_NOTCH_DELTA_Y, exitBounds);
			notches += 1;
		}

		expect(amount).toBeGreaterThanOrEqual(1);
		expect(notches).toBeGreaterThan(3);
		expect(notches).toBeLessThanOrEqual(40);
	});
});
