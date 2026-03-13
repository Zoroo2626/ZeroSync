// deploy.js - deploys ModelRegistry to local hardhat and publishes a test record
// run: npx hardhat run scripts/deploy.js --network localhost
// make sure hardhat node is running first (npx hardhat node)

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
    console.log("[hardhat] deploying ModelRegistry...\n");

    const ModelRegistry = await ethers.getContractFactory("ModelRegistry");
    const registry = await ModelRegistry.deploy();
    await registry.waitForDeployment();

    const address = await registry.getAddress();
    console.log(`  ✓ deployed to: ${address}\n`);

    // publish a test record to make sure it works
    console.log("[hardhat] publishing test model record...");

    const modelHash = ethers.keccak256(ethers.toUtf8Bytes("zerosync-aggregated-model-v1"));
    const proofUri = "zk/build/proof.json";
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes("cas://sample-content-hash-v1"));

    console.log(`  model hash:   ${modelHash}`);
    console.log(`  proof uri:    ${proofUri}`);
    console.log(`  content hash: ${contentHash}`);

    const tx = await registry.publishModel(modelHash, proofUri, contentHash);
    const receipt = await tx.wait();

    // check for the event
    const event = receipt.logs.find(log => {
        try {
            const parsed = registry.interface.parseLog({ topics: log.topics, data: log.data });
            return parsed && parsed.name === 'ModelPublished';
        } catch { return false; }
    });

    if (event) {
        const parsed = registry.interface.parseLog({ topics: event.topics, data: event.data });
        console.log(`\n  ✓ ModelPublished event emitted`);
        console.log(`    publisher: ${parsed.args.publisher}`);
        console.log(`    timestamp: ${parsed.args.timestamp}`);
    } else {
        console.log(`\n  ✗ event not found in receipt`);
    }

    const count = await registry.getRecordCount();
    console.log(`\n  total records: ${count}`);
    console.log(`\n[hardhat] done ✓ (contract: ${address})`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => { console.error("[hardhat] error:", err.message); process.exit(1); });
