// cas.js - content-addressed storage
// basically a local IPFS but way simpler
// stores stuff by SHA-256 hash so you get deduplication + tamper detection for free
// swap this out for actual IPFS/Arweave in production

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const INDEX_PATH = path.join(__dirname, 'index.json');

try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
    console.error(`[CAS] cant create storage dir: ${err.message}`);
}

// hash anything
function computeHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function loadIndex() {
    try {
        if (fs.existsSync(INDEX_PATH)) return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    } catch (err) {
        console.error(`[CAS] index load warning: ${err.message}`);
    }
    return {};
}

function saveIndex(index) {
    try { fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2)); }
    catch (err) { console.error(`[CAS] index save error: ${err.message}`); }
}

// store content, returns the hash
// if the content already exists (same hash) we just skip - free dedup
function store(data, metadata) {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const hash = computeHash(content);
    const filePath = path.join(DATA_DIR, `${hash}.json`);

    if (fs.existsSync(filePath)) {
        console.log(`[CAS] already have: ${hash.slice(0, 12)}...`);
        return hash;
    }

    try {
        fs.writeFileSync(filePath, content);
        const index = loadIndex();
        index[hash] = {
            hash, size: Buffer.byteLength(content),
            storedAt: new Date().toISOString(),
            ...(metadata || {})
        };
        saveIndex(index);
        console.log(`[CAS] stored: ${hash.slice(0, 12)}... (${Buffer.byteLength(content)} bytes)`);
        return hash;
    } catch (err) {
        console.error(`[CAS] store error: ${err.message}`);
        throw err;
    }
}

// get content back by hash, also verifies integrity
function retrieve(hash) {
    const filePath = path.join(DATA_DIR, `${hash}.json`);
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const actual = computeHash(content);
            if (actual !== hash) {
                console.error(`[CAS] INTEGRITY FAIL: expected ${hash}, got ${actual}`);
                return null;
            }
            return content;
        }
        console.log(`[CAS] not found: ${hash.slice(0, 12)}...`);
        return null;
    } catch (err) {
        console.error(`[CAS] retrieve error: ${err.message}`);
        return null;
    }
}

// quick check if content is intact
function verify(hash) { return retrieve(hash) !== null; }

// list everything in storage
function list() { return Object.values(loadIndex()); }

// hash something without storing it
function hash(data) {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return computeHash(content);
}

module.exports = { store, retrieve, verify, list, hash, computeHash, DATA_DIR, INDEX_PATH };
