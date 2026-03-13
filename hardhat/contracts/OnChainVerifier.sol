// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// OnChainVerifier - wraps the snarkjs-generated PLONK verifier
// instead of just storing proof URIs, this actually checks the proof on-chain
// way more trustworthy than "trust me bro the proof verified locally"

// in production youd import the actual verifier that snarkjs generates with:
//   snarkjs zkey export solidityverifier circuit.zkey Verifier.sol
// for now we have a mock interface that shows the pattern

interface IPlonkVerifier {
    function verifyProof(
        bytes memory proof,
        uint256[] memory pubSignals
    ) external view returns (bool);
}

contract OnChainVerifier {

    event ProofVerified(
        bytes32 indexed modelHash,
        bool verified,
        address verifier,
        uint256 timestamp
    );

    event VerifierUpdated(
        address oldVerifier,
        address newVerifier
    );

    struct VerificationRecord {
        bytes32 modelHash;
        bool verified;
        address verifier;
        uint256 timestamp;
        uint256[] publicSignals;
    }

    address public owner;
    address public plonkVerifier; // address of the snarkjs-generated verifier contract
    VerificationRecord[] public records;
    mapping(bytes32 => bool) public verified;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _verifier) {
        owner = msg.sender;
        plonkVerifier = _verifier;
    }

    // point to a new verifier contract (when you regenerate circuits)
    function setVerifier(address _verifier) external onlyOwner {
        emit VerifierUpdated(plonkVerifier, _verifier);
        plonkVerifier = _verifier;
    }

    // verify a proof on-chain using the PLONK verifier
    // proof = the raw proof bytes from snarkjs
    // pubSignals = the public inputs (expected_result, etc)
    // modelHash = identifier for this model update
    function verifyAndRecord(
        bytes calldata proof,
        uint256[] calldata pubSignals,
        bytes32 modelHash
    ) external returns (bool) {
        require(!verified[modelHash], "already verified");
        require(plonkVerifier != address(0), "no verifier set");

        bool ok = IPlonkVerifier(plonkVerifier).verifyProof(proof, pubSignals);

        verified[modelHash] = ok;
        records.push(VerificationRecord({
            modelHash: modelHash,
            verified: ok,
            verifier: msg.sender,
            timestamp: block.timestamp,
            publicSignals: pubSignals
        }));

        emit ProofVerified(modelHash, ok, msg.sender, block.timestamp);
        return ok;
    }

    // for cases where you dont have a deployed verifier yet
    // records the proof metadata without actual verification
    // clearly marked as unverified so theres no confusion
    function recordWithoutVerification(
        bytes32 modelHash,
        uint256[] calldata pubSignals,
        string calldata proofUri
    ) external {
        require(!verified[modelHash], "already recorded");

        records.push(VerificationRecord({
            modelHash: modelHash,
            verified: false,
            verifier: msg.sender,
            timestamp: block.timestamp,
            publicSignals: pubSignals
        }));

        emit ProofVerified(modelHash, false, msg.sender, block.timestamp);
    }

    function getRecordCount() external view returns (uint256) {
        return records.length;
    }

    function isVerified(bytes32 modelHash) external view returns (bool) {
        return verified[modelHash];
    }

    function getRecord(uint256 index) external view returns (
        bytes32 modelHash,
        bool isValid,
        address verifier,
        uint256 timestamp
    ) {
        require(index < records.length, "out of bounds");
        VerificationRecord storage r = records[index];
        return (r.modelHash, r.verified, r.verifier, r.timestamp);
    }
}
