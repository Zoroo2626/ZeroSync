// tests for the seedrandom PRNG
// making sure deterministic randomness actually works

const seedrandom = require('../client/utils/seedrandom');

describe('seedrandom', () => {
    test('returns a function', () => {
        const rng = seedrandom(42);
        expect(typeof rng).toBe('function');
    });

    test('produces numbers in [0, 1)', () => {
        const rng = seedrandom(12345);
        for (let i = 0; i < 100; i++) {
            const val = rng();
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThan(1);
        }
    });

    test('same seed = same sequence every time', () => {
        const rng1 = seedrandom(12345);
        const rng2 = seedrandom(12345);
        for (let i = 0; i < 50; i++) {
            expect(rng1()).toBe(rng2());
        }
    });

    test('different seeds = different sequences', () => {
        const rng1 = seedrandom(111);
        const rng2 = seedrandom(222);
        let same = 0;
        for (let i = 0; i < 20; i++) {
            if (rng1() === rng2()) same++;
        }
        // extremely unlikely to get even 1 match
        expect(same).toBeLessThan(3);
    });

    test('defaults to seed 12345 for bad input', () => {
        const rng1 = seedrandom(12345);
        const rng2 = seedrandom('not a number');
        expect(rng1()).toBe(rng2());
    });

    test('handles zero seed', () => {
        const rng = seedrandom(0);
        const val = rng();
        expect(typeof val).toBe('number');
        expect(val).toBeGreaterThanOrEqual(0);
    });

    test('handles negative seed', () => {
        const rng = seedrandom(-42);
        const val = rng();
        expect(typeof val).toBe('number');
        expect(val).toBeGreaterThanOrEqual(0);
    });
});
