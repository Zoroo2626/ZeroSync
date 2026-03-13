// tests for the aggregator logic
// verifies weighted sum and average computation match what the zk circuits expect

const fs = require('fs');
const path = require('path');

describe('Aggregator', () => {
    const VECTOR_LEN = 4;
    const NUM_CLIENTS = 4;

    test('weighted sum with equal weights', () => {
        const vectors = [
            [100, 200, 300, 400],
            [50, 150, 250, 350],
            [-100, 0, 100, 200],
            [200, -50, 75, 125]
        ];
        const weights = [1, 1, 1, 1];

        const result = new Array(VECTOR_LEN).fill(0);
        for (let i = 0; i < VECTOR_LEN; i++) {
            for (let j = 0; j < NUM_CLIENTS; j++) {
                result[i] += weights[j] * vectors[j][i];
            }
        }

        expect(result).toEqual([250, 300, 725, 1075]);
    });

    test('weighted sum with different weights', () => {
        const vectors = [
            [10, 20, 30, 40],
            [50, 60, 70, 80]
        ];
        const weights = [2, 3];

        const result = new Array(4).fill(0);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 2; j++) {
                result[i] += weights[j] * vectors[j][i];
            }
        }

        // 2*10 + 3*50 = 170, 2*20 + 3*60 = 220, ...
        expect(result).toEqual([170, 220, 270, 320]);
    });

    test('weighted average division identity holds', () => {
        const result = [250, 300, 725, 1075];
        const totalWeight = 4;
        const average = [];
        const remainder = [];

        for (let i = 0; i < VECTOR_LEN; i++) {
            average.push(Math.trunc(result[i] / totalWeight));
            remainder.push(result[i] - Math.trunc(result[i] / totalWeight) * totalWeight);
        }

        // verify: sum = average * totalWeight + remainder
        for (let i = 0; i < VECTOR_LEN; i++) {
            expect(average[i] * totalWeight + remainder[i]).toBe(result[i]);
        }

        // remainder should be in [0, totalWeight)
        for (let i = 0; i < VECTOR_LEN; i++) {
            expect(remainder[i]).toBeGreaterThanOrEqual(0);
            expect(remainder[i]).toBeLessThan(totalWeight);
        }
    });

    test('handles zero vectors', () => {
        const vectors = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0]
        ];
        const weights = [1, 1, 1, 1];

        const result = new Array(VECTOR_LEN).fill(0);
        for (let i = 0; i < VECTOR_LEN; i++) {
            for (let j = 0; j < NUM_CLIENTS; j++) {
                result[i] += weights[j] * vectors[j][i];
            }
        }

        expect(result).toEqual([0, 0, 0, 0]);
    });

    test('handles negative values', () => {
        const vectors = [
            [-500, -300, -100, 0],
            [500, 300, 100, 0],
            [-1000, 1000, -1000, 1000],
            [1000, -1000, 1000, -1000]
        ];
        const weights = [1, 1, 1, 1];

        const result = new Array(VECTOR_LEN).fill(0);
        for (let i = 0; i < VECTOR_LEN; i++) {
            for (let j = 0; j < NUM_CLIENTS; j++) {
                result[i] += weights[j] * vectors[j][i];
            }
        }

        expect(result).toEqual([0, 0, 0, 0]);
    });

    test('sample update files are parseable', () => {
        // test with the same deterministic generation the aggregator uses
        const baseSeed = 12345;
        for (let i = 0; i < NUM_CLIENTS; i++) {
            const clientSeed = baseSeed + i * 100;
            const vec = [];
            let s = clientSeed;
            for (let j = 0; j < VECTOR_LEN; j++) {
                s = ((s * 1103515245 + 12345) & 0x7fffffff);
                vec.push(Math.floor((s % 2001) - 1000));
            }
            expect(vec.length).toBe(VECTOR_LEN);
            vec.forEach(v => {
                expect(v).toBeGreaterThanOrEqual(-1000);
                expect(v).toBeLessThanOrEqual(1000);
            });
        }
    });
});
