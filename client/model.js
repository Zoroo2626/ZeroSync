// model.js - the tiny MLP that runs in each browser tab
// ngl this is a smol model but it gets the job done for demo purposes
// architecture: input(4) -> dense(8, relu) -> dense(2, softmax)

/* global tf, seedrandom, ZeroSyncConfig */

const ZeroSyncModel = (() => {
    'use strict';

    // pull params from config instead of hardcoding them everywhere
    const cfg = (typeof ZeroSyncConfig !== 'undefined') ? ZeroSyncConfig.model : {
        inputDim: 4, hiddenUnits: 8, outputDim: 2, lr: 0.01,
        epochs: 1, batchSize: 8, numSamples: 32
    };

    // ---- Iris dataset (the classic one lol) ----
    // 150 samples, 4 features, 3 classes but we squish to 2 for the binary setup
    // setosa vs non-setosa because keeping 3 classes would change the output dim
    const IRIS_DATA = [
        // sepal_len, sepal_wid, petal_len, petal_wid -> [class0, class1]
        // setosa samples (class 0)
        [5.1, 3.5, 1.4, 0.2], [4.9, 3.0, 1.4, 0.2], [4.7, 3.2, 1.3, 0.2], [4.6, 3.1, 1.5, 0.2],
        [5.0, 3.6, 1.4, 0.2], [5.4, 3.9, 1.7, 0.4], [4.6, 3.4, 1.4, 0.3], [5.0, 3.4, 1.5, 0.2],
        [4.4, 2.9, 1.4, 0.2], [4.9, 3.1, 1.5, 0.1], [5.4, 3.7, 1.5, 0.2], [4.8, 3.4, 1.6, 0.2],
        [4.8, 3.0, 1.4, 0.1], [4.3, 3.0, 1.1, 0.1], [5.8, 4.0, 1.2, 0.2], [5.7, 4.4, 1.5, 0.4],
        [5.4, 3.9, 1.3, 0.4], [5.1, 3.5, 1.4, 0.3], [5.7, 3.8, 1.7, 0.3], [5.1, 3.8, 1.5, 0.3],
        [5.4, 3.4, 1.7, 0.2], [5.1, 3.7, 1.5, 0.4], [4.6, 3.6, 1.0, 0.2], [5.1, 3.3, 1.7, 0.5],
        [4.8, 3.4, 1.9, 0.2], [5.0, 3.0, 1.6, 0.2], [5.0, 3.4, 1.6, 0.4], [5.2, 3.5, 1.5, 0.2],
        [5.2, 3.4, 1.4, 0.2], [4.7, 3.2, 1.6, 0.2], [4.8, 3.1, 1.6, 0.2], [5.4, 3.4, 1.5, 0.4],
        [5.2, 4.1, 1.5, 0.1], [5.5, 4.2, 1.4, 0.2], [4.9, 3.1, 1.5, 0.2], [5.0, 3.2, 1.2, 0.2],
        [5.5, 3.5, 1.3, 0.2], [4.9, 3.6, 1.4, 0.1], [4.4, 3.0, 1.3, 0.2], [5.1, 3.4, 1.5, 0.2],
        // versicolor (class 1)
        [7.0, 3.2, 4.7, 1.4], [6.4, 3.2, 4.5, 1.5], [6.9, 3.1, 4.9, 1.5], [5.5, 2.3, 4.0, 1.3],
        [6.5, 2.8, 4.6, 1.5], [5.7, 2.8, 4.5, 1.3], [6.3, 3.3, 4.7, 1.6], [4.9, 2.4, 3.3, 1.0],
        [6.6, 2.9, 4.6, 1.3], [5.2, 2.7, 3.9, 1.4], [5.0, 2.0, 3.5, 1.0], [5.9, 3.0, 4.2, 1.5],
        [6.0, 2.2, 4.0, 1.0], [6.1, 2.9, 4.7, 1.4], [5.6, 2.9, 3.6, 1.3], [6.7, 3.1, 4.4, 1.4],
        [5.6, 3.0, 4.5, 1.5], [5.8, 2.7, 4.1, 1.0], [6.2, 2.2, 4.5, 1.5], [5.6, 2.5, 3.9, 1.1],
        // virginica (also class 1 - lumped together)
        [6.3, 3.3, 6.0, 2.5], [5.8, 2.7, 5.1, 1.9], [7.1, 3.0, 5.9, 2.1], [6.3, 2.9, 5.6, 1.8],
        [6.5, 3.0, 5.8, 2.2], [7.6, 3.0, 6.6, 2.1], [4.9, 2.5, 4.5, 1.7], [7.3, 2.9, 6.3, 1.8],
        [6.7, 2.5, 5.8, 1.8], [7.2, 3.6, 6.1, 2.5], [6.5, 3.2, 5.1, 2.0], [6.4, 2.7, 5.3, 1.9],
        [6.8, 3.0, 5.5, 2.1], [5.7, 2.5, 5.0, 2.0], [5.8, 2.8, 5.1, 2.4], [6.4, 3.2, 5.3, 2.3],
        [6.5, 3.0, 5.5, 1.8], [7.7, 3.8, 6.7, 2.2], [7.7, 2.6, 6.9, 2.3], [6.0, 2.2, 5.0, 1.5]
    ];
    // labels: first 40 are setosa (class 0), rest are non-setosa (class 1)
    const IRIS_LABELS = [
        ...Array(40).fill([1, 0]),
        ...Array(40).fill([0, 1])
    ];

    /**
     * builds the model - nothing fancy just a standard MLP
     */
    function createModel() {
        const model = tf.sequential();
        model.add(tf.layers.dense({
            inputShape: [cfg.inputDim],
            units: cfg.hiddenUnits,
            activation: cfg.activation || 'relu',
            kernelInitializer: 'glorotUniform',
            name: 'hidden'
        }));
        model.add(tf.layers.dense({
            units: cfg.outputDim,
            activation: 'softmax',
            kernelInitializer: 'glorotUniform',
            name: 'output'
        }));
        model.compile({
            optimizer: tf.train.adam(cfg.lr),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
        return model;
    }

    /**
     * generates fake data using the seeded rng
     * each sample: 4 random floats, label = sum < 2 ? class0 : class1
     * simple but deterministic which is the whole point
     */
    function generateSyntheticData(rng) {
        const xData = [];
        const yData = [];
        for (let i = 0; i < cfg.numSamples; i++) {
            const row = [];
            for (let j = 0; j < cfg.inputDim; j++) row.push(rng());
            xData.push(row);
            const sum = row.reduce((a, b) => a + b, 0);
            yData.push(sum < 2 ? [1, 0] : [0, 1]);
        }
        return {
            xs: tf.tensor2d(xData, [cfg.numSamples, cfg.inputDim]),
            ys: tf.tensor2d(yData, [cfg.numSamples, cfg.outputDim])
        };
    }

    /**
     * grabs a batch from the iris dataset
     * uses rng to shuffle so its still deterministic
     */
    function generateIrisData(rng) {
        // shuffle indices deterministically
        const indices = Array.from({ length: IRIS_DATA.length }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        // grab a batch
        const batchSize = Math.min(cfg.numSamples, IRIS_DATA.length);
        const xData = [];
        const yData = [];
        for (let i = 0; i < batchSize; i++) {
            const idx = indices[i % indices.length];
            // normalize features to [0, 1] range roughly
            const row = IRIS_DATA[idx].map(v => v / 8.0);
            xData.push(row);
            yData.push(IRIS_LABELS[idx]);
        }

        return {
            xs: tf.tensor2d(xData, [batchSize, cfg.inputDim]),
            ys: tf.tensor2d(yData, [batchSize, cfg.outputDim])
        };
    }

    /**
     * one training step on either synthetic or iris data
     * returns loss and accuracy so you can see if its actually learning
     */
    async function trainStep(model, rng, dataset) {
        const ds = dataset || (typeof ZeroSyncConfig !== 'undefined' ? ZeroSyncConfig.dataset : 'synthetic');
        const { xs, ys } = ds === 'iris' ? generateIrisData(rng) : generateSyntheticData(rng);

        const result = await model.fit(xs, ys, {
            epochs: cfg.epochs,
            batchSize: cfg.batchSize,
            shuffle: false, // deterministic order fr
            verbose: 0
        });

        // clean up tensors so we dont leak memory
        xs.dispose();
        ys.dispose();

        return {
            loss: result.history.loss[0],
            accuracy: result.history.acc ? result.history.acc[0] : (result.history.accuracy ? result.history.accuracy[0] : 0)
        };
    }

    /**
     * dumps all weights as plain arrays
     * useful for checkpoints and sending to other clients
     */
    function getWeights(model) {
        const rawWeights = model.getWeights();
        const result = rawWeights.map((t, i) => {
            const data = Array.from(t.dataSync());
            const shape = t.shape.slice();
            const name = model.weights[i].name;
            return { name, shape, data };
        });
        rawWeights.forEach(t => t.dispose());
        return result;
    }

    /**
     * loads weights back in (for aggregation or replay)
     * disposes temp tensors cuz memory leaks are no joke
     */
    function setWeights(model, weightData) {
        const tensors = weightData.map(w => tf.tensor(w.data, w.shape));
        model.setWeights(tensors);
        tensors.forEach(t => t.dispose());
    }

    /**
     * extracts first N values from the hidden layer kernel
     * this is the "summary" that gets sent to the aggregator + zk circuit
     * basically a fingerprint of the model state
     */
    function getSummaryVector(model) {
        const vectorLen = (typeof ZeroSyncConfig !== 'undefined') ? ZeroSyncConfig.fl.vectorLen : 4;
        const allWeights = model.getWeights();
        const data = allWeights[0].dataSync();
        const vec = Array.from(data.slice(0, vectorLen));
        allWeights.forEach(t => t.dispose());
        return vec;
    }

    return {
        createModel,
        generateSyntheticData,
        generateIrisData,
        trainStep,
        getWeights,
        setWeights,
        getSummaryVector,
        // expose config vals for backwards compat
        INPUT_DIM: cfg.inputDim,
        OUTPUT_DIM: cfg.outputDim,
        HIDDEN_UNITS: cfg.hiddenUnits,
        LEARNING_RATE: cfg.lr,
        BATCH_SIZE: cfg.batchSize,
        EPOCHS: cfg.epochs,
        NUM_SAMPLES: cfg.numSamples
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZeroSyncModel;
}
