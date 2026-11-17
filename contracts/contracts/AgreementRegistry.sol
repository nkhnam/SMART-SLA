// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract AgreementRegistry is EIP712 {
    bytes32 private constant APPROVAL_TYPEHASH = keccak256(
        "AgreementApproval(bytes32 agreementKey,bytes32 agreementHash,uint64 version,bytes32 buyerOrganization,bytes32 supplierOrganization,address buyerSigner,address supplierSigner,uint256 nonce,uint64 deadline)"
    );

    struct AgreementApproval {
        bytes32 agreementKey;
        bytes32 agreementHash;
        uint64 version;
        bytes32 buyerOrganization;
        bytes32 supplierOrganization;
        address buyerSigner;
        address supplierSigner;
        uint256 nonce;
        uint64 deadline;
    }

    struct RegisteredAgreement {
        bytes32 agreementHash;
        uint64 version;
        bytes32 buyerOrganization;
        bytes32 supplierOrganization;
        uint64 validUntil;
        uint64 registeredAt;
    }

    address public owner;
    address public publisher;
    mapping(bytes32 agreementKey => RegisteredAgreement agreement) private agreements;

    event AgreementRegistered(
        bytes32 indexed agreementKey,
        bytes32 indexed agreementHash,
        uint64 version,
        bytes32 buyerOrganization,
        bytes32 supplierOrganization,
        uint64 validUntil
    );

    error InvalidApproval();
    error ApprovalExpired(uint64 deadline);
    error AgreementAlreadyRegistered(bytes32 agreementKey);
    error InvalidBuyerSignature();
    error InvalidSupplierSignature();
    error UnauthorizedPublisher();
    error UnauthorizedOwner();

    constructor(address initialPublisher) EIP712("SLA-DEX Agreement Registry", "1") {
        if (initialPublisher == address(0)) revert InvalidApproval();
        owner = msg.sender;
        publisher = initialPublisher;
    }

    function setPublisher(address newPublisher) external {
        if (msg.sender != owner) revert UnauthorizedOwner();
        if (newPublisher == address(0)) revert InvalidApproval();
        publisher = newPublisher;
    }

    function registerAgreement(
        AgreementApproval calldata approval,
        bytes calldata buyerSignature,
        bytes calldata supplierSignature
    ) external {
        if (msg.sender != publisher) revert UnauthorizedPublisher();
        if (
            approval.agreementKey == bytes32(0) || approval.agreementHash == bytes32(0) || approval.version == 0
                || approval.buyerOrganization == bytes32(0) || approval.supplierOrganization == bytes32(0)
                || approval.buyerOrganization == approval.supplierOrganization || approval.buyerSigner == address(0)
                || approval.supplierSigner == address(0) || approval.buyerSigner == approval.supplierSigner
        ) revert InvalidApproval();
        if (block.timestamp > approval.deadline) revert ApprovalExpired(approval.deadline);
        if (agreements[approval.agreementKey].registeredAt != 0) revert AgreementAlreadyRegistered(approval.agreementKey);

        bytes32 structHash = keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                approval.agreementKey,
                approval.agreementHash,
                approval.version,
                approval.buyerOrganization,
                approval.supplierOrganization,
                approval.buyerSigner,
                approval.supplierSigner,
                approval.nonce,
                approval.deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, buyerSignature) != approval.buyerSigner) revert InvalidBuyerSignature();
        if (ECDSA.recover(digest, supplierSignature) != approval.supplierSigner) revert InvalidSupplierSignature();

        agreements[approval.agreementKey] = RegisteredAgreement({
            agreementHash: approval.agreementHash,
            version: approval.version,
            buyerOrganization: approval.buyerOrganization,
            supplierOrganization: approval.supplierOrganization,
            validUntil: approval.deadline,
            registeredAt: uint64(block.timestamp)
        });
        emit AgreementRegistered(
            approval.agreementKey,
            approval.agreementHash,
            approval.version,
            approval.buyerOrganization,
            approval.supplierOrganization,
            approval.deadline
        );
    }

    function getAgreement(bytes32 agreementKey) external view returns (RegisteredAgreement memory) {
        return agreements[agreementKey];
    }
}
