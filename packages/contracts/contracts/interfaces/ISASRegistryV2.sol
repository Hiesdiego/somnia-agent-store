// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Target interface for a Somnia-native-only SAS registry v2.
/// @dev This is a design interface, not a deployed implementation.
interface ISASRegistryV2 {
    enum AgentType {
        LLM_INFERENCE,
        JSON_API,
        WEBSITE_PARSE
    }

    enum AgentStatus {
        ACTIVE,
        PAUSED,
        DEPRECATED
    }

    struct AgentConfigV2 {
        uint256 id;
        bytes32 publicId;
        uint256 parentAgentId;
        address builder;
        string slug;
        string name;
        string description;
        string category;
        string metadataURI;
        AgentType agentType;
        AgentStatus status;
        uint256 pricePerExecution;
        uint256 somniaAgentId;
        uint256 version;
        bool isVerified;
    }

    event AgentRegisteredV2(
        uint256 indexed agentId,
        bytes32 indexed publicId,
        address indexed builder,
        string slug,
        uint256 somniaAgentId,
        AgentType agentType
    );

    event AgentMetadataUpdated(
        uint256 indexed agentId,
        uint256 indexed version,
        string metadataURI
    );

    event AgentVerifiedV2(
        uint256 indexed agentId,
        bool isVerified,
        string verificationURI
    );

    event AgentReviewed(
        uint256 indexed agentId,
        address indexed reviewer,
        uint8 rating,
        string reviewURI
    );

    function getAgentByPublicId(bytes32 publicId) external view returns (AgentConfigV2 memory);

    function latestVersionOf(bytes32 publicId) external view returns (uint256 agentId);
}
