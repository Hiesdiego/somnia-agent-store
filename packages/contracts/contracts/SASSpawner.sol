// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SASTypes.sol";

interface ISASRegistryRegistrar {
    function registerAgentForBuilder(
        address builder,
        string calldata name,
        string calldata description,
        string calldata category,
        string calldata metadataURI,
        SASTypes.AgentType agentType,
        uint256 pricePerExecution,
        uint256 somniaAgentId
    ) external returns (uint256 agentId);
}

/// @title SASSpawner
/// @notice Template-driven autonomous spawn pipeline for new specialized agents.
contract SASSpawner is Ownable {
    enum SpawnStatus {
        REQUESTED,
        CERTIFIED,
        REJECTED,
        LISTED
    }

    struct SpawnTemplate {
        uint256 id;
        address creator;
        string name;
        string description;
        string category;
        string metadataURI;
        SASTypes.AgentType agentType;
        uint256 defaultPricePerExecution;
        uint256 defaultSomniaAgentId;
        bool active;
        uint256 createdAt;
    }

    struct SpawnRequest {
        uint256 id;
        uint256 templateId;
        address requester;
        address builder;
        string nameOverride;
        string descriptionOverride;
        string categoryOverride;
        string metadataURIOverride;
        uint256 pricePerExecution;
        uint256 somniaAgentId;
        uint256 scoreBps;
        uint256 listedAgentId;
        SpawnStatus status;
        uint256 createdAt;
    }

    struct SpawnRequestInput {
        address builder;
        string nameOverride;
        string descriptionOverride;
        string categoryOverride;
        string metadataURIOverride;
        uint256 pricePerExecutionOverride;
        uint256 somniaAgentIdOverride;
    }

    ISASRegistryRegistrar public immutable registry;
    uint256 public templateCount;
    uint256 public requestCount;

    mapping(uint256 => SpawnTemplate) public templates;
    mapping(uint256 => SpawnRequest) public requests;
    mapping(address => bool) public certifiers;

    event CertifierUpdated(address indexed certifier, bool allowed);
    event TemplateCreated(
        uint256 indexed templateId,
        address indexed creator,
        SASTypes.AgentType agentType,
        uint256 defaultPricePerExecution
    );
    event TemplateActiveSet(uint256 indexed templateId, bool active);
    event SpawnRequested(
        uint256 indexed requestId,
        uint256 indexed templateId,
        address indexed builder,
        address requester
    );
    event SpawnCertified(uint256 indexed requestId, bool approved, uint256 scoreBps);
    event SpawnListed(uint256 indexed requestId, uint256 indexed agentId, address indexed builder);

    modifier onlyCertifier() {
        require(certifiers[msg.sender], "SASSpawner: not certifier");
        _;
    }

    constructor(address initialOwner, address registryAddress) Ownable(initialOwner) {
        require(registryAddress != address(0), "SASSpawner: zero registry");
        registry = ISASRegistryRegistrar(registryAddress);
        certifiers[initialOwner] = true;
    }

    function setCertifier(address certifier, bool allowed) external onlyOwner {
        require(certifier != address(0), "SASSpawner: zero certifier");
        certifiers[certifier] = allowed;
        emit CertifierUpdated(certifier, allowed);
    }

    function createTemplate(
        string calldata name,
        string calldata description,
        string calldata category,
        string calldata metadataURI,
        SASTypes.AgentType agentType,
        uint256 defaultPricePerExecution,
        uint256 defaultSomniaAgentId
    ) external returns (uint256 templateId) {
        require(bytes(name).length > 0, "SASSpawner: name required");
        require(defaultPricePerExecution > 0, "SASSpawner: price required");
        if (agentType != SASTypes.AgentType.CUSTOM_OFFCHAIN) {
            require(defaultSomniaAgentId > 0, "SASSpawner: somnia id required");
        }

        templateCount++;
        templateId = templateCount;
        SpawnTemplate storage template = templates[templateId];
        template.id = templateId;
        template.creator = msg.sender;
        template.name = name;
        template.description = description;
        template.category = category;
        template.metadataURI = metadataURI;
        template.agentType = agentType;
        template.defaultPricePerExecution = defaultPricePerExecution;
        template.defaultSomniaAgentId = defaultSomniaAgentId;
        template.active = true;
        template.createdAt = block.timestamp;

        emit TemplateCreated(templateId, msg.sender, agentType, defaultPricePerExecution);
    }

    function setTemplateActive(uint256 templateId, bool active) external {
        SpawnTemplate storage template = templates[templateId];
        require(template.id != 0, "SASSpawner: template missing");
        require(
            msg.sender == template.creator || msg.sender == owner(),
            "SASSpawner: not template controller"
        );
        template.active = active;
        emit TemplateActiveSet(templateId, active);
    }

    function requestSpawn(
        uint256 templateId,
        SpawnRequestInput calldata input
    ) external returns (uint256 requestId) {
        SpawnTemplate storage template = templates[templateId];
        require(template.id != 0, "SASSpawner: template missing");
        require(template.active, "SASSpawner: template inactive");

        requestCount++;
        requestId = requestCount;
        address finalBuilder = input.builder == address(0) ? msg.sender : input.builder;
        uint256 finalPrice = input.pricePerExecutionOverride > 0
            ? input.pricePerExecutionOverride
            : template.defaultPricePerExecution;
        uint256 finalSomniaAgentId = input.somniaAgentIdOverride > 0
            ? input.somniaAgentIdOverride
            : template.defaultSomniaAgentId;

        if (template.agentType != SASTypes.AgentType.CUSTOM_OFFCHAIN) {
            require(finalSomniaAgentId > 0, "SASSpawner: somnia id required");
        }

        SpawnRequest storage req = requests[requestId];
        req.id = requestId;
        req.templateId = templateId;
        req.requester = msg.sender;
        req.builder = finalBuilder;
        req.nameOverride = input.nameOverride;
        req.descriptionOverride = input.descriptionOverride;
        req.categoryOverride = input.categoryOverride;
        req.metadataURIOverride = input.metadataURIOverride;
        req.pricePerExecution = finalPrice;
        req.somniaAgentId = finalSomniaAgentId;
        req.scoreBps = 0;
        req.listedAgentId = 0;
        req.status = SpawnStatus.REQUESTED;
        req.createdAt = block.timestamp;

        emit SpawnRequested(requestId, templateId, finalBuilder, msg.sender);
    }

    function certifySpawn(uint256 requestId, bool approved, uint256 scoreBps) external onlyCertifier {
        SpawnRequest storage req = requests[requestId];
        require(req.id != 0, "SASSpawner: request missing");
        require(req.status == SpawnStatus.REQUESTED, "SASSpawner: request not pending");
        require(scoreBps <= 10_000, "SASSpawner: invalid score");

        req.scoreBps = scoreBps;
        req.status = approved ? SpawnStatus.CERTIFIED : SpawnStatus.REJECTED;
        emit SpawnCertified(requestId, approved, scoreBps);
    }

    function listCertifiedSpawn(uint256 requestId) external returns (uint256 agentId) {
        SpawnRequest storage req = requests[requestId];
        require(req.id != 0, "SASSpawner: request missing");
        require(req.status == SpawnStatus.CERTIFIED, "SASSpawner: request not certified");

        SpawnTemplate storage template = templates[req.templateId];
        require(template.id != 0, "SASSpawner: template missing");
        require(template.active, "SASSpawner: template inactive");

        string memory finalName = bytes(req.nameOverride).length > 0 ? req.nameOverride : template.name;
        string memory finalDescription = bytes(req.descriptionOverride).length > 0
            ? req.descriptionOverride
            : template.description;
        string memory finalCategory = bytes(req.categoryOverride).length > 0
            ? req.categoryOverride
            : template.category;
        string memory finalMetadata = bytes(req.metadataURIOverride).length > 0
            ? req.metadataURIOverride
            : template.metadataURI;

        agentId = registry.registerAgentForBuilder(
            req.builder,
            finalName,
            finalDescription,
            finalCategory,
            finalMetadata,
            template.agentType,
            req.pricePerExecution,
            req.somniaAgentId
        );

        req.status = SpawnStatus.LISTED;
        req.listedAgentId = agentId;
        emit SpawnListed(requestId, agentId, req.builder);
    }

}
