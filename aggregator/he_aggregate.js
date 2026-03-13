// he_aggregate.js - encrypted aggregation demo
// proves that we can sum client model updates WITHOUT seeing the actual values
// uses Paillier homomorphic encryption under the hood
//
// flow:
//   1. generate keypair (aggregator holds private key)
//   2. load client updates from server/updates/
//   3. encrypt each vector individually
//   4. sum all encrypted vectors using homomorphic addition
//   5. decrypt the result
//   6. verify it matches the plaintext aggregation
//
// usage: node aggregator/he_aggregate.js

'use strict';

// load .env if available
try { require('dotenv').config(); } catch (e) { /* fine */ }

const fs = require('fs');
const path = require('path');
const paillier = require('../crypto/paillier');

let config;
try { config = require('../config'); }
catch (e) { config = { fl: { scale: 1000, vectorLen: 4, numClients: 4 } }; }

const VECTOR_LEN = config.fl.vectorLen;
const NUM_CLIENTS = config.fl.numClients;
const UPDATES_DIR = path.join(__dirname, '..', 'server', 'updates');
const KEY_BITS = parseInt(process.env.HE_KEY_BITS, 10) || 512;

function main() {
    console.log('=== ZeroSync Homomorphic Encryption Aggregation ===\n');
    console.log(`[HE] key size: ${KEY_BITS} bits`);
    console.log(`[HE] vector length: ${VECTOR_LEN}, clients: ${NUM_CLIENTS}\n`);

    // step 1: generate keys
    console.log('[HE] generating Paillier keypair...');
    const startGen = Date.now();
    const { publicKey, privateKey } = paillier.generateKeys(KEY_BITS);
    const genTime = Date.now() - startGen;
    console.log(`[HE] keypair ready (${genTime}ms)`);
    console.log(`[HE] n = ${publicKey.n.toString().slice(0, 40)}... (${publicKey.n.toString().length} digits)\n`);

    // step 2: load client updates
    let files = [];
    try {
        files = fs.readdirSync(UPDATES_DIR).filter(f => f.endsWith('.json')).sort();
    } catch (err) {
        console.error(`[HE] no updates found: ${err.message}`);
        process.exit(1);
    }

    console.log(`[HE] found ${files.length} update file(s)`);

    const vectors = [];
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(UPDATES_DIR, file), 'utf-8'));
            if (data.summaryVector && Array.isArray(data.summaryVector)) {
                const vec = data.summaryVector.slice(0, VECTOR_LEN);
                while (vec.length < VECTOR_LEN) vec.push(0);
                vectors.push(vec.map(v => Math.round(v)));
                console.log(`  ${data.clientId || '?'}: [${vec.map(v => Math.round(v)).join(', ')}]`);
            }
        } catch (err) {
            console.error(`  skipping ${file}: ${err.message}`);
        }
    }

    // pad if needed
    while (vectors.length < NUM_CLIENTS) {
        vectors.push(new Array(VECTOR_LEN).fill(0));
    }
    const selected = vectors.slice(0, NUM_CLIENTS);

    // step 3: plaintext aggregation (for comparison)
    console.log('\n--- Plaintext Aggregation (reference) ---');
    const plaintextSum = new Array(VECTOR_LEN).fill(0);
    for (let i = 0; i < VECTOR_LEN; i++) {
        for (let j = 0; j < NUM_CLIENTS; j++) {
            plaintextSum[i] += selected[j][i];
        }
    }
    console.log(`[plaintext] sum: [${plaintextSum.join(', ')}]`);

    // step 4: encrypted aggregation
    console.log('\n--- Encrypted Aggregation (homomorphic) ---');

    console.log('[HE] encrypting client vectors...');
    const startEnc = Date.now();
    const encryptedVectors = selected.map((vec, idx) => {
        const enc = paillier.encryptVector(publicKey, vec);
        console.log(`  client_${idx}: encrypted (${enc.length} ciphertexts)`);
        return enc;
    });
    const encTime = Date.now() - startEnc;
    console.log(`[HE] encryption done (${encTime}ms for ${NUM_CLIENTS} vectors)`);

    // step 5: homomorphic sum (the magic part)
    console.log('\n[HE] summing encrypted vectors (without decrypting)...');
    const startSum = Date.now();
    let encryptedSum = encryptedVectors[0];
    for (let j = 1; j < NUM_CLIENTS; j++) {
        encryptedSum = paillier.addEncryptedVectors(publicKey, encryptedSum, encryptedVectors[j]);
        console.log(`  added client_${j} (still encrypted)`);
    }
    const sumTime = Date.now() - startSum;
    console.log(`[HE] homomorphic addition done (${sumTime}ms)`);

    // step 6: decrypt the sum
    console.log('\n[HE] decrypting the aggregated result...');
    const startDec = Date.now();
    const decryptedSum = paillier.decryptVector(privateKey, encryptedSum);
    const decTime = Date.now() - startDec;
    console.log(`[HE] decrypted sum: [${decryptedSum.join(', ')}]`);
    console.log(`[HE] decryption done (${decTime}ms)`);

    // step 7: verify match
    console.log('\n--- Verification ---');
    let match = true;
    for (let i = 0; i < VECTOR_LEN; i++) {
        if (plaintextSum[i] !== decryptedSum[i]) {
            console.error(`[HE] MISMATCH at index ${i}: plaintext=${plaintextSum[i]}, decrypted=${decryptedSum[i]}`);
            match = false;
        }
    }

    if (match) {
        console.log('[HE] ✓ VERIFIED: encrypted sum matches plaintext sum exactly');
        console.log('[HE] the aggregator never saw the individual values!\n');
    } else {
        console.error('[HE] ✗ VERIFICATION FAILED\n');
    }

    // step 8: timing summary
    console.log('--- Performance ---');
    console.log(`  key generation:  ${genTime}ms`);
    console.log(`  encryption:      ${encTime}ms (${NUM_CLIENTS} × ${VECTOR_LEN} values)`);
    console.log(`  homomorphic sum: ${sumTime}ms`);
    console.log(`  decryption:      ${decTime}ms`);
    console.log(`  total:           ${genTime + encTime + sumTime + decTime}ms`);

    // step 9: export results to dashboard
    const heResults = {
        verified: match,
        keyBits: KEY_BITS,
        plaintextSum,
        decryptedSum,
        numClients: NUM_CLIENTS,
        vectorLen: VECTOR_LEN,
        timings: { keyGen: genTime, encryption: encTime, homomorphicSum: sumTime, decryption: decTime },
        generatedAt: new Date().toISOString()
    };

    // update the existing dashboard data if it exists
    const dashPath = path.join(__dirname, '..', 'client', 'dashboard_data.json');
    try {
        let dashData = {};
        if (fs.existsSync(dashPath)) {
            dashData = JSON.parse(fs.readFileSync(dashPath, 'utf-8'));
        }
        dashData.homomorphicEncryption = heResults;
        fs.writeFileSync(dashPath, JSON.stringify(dashData, null, 2));
        console.log(`\n[HE] results exported to dashboard_data.json`);
    } catch (err) {
        console.log(`\n[HE] export skipped: ${err.message}`);
    }

    console.log('\n[HE] done ✓');
}

main();
