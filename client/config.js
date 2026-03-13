// client-side config (browser version)
// keeps things in sync w/ the server-side config.js
// edit this if you need different params in the browser

const ZeroSyncConfig = (() => {
    'use strict';

    return {
        model: {
            inputDim: 4,
            hiddenUnits: 8,
            outputDim: 2,
            activation: 'relu',
            lr: 0.01,
            epochs: 1,
            batchSize: 8,
            numSamples: 32
        },
        fl: {
            baseSeed: 12345,
            scale: 1000,
            vectorLen: 4,
            numClients: 4
        },
        // differential privacy - set epsilon > 0 to enable
        privacy: {
            epsilon: 0,       // 0 = off, 1 = decent, 0.1 = strong
            delta: 1e-5,      // failure probability
            clipNorm: 1.0,    // max L2 norm before clipping
            mechanism: 'gaussian'  // 'gaussian' or 'laplace'
        },
        server: {
            signalingUrl: 'ws://127.0.0.1:4200'
        },
        dataset: 'synthetic'
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZeroSyncConfig;
}
