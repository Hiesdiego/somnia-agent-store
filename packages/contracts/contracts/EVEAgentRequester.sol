// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAgentPlatform.sol";

/// @title EVEAgentRequester
/// @notice Official Somnia Agents requester for Agent E.V.E governance reports.
/// @dev This does not register a custom Somnia agent. It invokes the official
///      LLM base agent through IAgentPlatform.createRequest and stores the
///      asynchronous callback result on-chain.
contract EVEAgentRequester is Ownable, ReentrancyGuard {
    uint256 public constant LLM_PRICE_PER_AGENT = 0.07 ether;
    uint256 public constant STANDARD_SUBCOMMITTEE_SIZE = 3;

    IAgentPlatform public immutable agentPlatform;
    uint256 public eveAgentId;
    string public systemPrompt;

    struct Report {
        address requester;
        string prompt;
        string result;
        IAgentPlatform.ResponseStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    mapping(uint256 => Report) public reports;

    event EVEAgentIdUpdated(uint256 indexed agentId);
    event EVESystemPromptUpdated(string systemPrompt);
    event EVEReportRequested(uint256 indexed requestId, address indexed requester, uint256 indexed agentId, string prompt);
    event EVEReportResolved(uint256 indexed requestId, IAgentPlatform.ResponseStatus status, string result);

    constructor(
        address initialOwner,
        address _agentPlatform,
        uint256 _eveAgentId,
        string memory _systemPrompt
    ) Ownable(initialOwner) {
        require(_agentPlatform != address(0), "EVEAgentRequester: zero platform");
        require(_eveAgentId > 0, "EVEAgentRequester: zero agent id");
        agentPlatform = IAgentPlatform(_agentPlatform);
        eveAgentId = _eveAgentId;
        systemPrompt = _systemPrompt;
    }

    function setEVEAgentId(uint256 agentId) external onlyOwner {
        require(agentId > 0, "EVEAgentRequester: zero agent id");
        eveAgentId = agentId;
        emit EVEAgentIdUpdated(agentId);
    }

    function setSystemPrompt(string calldata nextSystemPrompt) external onlyOwner {
        require(bytes(nextSystemPrompt).length > 0, "EVEAgentRequester: empty system");
        systemPrompt = nextSystemPrompt;
        emit EVESystemPromptUpdated(nextSystemPrompt);
    }

    function getRequiredDeposit() external view returns (uint256) {
        return agentPlatform.getRequestDeposit() + (LLM_PRICE_PER_AGENT * STANDARD_SUBCOMMITTEE_SIZE);
    }

    function requestGovernanceReport(string calldata prompt)
        external
        payable
        onlyOwner
        nonReentrant
        returns (uint256 requestId)
    {
        require(bytes(prompt).length > 0, "EVEAgentRequester: empty prompt");
        uint256 requiredDeposit = agentPlatform.getRequestDeposit() + (LLM_PRICE_PER_AGENT * STANDARD_SUBCOMMITTEE_SIZE);
        require(msg.value >= requiredDeposit, "EVEAgentRequester: insufficient deposit");

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            systemPrompt,
            false,
            new string[](0)
        );

        requestId = agentPlatform.createRequest{value: msg.value}(
            eveAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );

        reports[requestId] = Report({
            requester: msg.sender,
            prompt: prompt,
            result: "",
            status: IAgentPlatform.ResponseStatus.Pending,
            createdAt: block.timestamp,
            resolvedAt: 0
        });

        emit EVEReportRequested(requestId, msg.sender, eveAgentId, prompt);
    }

    function handleResponse(
        uint256 requestId,
        IAgentPlatform.Response[] memory responses,
        IAgentPlatform.ResponseStatus status,
        IAgentPlatform.Request memory
    ) external {
        require(msg.sender == address(agentPlatform), "EVEAgentRequester: only platform");
        Report storage report = reports[requestId];
        require(report.createdAt != 0, "EVEAgentRequester: unknown request");

        string memory result = "";
        if (status == IAgentPlatform.ResponseStatus.Success && responses.length > 0) {
            result = abi.decode(responses[0].result, (string));
        }

        report.result = result;
        report.status = status;
        report.resolvedAt = block.timestamp;

        emit EVEReportResolved(requestId, status, result);
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = payable(owner()).call{value: amount}("");
        require(ok, "EVEAgentRequester: withdraw failed");
    }

    receive() external payable {}
}
