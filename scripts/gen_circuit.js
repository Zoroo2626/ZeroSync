// gen_circuit.js - generates circom circuits with custom client/vector counts
// tired of editing circom files by hand every time you change N? same
// usage: node scripts/gen_circuit.js --clients 8 --vectorLen 6

'use strict';

const fs = require('fs');
const path = require('path');

// parse cli args (keeping it simple, no dep needed)
const args = {};
process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg.startsWith('--') && arr[i + 1]) {
        args[arg.slice(2)] = parseInt(arr[i + 1], 10);
    }
});

const N = args.clients || 4;
const VECTOR_LEN = args.vectorLen || 4;
const BITS = args.bits || 32; // for range check in avg circuit

const CIRCUITS_DIR = path.join(__dirname, '..', 'zk', 'circuits');

// make sure dir exists
if (!fs.existsSync(CIRCUITS_DIR)) fs.mkdirSync(CIRCUITS_DIR, { recursive: true });

// --- weighted sum circuit ---
function genWeightedSum() {
    return `// auto-generated weighted_sum circuit for N=${N}, VECTOR_LEN=${VECTOR_LEN}
// regenerate with: node scripts/gen_circuit.js --clients ${N} --vectorLen ${VECTOR_LEN}

pragma circom 2.0.0;

template WeightedSum(N, VECTOR_LEN) {
    signal input vectors[N][VECTOR_LEN];
    signal input weights[N];
    signal input expected_result[VECTOR_LEN];

    // intermediate products so circom doesnt complain about quadratic constraints
    signal products[N][VECTOR_LEN];

    for (var i = 0; i < VECTOR_LEN; i++) {
        var acc = 0;
        for (var j = 0; j < N; j++) {
            products[j][i] <== weights[j] * vectors[j][i];
            acc = acc + products[j][i];
        }
        expected_result[i] === acc;
    }
}

component main {public [expected_result]} = WeightedSum(${N}, ${VECTOR_LEN});
`;
}

// --- weighted average circuit (with division proof) ---
function genWeightedAverage() {
    return `// auto-generated weighted_average circuit for N=${N}, VECTOR_LEN=${VECTOR_LEN}
// proves: sum = average * totalWeight + remainder (no division in-circuit)
// regenerate with: node scripts/gen_circuit.js --clients ${N} --vectorLen ${VECTOR_LEN}

pragma circom 2.0.0;

// bit decomposition - needed for range checks
template Num2Bits(n) {
    signal input in;
    signal output out[n];

    var lc = 0;
    var e2 = 1;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc += out[i] * e2;
        e2 = e2 + e2;
    }
    lc === in;
}

// returns 1 if in[0] < in[1]
template LessThan(n) {
    assert(n <= 252);
    signal input in[2];
    signal output out;

    component n2b = Num2Bits(n + 1);
    n2b.in <== in[0] + (1 << n) - in[1];
    out <== 1 - n2b.out[n];
}

template WeightedAverage(N, VECTOR_LEN) {
    signal input vectors[N][VECTOR_LEN];
    signal input weights[N];
    signal input expected_average[VECTOR_LEN];
    signal input total_weight;
    signal input remainder[VECTOR_LEN];

    signal products[N][VECTOR_LEN];
    signal avg_times_total[VECTOR_LEN];

    // range check components (one per dimension)
    component lt[VECTOR_LEN];

    // check total_weight = sum of all weights
    var weight_sum = 0;
    for (var j = 0; j < N; j++) {
        weight_sum = weight_sum + weights[j];
    }
    total_weight === weight_sum;

    // for each dimension: sum == avg * totalWeight + remainder
    for (var i = 0; i < VECTOR_LEN; i++) {
        var acc = 0;
        for (var j = 0; j < N; j++) {
            products[j][i] <== weights[j] * vectors[j][i];
            acc = acc + products[j][i];
        }

        avg_times_total[i] <== expected_average[i] * total_weight;
        acc === avg_times_total[i] + remainder[i];

        // remainder must be less than totalWeight (range check)
        lt[i] = LessThan(${BITS});
        lt[i].in[0] <== remainder[i];
        lt[i].in[1] <== total_weight;
        lt[i].out === 1;
    }
}

component main {public [expected_average, total_weight]} = WeightedAverage(${N}, ${VECTOR_LEN});
`;
}

// write em out
const sumPath = path.join(CIRCUITS_DIR, 'weighted_sum.circom');
const avgPath = path.join(CIRCUITS_DIR, 'weighted_average.circom');

fs.writeFileSync(sumPath, genWeightedSum());
fs.writeFileSync(avgPath, genWeightedAverage());

console.log(`[gen_circuit] generated circuits for N=${N}, VECTOR_LEN=${VECTOR_LEN}`);
console.log(`  ${sumPath}`);
console.log(`  ${avgPath}`);
console.log(`\nnext: npm run zk:setup && npm run zk:prove`);

// also update the config to match
const configPath = path.join(__dirname, '..', 'config.js');
if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, 'utf-8');
    cfg = cfg.replace(/vectorLen:\s*\d+/, `vectorLen: ${VECTOR_LEN}`);
    cfg = cfg.replace(/numClients:\s*\d+/, `numClients: ${N}`);
    fs.writeFileSync(configPath, cfg);
    console.log(`\n[gen_circuit] updated config.js: numClients=${N}, vectorLen=${VECTOR_LEN}`);
}
