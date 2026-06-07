// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SASTypes.sol";
import "./interfaces/IAgentPlatform.sol";

// Forward-declare SASBilling to avoid circular import (use interface)
interface ISASBilling {
    function resolveExecution(
        uint256 executionId,
        SASTypes.ExecutionStatus status,
        bytes calldata result,
        uint256 somniaRequestId
    ) external;
}

/// @title SASExecutor
/// @notice Routes execution requests to the appropriate runtime:
///           • On-chain agents  → Somnia Agent Platform (validators run + callback)
///           • Custom off-chain → Emits event; off-chain runner picks up + posts result
///
/// @dev Somnia-native calls receive their runtime budget from SASBilling per
///      execution. Any direct funding or returned platform funds remain as an
///      optional sponsored/refund reserve. Only authorized addresses (runner)
///      can submit off-chain results.
///
contract SASExecutor is Ownable, ReentrancyGuard {
    using SASTypes for *;

    // ─── Somnia Agent Platform ─────────────────────────────────────────────────

    IAgentPlatform public immutable agentPlatform;

    // Agent budgets per validator on the Somnia platform.
    // Total request cost = getRequestDeposit() + (per-validator budget × subcommitteeSize).
    uint256 public jsonApiBudgetPerValidator      = 0.03 ether;
    uint256 public llmBudgetPerValidator          = 0.07 ether;
    uint256 public websiteParseBudgetPerValidator = 0.10 ether;
    uint256 public subcommitteeSize               = 3;

    // ─── State ─────────────────────────────────────────────────────────────────

    ISASBilling public billing;

    /// @notice Authorized off-chain runner address. Only this can submit custom results.
    address public runner;

    /// @notice somniaRequestId → SAS executionId (for callback resolution)
    mapping(uint256 => uint256) public requestToExecution;

    /// @notice agentId context stored per Somnia request (for callback)
    mapping(uint256 => uint256) public requestToAgentId;

    /// @notice subscriber stored per Somnia request (for event emission)
    mapping(uint256 => address) public requestToSubscriber;

    // ─── Events ────────────────────────────────────────────────────────────────

    /// @notice Emitted for CUSTOM_OFFCHAIN agents. Off-chain runner listens to this.
    event CustomAgentExecutionRequested(
        uint256 indexed executionId,
        uint256 indexed agentId,
        address indexed subscriber,
        bytes payload,
        uint256 timestamp
    );

    /// @notice Emitted when any execution result is delivered (on-chain or off-chain).
    event AgentResultDelivered(
        uint256 indexed executionId,
        uint256 indexed agentId,
        address indexed subscriber,
        bytes result,
        SASTypes.ExecutionStatus status
    );

    /// @notice Emitted when Somnia Agent Platform request is created.
    event SomniaRequestCreated(
        uint256 indexed executionId,
        uint256 indexed somniaRequestId,
        SASTypes.AgentType agentType
    );

    event SomniaReserveFunded(address indexed funder, uint256 amount);
    event RunnerUpdated(address indexed runner);
    event BillingUpdated(address indexed billing);
    event SomniaCostConfigUpdated(
        uint256 jsonApiBudgetPerValidator,
        uint256 llmBudgetPerValidator,
        uint256 websiteParseBudgetPerValidator,
        uint256 subcommitteeSize
    );

    // ─── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyBilling() {
        require(msg.sender == address(billing), "SASExecutor: not billing contract");
        _;
    }

    modifier onlyRunner() {
        require(msg.sender == runner, "SASExecutor: not authorized runner");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────────

    /// @param initialOwner  Platform deployer
    /// @param _agentPlatform Somnia Agent Platform address
    ///                       Testnet: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
    ///                       Mainnet: 0x5E5205CF39E766118C01636bED000A54D93163E6
    constructor(address initialOwner, address _agentPlatform) Ownable(initialOwner) {
        require(_agentPlatform != address(0), "SASExecutor: zero platform address");
        agentPlatform = IAgentPlatform(_agentPlatform);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function setBilling(address _billing) external onlyOwner {
        require(_billing != address(0), "SASExecutor: zero billing");
        billing = ISASBilling(_billing);
        emit BillingUpdated(_billing);
    }

    function setRunner(address _runner) external onlyOwner {
        require(_runner != address(0), "SASExecutor: zero runner");
        runner = _runner;
        emit RunnerUpdated(_runner);
    }

    /// @notice Update Somnia execution budget settings without redeploying.
    function setSomniaCostConfig(
        uint256 _jsonApiBudgetPerValidator,
        uint256 _llmBudgetPerValidator,
        uint256 _websiteParseBudgetPerValidator,
        uint256 _subcommitteeSize
    ) external onlyOwner {
        require(_jsonApiBudgetPerValidator > 0, "SASExecutor: zero JSON budget");
        require(_llmBudgetPerValidator > 0, "SASExecutor: zero LLM budget");
        require(_websiteParseBudgetPerValidator > 0, "SASExecutor: zero Website budget");
        require(_subcommitteeSize > 0, "SASExecutor: zero subcommittee");

        jsonApiBudgetPerValidator = _jsonApiBudgetPerValidator;
        llmBudgetPerValidator = _llmBudgetPerValidator;
        websiteParseBudgetPerValidator = _websiteParseBudgetPerValidator;
        subcommitteeSize = _subcommitteeSize;

        emit SomniaCostConfigUpdated(
            _jsonApiBudgetPerValidator,
            _llmBudgetPerValidator,
            _websiteParseBudgetPerValidator,
            _subcommitteeSize
        );
    }

    /// @notice Add optional sponsored/refund reserve; ordinary paid runs provide their own runtime budget.
    function fundSomniaReserve() external payable onlyOwner {
        require(msg.value > 0, "SASExecutor: zero value");
        emit SomniaReserveFunded(msg.sender, msg.value);
    }

    /// @notice Emergency: withdraw STT from this contract.
    function emergencyWithdraw(uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = payable(owner()).call{value: amount}("");
        require(ok, "SASExecutor: withdraw failed");
    }

    // ─── Core: Execute ─────────────────────────────────────────────────────────

    /// @notice Called by SASBilling after payment is processed.
    ///         Routes execution based on agent type.
    function execute(
        uint256 executionId,
        SASTypes.AgentConfig memory agent,
        address subscriber,
        bytes calldata payload
    ) external payable onlyBilling {
        uint256 runtimeBudget = quoteRuntimeBudget(agent.agentType);
        require(msg.value == runtimeBudget, "SASExecutor: incorrect runtime budget");

        if (agent.agentType == SASTypes.AgentType.CUSTOM_OFFCHAIN) {
            _dispatchCustom(executionId, agent.id, subscriber, payload);
        } else {
            _dispatchOnChain(executionId, agent, subscriber, payload, runtimeBudget);
        }
    }

    // ─── On-Chain Dispatch (Somnia Agent Platform) ─────────────────────────────

    function _dispatchOnChain(
        uint256 executionId,
        SASTypes.AgentConfig memory agent,
        address subscriber,
        bytes calldata payload,
        uint256 runtimeBudget
    ) internal {
        uint256 somniaRequestId = agentPlatform.createRequest{value: runtimeBudget}(
            agent.somniaAgentId,
            address(this),
            this.handleSomniaResponse.selector,
            payload
        );

        // Store mappings for callback resolution
        requestToExecution[somniaRequestId]  = executionId;
        requestToAgentId[somniaRequestId]    = agent.id;
        requestToSubscriber[somniaRequestId] = subscriber;

        emit SomniaRequestCreated(executionId, somniaRequestId, agent.agentType);
    }

    /// @notice Callback from Somnia Agent Platform validators.
    ///         Only the platform contract can call this.
    function handleSomniaResponse(
        uint256 somniaRequestId,
        IAgentPlatform.Response[] memory responses,
        IAgentPlatform.ResponseStatus status,
        IAgentPlatform.Request memory /* details */
    ) external {
        // Security: only the Somnia Agent Platform can call this
        require(
            msg.sender == address(agentPlatform),
            "SASExecutor: only Somnia platform can call handleResponse"
        );

        uint256 executionId = requestToExecution[somniaRequestId];
        require(executionId != 0, "SASExecutor: unknown request ID");

        uint256 agentId    = requestToAgentId[somniaRequestId];
        address subscriber = requestToSubscriber[somniaRequestId];

        // Clean up mappings
        delete requestToExecution[somniaRequestId];
        delete requestToAgentId[somniaRequestId];
        delete requestToSubscriber[somniaRequestId];

        SASTypes.ExecutionStatus execStatus;
        bytes memory result;

        if (status == IAgentPlatform.ResponseStatus.Success && responses.length > 0) {
            execStatus = SASTypes.ExecutionStatus.SUCCESS;
            result = responses[0].result;
        } else if (status == IAgentPlatform.ResponseStatus.TimedOut) {
            execStatus = SASTypes.ExecutionStatus.TIMEOUT;
        } else {
            execStatus = SASTypes.ExecutionStatus.FAILED;
        }

        billing.resolveExecution(executionId, execStatus, result, somniaRequestId);

        emit AgentResultDelivered(executionId, agentId, subscriber, result, execStatus);
    }

    // ─── Off-Chain Dispatch (Custom Agents) ───────────────────────────────────

    function _dispatchCustom(
        uint256 executionId,
        uint256 agentId,
        address subscriber,
        bytes calldata payload
    ) internal {
        // No on-chain action needed — just emit the event.
        // The off-chain runner listens via WebSocket and picks this up.
        emit CustomAgentExecutionRequested(executionId, agentId, subscriber, payload, block.timestamp);
    }

    /// @notice Off-chain runner calls this to post the result of a CUSTOM_OFFCHAIN agent.
    /// @param executionId The SAS execution ID (from CustomAgentExecutionRequested event)
    /// @param agentId     The agent ID (for event emission)
    /// @param subscriber  The subscriber address (for event emission)
    /// @param result      ABI-encoded result bytes
    /// @param success     True if the agent ran successfully
    function submitOffChainResult(
        uint256 executionId,
        uint256 agentId,
        address subscriber,
        bytes calldata result,
        bool success
    ) external onlyRunner nonReentrant {
        SASTypes.ExecutionStatus status = success
            ? SASTypes.ExecutionStatus.SUCCESS
            : SASTypes.ExecutionStatus.FAILED;

        billing.resolveExecution(executionId, status, result, 0);

        emit AgentResultDelivered(executionId, agentId, subscriber, result, status);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /// @notice Quote the runtime budget that billing must forward for one execution.
    /// @dev Custom off-chain agents do not create a Somnia platform request.
    function quoteRuntimeBudget(SASTypes.AgentType agentType) public view returns (uint256) {
        if (agentType == SASTypes.AgentType.CUSTOM_OFFCHAIN) return 0;
        return _getSomniaCost(agentType);
    }

    /// @notice Calculate Somnia Agent Platform cost for a Somnia-native agent type.
    function _getSomniaCost(SASTypes.AgentType agentType) internal view returns (uint256) {
        uint256 perValidatorBudget = _getPerValidatorBudget(agentType);
        uint256 reserveCost = agentPlatform.getRequestDeposit();
        return reserveCost + (perValidatorBudget * subcommitteeSize);
    }

    function _getPerValidatorBudget(SASTypes.AgentType agentType) internal view returns (uint256) {
        if (agentType == SASTypes.AgentType.JSON_API) return jsonApiBudgetPerValidator;
        if (agentType == SASTypes.AgentType.LLM_INFERENCE) return llmBudgetPerValidator;
        if (agentType == SASTypes.AgentType.WEBSITE_PARSE) return websiteParseBudgetPerValidator;
        revert("SASExecutor: unknown agent type for budget calculation");
    }

    /// @notice View optional sponsored/refund reserve balance.
    function somniaReserveBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {} // Accept rebates from Somnia Agent Platform
}

