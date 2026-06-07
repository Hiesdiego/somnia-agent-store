// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./SASTypes.sol";
import "./SASRegistry.sol";
import "./SASExecutor.sol";

/// @title SASBilling
/// @notice Payment and execution accounting for SAS.
/// @dev Supports direct billing and settlement-managed escrow billing.
contract SASBilling is Ownable, ReentrancyGuard, Pausable {
    using SASTypes for *;

    uint256 public constant PLATFORM_FEE_BPS = 1500; // 15%
    uint256 public constant BPS_DENOMINATOR = 10000;

    SASRegistry public immutable registry;
    SASExecutor public executor;

    address public treasury;
    address public settlementContract;

    mapping(address => uint256) public builderBalances;
    uint256 public treasuryBalance;

    uint256 public executionCount;
    uint256 public cumulativeRevenue;
    uint256 public cumulativeRuntimeBudget;

    mapping(uint256 => SASTypes.ExecutionRecord) private _executions;
    mapping(address => uint256[]) private _userExecutions;
    mapping(uint256 => uint256[]) private _agentExecutions;

    struct PendingSettlement {
        uint256 executionId;
        uint256 agentId;
        address subscriber;
        address builder;
        uint256 amountPaid;
        uint256 agentFee;
        uint256 runtimeBudget;
        uint256 builderRevenue;
        uint256 platformFee;
        bool exists;
        bool finalized;
    }

    struct ExecutionCharge {
        uint256 agentFee;
        uint256 runtimeBudget;
        uint256 totalPaid;
    }

    struct ExecutionProposal {
        SASTypes.ExecutionStatus status;
        bytes result;
        uint256 somniaRequestId;
        uint256 proposedAt;
        bool exists;
    }

    mapping(uint256 => PendingSettlement) private _pendingSettlements;
    mapping(uint256 => ExecutionProposal) private _executionProposals;
    mapping(uint256 => ExecutionCharge) private _executionCharges;

    event AgentExecutionRequested(
        uint256 indexed executionId,
        uint256 indexed agentId,
        address indexed subscriber,
        uint256 amountPaid,
        uint256 builderRevenue,
        uint256 platformFee
    );

    event ExecutionStatusUpdated(
        uint256 indexed executionId,
        SASTypes.ExecutionStatus status,
        bytes result
    );

    event ExecutionPaymentBreakdown(
        uint256 indexed executionId,
        uint256 agentFee,
        uint256 runtimeBudget,
        uint256 totalPaid
    );

    event BuilderWithdrawal(address indexed builder, uint256 amount);
    event TreasuryWithdrawal(address indexed to, uint256 amount);
    event ExecutorUpdated(address indexed executor);
    event TreasuryUpdated(address indexed treasury);
    event SettlementContractUpdated(address indexed settlementContract);
    event ExecutionProposedForSettlement(
        uint256 indexed executionId,
        SASTypes.ExecutionStatus proposedStatus,
        uint256 somniaRequestId
    );
    event SettlementExecutionCreated(
        uint256 indexed executionId,
        bytes32 indexed settlementId,
        uint256 indexed agentId,
        address subscriber,
        uint256 amountPaid
    );
    event SettlementExecutionFinalized(
        uint256 indexed executionId,
        bool releasedToBuilder,
        bool refundedSubscriber
    );

    modifier onlyExecutor() {
        require(msg.sender == address(executor), "SASBilling: caller is not executor");
        _;
    }

    modifier onlySettlement() {
        require(msg.sender == settlementContract, "SASBilling: caller is not settlement");
        _;
    }

    constructor(
        address initialOwner,
        address _registry,
        address _treasury
    ) Ownable(initialOwner) {
        require(_registry != address(0), "SASBilling: zero registry");
        require(_treasury != address(0), "SASBilling: zero treasury");
        registry = SASRegistry(_registry);
        treasury = _treasury;
    }

    function setExecutor(address _executor) external onlyOwner {
        require(_executor != address(0), "SASBilling: zero executor");
        executor = SASExecutor(payable(_executor));
        emit ExecutorUpdated(_executor);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "SASBilling: zero treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setSettlementContract(address _settlementContract) external onlyOwner {
        require(_settlementContract != address(0), "SASBilling: zero settlement");
        settlementContract = _settlementContract;
        emit SettlementContractUpdated(_settlementContract);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function executeAgent(
        uint256 agentId,
        bytes calldata payload
    ) external payable whenNotPaused nonReentrant returns (uint256 executionId) {
        require(address(executor) != address(0), "SASBilling: executor not set");
        require(registry.isAgentActive(agentId), "SASBilling: agent not active");

        SASTypes.AgentConfig memory agent = registry.getAgent(agentId);
        (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost) = _quoteExecution(agent);
        require(msg.value == totalCost, "SASBilling: incorrect payment amount");

        uint256 platformFee = (agentFee * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 builderRevenue = agentFee - platformFee;

        builderBalances[agent.builder] += builderRevenue;
        treasuryBalance += platformFee;

        executionId = _createExecutionRecord(agentId, msg.sender, payload, agentFee, runtimeBudget, totalCost, true);
        registry.recordExecution(agentId, agentFee);

        emit AgentExecutionRequested(
            executionId,
            agentId,
            msg.sender,
            msg.value,
            builderRevenue,
            platformFee
        );

        executor.execute{value: runtimeBudget}(executionId, agent, msg.sender, payload);
    }

    function executeAgentFromSettlement(
        bytes32 settlementId,
        uint256 agentId,
        address subscriber,
        bytes calldata payload
    ) external payable onlySettlement whenNotPaused nonReentrant returns (uint256 executionId) {
        require(address(executor) != address(0), "SASBilling: executor not set");
        require(subscriber != address(0), "SASBilling: zero subscriber");
        require(registry.isAgentActive(agentId), "SASBilling: agent not active");

        SASTypes.AgentConfig memory agent = registry.getAgent(agentId);
        (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost) = _quoteExecution(agent);
        require(msg.value == totalCost, "SASBilling: incorrect settlement payment amount");

        uint256 platformFee = (agentFee * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 builderRevenue = agentFee - platformFee;

        executionId = _createExecutionRecord(agentId, subscriber, payload, agentFee, runtimeBudget, totalCost, false);
        _pendingSettlements[executionId] = PendingSettlement({
            executionId: executionId,
            agentId: agentId,
            subscriber: subscriber,
            builder: agent.builder,
            amountPaid: totalCost,
            agentFee: agentFee,
            runtimeBudget: runtimeBudget,
            builderRevenue: builderRevenue,
            platformFee: platformFee,
            exists: true,
            finalized: false
        });

        emit SettlementExecutionCreated(executionId, settlementId, agentId, subscriber, totalCost);
        executor.execute{value: runtimeBudget}(executionId, agent, subscriber, payload);
    }

    function resolveExecution(
        uint256 executionId,
        SASTypes.ExecutionStatus status,
        bytes calldata result,
        uint256 somniaRequestId
    ) external onlyExecutor {
        SASTypes.ExecutionRecord storage rec = _executions[executionId];
        require(rec.id != 0, "SASBilling: execution not found");
        require(rec.status == SASTypes.ExecutionStatus.PENDING, "SASBilling: already resolved");

        if (_pendingSettlements[executionId].exists) {
            require(!_executionProposals[executionId].exists, "SASBilling: proposal already exists");
            _executionProposals[executionId] = ExecutionProposal({
                status: status,
                result: result,
                somniaRequestId: somniaRequestId,
                proposedAt: block.timestamp,
                exists: true
            });
            emit ExecutionProposedForSettlement(executionId, status, somniaRequestId);
            return;
        }

        rec.status = status;
        rec.result = result;
        rec.resolvedAt = block.timestamp;
        rec.somniaRequestId = somniaRequestId;

        emit ExecutionStatusUpdated(executionId, status, result);
    }

    function finalizeExecutionSettlement(
        uint256 executionId,
        SASTypes.ExecutionStatus finalStatus,
        bool releaseToBuilder,
        bool refundSubscriber
    ) external onlySettlement nonReentrant {
        require(finalStatus != SASTypes.ExecutionStatus.PENDING, "SASBilling: invalid final status");
        require(releaseToBuilder != refundSubscriber, "SASBilling: choose release OR refund");

        PendingSettlement storage pending = _pendingSettlements[executionId];
        require(pending.exists, "SASBilling: settlement not found");
        require(!pending.finalized, "SASBilling: settlement already finalized");

        SASTypes.ExecutionRecord storage rec = _executions[executionId];
        require(rec.id != 0, "SASBilling: execution not found");
        require(rec.status == SASTypes.ExecutionStatus.PENDING, "SASBilling: already resolved");

        ExecutionProposal storage proposal = _executionProposals[executionId];
        if (!proposal.exists) {
            require(refundSubscriber, "SASBilling: proposal missing for release");
            require(finalStatus != SASTypes.ExecutionStatus.SUCCESS, "SASBilling: invalid success without proposal");
        }

        rec.status = finalStatus;
        rec.result = proposal.exists ? proposal.result : bytes("");
        rec.resolvedAt = block.timestamp;
        rec.somniaRequestId = proposal.exists ? proposal.somniaRequestId : 0;

        pending.finalized = true;

        if (releaseToBuilder) {
            builderBalances[pending.builder] += pending.builderRevenue;
            treasuryBalance += pending.platformFee;
            cumulativeRevenue += pending.agentFee;
            registry.recordExecution(pending.agentId, pending.agentFee);
        } else {
            // The runtime budget was already forwarded to Somnia when execution began.
            // Only the escrowed agent fee remains refundable.
            (bool ok, ) = payable(pending.subscriber).call{value: pending.agentFee}("");
            require(ok, "SASBilling: refund failed");
        }

        emit ExecutionStatusUpdated(executionId, finalStatus, rec.result);
        emit SettlementExecutionFinalized(executionId, releaseToBuilder, refundSubscriber);
    }

    function builderWithdraw() external nonReentrant {
        uint256 amount = builderBalances[msg.sender];
        require(amount > 0, "SASBilling: no balance to withdraw");

        builderBalances[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "SASBilling: transfer failed");

        emit BuilderWithdrawal(msg.sender, amount);
    }

    function adminWithdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "SASBilling: amount must be > 0");
        require(amount <= treasuryBalance, "SASBilling: insufficient treasury");

        treasuryBalance -= amount;
        (bool ok, ) = payable(treasury).call{value: amount}("");
        require(ok, "SASBilling: transfer failed");

        emit TreasuryWithdrawal(treasury, amount);
    }

    function getExecutionRecord(uint256 executionId)
        external
        view
        returns (SASTypes.ExecutionRecord memory)
    {
        return _executions[executionId];
    }

    function getExecutionProposal(uint256 executionId)
        external
        view
        returns (ExecutionProposal memory)
    {
        return _executionProposals[executionId];
    }

    function getPendingSettlement(uint256 executionId)
        external
        view
        returns (PendingSettlement memory)
    {
        return _pendingSettlements[executionId];
    }

    function getExecutionCharge(uint256 executionId)
        external
        view
        returns (ExecutionCharge memory)
    {
        return _executionCharges[executionId];
    }

    function quoteExecution(uint256 agentId)
        external
        view
        returns (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost)
    {
        require(address(executor) != address(0), "SASBilling: executor not set");
        SASTypes.AgentConfig memory agent = registry.getAgent(agentId);
        return _quoteExecution(agent);
    }

    function getUserExecutions(address user)
        external
        view
        returns (SASTypes.ExecutionRecord[] memory records)
    {
        uint256[] storage ids = _userExecutions[user];
        records = new SASTypes.ExecutionRecord[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            records[i] = _executions[ids[i]];
        }
    }

    function getAgentExecutions(uint256 agentId)
        external
        view
        returns (SASTypes.ExecutionRecord[] memory records)
    {
        uint256[] storage ids = _agentExecutions[agentId];
        records = new SASTypes.ExecutionRecord[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            records[i] = _executions[ids[i]];
        }
    }

    function getPlatformStats()
        external
        view
        returns (
            uint256 totalExecutions,
            uint256 totalRevenue,
            uint256 _treasuryBalance,
            uint256 agentCount
        )
    {
        totalExecutions = executionCount;
        totalRevenue = cumulativeRevenue;
        _treasuryBalance = treasuryBalance;
        agentCount = registry.agentCount();
    }

    receive() external payable {}

    function _createExecutionRecord(
        uint256 agentId,
        address subscriber,
        bytes calldata payload,
        uint256 agentFee,
        uint256 runtimeBudget,
        uint256 totalPaid,
        bool recognizeAgentRevenue
    ) internal returns (uint256 executionId) {
        executionCount++;
        executionId = executionCount;
        if (recognizeAgentRevenue) {
            cumulativeRevenue += agentFee;
        }
        cumulativeRuntimeBudget += runtimeBudget;

        _executions[executionId] = SASTypes.ExecutionRecord({
            id: executionId,
            agentId: agentId,
            subscriber: subscriber,
            payload: payload,
            status: SASTypes.ExecutionStatus.PENDING,
            result: "",
            createdAt: block.timestamp,
            resolvedAt: 0,
            amountPaid: totalPaid,
            somniaRequestId: 0
        });
        _executionCharges[executionId] = ExecutionCharge({
            agentFee: agentFee,
            runtimeBudget: runtimeBudget,
            totalPaid: totalPaid
        });

        _userExecutions[subscriber].push(executionId);
        _agentExecutions[agentId].push(executionId);
        emit ExecutionPaymentBreakdown(executionId, agentFee, runtimeBudget, totalPaid);
    }

    function _quoteExecution(SASTypes.AgentConfig memory agent)
        internal
        view
        returns (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost)
    {
        agentFee = agent.pricePerExecution;
        runtimeBudget = executor.quoteRuntimeBudget(agent.agentType);
        totalCost = agentFee + runtimeBudget;
    }
}
