// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SASTypes.sol";

interface ISASBillingForSettlement {
    function executeAgentFromSettlement(
        bytes32 settlementId,
        uint256 agentId,
        address subscriber,
        bytes calldata payload
    ) external payable returns (uint256 executionId);

    function finalizeExecutionSettlement(
        uint256 executionId,
        SASTypes.ExecutionStatus finalStatus,
        bool releaseToBuilder,
        bool refundSubscriber
    ) external;

    function getExecutionProposal(uint256 executionId)
        external
        view
        returns (
            SASTypes.ExecutionStatus status,
            bytes memory result,
            uint256 somniaRequestId,
            uint256 proposedAt,
            bool exists
        );
}

interface ISASVerifierRegistryForSettlement {
    function isVerifier(address verifier) external view returns (bool);
    function recordReport(address verifier, bool agreed) external;
}

interface ISASExecutionGraphForSettlement {
    function createWorkflow(
        uint256 rootExecutionId,
        uint256 rootAgentId,
        address requester,
        bytes32 parentWorkflowId,
        string calldata metadataURI
    ) external returns (bytes32 workflowId);

    function addWorkflowEdge(
        bytes32 workflowId,
        uint256 fromExecutionId,
        uint256 toExecutionId,
        uint256 fromAgentId,
        uint256 toAgentId,
        bytes32 relationType,
        string calldata metadataURI
    ) external;

    function finalizeWorkflow(
        bytes32 workflowId,
        bool success,
        bytes32 resultHash,
        string calldata metadataURI
    ) external;
}

/// @title SASSettlement
/// @notice Escrow + verifier-gated autonomous settlement layer.
contract SASSettlement is Ownable, ReentrancyGuard {
    enum SettlementStatus {
        OPEN,
        VERIFYING,
        RELEASED,
        REFUNDED,
        CANCELLED
    }

    struct Settlement {
        bytes32 id;
        bytes32 parentSettlementId;
        bytes32 workflowId;
        uint256 agentId;
        uint256 executionId;
        uint256 amount;
        address requester;
        address subscriber;
        uint256 minApprovals;
        uint256 minRejections;
        uint256 approvals;
        uint256 rejections;
        uint256 createdAt;
        uint256 expiresAt;
        SettlementStatus status;
    }

    ISASBillingForSettlement public billing;
    ISASVerifierRegistryForSettlement public verifierRegistry;
    ISASExecutionGraphForSettlement public executionGraph;

    uint256 public settlementNonce;
    mapping(bytes32 => Settlement) public settlements;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(address => bool) public executors;

    event BillingUpdated(address indexed billing);
    event VerifierRegistryUpdated(address indexed verifierRegistry);
    event ExecutionGraphUpdated(address indexed executionGraph);
    event ExecutorUpdated(address indexed executor, bool allowed);
    event SettlementCreated(
        bytes32 indexed settlementId,
        bytes32 indexed parentSettlementId,
        uint256 indexed agentId,
        address requester,
        address subscriber,
        uint256 amount,
        uint256 expiresAt
    );
    event SettlementComposed(bytes32 indexed parentSettlementId, bytes32 indexed childSettlementId);
    event SettlementExecuted(bytes32 indexed settlementId, uint256 indexed executionId);
    event VerificationSubmitted(
        bytes32 indexed settlementId,
        address indexed verifier,
        bool approve,
        uint256 approvals,
        uint256 rejections,
        string evidenceURI
    );
    event SettlementFinalized(
        bytes32 indexed settlementId,
        uint256 indexed executionId,
        bool releasedToBuilder,
        bool refundedSubscriber,
        SASTypes.ExecutionStatus finalStatus
    );
    event SettlementCancelled(bytes32 indexed settlementId);

    modifier onlySettlementExecutor(bytes32 settlementId) {
        Settlement storage s = settlements[settlementId];
        require(s.id != 0, "SASSettlement: settlement missing");
        require(
            msg.sender == s.requester || executors[msg.sender],
            "SASSettlement: not authorized executor"
        );
        _;
    }

    constructor(
        address initialOwner,
        address billingAddress,
        address verifierRegistryAddress
    ) Ownable(initialOwner) {
        require(billingAddress != address(0), "SASSettlement: zero billing");
        require(verifierRegistryAddress != address(0), "SASSettlement: zero verifier registry");
        billing = ISASBillingForSettlement(billingAddress);
        verifierRegistry = ISASVerifierRegistryForSettlement(verifierRegistryAddress);
        executors[initialOwner] = true;
    }

    function setBilling(address billingAddress) external onlyOwner {
        require(billingAddress != address(0), "SASSettlement: zero billing");
        billing = ISASBillingForSettlement(billingAddress);
        emit BillingUpdated(billingAddress);
    }

    function setVerifierRegistry(address verifierRegistryAddress) external onlyOwner {
        require(verifierRegistryAddress != address(0), "SASSettlement: zero verifier registry");
        verifierRegistry = ISASVerifierRegistryForSettlement(verifierRegistryAddress);
        emit VerifierRegistryUpdated(verifierRegistryAddress);
    }

    function setExecutionGraph(address executionGraphAddress) external onlyOwner {
        executionGraph = ISASExecutionGraphForSettlement(executionGraphAddress);
        emit ExecutionGraphUpdated(executionGraphAddress);
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        require(executor != address(0), "SASSettlement: zero executor");
        executors[executor] = allowed;
        emit ExecutorUpdated(executor, allowed);
    }

    function createSettlement(
        uint256 agentId,
        address subscriber,
        uint256 minApprovals,
        uint256 minRejections,
        uint256 expiresAt,
        bytes32 parentSettlementId
    ) external payable returns (bytes32 settlementId) {
        require(msg.value > 0, "SASSettlement: zero amount");
        require(agentId > 0, "SASSettlement: invalid agent");
        require(expiresAt > block.timestamp, "SASSettlement: invalid expiry");
        require(minApprovals > 0 || minRejections > 0, "SASSettlement: invalid thresholds");

        if (parentSettlementId != bytes32(0)) {
            Settlement storage parent = settlements[parentSettlementId];
            require(parent.id != 0, "SASSettlement: parent missing");
            require(
                parent.status == SettlementStatus.OPEN || parent.status == SettlementStatus.VERIFYING,
                "SASSettlement: parent inactive"
            );
        }

        settlementNonce++;
        settlementId = _computeSettlementId(
            msg.sender,
            agentId,
            subscriber == address(0) ? msg.sender : subscriber,
            settlementNonce
        );

        settlements[settlementId] = Settlement({
            id: settlementId,
            parentSettlementId: parentSettlementId,
            workflowId: bytes32(0),
            agentId: agentId,
            executionId: 0,
            amount: msg.value,
            requester: msg.sender,
            subscriber: subscriber == address(0) ? msg.sender : subscriber,
            minApprovals: minApprovals,
            minRejections: minRejections,
            approvals: 0,
            rejections: 0,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            status: SettlementStatus.OPEN
        });

        emit SettlementCreated(
            settlementId,
            parentSettlementId,
            agentId,
            msg.sender,
            subscriber == address(0) ? msg.sender : subscriber,
            msg.value,
            expiresAt
        );
        if (parentSettlementId != bytes32(0)) {
            emit SettlementComposed(parentSettlementId, settlementId);
        }
    }

    function executeSettlement(bytes32 settlementId, bytes calldata payload)
        external
        nonReentrant
        onlySettlementExecutor(settlementId)
        returns (uint256 executionId)
    {
        Settlement storage s = settlements[settlementId];
        require(s.status == SettlementStatus.OPEN, "SASSettlement: settlement not open");
        require(block.timestamp <= s.expiresAt, "SASSettlement: settlement expired");

        executionId = billing.executeAgentFromSettlement{value: s.amount}(
            settlementId,
            s.agentId,
            s.subscriber,
            payload
        );

        s.executionId = executionId;
        s.status = SettlementStatus.VERIFYING;
        emit SettlementExecuted(settlementId, executionId);

        if (address(executionGraph) != address(0)) {
            bytes32 parentWorkflowId = bytes32(0);
            uint256 parentExecutionId = 0;
            uint256 parentAgentId = 0;
            if (s.parentSettlementId != bytes32(0)) {
                Settlement storage parent = settlements[s.parentSettlementId];
                parentWorkflowId = parent.workflowId;
                parentExecutionId = parent.executionId;
                parentAgentId = parent.agentId;
            }

            bytes32 workflowId = executionGraph.createWorkflow(
                executionId,
                s.agentId,
                s.requester,
                parentWorkflowId,
                ""
            );
            s.workflowId = workflowId;

            if (parentExecutionId > 0) {
                executionGraph.addWorkflowEdge(
                    workflowId,
                    parentExecutionId,
                    executionId,
                    parentAgentId,
                    s.agentId,
                    keccak256("PARENT_CHILD"),
                    ""
                );
            }
        }
    }

    function submitVerification(
        bytes32 settlementId,
        bool approve,
        string calldata evidenceURI
    ) external {
        Settlement storage s = settlements[settlementId];
        require(s.id != 0, "SASSettlement: settlement missing");
        require(s.status == SettlementStatus.VERIFYING, "SASSettlement: settlement not verifying");
        require(s.executionId > 0, "SASSettlement: execution missing");
        require(block.timestamp <= s.expiresAt, "SASSettlement: verification window closed");
        require(verifierRegistry.isVerifier(msg.sender), "SASSettlement: not active verifier");
        require(!hasVoted[settlementId][msg.sender], "SASSettlement: verifier already voted");

        hasVoted[settlementId][msg.sender] = true;
        if (approve) {
            s.approvals += 1;
        } else {
            s.rejections += 1;
        }

        // Best-effort metrics update. Settlement flow should not fail if writer role is not configured yet.
        try verifierRegistry.recordReport(msg.sender, approve) {} catch {}

        emit VerificationSubmitted(
            settlementId,
            msg.sender,
            approve,
            s.approvals,
            s.rejections,
            evidenceURI
        );

        if (s.minApprovals > 0 && s.approvals >= s.minApprovals) {
            _finalizeSettlement(settlementId, true, false);
            return;
        }
        if (s.minRejections > 0 && s.rejections >= s.minRejections) {
            _finalizeSettlement(settlementId, false, true);
        }
    }

    function forceFinalizeExpired(bytes32 settlementId, bool preferRelease) external nonReentrant {
        Settlement storage s = settlements[settlementId];
        require(s.id != 0, "SASSettlement: settlement missing");
        require(block.timestamp > s.expiresAt, "SASSettlement: not expired");

        if (s.status == SettlementStatus.OPEN) {
            s.status = SettlementStatus.CANCELLED;
            (bool ok, ) = payable(s.requester).call{value: s.amount}("");
            require(ok, "SASSettlement: cancel refund failed");
            emit SettlementCancelled(settlementId);
            return;
        }

        require(s.status == SettlementStatus.VERIFYING, "SASSettlement: settlement already finalized");
        _finalizeSettlement(settlementId, preferRelease, true);
    }

    function cancelSettlement(bytes32 settlementId) external nonReentrant {
        Settlement storage s = settlements[settlementId];
        require(s.id != 0, "SASSettlement: settlement missing");
        require(s.status == SettlementStatus.OPEN, "SASSettlement: settlement not open");
        require(msg.sender == s.requester || msg.sender == owner(), "SASSettlement: not allowed");

        s.status = SettlementStatus.CANCELLED;
        (bool ok, ) = payable(s.requester).call{value: s.amount}("");
        require(ok, "SASSettlement: cancel refund failed");
        emit SettlementCancelled(settlementId);
    }

    function previewNextSettlementId(
        address requester,
        uint256 agentId,
        address subscriber
    ) external view returns (bytes32) {
        return _computeSettlementId(requester, agentId, subscriber, settlementNonce + 1);
    }

    function _finalizeSettlement(bytes32 settlementId, bool preferRelease, bool forceRefund) internal {
        Settlement storage s = settlements[settlementId];

        bool releaseToBuilder = false;
        bool refundSubscriber = true;
        SASTypes.ExecutionStatus finalStatus = SASTypes.ExecutionStatus.FAILED;

        if (!forceRefund && preferRelease) {
            releaseToBuilder = true;
            refundSubscriber = false;
            finalStatus = SASTypes.ExecutionStatus.SUCCESS;
        }

        billing.finalizeExecutionSettlement(
            s.executionId,
            finalStatus,
            releaseToBuilder,
            refundSubscriber
        );

        s.status = releaseToBuilder ? SettlementStatus.RELEASED : SettlementStatus.REFUNDED;

        if (address(executionGraph) != address(0) && s.workflowId != bytes32(0)) {
            executionGraph.finalizeWorkflow(s.workflowId, releaseToBuilder, bytes32(0), "");
        }

        emit SettlementFinalized(
            settlementId,
            s.executionId,
            releaseToBuilder,
            refundSubscriber,
            finalStatus
        );
    }

    function _computeSettlementId(
        address requester,
        uint256 agentId,
        address subscriber,
        uint256 nonce
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                requester,
                agentId,
                subscriber,
                nonce
            )
        );
    }
}
