// tests for differential privacy noise injection
// makes sure the noise is actually being added and epsilon controls noise level

// gotta mock some browser globals for the module
global.ZeroSyncConfig = {
    privacy: { epsilon: 1.0, delta: 1e-5, clipNorm: 1.0, mechanism: 'gaussian' }
};

const privacy = require('../client/privacy');

describe('ZeroSyncPrivacy', () => {
    describe('clipVector', () => {
        test('does not alter vectors within norm', () => {
            const vec = [0.3, 0.4]; // norm = 0.5
            const clipped = privacy.clipVector(vec, 1.0);
            expect(clipped).toEqual(vec);
        });

        test('clips vectors exceeding max norm', () => {
            const vec = [3, 4]; // norm = 5
            const clipped = privacy.clipVector(vec, 1.0);
            const norm = Math.sqrt(clipped.reduce((s, v) => s + v * v, 0));
            expect(norm).toBeCloseTo(1.0, 4);
        });

        test('preserves direction after clipping', () => {
            const vec = [6, 8]; // norm = 10
            const clipped = privacy.clipVector(vec, 2.0);
            // ratio should be preserved: 6/8 = 0.75
            expect(clipped[0] / clipped[1]).toBeCloseTo(6 / 8, 4);
        });

        test('handles zero vector', () => {
            const vec = [0, 0, 0, 0];
            const clipped = privacy.clipVector(vec, 1.0);
            expect(clipped).toEqual([0, 0, 0, 0]);
        });
    });

    describe('computeNoiseScale', () => {
        test('returns 0 when epsilon is 0 (dp off)', () => {
            expect(privacy.computeNoiseScale(0, 1e-5, 1.0, 'gaussian')).toBe(0);
        });

        test('higher epsilon = less noise (gaussian)', () => {
            const scale1 = privacy.computeNoiseScale(0.5, 1e-5, 1.0, 'gaussian');
            const scale2 = privacy.computeNoiseScale(5.0, 1e-5, 1.0, 'gaussian');
            expect(scale1).toBeGreaterThan(scale2);
        });

        test('higher epsilon = less noise (laplace)', () => {
            const scale1 = privacy.computeNoiseScale(0.5, 1e-5, 1.0, 'laplace');
            const scale2 = privacy.computeNoiseScale(5.0, 1e-5, 1.0, 'laplace');
            expect(scale1).toBeGreaterThan(scale2);
        });

        test('larger clip norm = more noise needed', () => {
            const s1 = privacy.computeNoiseScale(1, 1e-5, 0.5, 'gaussian');
            const s2 = privacy.computeNoiseScale(1, 1e-5, 2.0, 'gaussian');
            expect(s2).toBeGreaterThan(s1);
        });
    });

    describe('addNoise', () => {
        test('returns original when epsilon = 0', () => {
            const vec = [1, 2, 3, 4];
            const result = privacy.addNoise(vec, { epsilon: 0 });
            expect(result.noisyVector).toEqual(vec);
            expect(result.metadata.dpEnabled).toBe(false);
        });

        test('modifies vector when epsilon > 0', () => {
            const vec = [1, 2, 3, 4];
            const result = privacy.addNoise(vec, { epsilon: 1.0 });
            expect(result.metadata.dpEnabled).toBe(true);
            // extremely unlikely all noise = 0
            let same = true;
            for (let i = 0; i < vec.length; i++) {
                if (Math.abs(result.noisyVector[i] - vec[i]) > 1e-10) same = false;
            }
            expect(same).toBe(false);
        });

        test('preserves vector length', () => {
            const vec = [0.5, -0.3, 0.8, -0.1];
            const result = privacy.addNoise(vec, { epsilon: 2.0 });
            expect(result.noisyVector.length).toBe(vec.length);
        });

        test('metadata contains noise params', () => {
            const result = privacy.addNoise([1, 2], { epsilon: 1.0, mechanism: 'laplace' });
            expect(result.metadata.epsilon).toBe(1.0);
            expect(result.metadata.mechanism).toBe('laplace');
            expect(result.metadata.noiseScale).toBeGreaterThan(0);
        });
    });

    describe('createBudgetTracker', () => {
        test('tracks spending correctly', () => {
            const budget = privacy.createBudgetTracker(5.0);
            expect(budget.remaining()).toBe(5.0);
            budget.spend(1.0);
            expect(budget.remaining()).toBe(4.0);
            expect(budget.spent()).toBe(1.0);
        });

        test('reports exhaustion', () => {
            const budget = privacy.createBudgetTracker(2.0);
            budget.spend(1.0);
            expect(budget.exhausted()).toBe(false);
            budget.spend(1.0);
            expect(budget.exhausted()).toBe(true);
        });

        test('returns false when over budget', () => {
            const budget = privacy.createBudgetTracker(1.0);
            expect(budget.spend(0.5)).toBe(true);
            expect(budget.spend(0.6)).toBe(false);
        });
    });
});
