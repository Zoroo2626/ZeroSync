// tests for CAS (content-addressed storage)
// makes sure hashing, storing, retrieving, and integrity checks work

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// we need to test against a temp directory so we dont mess with real data
const TEST_DATA_DIR = path.join(__dirname, 'temp_cas_data');
const TEST_INDEX = path.join(__dirname, 'temp_cas_index.json');

// mock the paths before requiring cas
jest.mock('path', () => {
    const original = jest.requireActual('path');
    return {
        ...original,
        join: (...args) => {
            const result = original.join(...args);
            // redirect CAS paths to test dir
            if (result.includes('storage/data') || result.endsWith('storage\\data')) {
                return original.join(__dirname, 'temp_cas_data');
            }
            if (result.includes('storage/index.json') || result.endsWith('storage\\index.json')) {
                return original.join(__dirname, 'temp_cas_index.json');
            }
            return result;
        }
    };
});

// clean up before and after
beforeAll(() => {
    if (!fs.existsSync(TEST_DATA_DIR)) fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
});

afterAll(() => {
    // clean up test files
    try {
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.readdirSync(TEST_DATA_DIR).forEach(f => fs.unlinkSync(path.join(TEST_DATA_DIR, f)));
            fs.rmdirSync(TEST_DATA_DIR);
        }
        if (fs.existsSync(TEST_INDEX)) fs.unlinkSync(TEST_INDEX);
    } catch (e) { /* cleanup errors are fine */ }
});

// reimport after mock
const cas = require('../storage/cas');

describe('CAS - computeHash', () => {
    test('returns a hex string', () => {
        const hash = cas.computeHash('hello world');
        expect(typeof hash).toBe('string');
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('same input = same hash', () => {
        const h1 = cas.computeHash('test data');
        const h2 = cas.computeHash('test data');
        expect(h1).toBe(h2);
    });

    test('different input = different hash', () => {
        const h1 = cas.computeHash('data1');
        const h2 = cas.computeHash('data2');
        expect(h1).not.toBe(h2);
    });

    test('matches node crypto sha256', () => {
        const input = 'verify this';
        const expected = crypto.createHash('sha256').update(input).digest('hex');
        expect(cas.computeHash(input)).toBe(expected);
    });
});

describe('CAS - hash (without storing)', () => {
    test('hashes objects as json', () => {
        const obj = { key: 'value', num: 42 };
        const hash = cas.hash(obj);
        expect(typeof hash).toBe('string');
        expect(hash.length).toBe(64);
    });

    test('deterministic for same object', () => {
        const obj = { a: 1, b: 2 };
        expect(cas.hash(obj)).toBe(cas.hash(obj));
    });
});
