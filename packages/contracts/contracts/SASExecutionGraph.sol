// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SASExecutionGraph
/// @notice On-chain execution graph metadata for autonomous composition analysis.
contract SASExecutionGraph is Ownable {
    struct Workflow {
        bytes32 id;
        uint256 rootExecutionId;
        uint256 rootAgentId;
        address requester;
        bytes32 parentWorkflowId;
        uint256 createdAt;
        uint256 completedAt;
        bool finalized;
        bool success;
        bytes32 resultHash;
        string metadataURI;
    }

    struct WorkflowEdge {
        uint256 fromExecutionId;
        uint256 toExecutionId;
        uint256 fromAgentId;
        uint256 toAgentId;
        bytes32 relationType;
        uint256 createdAt;
        string metadataURI;
    }

    uint256 public workflowNonce;
    mapping(address => bool) public recorders;
    mapping(bytes32 => Workflow) public workflows;
    mapping(bytes32 => WorkflowEdge[]) private _workflowEdges;

    event RecorderUpdated(address indexed recorder, bool allowed);
    event WorkflowCreated(
        bytes32 indexed workflowId,
        uint256 indexed rootExecutionId,
        uint256 indexed rootAgentId,
        address requester,
        bytes32 parentWorkflowId,
        string metadataURI
    );
    event WorkflowEdgeAdded(
        bytes32 indexed workflowId,
        uint256 indexed fromExecutionId,
        uint256 indexed toExecutionId,
        uint256 fromAgentId,
        uint256 toAgentId,
        bytes32 relationType,
        string metadataURI
    );
    event WorkflowFinalized(
        bytes32 indexed workflowId,
        bool success,
        bytes32 resultHash,
        string metadataURI
    );

    modifier onlyRecorder() {
        require(recorders[msg.sender], "SASExecutionGraph: not recorder");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRecorder(address recorder, bool allowed) external onlyOwner {
        require(recorder != address(0), "SASExecutionGraph: zero recorder");
        recorders[recorder] = allowed;
        emit RecorderUpdated(recorder, allowed);
    }

    function createWorkflow(
        uint256 rootExecutionId,
        uint256 rootAgentId,
        address requester,
        bytes32 parentWorkflowId,
        string calldata metadataURI
    ) external onlyRecorder returns (bytes32 workflowId) {
        require(requester != address(0), "SASExecutionGraph: zero requester");
        require(rootExecutionId > 0, "SASExecutionGraph: invalid root execution");
        require(rootAgentId > 0, "SASExecutionGraph: invalid root agent");

        workflowNonce++;
        workflowId = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                rootExecutionId,
                rootAgentId,
                requester,
                workflowNonce
            )
        );

        workflows[workflowId] = Workflow({
            id: workflowId,
            rootExecutionId: rootExecutionId,
            rootAgentId: rootAgentId,
            requester: requester,
            parentWorkflowId: parentWorkflowId,
            createdAt: block.timestamp,
            completedAt: 0,
            finalized: false,
            success: false,
            resultHash: bytes32(0),
            metadataURI: metadataURI
        });

        emit WorkflowCreated(
            workflowId,
            rootExecutionId,
            rootAgentId,
            requester,
            parentWorkflowId,
            metadataURI
        );
    }

    function addWorkflowEdge(
        bytes32 workflowId,
        uint256 fromExecutionId,
        uint256 toExecutionId,
        uint256 fromAgentId,
        uint256 toAgentId,
        bytes32 relationType,
        string calldata metadataURI
    ) external onlyRecorder {
        Workflow storage workflow = workflows[workflowId];
        require(workflow.id != 0, "SASExecutionGraph: workflow missing");
        require(!workflow.finalized, "SASExecutionGraph: workflow finalized");
        require(toExecutionId > 0, "SASExecutionGraph: invalid target execution");
        require(toAgentId > 0, "SASExecutionGraph: invalid target agent");

        _workflowEdges[workflowId].push(
            WorkflowEdge({
                fromExecutionId: fromExecutionId,
                toExecutionId: toExecutionId,
                fromAgentId: fromAgentId,
                toAgentId: toAgentId,
                relationType: relationType,
                createdAt: block.timestamp,
                metadataURI: metadataURI
            })
        );

        emit WorkflowEdgeAdded(
            workflowId,
            fromExecutionId,
            toExecutionId,
            fromAgentId,
            toAgentId,
            relationType,
            metadataURI
        );
    }

    function finalizeWorkflow(
        bytes32 workflowId,
        bool success,
        bytes32 resultHash,
        string calldata metadataURI
    ) external onlyRecorder {
        Workflow storage workflow = workflows[workflowId];
        require(workflow.id != 0, "SASExecutionGraph: workflow missing");
        require(!workflow.finalized, "SASExecutionGraph: workflow already finalized");

        workflow.finalized = true;
        workflow.success = success;
        workflow.resultHash = resultHash;
        workflow.completedAt = block.timestamp;
        workflow.metadataURI = metadataURI;

        emit WorkflowFinalized(workflowId, success, resultHash, metadataURI);
    }

    function getWorkflowEdges(bytes32 workflowId)
        external
        view
        returns (WorkflowEdge[] memory edges)
    {
        edges = _workflowEdges[workflowId];
    }
}
