// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EvidenceRegistry {
    struct EvidenceCommitment {
        bytes32 agreementVersionKey;
        bytes32 merkleRoot;
        bytes32 batchDigest;
        bytes32 schemaVersionHash;
        uint64 agreementVersion;
        uint64 windowStart;
        uint64 windowEnd;
        address reporter;
        uint64 committedAt;
    }

    address public owner;
    address public publisher;
    mapping(bytes32 batchKey => EvidenceCommitment commitment) private commitments;

    event EvidenceCommitted(
        bytes32 indexed batchKey,
        bytes32 indexed agreementVersionKey,
        bytes32 indexed merkleRoot,
        bytes32 batchDigest,
        bytes32 schemaVersionHash,
        uint64 agreementVersion,
        uint64 windowStart,
        uint64 windowEnd,
        address reporter
    );

    error InvalidEvidenceCommitment();
    error EvidenceAlreadyCommitted(bytes32 batchKey);
    error UnauthorizedPublisher();
    error UnauthorizedOwner();

    constructor(address initialPublisher) {
        if (initialPublisher == address(0)) revert InvalidEvidenceCommitment();
        owner = msg.sender;
        publisher = initialPublisher;
    }

    function setPublisher(address newPublisher) external {
        if (msg.sender != owner) revert UnauthorizedOwner();
        if (newPublisher == address(0)) revert InvalidEvidenceCommitment();
        publisher = newPublisher;
    }

    function commitEvidence(
        bytes32 batchKey,
        bytes32 agreementVersionKey,
        bytes32 merkleRoot,
        bytes32 batchDigest,
        bytes32 schemaVersionHash,
        uint64 agreementVersion,
        uint64 windowStart,
        uint64 windowEnd
    ) external {
        if (msg.sender != publisher) revert UnauthorizedPublisher();
        if (batchKey == bytes32(0) || agreementVersionKey == bytes32(0) || merkleRoot == bytes32(0) || batchDigest == bytes32(0) || schemaVersionHash == bytes32(0) || agreementVersion == 0 || windowEnd <= windowStart) {
            revert InvalidEvidenceCommitment();
        }
        if (commitments[batchKey].committedAt != 0) revert EvidenceAlreadyCommitted(batchKey);
        commitments[batchKey] = EvidenceCommitment(agreementVersionKey, merkleRoot, batchDigest, schemaVersionHash, agreementVersion, windowStart, windowEnd, msg.sender, uint64(block.timestamp));
        emit EvidenceCommitted(batchKey, agreementVersionKey, merkleRoot, batchDigest, schemaVersionHash, agreementVersion, windowStart, windowEnd, msg.sender);
    }

    function getCommitment(bytes32 batchKey) external view returns (EvidenceCommitment memory) {
        return commitments[batchKey];
    }
}
