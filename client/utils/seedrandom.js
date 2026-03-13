// seedrandom.js - tiny seeded PRNG (mulberry32)
// the whole deterministic replay thing depends on this
// same seed = exact same sequence of random numbers every time
// its fast and the distribution is surprisingly good for how smol it is

(function (root) {
  'use strict';

  // mulberry32 - 32-bit prng, works great for our use case
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedrandom(seed) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) {
      seed = 12345; // default seed if none provided
    }
    return mulberry32(Math.floor(seed));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = seedrandom;
  }
  if (typeof root !== 'undefined') {
    root.seedrandom = seedrandom;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
