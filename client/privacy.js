// privacy.js - differential privacy noise injection
// adds calibrated noise to model updates before sending them out
// even if someone intercepts your weight updates, they cant reverse-engineer
// your training data. thats the whole point of DP tbh
//
// supports gaussian (better composition) and laplace (simpler bounds)
// epsilon controls how much noise: lower = more private but less accurate

/* global ZeroSyncConfig */

const ZeroSyncPrivacy = (() => {
    'use strict';

    // pull config or defaults
    const cfg = (typeof ZeroSyncConfig !== 'undefined' && ZeroSyncConfig.privacy) ? ZeroSyncConfig.privacy : {
        epsilon: 0, delta: 1e-5, clipNorm: 1.0, mechanism: 'gaussian'
    };

    // box-muller transform for gaussian samples
    // yes i could use a library but this is like 5 lines
    function gaussianNoise(mean, stddev) {
        let u1 = Math.random();
        let u2 = Math.random();
        // avoid log(0) edge case
        while (u1 === 0) u1 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + stddev * z;
    }

    // laplace noise from uniform samples
    function laplaceNoise(mean, scale) {
        let u = Math.random() - 0.5;
        // guard against log(0) if random hits exactly 0 or 1
        while (u === 0 || u === -0.5 || u === 0.5) u = Math.random() - 0.5;
        return mean - scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    }

    // clip vector to max L2 norm
    // this bounds the sensitivity so we know how much noise to add
    function clipVector(vec, maxNorm) {
        const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
        if (norm <= maxNorm) return vec.slice();
        const scale = maxNorm / norm;
        return vec.map(v => v * scale);
    }

    // compute noise scale based on epsilon and mechanism
    // higher epsilon = less noise = less privacy
    function computeNoiseScale(epsilon, delta, clipNorm, mechanism) {
        if (epsilon <= 0) return 0; // dp disabled

        if (mechanism === 'gaussian') {
            // gaussian mechanism: sigma = clipNorm * sqrt(2 * ln(1.25/delta)) / epsilon
            const sigma = clipNorm * Math.sqrt(2 * Math.log(1.25 / delta)) / epsilon;
            return sigma;
        } else {
            // laplace mechanism: scale = clipNorm / epsilon
            return clipNorm / epsilon;
        }
    }

    /**
     * add dp noise to a vector of model update values
     * returns { noisyVector, metadata } where metadata has the noise params used
     *
     * epsilon = 0 means dp is off, returns original vector
     * epsilon = 1 is decent privacy
     * epsilon = 0.1 is strong privacy (very noisy)
     * epsilon = 10 is weak privacy (barely any noise)
     */
    function addNoise(vector, options) {
        const eps = (options && options.epsilon !== undefined) ? options.epsilon : cfg.epsilon;
        const delta = (options && options.delta !== undefined) ? options.delta : cfg.delta;
        const clip = (options && options.clipNorm !== undefined) ? options.clipNorm : cfg.clipNorm;
        const mech = (options && options.mechanism) ? options.mechanism : cfg.mechanism;

        // dp disabled
        if (eps <= 0) {
            return {
                noisyVector: vector.slice(),
                metadata: { dpEnabled: false, epsilon: 0 }
            };
        }

        // step 1: clip the vector
        const clipped = clipVector(vector, clip);

        // step 2: compute noise scale
        const noiseScale = computeNoiseScale(eps, delta, clip, mech);

        // step 3: add noise to each element
        const noisyVector = clipped.map(v => {
            if (mech === 'gaussian') {
                return v + gaussianNoise(0, noiseScale);
            } else {
                return v + laplaceNoise(0, noiseScale);
            }
        });

        return {
            noisyVector,
            metadata: {
                dpEnabled: true,
                epsilon: eps,
                delta: delta,
                clipNorm: clip,
                mechanism: mech,
                noiseScale: noiseScale,
                originalNorm: Math.sqrt(vector.reduce((s, v) => s + v * v, 0)),
                clippedNorm: Math.sqrt(clipped.reduce((s, v) => s + v * v, 0))
            }
        };
    }

    /**
     * handy privacy budget tracker
     * each query costs epsilon, so you can track total spend
     */
    function createBudgetTracker(totalBudget) {
        let spent = 0;
        return {
            spend(eps) {
                spent += eps;
                return spent <= totalBudget;
            },
            remaining() { return Math.max(0, totalBudget - spent); },
            total() { return totalBudget; },
            spent() { return spent; },
            exhausted() { return spent >= totalBudget; }
        };
    }

    return { addNoise, clipVector, computeNoiseScale, createBudgetTracker };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZeroSyncPrivacy;
}
