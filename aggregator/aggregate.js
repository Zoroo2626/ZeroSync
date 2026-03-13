// aggregate.js - reads client updates and computes the weighted sum + average
// generates input files for both zk circuits and stores everything in CAS
// this is where the math happens fr

'use strict';

const fs = require('fs');
const path = require('path');

// try to load config, fallback to defaults if running standalone
let config;
try { config = require('../config'); }
catch (e) { config = { fl: { vectorLen: 4, numClients: 4, scale: 1000 } }; }

const UPDATES_DIR = path.join(__dirname, '..', 'server', 'updates');
const ZK_INPUT_PATH = path.join(__dirname, '..', 'zk', 'input.json');
const ZK_AVG_INPUT_PATH = path.join(__dirname, '..', 'zk', 'input_average.json');
const VECTOR_LEN = config.fl.vectorLen;
const NUM_CLIENTS = config.fl.numClients;

function main() {
    console.log('[aggregator] reading updates from:', UPDATES_DIR);

    // grab all update files
    let files;
    try {
        if (!fs.existsSync(UPDATES_DIR)) {
            console.error(`[aggregator] updates dir not found: ${UPDATES_DIR}`);
            console.error('  run the signaling server and send some updates first');
            process.exit(1);
        }
        files = fs.readdirSync(UPDATES_DIR).filter(f => f.endsWith('.json')).sort();
    } catch (err) {
        console.error(`[aggregator] cant read updates: ${err.message}`);
        process.exit(1);
    }

    if (files.length === 0) {
        console.log('[aggregator] no updates found, generating sample data...');
        generateSampleUpdates();
        files = fs.readdirSync(UPDATES_DIR).filter(f => f.endsWith('.json')).sort();
    }

    console.log(`[aggregator] found ${files.length} update(s)`);

    // parse out the summary vectors
    const vectors = [];
    const clientUpdates = []; // track for dashboard
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(UPDATES_DIR, file), 'utf-8'));
            if (data.summaryVector && Array.isArray(data.summaryVector)) {
                const vec = data.summaryVector.slice(0, VECTOR_LEN);
                while (vec.length < VECTOR_LEN) vec.push(0);
                vectors.push(vec.map(v => Math.round(v)));
                clientUpdates.push({
                    clientId: data.clientId || 'unknown',
                    vector: vec.map(v => Math.round(v)),
                    steps: data.trainSteps || 0,
                    dpEnabled: data.dpEnabled || false,
                    epsilon: data.epsilon || 0,
                    timestamp: data.timestamp || 0
                });
                console.log(`  ${file}: [${vec.join(', ')}] (${data.clientId || '?'})`);
            }
        } catch (err) {
            console.error(`  skipping ${file}: ${err.message}`);
        }
    }

    // pad if we have fewer than expected
    while (vectors.length < NUM_CLIENTS) {
        console.log(`  padding (${vectors.length}/${NUM_CLIENTS})`);
        vectors.push(new Array(VECTOR_LEN).fill(0));
    }

    const selected = vectors.slice(0, NUM_CLIENTS);

    // equal weights for now (all clients matter equally)
    const weights = new Array(NUM_CLIENTS).fill(1);

    // compute weighted sum: result[i] = sum of (weight[j] * vector[j][i])
    const result = new Array(VECTOR_LEN).fill(0);
    for (let i = 0; i < VECTOR_LEN; i++) {
        for (let j = 0; j < NUM_CLIENTS; j++) {
            result[i] += weights[j] * selected[j][i];
        }
    }

    console.log(`\n[aggregator] weighted sum: [${result.join(', ')}]`);
    console.log(`[aggregator] weights: [${weights.join(', ')}]`);

    // write input for the weighted_sum circuit
    const circuitInput = { vectors: selected, weights, expected_result: result };
    try {
        const zkDir = path.dirname(ZK_INPUT_PATH);
        if (!fs.existsSync(zkDir)) fs.mkdirSync(zkDir, { recursive: true });
        fs.writeFileSync(ZK_INPUT_PATH, JSON.stringify(circuitInput, null, 2));
        console.log(`\n[aggregator] sum circuit input -> ${ZK_INPUT_PATH}`);
    } catch (err) {
        console.error(`[aggregator] write error: ${err.message}`);
        process.exit(1);
    }

    // ---- weighted average with division proof ----
    // for the production circuit we prove: sum = avg * totalWeight + remainder
    // this avoids division in the circuit which circom cant do natively
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const average = new Array(VECTOR_LEN).fill(0);
    const remainder = new Array(VECTOR_LEN).fill(0);

    for (let i = 0; i < VECTOR_LEN; i++) {
        average[i] = Math.trunc(result[i] / totalWeight);
        remainder[i] = result[i] - average[i] * totalWeight;
        // make sure remainder is non-negative for the circuit
        if (remainder[i] < 0) {
            average[i] -= 1;
            remainder[i] += totalWeight;
        }
    }

    console.log(`[aggregator] average:    [${average.join(', ')}]`);
    console.log(`[aggregator] remainder:  [${remainder.join(', ')}]`);
    console.log(`[aggregator] total wt:   ${totalWeight}`);

    // sanity check - verify the math adds up
    console.log('[aggregator] verification:');
    for (let i = 0; i < VECTOR_LEN; i++) {
        const check = average[i] * totalWeight + remainder[i];
        console.log(`  dim[${i}]: ${result[i]} === ${average[i]}*${totalWeight} + ${remainder[i]} = ${check} ${check === result[i] ? '✓' : '✗'}`);
    }

    // write input for the weighted_average circuit
    const avgCircuitInput = {
        vectors: selected,
        weights,
        expected_average: average,
        total_weight: totalWeight.toString(),
        remainder
    };
    try {
        fs.writeFileSync(ZK_AVG_INPUT_PATH, JSON.stringify(avgCircuitInput, null, 2));
        console.log(`\n[aggregator] avg circuit input -> ${ZK_AVG_INPUT_PATH}`);
    } catch (err) {
        console.error(`[aggregator] write error: ${err.message}`);
        process.exit(1);
    }

    // ---- store in CAS (content-addressed storage) ----
    let casItems = [];
    try {
        const cas = require('../storage/cas');
        const modelArtifact = {
            type: 'aggregated_model', vectors: selected, weights,
            weightedSum: result, weightedAverage: average,
            remainder, totalWeight, timestamp: new Date().toISOString()
        };

        const modelHash = cas.store(modelArtifact, { type: 'aggregated_model' });
        const sumHash = cas.store(circuitInput, { type: 'circuit_input_sum' });
        const avgHash = cas.store(avgCircuitInput, { type: 'circuit_input_average' });

        casItems = [
            { hash: modelHash, type: 'aggregated_model', size: JSON.stringify(modelArtifact).length },
            { hash: sumHash, type: 'circuit_input_sum', size: JSON.stringify(circuitInput).length },
            { hash: avgHash, type: 'circuit_input_average', size: JSON.stringify(avgCircuitInput).length }
        ];

        console.log(`\n[aggregator] -- CAS storage --`);
        console.log(`  model:     ${modelHash.slice(0, 16)}...`);
        console.log(`  sum input: ${sumHash.slice(0, 16)}...`);
        console.log(`  avg input: ${avgHash.slice(0, 16)}...`);
        console.log(`  these hashes can go on-chain via ModelRegistry`);
    } catch (err) {
        console.log(`\n[aggregator] CAS skipped: ${err.message}`);
    }

    // ---- export dashboard data so the browser can see it ----
    // the http server serves from client/ so we drop a json there
    const dashboardData = {
        sumInput: circuitInput,
        avgInput: avgCircuitInput,
        cas: casItems,
        clientUpdates: clientUpdates,
        generatedAt: new Date().toISOString()
    };
    const dashPath = path.join(__dirname, '..', 'client', 'dashboard_data.json');
    try {
        fs.writeFileSync(dashPath, JSON.stringify(dashboardData, null, 2));
        console.log(`[aggregator] dashboard data -> ${dashPath}`);
    } catch (err) {
        console.log(`[aggregator] dashboard export skipped: ${err.message}`);
    }

    console.log('\n[aggregator] next: npm run zk:setup && npm run zk:prove');
}

// generates sample updates for demo/testing
function generateSampleUpdates() {
    console.log('[aggregator] creating 4 sample updates...');
    if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });

    const baseSeed = 12345;
    for (let i = 0; i < NUM_CLIENTS; i++) {
        const clientSeed = baseSeed + i * 100;
        const vec = [];
        let s = clientSeed;
        for (let j = 0; j < VECTOR_LEN; j++) {
            s = ((s * 1103515245 + 12345) & 0x7fffffff);
            vec.push(Math.floor((s % 2001) - 1000));
        }

        const update = {
            type: 'model_update',
            clientId: `sample_client_${i}`,
            seed: clientSeed,
            trainSteps: 1,
            summaryVector: vec,
            timestamp: Date.now() + i
        };

        const filename = `update_sample_${i}_sample_client_${i}.json`;
        fs.writeFileSync(path.join(UPDATES_DIR, filename), JSON.stringify(update, null, 2));
        console.log(`  ${filename} -> [${vec.join(', ')}]`);
    }
}

main();
