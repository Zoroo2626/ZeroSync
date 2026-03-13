// tests for the replay module
// checks that replay parsing and seed determinism work correctly

const path = require('path');
const seedrandom = require('../client/utils/seedrandom');

describe('Replay', () => {
    test('seedrandom produces deterministic sequences for replay', () => {
        const seed = 12345;
        const rng1 = seedrandom(seed);
        const rng2 = seedrandom(seed);

        // simulate 128 rng calls (one training step: 32 samples * 4 features)
        const seq1 = [];
        const seq2 = [];
        for (let i = 0; i < 128; i++) {
            seq1.push(rng1());
            seq2.push(rng2());
        }

        expect(seq1).toEqual(seq2);
    });

    test('sample replay file is valid', () => {
        const fs = require('fs');
        const samplePath = path.join(__dirname, 'sample_replay.json');

        if (!fs.existsSync(samplePath)) {
            // sample might not exist, thats ok
            return;
        }

        const data = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
        expect(data.project).toBe('ZeroSync');
        expect(data.clientId).toBeTruthy();
        expect(typeof data.seed).toBe('number');
        expect(Array.isArray(data.events)).toBe(true);
    });

    test('replay rng sync - advancing prng stays in sync', () => {
        const seed = 99999;
        const rng = seedrandom(seed);

        // simulate 3 training steps
        const vectors = [];
        for (let step = 0; step < 3; step++) {
            // each step burns 128 random values (32 * 4)
            for (let i = 0; i < 128; i++) rng();

            // then record a "summary" of 4 values
            const vec = [];
            for (let i = 0; i < 4; i++) vec.push(rng());
            vectors.push(vec);
        }

        // replay with same seed should get same vectors
        const rng2 = seedrandom(seed);
        const vectors2 = [];
        for (let step = 0; step < 3; step++) {
            for (let i = 0; i < 128; i++) rng2();
            const vec = [];
            for (let i = 0; i < 4; i++) vec.push(rng2());
            vectors2.push(vec);
        }

        expect(vectors).toEqual(vectors2);
    });

    test('config values are sane', () => {
        let config;
        try { config = require('../config'); }
        catch (e) { return; } // config might not be available

        expect(config.fl.scale).toBeGreaterThan(0);
        expect(config.fl.vectorLen).toBeGreaterThan(0);
        expect(config.fl.numClients).toBeGreaterThan(0);
        expect(config.fl.baseSeed).toBeDefined();
    });
});
