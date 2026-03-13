# ZeroSync — Technical Whitepaper

## Abstract

ZeroSync is a browser-native federated learning system that combines in-browser model training, peer-to-peer weight transfer via WebRTC, zero-knowledge aggregation proofs, and on-chain model registries. It enables multiple browser tabs (representing edge devices) to collaboratively train a shared model while providing **verifiable, tamper-proof, and deterministically reproducible** aggregation — all without a trusted central server.

---

## 1. Problem Statement

Federated learning (FL) requires clients to trust an aggregation server to correctly combine model updates. In practice:

- **Aggregation integrity** — How do clients verify the server computed the correct weighted average?
- **Reproducibility** — Can a third party replay and verify a training run?
- **Privacy** — Can model updates flow without routing through a central server?

ZeroSync addresses all three by combining ZK proofs, WebRTC P2P channels, and deterministic replay.

---

## 2. Architecture

```
┌─────────────┐     WebRTC P2P      ┌─────────────┐
│  Browser     │◄──────────────────►│  Browser     │
│  Client A    │                     │  Client B    │
└──────┬───────┘                     └──────┬───────┘
       │ WS (signaling only)                │
       └──────────┬─────────────────────────┘
                  │
           ┌──────▼──────┐
           │  Signaling   │  ← SDP/ICE relay only
           │  Server      │  ← also archives updates
           └──────┬───────┘
                  │
           ┌──────▼──────┐
           │  Aggregator  │  ← computes weighted sum/avg
           └──────┬───────┘
                  │
           ┌──────▼──────┐
           │  ZK Prover   │  ← circom circuit + snarkjs PLONK
           └──────┬───────┘
                  │
           ┌──────▼──────┐
           │  On-Chain    │  ← ModelRegistry (Hardhat)
           │  Registry    │  ← stores hashes, not weights
           └──────────────┘
```

### 2.1 Client Layer

Each browser tab runs a TensorFlow.js MLP model initialized with a unique deterministic seed (Mulberry32 PRNG). Training uses either synthetic data or the Iris dataset. Model updates are 4-dimensional summary vectors extracted from the first dense layer's kernel weights.

### 2.2 Networking Layer

- **WebRTC Data Channels**: Model updates flow directly between browsers after an initial WebSocket handshake. This eliminates the server as a data bottleneck and reduces privacy exposure.
- **WebSocket Fallback**: If WebRTC negotiation fails, updates are relayed through the signaling server. The server always receives a copy for aggregation.

### 2.3 Aggregation Layer

The aggregator reads archived updates and computes:

1. **Weighted Sum**: `result[i] = Σ(weight[j] × vector[j][i])`
2. **Weighted Average**: Uses integer division identity for ZK compatibility

### 2.4 ZK Verification Layer

Two circom circuits enforce aggregation correctness:

**Circuit 1 — Weighted Sum** (weighted_sum.circom):
- Public inputs: `expected_result[4]`
- Private inputs: `vectors[4][4]`, `weights[4]`
- Constraint: For each dimension, the weighted sum equals the declared result

**Circuit 2 — Weighted Average** (weighted_average.circom):
- Proves: `sum = average × totalWeight + remainder`
- Enforces: `0 ≤ remainder < totalWeight` via Num2Bits + LessThan
- Avoids division entirely — uses multiplication + range check instead

Both use PLONK (snarkjs) with local trusted setup.

### 2.5 Storage Layer

**Content-Addressed Storage (CAS)**: All artifacts (aggregated models, circuit inputs) are stored by their SHA-256 hash. This provides:

- **Deduplication**: Identical content is stored once
- **Tamper detection**: Any modification changes the hash
- **Auditability**: Hashes can be published on-chain

### 2.6 Blockchain Layer

`ModelRegistry.sol` stores on-chain records containing:
- Model hash (keccak256 of aggregated weights)
- Proof URI (location of the ZK proof)
- Content hash (SHA-256 from CAS)

This creates an immutable audit trail without storing any model data on-chain.

---

## 3. Threat Model

### What ZeroSync verifies:
- ✅ Aggregator computed the correct weighted sum/average
- ✅ Division proof is mathematically correct (sum = avg × N + remainder)
- ✅ Remainder is in valid range [0, totalWeight)
- ✅ Published hashes match stored artifacts (CAS integrity)
- ✅ Training runs are bitwise reproducible (deterministic replay)

### What ZeroSync does NOT verify:
- ❌ Clients submitted honest model updates (byzantine clients)
- ❌ Data quality or distribution (data poisoning)
- ❌ Model convergence or utility
- ❌ Network-level attacks (MITM on WebSocket pre-WebRTC)

### Trust assumptions:
- The ZK proof system (PLONK) is sound
- The PRNG (Mulberry32) is deterministic (proven by construction)
- SHA-256 is collision-resistant
- The Hardhat node is honest (local only — not a concern for production intent)

---

## 4. Deterministic Replay

Every training run records:
- **PRNG seed**: The exact random seed for reproducibility
- **Event timeline**: Ordered list of training steps, updates sent/received
- **Model checkpoints**: Weight snapshots at key moments

A replay consumer can re-initialize the PRNG with the saved seed and step through events to reproduce the exact same model state. This enables third-party verification without re-running the actual training.

---

## 5. Performance Characteristics

| Component | Metric | Value |
|-----------|--------|-------|
| Model training | 1 step (32 samples) | ~50ms in browser |
| WebRTC connection | Handshake time | ~200-500ms (local) |
| Aggregation | 4 clients, 4-dim vectors | <10ms |
| ZK proof (PLONK) | Prove time | ~2-5s (local) |
| ZK verification | Verify time | <100ms |
| CAS store | Write + hash | <5ms |

---

## 6. Design Decisions

**Why PLONK over Groth16?**
PLONK doesn't require a per-circuit trusted setup ceremony. Since ZeroSync is meant for experimentation and rapid iteration, the universal setup of PLONK is more practical.

**Why fixed-point integers?**
Circom operates in a prime field (BN128). Floating-point arithmetic doesn't exist in this field. All values are scaled by SCALE=1000 before entering the circuit, then the division proof handles the integer math.

**Why Mulberry32?**
Simple, fast, and produces excellent distribution for a 32-bit PRNG. More importantly, it's trivially deterministic — the entire state is one 32-bit integer, making replay straightforward.

**Why browser tabs instead of real devices?**
Accessibility. Anyone can open 4 tabs to simulate a 4-client federation. No mobile SDKs, no Docker networking, no device provisioning. The architecture is identical to a real deployment — only the transport layer changes.

---

## 7. Future Work

- **Differential privacy**: Add noise injection with ε-δ guarantees
- **Byzantine tolerance**: Implement Krum or trimmed mean aggregation
- **Real IPFS/Arweave**: Swap local CAS for decentralized storage
- **Mainnet deployment**: Deploy ModelRegistry to a real L2 (Optimism, Arbitrum)
- **Larger models**: Support configurable architectures beyond the toy MLP
- **FedAvg / FedProx**: Implement standard FL aggregation strategies

---

## License

MIT — free to use, modify, and distribute.
