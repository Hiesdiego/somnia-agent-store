// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SASTypes
/// @notice Shared type definitions for the Somnia Agent Store protocol.
library SASTypes {
    // ─── Agent Types ───────────────────────────────────────────────────────────

    /// @notice The four supported agent execution modes.
    /// @dev Determines how SASExecutor routes an execution request.
    enum AgentType {
        LLM_INFERENCE,  // Somnia LLM Agent — deterministic AI inference on-chain
        JSON_API,       // Somnia JSON API Agent — fetch + extract from public APIs
        WEBSITE_PARSE,  // Somnia Website Parse Agent — scrape + AI extraction
        CUSTOM_OFFCHAIN // Off-chain runner; registry + billing on-chain only
    }

    /// @notice Lifecycle state of an agent listing.
    enum AgentStatus {
        ACTIVE,      // Discoverable and executable by subscribers
        PAUSED,      // Builder has paused — no new executions allowed
        DEPRECATED   // Permanently retired; historical executions still readable
    }

    /// @notice State of a single execution request.
    enum ExecutionStatus {
        PENDING,  // Submitted, awaiting result (on-chain validators or off-chain runner)
        SUCCESS,  // Completed successfully; result available
        FAILED,   // Execution failed (agent error, timeout, or runner failure)
        TIMEOUT   // Somnia Agent Platform timed out
    }

    // ─── Structs ───────────────────────────────────────────────────────────────

    /// @notice Full on-chain record of a registered agent.
    struct AgentConfig {
        uint256 id;
        address builder;            // Builder's wallet — receives 85% of revenue
        string name;
        string description;
        string category;            // e.g., "Sports", "Finance", "AI", "Data"
        string metadataURI;         // IPFS/Arweave JSON: icon, tags, input/output schema
        AgentType agentType;
        AgentStatus status;
        uint256 pricePerExecution;  // Builder/protocol agent fee in wei; runtime budget is quoted separately
        uint256 somniaAgentId;      // Somnia Agent Platform ID (0 for CUSTOM_OFFCHAIN)
        uint256 totalExecutions;    // Lifetime execution count (updated on each run)
        uint256 totalRevenue;       // Cumulative agent fees; excludes pass-through runtime budget
        uint256 createdAt;          // Block timestamp of registration
        uint256 version;            // Incremented on each update
        bool isVerified;            // Platform-verified (set by admin)
    }

    /// @notice Full record of a single execution request.
    struct ExecutionRecord {
        uint256 id;
        uint256 agentId;
        address subscriber;         // User who triggered this execution
        bytes payload;              // ABI-encoded input passed to the agent
        ExecutionStatus status;
        bytes result;               // ABI-encoded output from the agent (empty while PENDING)
        uint256 createdAt;
        uint256 resolvedAt;         // 0 while PENDING
        uint256 amountPaid;         // total wei paid by subscriber (agent fee + runtime budget)
        uint256 somniaRequestId;    // Somnia platform request ID (0 for CUSTOM_OFFCHAIN)
    }

    // ─── Per-agent pricing on the Somnia Agent Platform ───────────────────────

    /// @notice Approximate STT cost per agent per validator run.
    /// @dev These are hardcoded estimates. Derive real values via getRequestDeposit()
    ///      before each call. Billing collects and forwards this per execution.
    uint256 internal constant COST_PER_AGENT_LLM      = 0.07 ether; // 0.21 SOMI total (3 validators)
    uint256 internal constant COST_PER_AGENT_JSON      = 0.03 ether; // 0.09 SOMI total
    uint256 internal constant COST_PER_AGENT_WEBSITE   = 0.10 ether; // 0.30 SOMI total
    uint256 internal constant DEFAULT_SUBCOMMITTEE     = 3;
    uint256 internal constant OPS_RESERVE_PER_AGENT    = 0.01 ether; // ops reserve floor per validator
}
