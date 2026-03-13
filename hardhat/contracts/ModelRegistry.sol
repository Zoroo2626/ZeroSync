// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ModelRegistry - stores on-chain records of aggregated model updates
// each record links to a ZK proof and CAS content hash
// deployed locally on hardhat only - dont put this on mainnet lol

contract ModelRegistry {

    event ModelPublished(
        bytes32 indexed modelHash,
        string proofUri,
        bytes32 contentHash,
        address indexed publisher,
        uint256 timestamp
    );

    struct ModelRecord {
        bytes32 modelHash;
        string proofUri;
        bytes32 contentHash;
        address publisher;
        uint256 timestamp;
    }

    ModelRecord[] public records;
    mapping(bytes32 => bool) public published;

    // publish a new model update record
    // modelHash = keccak of aggregated weights
    // proofUri = where to find the zk proof
    // contentHash = SHA-256 from CAS for tamper detection
    function publishModel(bytes32 modelHash, string calldata proofUri, bytes32 contentHash) external {
        require(!published[modelHash], "ModelRegistry: already published");

        published[modelHash] = true;
        records.push(ModelRecord({
            modelHash: modelHash,
            proofUri: proofUri,
            contentHash: contentHash,
            publisher: msg.sender,
            timestamp: block.timestamp
        }));

        emit ModelPublished(modelHash, proofUri, contentHash, msg.sender, block.timestamp);
    }

    function getRecordCount() external view returns (uint256) {
        return records.length;
    }

    function getRecord(uint256 index) external view returns (
        bytes32 modelHash, string memory proofUri, bytes32 contentHash,
        address publisher, uint256 timestamp
    ) {
        require(index < records.length, "ModelRegistry: out of bounds");
        ModelRecord storage r = records[index];
        return (r.modelHash, r.proofUri, r.contentHash, r.publisher, r.timestamp);
    }
}
