// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface ISASBillingAutopilot {
    function executeAgent(uint256 agentId, bytes calldata payload)
        external
        payable
        returns (uint256 executionId);

    function quoteExecution(uint256 agentId)
        external
        view
        returns (uint256 agentFee, uint256 runtimeBudget, uint256 totalCost);
}

interface ISASRegistryAutopilot {
    struct AgentConfig {
        uint256 id;
        address builder;
        string name;
        string description;
        string category;
        string metadataURI;
        uint8 agentType;
        uint8 status;
        uint256 pricePerExecution;
        uint256 somniaAgentId;
        uint256 totalExecutions;
        uint256 totalRevenue;
        uint256 createdAt;
        uint256 version;
        bool isVerified;
    }

    function getAgent(uint256 agentId) external view returns (AgentConfig memory);
    function isAgentActive(uint256 agentId) external view returns (bool);
}

/// @title AutopilotVault
/// @notice User-funded vault for autonomous SAS agent runs.
/// @dev Users deposit STT into named missions. Authorized relayers spend the
///      target agent fee, the quoted Somnia runtime budget, and a user-capped
///      relayer fee until the mission balance is exhausted or cancelled.
contract AutopilotVault is Ownable, ReentrancyGuard, Pausable {
    struct Mission {
        bytes32 id;
        address owner;
        uint256 agentId;
        uint256 balance;
        uint256 spent;
        uint256 runCount;
        uint256 maxRelayerFeePerRun;
        uint256 minCadenceSeconds;
        uint256 maxRuns;
        uint256 expiresAt;
        uint256 maxTotalSpend;
        uint256 lastExecutedAt;
        uint256 createdAt;
        uint256 updatedAt;
        bytes32 marketHash;
        bytes32 questionHash;
        bytes32 payloadTemplateHash;
        bool active;
        string metadataURI;
    }

    ISASBillingAutopilot public immutable billing;
    ISASRegistryAutopilot public immutable registry;

    mapping(bytes32 => Mission) private _missions;
    mapping(address => bytes32[]) private _ownerMissions;
    mapping(address => bool) public relayers;
    mapping(bytes32 => bool) public usedIdempotencyKeys;

    event MissionCreated(
        bytes32 indexed missionId,
        address indexed owner,
        uint256 indexed agentId,
        uint256 amount,
        uint256 maxRelayerFeePerRun,
        uint256 minCadenceSeconds,
        uint256 maxRuns,
        uint256 expiresAt,
        uint256 maxTotalSpend,
        bytes32 marketHash,
        bytes32 questionHash,
        bytes32 payloadTemplateHash,
        string metadataURI
    );
    event MissionFunded(bytes32 indexed missionId, address indexed funder, uint256 amount, uint256 newBalance);
    event MissionCancelled(bytes32 indexed missionId, address indexed owner, uint256 refunded);
    event MissionSpent(
        bytes32 indexed missionId,
        address indexed owner,
        uint256 indexed agentId,
        uint256 executionId,
        uint256 agentFee,
        uint256 runtimeBudget,
        uint256 relayerFee,
        uint256 remainingBalance,
        bytes32 idempotencyKey,
        bytes32 payloadTemplateHash,
        bytes32 payloadHash,
        bytes32 contextHash
    );
    event RelayerUpdated(address indexed relayer, bool allowed);

    modifier onlyRelayer() {
        require(relayers[msg.sender], "AutopilotVault: not relayer");
        _;
    }

    modifier missionExists(bytes32 missionId) {
        require(_missions[missionId].owner != address(0), "AutopilotVault: mission not found");
        _;
    }

    constructor(address initialOwner, address _billing, address _registry) Ownable(initialOwner) {
        require(_billing != address(0), "AutopilotVault: zero billing");
        require(_registry != address(0), "AutopilotVault: zero registry");
        billing = ISASBillingAutopilot(_billing);
        registry = ISASRegistryAutopilot(_registry);
    }

    receive() external payable {
        revert("AutopilotVault: use fundMission");
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        require(relayer != address(0), "AutopilotVault: zero relayer");
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createMission(
        uint256 agentId,
        uint256 maxRelayerFeePerRun,
        uint256 minCadenceSeconds,
        uint256 maxRuns,
        uint256 expiresAt,
        uint256 maxTotalSpend,
        bytes32 marketHash,
        bytes32 questionHash,
        bytes32 payloadTemplateHash,
        string calldata metadataURI
    ) external payable whenNotPaused nonReentrant returns (bytes32 missionId) {
        require(msg.value > 0, "AutopilotVault: zero funding");
        require(registry.isAgentActive(agentId), "AutopilotVault: inactive agent");
        require(maxRuns > 0, "AutopilotVault: zero max runs");
        require(expiresAt > block.timestamp, "AutopilotVault: invalid expiry");
        require(maxTotalSpend > 0, "AutopilotVault: zero spend cap");
        require(msg.value >= maxTotalSpend, "AutopilotVault: underfunded spend cap");
        require(marketHash != bytes32(0), "AutopilotVault: zero market hash");
        require(questionHash != bytes32(0), "AutopilotVault: zero question hash");
        require(payloadTemplateHash != bytes32(0), "AutopilotVault: zero template hash");

        missionId = keccak256(
            abi.encodePacked(
                msg.sender,
                agentId,
                marketHash,
                questionHash,
                payloadTemplateHash,
                block.chainid,
                block.timestamp,
                _ownerMissions[msg.sender].length
            )
        );
        require(_missions[missionId].owner == address(0), "AutopilotVault: mission exists");

        _missions[missionId] = Mission({
            id: missionId,
            owner: msg.sender,
            agentId: agentId,
            balance: msg.value,
            spent: 0,
            runCount: 0,
            maxRelayerFeePerRun: maxRelayerFeePerRun,
            minCadenceSeconds: minCadenceSeconds,
            maxRuns: maxRuns,
            expiresAt: expiresAt,
            maxTotalSpend: maxTotalSpend,
            lastExecutedAt: 0,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            marketHash: marketHash,
            questionHash: questionHash,
            payloadTemplateHash: payloadTemplateHash,
            active: true,
            metadataURI: metadataURI
        });
        _ownerMissions[msg.sender].push(missionId);

        emit MissionCreated(
            missionId,
            msg.sender,
            agentId,
            msg.value,
            maxRelayerFeePerRun,
            minCadenceSeconds,
            maxRuns,
            expiresAt,
            maxTotalSpend,
            marketHash,
            questionHash,
            payloadTemplateHash,
            metadataURI
        );
    }

    function fundMission(bytes32 missionId) external payable whenNotPaused nonReentrant missionExists(missionId) {
        require(msg.value > 0, "AutopilotVault: zero funding");

        Mission storage mission = _missions[missionId];
        require(mission.active, "AutopilotVault: inactive mission");

        mission.balance += msg.value;
        mission.updatedAt = block.timestamp;

        emit MissionFunded(missionId, msg.sender, msg.value, mission.balance);
    }

    function cancelMission(bytes32 missionId) external nonReentrant missionExists(missionId) {
        Mission storage mission = _missions[missionId];
        require(msg.sender == mission.owner, "AutopilotVault: not mission owner");
        require(mission.active, "AutopilotVault: already inactive");

        uint256 refund = mission.balance;
        mission.balance = 0;
        mission.active = false;
        mission.updatedAt = block.timestamp;

        if (refund > 0) {
            (bool ok, ) = payable(mission.owner).call{value: refund}("");
            require(ok, "AutopilotVault: refund failed");
        }

        emit MissionCancelled(missionId, mission.owner, refund);
    }

    function executeMission(
        bytes32 missionId,
        bytes calldata payload,
        bytes32 idempotencyKey,
        uint256 relayerFee,
        bytes32 marketHash,
        bytes32 questionHash,
        bytes32 payloadTemplateHash,
        bytes32 payloadHash,
        bytes32 contextHash,
        string calldata /* runMetadataURI */
    ) external whenNotPaused nonReentrant onlyRelayer missionExists(missionId) returns (uint256 executionId) {
        Mission storage mission = _missions[missionId];
        (uint256 agentFee, uint256 runtimeBudget, uint256 executionCost) =
            _chargeMission(
                mission,
                payload,
                idempotencyKey,
                relayerFee,
                marketHash,
                questionHash,
                payloadTemplateHash,
                payloadHash,
                contextHash
            );

        executionId = billing.executeAgent{value: executionCost}(mission.agentId, payload);

        _payRelayer(msg.sender, relayerFee);
        _emitMissionSpent(
            missionId,
            mission.owner,
            mission.agentId,
            executionId,
            agentFee,
            runtimeBudget,
            relayerFee,
            mission.balance,
            idempotencyKey,
            payloadTemplateHash,
            payloadHash,
            contextHash
        );
    }

    function _chargeMission(
        Mission storage mission,
        bytes calldata payload,
        bytes32 idempotencyKey,
        uint256 relayerFee,
        bytes32 marketHash,
        bytes32 questionHash,
        bytes32 payloadTemplateHash,
        bytes32 payloadHash,
        bytes32 contextHash
    ) internal returns (uint256 agentFee, uint256 runtimeBudget, uint256 executionCost) {
        require(idempotencyKey != bytes32(0), "AutopilotVault: zero idempotency key");
        require(payloadHash != bytes32(0), "AutopilotVault: zero payload hash");
        require(contextHash != bytes32(0), "AutopilotVault: zero context hash");
        require(!usedIdempotencyKeys[idempotencyKey], "AutopilotVault: duplicate run");
        require(mission.active, "AutopilotVault: inactive mission");
        require(registry.isAgentActive(mission.agentId), "AutopilotVault: inactive agent");
        require(block.timestamp <= mission.expiresAt, "AutopilotVault: mission expired");
        require(mission.runCount < mission.maxRuns, "AutopilotVault: max runs reached");
        require(marketHash == mission.marketHash, "AutopilotVault: market mismatch");
        require(questionHash == mission.questionHash, "AutopilotVault: question mismatch");
        require(payloadTemplateHash == mission.payloadTemplateHash, "AutopilotVault: template mismatch");
        require(keccak256(payload) == payloadHash, "AutopilotVault: payload hash mismatch");
        require(
            mission.lastExecutedAt == 0 || block.timestamp >= mission.lastExecutedAt + mission.minCadenceSeconds,
            "AutopilotVault: cadence not elapsed"
        );
        require(relayerFee <= mission.maxRelayerFeePerRun, "AutopilotVault: relayer fee too high");

        (agentFee, runtimeBudget, executionCost) = billing.quoteExecution(mission.agentId);
        require(agentFee > 0, "AutopilotVault: zero agent fee");
        require(mission.spent + executionCost + relayerFee <= mission.maxTotalSpend, "AutopilotVault: spend cap exceeded");
        require(mission.balance >= executionCost + relayerFee, "AutopilotVault: insufficient mission balance");

        usedIdempotencyKeys[idempotencyKey] = true;
        mission.balance -= executionCost + relayerFee;
        mission.spent += executionCost + relayerFee;
        mission.runCount += 1;
        mission.lastExecutedAt = block.timestamp;
        mission.updatedAt = block.timestamp;
    }

    function _payRelayer(address relayer, uint256 relayerFee) internal {
        if (relayerFee == 0) return;
        (bool ok, ) = payable(relayer).call{value: relayerFee}("");
        require(ok, "AutopilotVault: relayer fee failed");
    }

    function _emitMissionSpent(
        bytes32 missionId,
        address owner,
        uint256 agentId,
        uint256 executionId,
        uint256 agentFee,
        uint256 runtimeBudget,
        uint256 relayerFee,
        uint256 remainingBalance,
        bytes32 idempotencyKey,
        bytes32 payloadTemplateHash,
        bytes32 payloadHash,
        bytes32 contextHash
    ) internal {
        emit MissionSpent(
            missionId,
            owner,
            agentId,
            executionId,
            agentFee,
            runtimeBudget,
            relayerFee,
            remainingBalance,
            idempotencyKey,
            payloadTemplateHash,
            payloadHash,
            contextHash
        );
    }

    function getMission(bytes32 missionId) external view returns (Mission memory) {
        return _missions[missionId];
    }

    function getOwnerMissionIds(address owner) external view returns (bytes32[] memory) {
        return _ownerMissions[owner];
    }

    function canExecute(
        bytes32 missionId,
        uint256 relayerFee
    ) external view returns (
        bool ok,
        uint256 agentFee,
        uint256 runtimeBudget,
        uint256 totalCost,
        uint256 balance
    ) {
        Mission storage mission = _missions[missionId];
        if (mission.owner == address(0) || !mission.active || !registry.isAgentActive(mission.agentId)) {
            return (false, 0, 0, 0, mission.balance);
        }

        uint256 executionCost;
        (agentFee, runtimeBudget, executionCost) = billing.quoteExecution(mission.agentId);
        totalCost = executionCost + relayerFee;
        balance = mission.balance;
        ok = agentFee > 0
            && relayerFee <= mission.maxRelayerFeePerRun
            && balance >= totalCost
            && block.timestamp <= mission.expiresAt
            && mission.runCount < mission.maxRuns
            && (mission.lastExecutedAt == 0 || block.timestamp >= mission.lastExecutedAt + mission.minCadenceSeconds)
            && mission.spent + totalCost <= mission.maxTotalSpend;
    }
}
