// auto-generated weighted_sum circuit for N=4, VECTOR_LEN=4
// regenerate with: node scripts/gen_circuit.js --clients 4 --vectorLen 4

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

component main {public [expected_result]} = WeightedSum(4, 4);
