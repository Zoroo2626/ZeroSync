// tests for the Paillier homomorphic encryption module
// verifies key generation, encrypt/decrypt, and the homomorphic property

const paillier = require('../crypto/paillier');

describe('Paillier HE - Math Helpers', () => {
    test('modPow computes correctly', () => {
        expect(paillier.modPow(2n, 10n, 1000n)).toBe(24n); // 1024 mod 1000
        expect(paillier.modPow(3n, 5n, 13n)).toBe(9n); // 243 mod 13
    });

    test('modInverse computes correctly', () => {
        const inv = paillier.modInverse(3n, 11n);
        expect((3n * inv) % 11n).toBe(1n);
    });

    test('gcd works', () => {
        expect(paillier.gcd(12n, 8n)).toBe(4n);
        expect(paillier.gcd(17n, 13n)).toBe(1n);
    });

    test('lcm works', () => {
        expect(paillier.lcm(4n, 6n)).toBe(12n);
    });
});

describe('Paillier HE - Primality', () => {
    test('identifies small primes', () => {
        expect(paillier.isProbablyPrime(2n)).toBe(true);
        expect(paillier.isProbablyPrime(3n)).toBe(true);
        expect(paillier.isProbablyPrime(17n)).toBe(true);
        expect(paillier.isProbablyPrime(97n)).toBe(true);
    });

    test('rejects composites', () => {
        expect(paillier.isProbablyPrime(4n)).toBe(false);
        expect(paillier.isProbablyPrime(15n)).toBe(false);
        expect(paillier.isProbablyPrime(100n)).toBe(false);
    });

    test('generatePrime returns a prime', () => {
        const p = paillier.generatePrime(64);
        expect(paillier.isProbablyPrime(p)).toBe(true);
        // should be roughly 64 bits
        expect(p.toString(2).length).toBeGreaterThanOrEqual(60);
    });
});

describe('Paillier HE - Encrypt/Decrypt', () => {
    let pub, priv;

    beforeAll(() => {
        // use small keys for test speed (256 bit)
        const keys = paillier.generateKeys(256);
        pub = keys.publicKey;
        priv = keys.privateKey;
    });

    test('encrypts and decrypts back correctly', () => {
        const msg = 42n;
        const ct = paillier.encrypt(pub, msg);
        const dec = paillier.decrypt(priv, ct);
        expect(dec).toBe(msg);
    });

    test('encrypts zero', () => {
        const ct = paillier.encrypt(pub, 0n);
        const dec = paillier.decrypt(priv, ct);
        expect(dec).toBe(0n);
    });

    test('different encryptions of same value produce different ciphertexts', () => {
        const c1 = paillier.encrypt(pub, 100n);
        const c2 = paillier.encrypt(pub, 100n);
        // probabilistic encryption means different ciphertexts
        expect(c1).not.toBe(c2);
        // but both decrypt to same value
        expect(paillier.decrypt(priv, c1)).toBe(100n);
        expect(paillier.decrypt(priv, c2)).toBe(100n);
    });

    test('handles large values', () => {
        const msg = 999999n;
        const ct = paillier.encrypt(pub, msg);
        expect(paillier.decrypt(priv, ct)).toBe(msg);
    });
});

describe('Paillier HE - Homomorphic Addition', () => {
    let pub, priv;

    beforeAll(() => {
        const keys = paillier.generateKeys(256);
        pub = keys.publicKey;
        priv = keys.privateKey;
    });

    test('Enc(a) * Enc(b) = Enc(a + b)', () => {
        const a = 100n;
        const b = 250n;
        const ca = paillier.encrypt(pub, a);
        const cb = paillier.encrypt(pub, b);
        const cSum = paillier.addEncrypted(pub, ca, cb);
        const decrypted = paillier.decrypt(priv, cSum);
        expect(decrypted).toBe(a + b);
    });

    test('summing multiple values', () => {
        const values = [10n, 20n, 30n, 40n];
        const encrypted = values.map(v => paillier.encrypt(pub, v));
        let total = encrypted[0];
        for (let i = 1; i < encrypted.length; i++) {
            total = paillier.addEncrypted(pub, total, encrypted[i]);
        }
        expect(paillier.decrypt(priv, total)).toBe(100n);
    });

    test('scalar multiplication works', () => {
        const m = 7n;
        const scalar = 5n;
        const cm = paillier.encrypt(pub, m);
        const result = paillier.mulScalar(pub, cm, scalar);
        expect(paillier.decrypt(priv, result)).toBe(35n);
    });
});

describe('Paillier HE - Signed Integers', () => {
    let pub, priv;

    beforeAll(() => {
        const keys = paillier.generateKeys(256);
        pub = keys.publicKey;
        priv = keys.privateKey;
    });

    test('encryptInt handles positive values', () => {
        const ct = paillier.encryptInt(pub, 42);
        expect(paillier.decryptInt(priv, ct)).toBe(42);
    });

    test('encryptInt handles negative values', () => {
        const ct = paillier.encryptInt(pub, -100);
        expect(paillier.decryptInt(priv, ct)).toBe(-100);
    });

    test('homomorphic sum with negatives', () => {
        const ca = paillier.encryptInt(pub, 500);
        const cb = paillier.encryptInt(pub, -300);
        const cSum = paillier.addEncrypted(pub, ca, cb);
        expect(paillier.decryptInt(priv, cSum)).toBe(200);
    });

    test('sum of positive and negative cancels out', () => {
        const ca = paillier.encryptInt(pub, 123);
        const cb = paillier.encryptInt(pub, -123);
        const cSum = paillier.addEncrypted(pub, ca, cb);
        expect(paillier.decryptInt(priv, cSum)).toBe(0);
    });
});

describe('Paillier HE - Vector Operations', () => {
    let pub, priv;

    beforeAll(() => {
        const keys = paillier.generateKeys(256);
        pub = keys.publicKey;
        priv = keys.privateKey;
    });

    test('encrypt and decrypt a vector', () => {
        const vec = [100, -200, 300, -400];
        const enc = paillier.encryptVector(pub, vec);
        const dec = paillier.decryptVector(priv, enc);
        expect(dec).toEqual(vec);
    });

    test('addEncryptedVectors sums element-wise', () => {
        const v1 = [10, 20, 30, 40];
        const v2 = [5, -10, 15, -20];
        const e1 = paillier.encryptVector(pub, v1);
        const e2 = paillier.encryptVector(pub, v2);
        const eSum = paillier.addEncryptedVectors(pub, e1, e2);
        const result = paillier.decryptVector(priv, eSum);
        expect(result).toEqual([15, 10, 45, 20]);
    });

    test('multi-vector sum matches plaintext', () => {
        const vectors = [
            [100, -200, 300, 400],
            [50, 150, -250, 350],
            [-100, 0, 100, -200],
            [200, -50, 75, 125]
        ];

        // plaintext sum
        const expected = [250, -100, 225, 675];

        // encrypted sum
        const encVecs = vectors.map(v => paillier.encryptVector(pub, v));
        let encSum = encVecs[0];
        for (let i = 1; i < encVecs.length; i++) {
            encSum = paillier.addEncryptedVectors(pub, encSum, encVecs[i]);
        }
        const result = paillier.decryptVector(priv, encSum);
        expect(result).toEqual(expected);
    });

    test('throws on mismatched vector lengths', () => {
        const e1 = paillier.encryptVector(pub, [1, 2]);
        const e2 = paillier.encryptVector(pub, [3, 4, 5]);
        expect(() => paillier.addEncryptedVectors(pub, e1, e2)).toThrow('vector length mismatch');
    });
});
