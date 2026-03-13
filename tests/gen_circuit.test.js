// tests for the circuit generator script
// makes sure it outputs valid circom files with correct N and vector params

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Circuit Generator', () => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'gen_circuit.js');
    const sumPath = path.join(__dirname, '..', 'zk', 'circuits', 'weighted_sum.circom');
    const avgPath = path.join(__dirname, '..', 'zk', 'circuits', 'weighted_average.circom');

    // save originals before tests
    let origSum, origAvg;
    beforeAll(() => {
        if (fs.existsSync(sumPath)) origSum = fs.readFileSync(sumPath, 'utf-8');
        if (fs.existsSync(avgPath)) origAvg = fs.readFileSync(avgPath, 'utf-8');
    });

    afterAll(() => {
        // restore originals
        if (origSum) fs.writeFileSync(sumPath, origSum);
        if (origAvg) fs.writeFileSync(avgPath, origAvg);
    });

    test('generates circuits with default params', () => {
        execSync(`node "${scriptPath}"`, { stdio: 'pipe' });

        const sum = fs.readFileSync(sumPath, 'utf-8');
        expect(sum).toContain('WeightedSum(4, 4)');
        expect(sum).toContain('pragma circom 2.0.0');

        const avg = fs.readFileSync(avgPath, 'utf-8');
        expect(avg).toContain('WeightedAverage(4, 4)');
    });

    test('generates circuits with custom N=8 vectorLen=6', () => {
        execSync(`node "${scriptPath}" --clients 8 --vectorLen 6`, { stdio: 'pipe' });

        const sum = fs.readFileSync(sumPath, 'utf-8');
        expect(sum).toContain('WeightedSum(8, 6)');
        expect(sum).toContain('vectors[N][VECTOR_LEN]');

        const avg = fs.readFileSync(avgPath, 'utf-8');
        expect(avg).toContain('WeightedAverage(8, 6)');
        expect(avg).toContain('total_weight');
    });

    test('generated sum circuit has valid structure', () => {
        execSync(`node "${scriptPath}" --clients 4 --vectorLen 4`, { stdio: 'pipe' });

        const sum = fs.readFileSync(sumPath, 'utf-8');
        expect(sum).toContain('signal input vectors');
        expect(sum).toContain('signal input weights');
        expect(sum).toContain('signal input expected_result');
        expect(sum).toContain('component main');
    });

    test('generated avg circuit has division proof structure', () => {
        execSync(`node "${scriptPath}" --clients 4 --vectorLen 4`, { stdio: 'pipe' });

        const avg = fs.readFileSync(avgPath, 'utf-8');
        expect(avg).toContain('signal input expected_average');
        expect(avg).toContain('signal input remainder');
        expect(avg).toContain('template Num2Bits');
        expect(avg).toContain('template LessThan');
    });
});
