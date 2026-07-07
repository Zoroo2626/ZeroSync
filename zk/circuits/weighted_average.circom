// auto-generated weighted_average circuit for N=4, VECTOR_LEN=4
// proves: sum = average * totalWeight + remainder (no division in-circuit)
// regenerate with: node scripts/gen_circuit.js --clients 4 --vectorLen 4

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
        lt[i] = LessThan(32);
        lt[i].in[0] <== remainder[i];
        lt[i].in[1] <== total_weight;
        lt[i].out === 1;
    }
}

component main {public [expected_average, total_weight]} = WeightedAverage(4, 4);
