# ZeroSync 🧠

> **Browser-native Federated Learning with a Triple-Layer Privacy Stack.**

Look, most federated learning (FL) frameworks are massive beasts. They run on Python, they require crazy container orchestration, and you basically need a PhD to get them running on end-user devices. I wanted something that just works in the browser.

More importantly, I wanted a *real* privacy stack. Not just a promise that "we won't look at your data." I'm talking mathematically guaranteed, cryptographically enforced privacy. 

So I built ZeroSync. 

It’s an end-to-end federated learning prototype that runs right in the browser. But the real magic is what I call the **Triple-Layer Privacy Stack**:
1. **Differential Privacy (DP)** — Gaussian/Laplace noise is added to the model weights on the client side *before* the data ever leaves the device.
2. **Homomorphic Encryption (HE)** — We use the Paillier cryptosystem so the aggregator (central server) can sum up all the model updates while they are still encrypted. The server literally never sees the raw numbers.
3. **Zero-Knowledge Proofs (ZK)** — We generate PLONK circuits via Circom to prove that the aggregation was done correctly, and we verify that proof on-chain via a Solidity smart contract.

If you're an engineer or researcher looking to understand what the future of privacy-preserving ML actually looks like, this is your reference implementation.

![ZeroSync Dashboard](./assets/dashboard.png)

***

## What's actually under the hood?

I didn't just wire up a bunch of existing libraries. A lot of this is built from scratch to work natively in JS/Node:
* **Zero-dependency Paillier HE:** The entire Paillier cryptosystem (`crypto/paillier.js`) is written in pure JavaScript using `BigInt`. No weird C++ bindings, no massive WASM blobs. It handles key generation, encryption, decryption, and (crucially) homomorphic addition of signed integers.
* **WebRTC Data Channels:** Clients don't just talk to the server; they can talk to each other.
* **Smart Contract Verification:** Proofs are verified on a local Hardhat network (`OnChainVerifier.sol`).
* **Content-Addressed Storage (CAS):** Model checkpoints and proofs are stored using IPFS-style SHA-256 content addressing.

## How to run this thing

It's actually super simple to spin up locally.

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Start the HTTP server (serves the client UI):**
   ```bash
   npm run start:client
   ```
   *Go to `http://127.0.0.1:8000` and you'll see the training UI. Open a few tabs to simulate multiple clients training on different data.*

3. **Start the Signaling and Aggregation Server:**
   ```bash
   npm run start:server
   ```

4. **Run the Homomorphic Encryption demo:**
   ```bash
   npm run he:aggregate
   ```
   *This takes the updates from your clients, encrypts them, sums them up homomorphically, decrypts the result, and verifies that it matches the plaintext sum exactly. Check `http://127.0.0.1:8000/dashboard.html` to see the results live.*

5. **(Optional) Run the ZK Proof generation and verification:**
   ```bash
   npm run zk:setup
   npm run zk:prove
   ```

## Why did I build this?

Because the privacy tech stack is fragmented. Blockchain people know ZK. AI people know FL. Data scientists know DP. Cryptographers know HE. But very few people are putting them all together in one system, let alone making it run smoothly in a browser environment.

This project is my proof-of-work that these technologies can (and should) be combined.

## License

This project is licensed under the **AGPL-3.0 License**. 

What does that mean for you? 
* **If you're an individual, student, or researcher:** Go crazy. Read the code, fork it, learn from it, run it.
* **If you're a company wanting to use this commercially:** You are legally required to open-source your entire product under the same license if you use this code. If you don't want to open-source your company's product, you'll need a commercial license. In that case, **reach out to me directly**. 

## Contact / Consulting

I am available for freelance/contract work. If your startup or lab is building privacy-preserving AI and you need someone who actually understands how to implement DP, ZK, and HE end-to-end, let's talk.
