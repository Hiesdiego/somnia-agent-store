// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./SASTypes.sol";

/// @title SASRegistry
/// @notice On-chain registry for all agents published to the Somnia Agent Store.
///         Every agent is an immutable record — name, type, builder, price, metadata.
///         Builders own their listings; the platform owner can verify or deprecate.
///
/// @dev Deployed once. SASBilling and SASExecutor read from this contract.
///      Gas note: Somnia storage ops need ~1_000_000 gas reserve. Set generous limits
///      when calling state-mutating functions from off-chain.
contract SASRegistry is Ownable, Pausable {
    using SASTypes for *;

    // ─── State ─────────────────────────────────────────────────────────────────

    /// @notice Auto-incrementing agent ID counter. Starts at 1.
    uint256 public agentCount;
    /// @notice Number of currently ACTIVE agents.
    uint256 public activeAgentCount;

    /// @notice agentId → AgentConfig
    mapping(uint256 => SASTypes.AgentConfig) private _agents;

    /// @notice builder address → list of agent IDs they've registered
    mapping(address => uint256[]) private _builderAgents;

    /// @notice category string → list of agent IDs in that category
    mapping(string => uint256[]) private _categoryAgents;

    /// @notice Authorized billing contract — only this can update execution stats
    address public billingContract;

    /// @notice Registrar contracts allowed to register agents for builders.
    mapping(address => bool) public authorizedRegistrars;

    // ─── Events ────────────────────────────────────────────────────────────────

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed builder,
        string name,
        SASTypes.AgentType agentType,
        uint256 pricePerExecution
    );

    event AgentUpdated(
        uint256 indexed agentId,
        address indexed builder,
        uint256 version
    );

    event AgentStatusChanged(
        uint256 indexed agentId,
        SASTypes.AgentStatus status
    );

    event AgentVerified(uint256 indexed agentId, bool isVerified);

    event AgentStatsUpdated(
        uint256 indexed agentId,
        uint256 totalExecutions,
        uint256 totalRevenue
    );

    event BillingContractSet(address indexed billingContract);
    event RegistrarAuthorizationUpdated(address indexed registrar, bool authorized);

    // ─── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyBuilder(uint256 agentId) {
        require(_agents[agentId].builder == msg.sender, "SASRegistry: not the agent builder");
        _;
    }

    modifier agentExists(uint256 agentId) {
        require(agentId > 0 && agentId <= agentCount, "SASRegistry: agent does not exist");
        _;
    }

    modifier onlyBilling() {
        require(msg.sender == billingContract, "SASRegistry: caller is not billing contract");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Set the authorized billing contract address.
    function setBillingContract(address _billing) external onlyOwner {
        require(_billing != address(0), "SASRegistry: zero address");
        billingContract = _billing;
        emit BillingContractSet(_billing);
    }

    /// @notice Allow/disallow registrar contracts that can list agents for builders.
    function setAuthorizedRegistrar(address registrar, bool authorized) external onlyOwner {
        require(registrar != address(0), "SASRegistry: zero registrar");
        authorizedRegistrars[registrar] = authorized;
        emit RegistrarAuthorizationUpdated(registrar, authorized);
    }

    /// @notice Platform admin can verify/unverify an agent.
    /// @dev Verified agents get a badge in the marketplace UI.
    function setAgentVerified(uint256 agentId, bool verified)
        external
        onlyOwner
        agentExists(agentId)
    {
        _agents[agentId].isVerified = verified;
        emit AgentVerified(agentId, verified);
    }

    /// @notice Admin can force-deprecate a malicious or broken agent.
    function adminDeprecateAgent(uint256 agentId) external onlyOwner agentExists(agentId) {
        if (_agents[agentId].status == SASTypes.AgentStatus.ACTIVE && activeAgentCount > 0) {
            activeAgentCount--;
        }
        _agents[agentId].status = SASTypes.AgentStatus.DEPRECATED;
        emit AgentStatusChanged(agentId, SASTypes.AgentStatus.DEPRECATED);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── Builder — Registration & Management ──────────────────────────────────

    /// @notice Register a new agent on the marketplace.
    /// @param name            Human-readable name (max 64 chars recommended)
    /// @param description     Short description shown in the marketplace card
    /// @param category        Category slug (e.g., "sports", "finance", "ai")
    /// @param metadataURI     IPFS/Arweave URI to full metadata JSON
    /// @param agentType       One of the four SASTypes.AgentType variants
    /// @param pricePerExecution Builder/protocol service fee in wei (STT); runtime is quoted by billing
    /// @param somniaAgentId   Somnia Agent Platform ID (pass 0 for CUSTOM_OFFCHAIN)
    /// @return agentId        The newly assigned agent ID
    function registerAgent(
        string calldata name,
        string calldata description,
        string calldata category,
        string calldata metadataURI,
        SASTypes.AgentType agentType,
        uint256 pricePerExecution,
        uint256 somniaAgentId
    ) external whenNotPaused returns (uint256 agentId) {
        return _registerAgent(
            msg.sender,
            name,
            description,
            category,
            metadataURI,
            agentType,
            pricePerExecution,
            somniaAgentId
        );
    }

    /// @notice Register an agent for a builder via an authorized registrar contract.
    function registerAgentForBuilder(
        address builder,
        string calldata name,
        string calldata description,
        string calldata category,
        string calldata metadataURI,
        SASTypes.AgentType agentType,
        uint256 pricePerExecution,
        uint256 somniaAgentId
    ) external whenNotPaused returns (uint256 agentId) {
        require(authorizedRegistrars[msg.sender], "SASRegistry: registrar not authorized");
        require(builder != address(0), "SASRegistry: zero builder");
        return _registerAgent(
            builder,
            name,
            description,
            category,
            metadataURI,
            agentType,
            pricePerExecution,
            somniaAgentId
        );
    }

    function _registerAgent(
        address builder,
        string calldata name,
        string calldata description,
        string calldata category,
        string calldata metadataURI,
        SASTypes.AgentType agentType,
        uint256 pricePerExecution,
        uint256 somniaAgentId
    ) internal returns (uint256 agentId) {
        require(bytes(name).length > 0, "SASRegistry: name required");
        require(bytes(description).length > 0, "SASRegistry: description required");
        require(pricePerExecution > 0, "SASRegistry: price must be > 0");

        // CUSTOM_OFFCHAIN agents don't need a Somnia Agent Platform ID
        if (agentType != SASTypes.AgentType.CUSTOM_OFFCHAIN) {
            require(somniaAgentId > 0, "SASRegistry: somniaAgentId required for on-chain agents");
        }

        agentCount++;
        agentId = agentCount;

        _agents[agentId] = SASTypes.AgentConfig({
            id: agentId,
            builder: builder,
            name: name,
            description: description,
            category: category,
            metadataURI: metadataURI,
            agentType: agentType,
            status: SASTypes.AgentStatus.ACTIVE,
            pricePerExecution: pricePerExecution,
            somniaAgentId: somniaAgentId,
            totalExecutions: 0,
            totalRevenue: 0,
            createdAt: block.timestamp,
            version: 1,
            isVerified: false
        });

        _builderAgents[builder].push(agentId);
        _categoryAgents[category].push(agentId);
        activeAgentCount++;

        emit AgentRegistered(agentId, builder, name, agentType, pricePerExecution);
    }

    /// @notice Update mutable fields on an existing agent listing.
    /// @dev Only the original builder can update. Bumps version.
    function updateAgent(
        uint256 agentId,
        string calldata description,
        string calldata metadataURI,
        uint256 pricePerExecution
    ) external whenNotPaused onlyBuilder(agentId) agentExists(agentId) {
        require(
            _agents[agentId].status != SASTypes.AgentStatus.DEPRECATED,
            "SASRegistry: cannot update a deprecated agent"
        );
        require(pricePerExecution > 0, "SASRegistry: price must be > 0");

        SASTypes.AgentConfig storage agent = _agents[agentId];
        agent.description = description;
        agent.metadataURI = metadataURI;
        agent.pricePerExecution = pricePerExecution;
        agent.version++;

        emit AgentUpdated(agentId, msg.sender, agent.version);
    }

    /// @notice Builder pauses their agent (no new executions, still visible).
    function pauseAgent(uint256 agentId)
        external
        onlyBuilder(agentId)
        agentExists(agentId)
    {
        require(
            _agents[agentId].status == SASTypes.AgentStatus.ACTIVE,
            "SASRegistry: agent is not active"
        );
        _agents[agentId].status = SASTypes.AgentStatus.PAUSED;
        if (activeAgentCount > 0) {
            activeAgentCount--;
        }
        emit AgentStatusChanged(agentId, SASTypes.AgentStatus.PAUSED);
    }

    /// @notice Builder resumes a paused agent.
    function resumeAgent(uint256 agentId)
        external
        onlyBuilder(agentId)
        agentExists(agentId)
    {
        require(
            _agents[agentId].status == SASTypes.AgentStatus.PAUSED,
            "SASRegistry: agent is not paused"
        );
        _agents[agentId].status = SASTypes.AgentStatus.ACTIVE;
        activeAgentCount++;
        emit AgentStatusChanged(agentId, SASTypes.AgentStatus.ACTIVE);
    }

    /// @notice Builder permanently retires an agent.
    function deprecateAgent(uint256 agentId)
        external
        onlyBuilder(agentId)
        agentExists(agentId)
    {
        if (_agents[agentId].status == SASTypes.AgentStatus.ACTIVE && activeAgentCount > 0) {
            activeAgentCount--;
        }
        _agents[agentId].status = SASTypes.AgentStatus.DEPRECATED;
        emit AgentStatusChanged(agentId, SASTypes.AgentStatus.DEPRECATED);
    }

    // ─── Billing Hook ──────────────────────────────────────────────────────────

    /// @notice Called by SASBilling after each successful execution to update stats.
    function recordExecution(uint256 agentId, uint256 amountPaid)
        external
        onlyBilling
        agentExists(agentId)
    {
        SASTypes.AgentConfig storage agent = _agents[agentId];
        agent.totalExecutions++;
        agent.totalRevenue += amountPaid;
        emit AgentStatsUpdated(agentId, agent.totalExecutions, agent.totalRevenue);
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    /// @notice Get a single agent by ID.
    function getAgent(uint256 agentId)
        external
        view
        agentExists(agentId)
        returns (SASTypes.AgentConfig memory)
    {
        return _agents[agentId];
    }

    /// @notice Get all agents registered by a builder.
    function getBuilderAgents(address builder)
        external
        view
        returns (SASTypes.AgentConfig[] memory agents)
    {
        uint256[] storage ids = _builderAgents[builder];
        agents = new SASTypes.AgentConfig[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            agents[i] = _agents[ids[i]];
        }
    }

    /// @notice Get all ACTIVE agents (used by marketplace to populate the grid).
    /// @dev Iterates all registered agents — fine for testnet, consider subgraph for mainnet.
    function getAllActiveAgents()
        external
        view
        returns (SASTypes.AgentConfig[] memory agents)
    {
        agents = new SASTypes.AgentConfig[](activeAgentCount);
        uint256 idx = 0;
        for (uint256 i = 1; i <= agentCount; i++) {
            if (_agents[i].status == SASTypes.AgentStatus.ACTIVE) {
                agents[idx++] = _agents[i];
            }
        }
    }

    /// @notice Get all agents in a category.
    function getAgentsByCategory(string calldata category)
        external
        view
        returns (SASTypes.AgentConfig[] memory agents)
    {
        uint256[] storage ids = _categoryAgents[category];
        uint256 count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_agents[ids[i]].status == SASTypes.AgentStatus.ACTIVE) count++;
        }
        agents = new SASTypes.AgentConfig[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_agents[ids[i]].status == SASTypes.AgentStatus.ACTIVE) {
                agents[idx++] = _agents[ids[i]];
            }
        }
    }

    /// @notice Get all agents — including paused/deprecated. Admin view.
    function getAllAgents()
        external
        view
        returns (SASTypes.AgentConfig[] memory agents)
    {
        agents = new SASTypes.AgentConfig[](agentCount);
        for (uint256 i = 1; i <= agentCount; i++) {
            agents[i - 1] = _agents[i];
        }
    }

    /// @notice Returns true if the agent is active and accepting executions.
    function isAgentActive(uint256 agentId) external view returns (bool) {
        if (agentId == 0 || agentId > agentCount) return false;
        return _agents[agentId].status == SASTypes.AgentStatus.ACTIVE;
    }
}
