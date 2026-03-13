// paillier.js - Paillier homomorphic encryption
// allows adding encrypted values WITHOUT decrypting them first
// aggregator can sum client vectors while they're still encrypted
// only the key holder can see the actual result
//
// this is the real deal - used in e-voting, private ML, secure auctions
// we use it here so the aggregation server never sees raw model updates

'use strict';

const crypto = require('crypto');

// ---- BigInt math helpers ----

// modular exponentiation: base^exp mod mod
// uses square-and-multiply for speed
function modPow(base, exp, mod) {
    if (mod === 1n) return 0n;
    let result = 1n;
    base = ((base % mod) + mod) % mod;
    while (exp > 0n) {
        if (exp & 1n) {
            result = (result * base) % mod;
        }
        exp >>= 1n;
        base = (base * base) % mod;
    }
    return result;
}

// extended GCD - needed for modular inverse
function extGcd(a, b) {
    if (a === 0n) return { g: b, x: 0n, y: 1n };
    const { g, x, y } = extGcd(b % a, a);
    return { g, x: y - (b / a) * x, y: x };
}

// modular inverse: a^(-1) mod m
function modInverse(a, m) {
    const { g, x } = extGcd(((a % m) + m) % m, m);
    if (g !== 1n) throw new Error('modular inverse does not exist');
    return ((x % m) + m) % m;
}

// GCD of two bigints
function gcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b > 0n) { [a, b] = [b, a % b]; }
    return a;
}

// LCM of two bigints
function lcm(a, b) {
    return (a / gcd(a, b)) * b;
}

// generate a random BigInt with the given number of bits
function randomBigIntBits(bits) {
    const bytes = Math.ceil(bits / 8);
    const buf = crypto.randomBytes(bytes);
    let val = 0n;
    for (const byte of buf) val = (val << 8n) | BigInt(byte);
    // mask to exact bit count
    const mask = (1n << BigInt(bits)) - 1n;
    return val & mask;
}

// random BigInt in range [min, max]
function randomBigInt(min, max) {
    const range = max - min + 1n;
    const bits = range.toString(2).length;
    let val;
    do {
        val = randomBigIntBits(bits);
    } while (val >= range);
    return min + val;
}

// ---- Primality testing (Miller-Rabin) ----

function millerRabinTest(n, a) {
    let d = n - 1n;
    let r = 0n;
    while (d % 2n === 0n) {
        d /= 2n;
        r++;
    }

    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) return true;

    for (let i = 0n; i < r - 1n; i++) {
        x = modPow(x, 2n, n);
        if (x === n - 1n) return true;
    }
    return false;
}

function isProbablyPrime(n, rounds = 20) {
    if (n < 2n) return false;
    if (n === 2n || n === 3n) return true;
    if (n % 2n === 0n || n % 3n === 0n) return false;

    // test against small primes first (fast rejection)
    const smallPrimes = [5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
    for (const p of smallPrimes) {
        if (n === p) return true;
        if (n % p === 0n) return false;
    }

    // miller-rabin with random witnesses
    for (let i = 0; i < rounds; i++) {
        const a = randomBigInt(2n, n - 2n);
        if (!millerRabinTest(n, a)) return false;
    }
    return true;
}

// generate a random prime of given bit length
function generatePrime(bits) {
    let attempts = 0;
    while (true) {
        attempts++;
        let n = randomBigIntBits(bits);
        n = n | 1n;                        // force odd
        n = n | (1n << BigInt(bits - 1));   // force high bit (correct bit length)
        if (isProbablyPrime(n)) {
            return n;
        }
    }
}

// ---- Paillier Cryptosystem ----
// additive homomorphic: Enc(a) * Enc(b) mod n^2 = Enc(a + b)

/**
 * generate a Paillier keypair
 * bits = key size (each prime is bits/2, so n is ~bits wide)
 * 512 = fast demo, 1024 = reasonable security, 2048 = production
 */
function generateKeys(bits) {
    bits = bits || 512;
    const halfBits = Math.floor(bits / 2);

    const p = generatePrime(halfBits);
    let q = generatePrime(halfBits);
    // make sure p != q (astronomically unlikely but still)
    while (q === p) q = generatePrime(halfBits);

    const n = p * q;
    const n2 = n * n;
    const lambda = lcm(p - 1n, q - 1n);

    // g = n + 1 is a common simplification that always works
    const g = n + 1n;

    // L(x) = (x - 1) / n
    const gl = modPow(g, lambda, n2);
    const l = (gl - 1n) / n;
    const mu = modInverse(l, n);

    return {
        publicKey: { n, n2, g, bits },
        privateKey: { lambda, mu, n, n2 }
    };
}

/**
 * encrypt a message (BigInt) using the public key
 * message must be in [0, n)
 * for negative numbers, use encodeSignedInt first
 */
function encrypt(pub, message) {
    if (message < 0n || message >= pub.n) {
        throw new Error(`message out of range [0, ${pub.n}): got ${message}`);
    }
    const r = randomBigInt(1n, pub.n - 1n);
    const gm = modPow(pub.g, message, pub.n2);
    const rn = modPow(r, pub.n, pub.n2);
    return (gm * rn) % pub.n2;
}

/**
 * decrypt a ciphertext using the private key
 * returns BigInt in [0, n)
 */
function decrypt(priv, ciphertext) {
    const cl = modPow(ciphertext, priv.lambda, priv.n2);
    const l = (cl - 1n) / priv.n;
    return (l * priv.mu) % priv.n;
}

/**
 * homomorphic addition: add two encrypted values WITHOUT decrypting
 * returns Enc(m1 + m2) from Enc(m1) and Enc(m2)
 * this is the entire magic of Paillier
 */
function addEncrypted(pub, c1, c2) {
    return (c1 * c2) % pub.n2;
}

/**
 * homomorphic scalar multiplication: multiply encrypted value by plaintext scalar
 * returns Enc(m * scalar) from Enc(m) and scalar
 */
function mulScalar(pub, ciphertext, scalar) {
    return modPow(ciphertext, scalar, pub.n2);
}

// ---- Signed integer helpers ----
// Paillier operates on [0, n) but we need negative numbers for model updates
// encoding: positive x -> x, negative x -> n + x (wraps around)

function encodeSignedInt(n, value) {
    const v = BigInt(value);
    if (v >= 0n) return v;
    return n + v; // negative wraps to top of range
}

function decodeSignedInt(n, value) {
    const halfN = n / 2n;
    if (value > halfN) return value - n;
    return value;
}

/**
 * high-level: encrypt a regular JS number (handles negatives)
 */
function encryptInt(pub, value) {
    const encoded = encodeSignedInt(pub.n, value);
    return encrypt(pub, encoded);
}

/**
 * high-level: decrypt to a regular JS number (handles negatives)
 */
function decryptInt(priv, ciphertext) {
    const raw = decrypt(priv, ciphertext);
    const signed = decodeSignedInt(priv.n, raw);
    return Number(signed);
}

/**
 * encrypt an entire vector of integers
 */
function encryptVector(pub, vector) {
    return vector.map(v => encryptInt(pub, v));
}

/**
 * decrypt an entire vector back to integers
 */
function decryptVector(priv, encVector) {
    return encVector.map(c => decryptInt(priv, c));
}

/**
 * homomorphically add two encrypted vectors element-wise
 * result[i] = Enc(a[i] + b[i])
 */
function addEncryptedVectors(pub, encVec1, encVec2) {
    if (encVec1.length !== encVec2.length) {
        throw new Error('vector length mismatch');
    }
    return encVec1.map((c, i) => addEncrypted(pub, c, encVec2[i]));
}

module.exports = {
    generateKeys,
    encrypt, decrypt,
    addEncrypted, mulScalar,
    encryptInt, decryptInt,
    encryptVector, decryptVector,
    addEncryptedVectors,
    encodeSignedInt, decodeSignedInt,
    // expose for testing
    modPow, modInverse, isProbablyPrime, generatePrime, gcd, lcm
};
