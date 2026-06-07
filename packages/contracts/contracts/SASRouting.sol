// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SASRouting
/// @notice On-chain anchoring for autonomous routing decisions and policy versions.
contract SASRouting is Ownable {
    struct RoutingPolicy {
        uint256 id;
        string name;
        uint256 weightPriceBps;
        uint256 weightLatencyBps;
        uint256 weightReliabilityBps;
        uint256 weightReputationBps;
        uint256 createdAt;
        bool active;
    }

    struct RouteDecision {
        bytes32 requestHash;
        uint256 policyId;
        uint256 selectedAgentId;
        uint256[] candidateAgentIds;
        uint256[] candidateScoresBps;
        string evidenceURI;
        uint256 timestamp;
        address router;
        bool exists;
    }

    uint256 public policyCount;
    mapping(uint256 => RoutingPolicy) public policies;
    mapping(bytes32 => RouteDecision) private _routes;
    mapping(address => bool) public routers;

    event RouterUpdated(address indexed router, bool allowed);
    event RoutingPolicyCreated(
        uint256 indexed policyId,
        string name,
        uint256 weightPriceBps,
        uint256 weightLatencyBps,
        uint256 weightReliabilityBps,
        uint256 weightReputationBps
    );
    event RoutingPolicyActiveSet(uint256 indexed policyId, bool active);
    event RouteCommitted(
        bytes32 indexed requestHash,
        uint256 indexed policyId,
        uint256 indexed selectedAgentId,
        address router,
        string evidenceURI
    );

    modifier onlyRouter() {
        require(routers[msg.sender], "SASRouting: not router");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRouter(address router, bool allowed) external onlyOwner {
        require(router != address(0), "SASRouting: zero router");
        routers[router] = allowed;
        emit RouterUpdated(router, allowed);
    }

    function createPolicy(
        string calldata name,
        uint256 weightPriceBps,
        uint256 weightLatencyBps,
        uint256 weightReliabilityBps,
        uint256 weightReputationBps,
        bool active
    ) external onlyOwner returns (uint256 policyId) {
        uint256 sum = weightPriceBps
            + weightLatencyBps
            + weightReliabilityBps
            + weightReputationBps;
        require(sum == 10_000, "SASRouting: weights must sum to 10000");

        policyCount++;
        policyId = policyCount;
        policies[policyId] = RoutingPolicy({
            id: policyId,
            name: name,
            weightPriceBps: weightPriceBps,
            weightLatencyBps: weightLatencyBps,
            weightReliabilityBps: weightReliabilityBps,
            weightReputationBps: weightReputationBps,
            createdAt: block.timestamp,
            active: active
        });

        emit RoutingPolicyCreated(
            policyId,
            name,
            weightPriceBps,
            weightLatencyBps,
            weightReliabilityBps,
            weightReputationBps
        );
    }

    function setPolicyActive(uint256 policyId, bool active) external onlyOwner {
        require(policies[policyId].id != 0, "SASRouting: policy missing");
        policies[policyId].active = active;
        emit RoutingPolicyActiveSet(policyId, active);
    }

    function commitRoute(
        bytes32 requestHash,
        uint256 policyId,
        uint256 selectedAgentId,
        uint256[] calldata candidateAgentIds,
        uint256[] calldata candidateScoresBps,
        string calldata evidenceURI
    ) external onlyRouter {
        require(requestHash != bytes32(0), "SASRouting: zero request hash");
        require(policies[policyId].active, "SASRouting: policy inactive");
        require(candidateAgentIds.length > 0, "SASRouting: empty candidates");
        require(candidateAgentIds.length == candidateScoresBps.length, "SASRouting: candidate mismatch");

        bool selectedInCandidates = false;
        for (uint256 i = 0; i < candidateAgentIds.length; i++) {
            if (candidateAgentIds[i] == selectedAgentId) {
                selectedInCandidates = true;
                break;
            }
        }
        require(selectedInCandidates, "SASRouting: selected not in candidates");

        RouteDecision storage route = _routes[requestHash];
        route.requestHash = requestHash;
        route.policyId = policyId;
        route.selectedAgentId = selectedAgentId;
        route.candidateAgentIds = candidateAgentIds;
        route.candidateScoresBps = candidateScoresBps;
        route.evidenceURI = evidenceURI;
        route.timestamp = block.timestamp;
        route.router = msg.sender;
        route.exists = true;

        emit RouteCommitted(requestHash, policyId, selectedAgentId, msg.sender, evidenceURI);
    }

    function getRoute(bytes32 requestHash) external view returns (RouteDecision memory) {
        return _routes[requestHash];
    }
}
