// config.js - central config for the whole project
// env vars > defaults, use .env file for local overrides
// node side only obv, browser gets client/config.js

'use strict';

// load .env if it exists - dont crash if it doesnt
try { require('dotenv').config(); } catch (e) { /* no biggie */ }

const config = {
    // -- model stuff --
    model: {
        inputDim: parseInt(process.env.INPUT_DIM, 10) || 4,
        hiddenUnits: parseInt(process.env.HIDDEN_UNITS, 10) || 8,
        outputDim: parseInt(process.env.OUTPUT_DIM, 10) || 2,
        activation: process.env.ACTIVATION || 'relu',
        lr: parseFloat(process.env.LEARNING_RATE) || 0.01,
        epochs: parseInt(process.env.EPOCHS, 10) || 1,
        batchSize: parseInt(process.env.BATCH_SIZE, 10) || 8,
        numSamples: parseInt(process.env.NUM_SAMPLES, 10) || 32
    },

    // -- federated learning --
    fl: {
        baseSeed: parseInt(process.env.RNG_BASE_SEED, 10) || 12345,
        scale: parseInt(process.env.FIXED_POINT_SCALE, 10) || 1000,
        vectorLen: parseInt(process.env.VECTOR_LEN, 10) || 4,
        numClients: parseInt(process.env.NUM_CLIENTS, 10) || 4
    },

    // -- differential privacy --
    // epsilon controls the noise level: lower = more private but noisier
    // set to 0 to disable dp entirely
    privacy: {
        epsilon: parseFloat(process.env.DP_EPSILON) || 0,
        delta: parseFloat(process.env.DP_DELTA) || 1e-5,
        clipNorm: parseFloat(process.env.DP_CLIP_NORM) || 1.0,
        mechanism: process.env.DP_MECHANISM || 'gaussian'  // 'gaussian' or 'laplace'
    },

    // -- networking --
    server: {
        signalingPort: parseInt(process.env.SIGNALING_PORT, 10) || 4200,
        signalingUrl: process.env.SIGNALING_URL || 'ws://127.0.0.1:4200',
        clientPort: parseInt(process.env.CLIENT_PORT, 10) || 8000
    },

    // -- blockchain --
    chain: {
        hardhatUrl: process.env.HARDHAT_URL || 'http://127.0.0.1:8545',
        solcVersion: '0.8.24'
    },

    // -- dataset --
    dataset: process.env.DATASET || 'synthetic'
};

module.exports = config;
