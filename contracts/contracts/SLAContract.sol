// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SLAContract - SLA_DEX evidence & challenge window (Polygon L2)
/// @notice Chỉ lưu hash + timestamp + trạng thái. Dữ liệu chi tiết nằm off-chain (Neon).
contract SLAContract {
    enum Status { None, Pending, Challenged, Settled }

    struct Evidence {
        bytes32 slaHash;   // hash hợp đồng SLA liên quan
        uint64 deadline;   // hết hạn Challenge Window (unix time)
        uint32 creditBps;  // service credit đề xuất, đơn vị basis point (100 = 1%)
        Status status;
    }

    address public immutable operator; // ví backend SLA_DEX

    mapping(bytes32 => uint64) public slaRegisteredAt;  // slaHash => thời điểm ghi
    mapping(bytes32 => Evidence) public evidences;      // evidenceHash => bằng chứng

    event SLARegistered(bytes32 indexed slaHash, uint64 timestamp);
    event ViolationRecorded(bytes32 indexed evidenceHash, bytes32 indexed slaHash, uint32 creditBps, uint64 deadline);
    event Challenged(bytes32 indexed evidenceHash);
    event Settled(bytes32 indexed evidenceHash);

    error NotOperator();
    error AlreadyExists();
    error NotFound();
    error WrongStatus();
    error WindowClosed();
    error WindowOpen();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor() {
        operator = msg.sender;
    }

    /// Bước 1: ghi hash hợp đồng SLA khi tạo SLA
    function registerSLA(bytes32 slaHash) external onlyOperator {
        if (slaRegisteredAt[slaHash] != 0) revert AlreadyExists();
        slaRegisteredAt[slaHash] = uint64(block.timestamp);
        emit SLARegistered(slaHash, uint64(block.timestamp));
    }

    /// Bước 2: Oracle phát hiện vi phạm -> ghi bằng chứng + mở Challenge Window
    function recordViolation(
        bytes32 evidenceHash,
        bytes32 slaHash,
        uint32 creditBps,
        uint64 windowSeconds
    ) external onlyOperator {
        if (slaRegisteredAt[slaHash] == 0) revert NotFound();
        if (evidences[evidenceHash].status != Status.None) revert AlreadyExists();
        uint64 deadline = uint64(block.timestamp) + windowSeconds;
        evidences[evidenceHash] = Evidence(slaHash, deadline, creditBps, Status.Pending);
        emit ViolationRecorded(evidenceHash, slaHash, creditBps, deadline);
    }

    /// Bước 3a: một bên phản đối trong thời hạn -> chuyển xử lý ngoại lệ
    function challenge(bytes32 evidenceHash) external onlyOperator {
        Evidence storage e = evidences[evidenceHash];
        if (e.status != Status.Pending) revert WrongStatus();
        if (block.timestamp > e.deadline) revert WindowClosed();
        e.status = Status.Challenged;
        emit Challenged(evidenceHash);
    }

    /// Bước 3b: hết hạn mà không ai phản đối -> tự động chốt kết quả
    function settle(bytes32 evidenceHash) external onlyOperator {
        Evidence storage e = evidences[evidenceHash];
        if (e.status != Status.Pending) revert WrongStatus();
        if (block.timestamp <= e.deadline) revert WindowOpen();
        e.status = Status.Settled;
        emit Settled(evidenceHash);
    }
}
