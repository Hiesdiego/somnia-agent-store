// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./SASTypes.sol";

interface ISASBillingAutonomyV4 {
    function executeAgent(uint256 agentId, bytes calldata payload)
        external
        payable
        returns (uint256 executionId);

    function quoteExecution(uint256 agentId)
        external
        view
        returns (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost);
}

interface ISASRegistryAutonomyV4 {
    function getAgent(uint256 agentId) external view returns (SASTypes.AgentConfig memory);
    function isAgentActive(uint256 agentId) external view returns (bool);
}

interface ISASExecutionGraphAutonomyV4 {
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

/// @title SASAutonomyV4
/// @notice Multi-agent autonomy orchestrator with step budgets and deterministic split payouts.
/// @dev This layer executes SAS-listed agents via SASBilling while keeping a workflow
///      budget, hierarchical step graph, and per-step revenue share payouts for
///      beneficiary agent builders.
contract SASAutonomyV4 is Ownable, ReentrancyGuard, Pausable {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum WorkflowStatus {
        ACTIVE,
        PAUSED,
        FINALIZED,
        CANCELLED
    }

    struct Workflow {
        uint256 id;
        address requester;
        uint256 rootAgentId;
        uint256 maxDepth;
        uint256 budgetTotal;
        uint256 budgetRemaining;
        uint256 spentExecution;
        uint256 spentSplits;
        uint256 stepCount;
        uint256 createdAt;
        WorkflowStatus status;
        bytes32 graphWorkflowId;
        bytes32 parentGraphWorkflowId;
        string metadataURI;
    }

    struct Step {
        uint256 id;
        uint256 workflowId;
        uint256 parentStepId;
        uint256 fromAgentId;
        uint256 toAgentId;
        uint256 depth;
        uint256 maxTotalCost;
        uint256 splitBpsTotal;
        bool executed;
        uint256 executionId;
        uint256 chargedAgentFee;
        uint256 chargedRuntimeBudget;
        uint256 chargedTotalCost;
        uint256 chargedSplitTotal;
        bytes32 payloadHash;
        bytes32 relationType;
        uint256 createdAt;
        string metadataURI;
    }

    struct SplitRule {
        uint256 beneficiaryAgentId;
        uint256 bps;
    }

    ISASBillingAutonomyV4 public immutable billing;
    ISASRegistryAutonomyV4 public immutable registry;
    ISASExecutionGraphAutonomyV4 public executionGraph;

    uint256 public workflowCount;
    uint256 public stepCount;

    mapping(uint256 => Workflow) public workflows;
    mapping(uint256 => Step) public steps;
    mapping(uint256 => uint256[]) private _workflowStepIds;
    mapping(uint256 => SplitRule[]) private _stepSplits;

    /// @notice Platform/operator executors allowed across workflows.
    mapping(address => bool) public executors;
    /// @notice Workflow-local executors allowed by requester/admin.
    mapping(uint256 => mapping(address => bool)) public workflowExecutors;

    /// @notice Builder split balances (withdrawable STT).
    mapping(address => uint256) public splitBalances;
    /// @notice Cumulative split revenue tracked by beneficiary agent.
    mapping(uint256 => uint256) public agentSplitRevenue;

    event ExecutorUpdated(address indexed executor, bool allowed);
    event WorkflowExecutorUpdated(uint256 indexed workflowId, address indexed executor, bool allowed);
    event ExecutionGraphUpdated(address indexed executionGraph);

    event WorkflowCreated(
        uint256 indexed workflowId,
        address indexed requester,
        uint256 indexed rootAgentId,
        uint256 budget,
        uint256 maxDepth,
        bytes32 parentGraphWorkflowId,
        string metadataURI
    );
    event WorkflowFunded(uint256 indexed workflowId, address indexed funder, uint256 amount, uint256 newBalance);
    event WorkflowStatusChanged(uint256 indexed workflowId, WorkflowStatus status);
    event WorkflowFinalized(
        uint256 indexed workflowId,
        bool success,
        bytes32 resultHash,
        string metadataURI
    );

    event StepPlanned(
        uint256 indexed workflowId,
        uint256 indexed stepId,
        uint256 indexed toAgentId,
        uint256 parentStepId,
        uint256 fromAgentId,
        uint256 depth,
        uint256 maxTotalCost,
        bytes32 payloadHash,
        bytes32 relationType,
        string metadataURI
    );
    event StepSplitAdded(
        uint256 indexed stepId,
        uint256 indexed beneficiaryAgentId,
        uint256 bps,
        uint256 totalBps
    );
    event StepExecuted(
        uint256 indexed workflowId,
        uint256 indexed stepId,
        uint256 indexed executionId,
        uint256 agentFee,
        uint256 runtimeBudget,
        uint256 totalCost,
        uint256 splitTotal,
        uint256 remainingBudget
    );
    event StepSplitAccrued(
        uint256 indexed workflowId,
        uint256 indexed stepId,
        uint256 indexed beneficiaryAgentId,
        address beneficiaryBuilder,
        uint256 amount
    );
    event SplitWithdrawn(address indexed builder, address indexed to, uint256 amount);

    modifier workflowExists(uint256 workflowId) {
        require(workflows[workflowId].requester != address(0), "SASAutonomyV4: workflow missing");
        _;
    }

    modifier stepExists(uint256 stepId) {
        require(steps[stepId].workflowId != 0, "SASAutonomyV4: step missing");
        _;
    }

    modifier onlyWorkflowOperator(uint256 workflowId) {
        Workflow storage wf = workflows[workflowId];
        require(
            msg.sender == owner()
                || msg.sender == wf.requester
                || executors[msg.sender]
                || workflowExecutors[workflowId][msg.sender],
            "SASAutonomyV4: not workflow operator"
        );
        _;
    }

    constructor(
        address initialOwner,
        address billingAddress,
        address registryAddress,
        address executionGraphAddress
    ) Ownable(initialOwner) {
        require(billingAddress != address(0), "SASAutonomyV4: zero billing");
        require(registryAddress != address(0), "SASAutonomyV4: zero registry");
        billing = ISASBillingAutonomyV4(billingAddress);
        registry = ISASRegistryAutonomyV4(registryAddress);
        executionGraph = ISASExecutionGraphAutonomyV4(executionGraphAddress);
        executors[initialOwner] = true;
    }

    receive() external payable {
        revert("SASAutonomyV4: use createWorkflow/fundWorkflow");
    }

    function setExecutionGraph(address executionGraphAddress) external onlyOwner {
        executionGraph = ISASExecutionGraphAutonomyV4(executionGraphAddress);
        emit ExecutionGraphUpdated(executionGraphAddress);
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        require(executor != address(0), "SASAutonomyV4: zero executor");
        executors[executor] = allowed;
        emit ExecutorUpdated(executor, allowed);
    }

    function setWorkflowExecutor(
        uint256 workflowId,
        address executor,
        bool allowed
    ) external workflowExists(workflowId) onlyWorkflowOperator(workflowId) {
        require(executor != address(0), "SASAutonomyV4: zero executor");
        workflowExecutors[workflowId][executor] = allowed;
        emit WorkflowExecutorUpdated(workflowId, executor, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createWorkflow(
        uint256 rootAgentId,
        uint256 maxDepth,
        bytes32 parentGraphWorkflowId,
        string calldata metadataURI
    ) external payable whenNotPaused nonReentrant returns (uint256 workflowId) {
        require(msg.value > 0, "SASAutonomyV4: zero budget");
        require(maxDepth > 0, "SASAutonomyV4: invalid depth");
        require(rootAgentId > 0, "SASAutonomyV4: invalid root agent");
        require(registry.isAgentActive(rootAgentId), "SASAutonomyV4: inactive root agent");

        workflowCount++;
        workflowId = workflowCount;

        workflows[workflowId] = Workflow({
            id: workflowId,
            requester: msg.sender,
            rootAgentId: rootAgentId,
            maxDepth: maxDepth,
            budgetTotal: msg.value,
            budgetRemaining: msg.value,
            spentExecution: 0,
            spentSplits: 0,
            stepCount: 0,
            createdAt: block.timestamp,
            status: WorkflowStatus.ACTIVE,
            graphWorkflowId: bytes32(0),
            parentGraphWorkflowId: parentGraphWorkflowId,
            metadataURI: metadataURI
        });

        workflowExecutors[workflowId][msg.sender] = true;

        emit WorkflowCreated(
            workflowId,
            msg.sender,
            rootAgentId,
            msg.value,
            maxDepth,
            parentGraphWorkflowId,
            metadataURI
        );
    }

    function fundWorkflow(uint256 workflowId)
        external
        payable
        whenNotPaused
        nonReentrant
        workflowExists(workflowId)
    {
        require(msg.value > 0, "SASAutonomyV4: zero funding");

        Workflow storage wf = workflows[workflowId];
        require(
            wf.status == WorkflowStatus.ACTIVE || wf.status == WorkflowStatus.PAUSED,
            "SASAutonomyV4: workflow closed"
        );

        wf.budgetTotal += msg.value;
        wf.budgetRemaining += msg.value;
        emit WorkflowFunded(workflowId, msg.sender, msg.value, wf.budgetRemaining);
    }

    function pauseWorkflow(uint256 workflowId)
        external
        workflowExists(workflowId)
        onlyWorkflowOperator(workflowId)
    {
        Workflow storage wf = workflows[workflowId];
        require(wf.status == WorkflowStatus.ACTIVE, "SASAutonomyV4: workflow not active");
        wf.status = WorkflowStatus.PAUSED;
        emit WorkflowStatusChanged(workflowId, WorkflowStatus.PAUSED);
    }

    function resumeWorkflow(uint256 workflowId)
        external
        workflowExists(workflowId)
        onlyWorkflowOperator(workflowId)
    {
        Workflow storage wf = workflows[workflowId];
        require(wf.status == WorkflowStatus.PAUSED, "SASAutonomyV4: workflow not paused");
        wf.status = WorkflowStatus.ACTIVE;
        emit WorkflowStatusChanged(workflowId, WorkflowStatus.ACTIVE);
    }

    function cancelWorkflow(uint256 workflowId)
        external
        nonReentrant
        workflowExists(workflowId)
        onlyWorkflowOperator(workflowId)
    {
        Workflow storage wf = workflows[workflowId];
        require(
            wf.status == WorkflowStatus.ACTIVE || wf.status == WorkflowStatus.PAUSED,
            "SASAutonomyV4: workflow closed"
        );
        wf.status = WorkflowStatus.CANCELLED;

        uint256 refund = wf.budgetRemaining;
        wf.budgetRemaining = 0;
        if (refund > 0) {
            (bool ok, ) = payable(wf.requester).call{value: refund}("");
            require(ok, "SASAutonomyV4: refund failed");
        }

        if (address(executionGraph) != address(0) && wf.graphWorkflowId != bytes32(0)) {
            executionGraph.finalizeWorkflow(wf.graphWorkflowId, false, bytes32(0), "workflow-cancelled");
        }

        emit WorkflowStatusChanged(workflowId, WorkflowStatus.CANCELLED);
    }

    function finalizeWorkflow(
        uint256 workflowId,
        bool success,
        bytes32 resultHash,
        string calldata metadataURI
    ) external workflowExists(workflowId) onlyWorkflowOperator(workflowId) {
        Workflow storage wf = workflows[workflowId];
        require(
            wf.status == WorkflowStatus.ACTIVE || wf.status == WorkflowStatus.PAUSED,
            "SASAutonomyV4: workflow closed"
        );
        wf.status = WorkflowStatus.FINALIZED;

        if (address(executionGraph) != address(0) && wf.graphWorkflowId != bytes32(0)) {
            executionGraph.finalizeWorkflow(wf.graphWorkflowId, success, resultHash, metadataURI);
        }

        emit WorkflowFinalized(workflowId, success, resultHash, metadataURI);
        emit WorkflowStatusChanged(workflowId, WorkflowStatus.FINALIZED);
    }

    function planStep(
        uint256 workflowId,
        uint256 parentStepId,
        uint256 fromAgentId,
        uint256 toAgentId,
        bytes32 payloadHash,
        uint256 maxTotalCost,
        bytes32 relationType,
        string calldata metadataURI
    ) external whenNotPaused workflowExists(workflowId) onlyWorkflowOperator(workflowId) returns (uint256 stepId) {
        require(toAgentId > 0, "SASAutonomyV4: invalid target agent");
        require(payloadHash != bytes32(0), "SASAutonomyV4: zero payload hash");
        require(maxTotalCost > 0, "SASAutonomyV4: zero max cost");

        Workflow storage wf = workflows[workflowId];
        require(
            wf.status == WorkflowStatus.ACTIVE || wf.status == WorkflowStatus.PAUSED,
            "SASAutonomyV4: workflow closed"
        );

        uint256 depth = 1;
        if (parentStepId == 0) {
            require(fromAgentId == wf.rootAgentId, "SASAutonomyV4: invalid root source");
        } else {
            Step storage parent = steps[parentStepId];
            require(parent.workflowId == workflowId, "SASAutonomyV4: parent workflow mismatch");
            depth = parent.depth + 1;
            require(fromAgentId == parent.toAgentId, "SASAutonomyV4: source/parent mismatch");
        }
        require(depth <= wf.maxDepth, "SASAutonomyV4: max depth exceeded");

        stepCount++;
        stepId = stepCount;
        steps[stepId] = Step({
            id: stepId,
            workflowId: workflowId,
            parentStepId: parentStepId,
            fromAgentId: fromAgentId,
            toAgentId: toAgentId,
            depth: depth,
            maxTotalCost: maxTotalCost,
            splitBpsTotal: 0,
            executed: false,
            executionId: 0,
            chargedAgentFee: 0,
            chargedRuntimeBudget: 0,
            chargedTotalCost: 0,
            chargedSplitTotal: 0,
            payloadHash: payloadHash,
            relationType: relationType,
            createdAt: block.timestamp,
            metadataURI: metadataURI
        });

        wf.stepCount += 1;
        _workflowStepIds[workflowId].push(stepId);

        emit StepPlanned(
            workflowId,
            stepId,
            toAgentId,
            parentStepId,
            fromAgentId,
            depth,
            maxTotalCost,
            payloadHash,
            relationType,
            metadataURI
        );
    }

    function addStepSplit(
        uint256 stepId,
        uint256 beneficiaryAgentId,
        uint256 bps
    ) external stepExists(stepId) onlyWorkflowOperator(steps[stepId].workflowId) {
        require(beneficiaryAgentId > 0, "SASAutonomyV4: invalid beneficiary agent");
        require(bps > 0, "SASAutonomyV4: zero bps");

        Step storage step = steps[stepId];
        require(!step.executed, "SASAutonomyV4: step already executed");
        require(step.splitBpsTotal + bps <= BPS_DENOMINATOR, "SASAutonomyV4: split bps overflow");

        // Validate agent existence via registry.
        registry.getAgent(beneficiaryAgentId);

        _stepSplits[stepId].push(SplitRule({
            beneficiaryAgentId: beneficiaryAgentId,
            bps: bps
        }));
        step.splitBpsTotal += bps;

        emit StepSplitAdded(stepId, beneficiaryAgentId, bps, step.splitBpsTotal);
    }

    function executeStep(
        uint256 stepId,
        bytes calldata payload
    ) external whenNotPaused nonReentrant stepExists(stepId) onlyWorkflowOperator(steps[stepId].workflowId) returns (uint256 executionId) {
        Step storage step = steps[stepId];
        Workflow storage wf = workflows[step.workflowId];

        require(wf.status == WorkflowStatus.ACTIVE, "SASAutonomyV4: workflow not active");
        require(!step.executed, "SASAutonomyV4: step already executed");
        require(keccak256(payload) == step.payloadHash, "SASAutonomyV4: payload hash mismatch");
        require(registry.isAgentActive(step.toAgentId), "SASAutonomyV4: inactive target agent");

        if (step.parentStepId != 0) {
            Step storage parent = steps[step.parentStepId];
            require(parent.executed, "SASAutonomyV4: parent step not executed");
        }

        (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost) = billing.quoteExecution(step.toAgentId);
        require(totalCost > 0, "SASAutonomyV4: zero execution cost");
        require(totalCost <= step.maxTotalCost, "SASAutonomyV4: execution cost above cap");

        uint256 splitTotal = _previewSplitTotal(stepId, agentFee);
        uint256 budgetRequired = totalCost + splitTotal;
        require(wf.budgetRemaining >= budgetRequired, "SASAutonomyV4: insufficient workflow budget");

        wf.budgetRemaining -= budgetRequired;
        wf.spentExecution += totalCost;
        wf.spentSplits += splitTotal;

        executionId = billing.executeAgent{value: totalCost}(step.toAgentId, payload);

        step.executed = true;
        step.executionId = executionId;
        step.chargedAgentFee = agentFee;
        step.chargedRuntimeBudget = runtimeBudget;
        step.chargedTotalCost = totalCost;
        step.chargedSplitTotal = splitTotal;

        _accrueStepSplits(step.workflowId, stepId, agentFee);
        _recordGraphEdge(step, executionId);

        emit StepExecuted(
            step.workflowId,
            stepId,
            executionId,
            agentFee,
            runtimeBudget,
            totalCost,
            splitTotal,
            wf.budgetRemaining
        );
    }

    function withdrawSplitRevenue(address to, uint256 amount) external nonReentrant {
        require(to != address(0), "SASAutonomyV4: zero recipient");
        require(amount > 0, "SASAutonomyV4: zero amount");
        require(amount <= splitBalances[msg.sender], "SASAutonomyV4: insufficient split balance");

        splitBalances[msg.sender] -= amount;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "SASAutonomyV4: split withdraw failed");

        emit SplitWithdrawn(msg.sender, to, amount);
    }

    function getWorkflowStepIds(uint256 workflowId)
        external
        view
        workflowExists(workflowId)
        returns (uint256[] memory stepIds)
    {
        stepIds = _workflowStepIds[workflowId];
    }

    function getStepSplits(uint256 stepId)
        external
        view
        stepExists(stepId)
        returns (SplitRule[] memory splits)
    {
        splits = _stepSplits[stepId];
    }

    function previewStepExecution(uint256 stepId)
        external
        view
        stepExists(stepId)
        returns (
            uint256 agentFee,
            uint256 runtimeBudget,
            uint256 totalCost,
            uint256 splitTotal,
            uint256 budgetRequired,
            uint256 remainingBudget
        )
    {
        Step storage step = steps[stepId];
        Workflow storage wf = workflows[step.workflowId];
        (agentFee, runtimeBudget, totalCost) = billing.quoteExecution(step.toAgentId);
        splitTotal = _previewSplitTotal(stepId, agentFee);
        budgetRequired = totalCost + splitTotal;
        remainingBudget = wf.budgetRemaining;
    }

    function _previewSplitTotal(uint256 stepId, uint256 agentFee) internal view returns (uint256 splitTotal) {
        SplitRule[] storage splits = _stepSplits[stepId];
        for (uint256 i = 0; i < splits.length; i++) {
            splitTotal += (agentFee * splits[i].bps) / BPS_DENOMINATOR;
        }
    }

    function _accrueStepSplits(uint256 workflowId, uint256 stepId, uint256 agentFee) internal {
        SplitRule[] storage splits = _stepSplits[stepId];
        for (uint256 i = 0; i < splits.length; i++) {
            SplitRule storage rule = splits[i];
            uint256 amount = (agentFee * rule.bps) / BPS_DENOMINATOR;
            if (amount == 0) continue;

            SASTypes.AgentConfig memory beneficiaryAgent = registry.getAgent(rule.beneficiaryAgentId);
            splitBalances[beneficiaryAgent.builder] += amount;
            agentSplitRevenue[rule.beneficiaryAgentId] += amount;

            emit StepSplitAccrued(
                workflowId,
                stepId,
                rule.beneficiaryAgentId,
                beneficiaryAgent.builder,
                amount
            );
        }
    }

    function _recordGraphEdge(Step storage step, uint256 toExecutionId) internal {
        if (address(executionGraph) == address(0)) return;

        Workflow storage wf = workflows[step.workflowId];
        if (wf.graphWorkflowId == bytes32(0)) {
            wf.graphWorkflowId = executionGraph.createWorkflow(
                toExecutionId,
                wf.rootAgentId,
                wf.requester,
                wf.parentGraphWorkflowId,
                wf.metadataURI
            );
        }

        if (step.parentStepId == 0) return;

        Step storage parent = steps[step.parentStepId];
        executionGraph.addWorkflowEdge(
            wf.graphWorkflowId,
            parent.executionId,
            toExecutionId,
            parent.toAgentId,
            step.toAgentId,
            step.relationType,
            step.metadataURI
        );
    }
}
