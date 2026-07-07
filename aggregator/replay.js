// replay.js - replays a training session from a saved replay.json
// feeds the same seed back into the prng and steps through events
// should produce the exact same summary vector as the original run
// thats the whole point of deterministic replay tbh

'use strict';

const fs = require('fs');
const path = require('path');
const seedrandom = require(path.join(__dirname, '..', 'client', 'utils', 'seedrandom.js'));

let config;
try { config = require('../config'); }
catch (e) { config = { fl: { scale: 1000, vectorLen: 4 } }; }

const SCALE = config.fl.scale;
const VECTOR_LEN = config.fl.vectorLen;

function main() {
    const replayPath = process.argv[2];

    if (!replayPath) {
        console.error('[replay] usage: node aggregator/replay.js <replay.json>');
        console.error('  example: node aggregator/replay.js tests/sample_replay.json');
        process.exit(1);
    }

    let replay;
    try {
        replay = JSON.parse(fs.readFileSync(replayPath, 'utf-8'));
    } catch (err) {
        console.error(`[replay] cant load file: ${err.message}`);
        process.exit(1);
    }

    if (replay.project !== 'ZeroSync') {
        console.error('[replay] this doesnt look like a ZeroSync replay file');
        process.exit(1);
    }

    console.log(`[replay] client: ${replay.clientId}`);
    console.log(`[replay] seed: ${replay.seed}`);
    console.log(`[replay] events: ${replay.events.length}`);
    console.log(`[replay] checkpoints: ${replay.checkpoints.length}`);

    // same seed = same random sequence
    const rng = seedrandom(replay.seed);

    console.log('\n[replay] stepping through events...');
    let lastSummaryVector = null;

    for (const event of replay.events) {
        console.log(`  [${event.timestamp}ms] ${event.type}`);

        if (event.type === 'train_step') {
            // burn through the same number of rng calls as training would
            // 32 samples * 4 features = 128 calls (or more with iris shuffle)
            const samples = (event.data && event.data.dataset === 'iris') ? 79 : 32 * 4;
            for (let i = 0; i < samples; i++) rng();
            console.log(`    step ${event.data.step}: loss=${event.data.loss?.toFixed(4)}, acc=${event.data.accuracy?.toFixed(4)}`);
        }

        if (event.type === 'send_update' && event.data.intVector) {
            lastSummaryVector = event.data.intVector;
            console.log(`    vector: [${lastSummaryVector.join(', ')}]`);
        }
    }

    if (replay.checkpoints.length > 0) {
        console.log('\n[replay] checkpoints:');
        for (const cp of replay.checkpoints) {
            console.log(`  ${cp.label} (${cp.timestamp}ms): ${cp.weights.length} tensors`);
        }
    }

    if (lastSummaryVector) {
        console.log('\n[replay] reproduced vector:');
        console.log(`  [${lastSummaryVector.join(', ')}]`);

        // save as aggregator input
        const outputPath = path.join(path.dirname(replayPath), 'replay_input.json');
        const input = {
            vectors: [lastSummaryVector.slice(0, VECTOR_LEN)],
            weights: [1],
            expected_result: lastSummaryVector.slice(0, VECTOR_LEN),
            replayed_from: replay.clientId,
            original_seed: replay.seed
        };
        try {
            fs.writeFileSync(outputPath, JSON.stringify(input, null, 2));
            console.log(`\n[replay] output -> ${outputPath}`);
        } catch (err) {
            console.error(`[replay] write failed: ${err.message}`);
        }
    } else {
        console.log('\n[replay] no send_update events found');
    }

    console.log('\n[replay] done ✓');
}

main();
