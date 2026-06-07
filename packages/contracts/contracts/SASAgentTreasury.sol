// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SASTypes.sol";

interface ISASRegistryForTreasury {
    function getAgent(uint256 agentId) external view returns (SASTypes.AgentConfig memory);
}

/// @title SASAgentTreasury
/// @notice On-chain wallets for agents with delegated spending controls.
contract SASAgentTreasury is Ownable, ReentrancyGuard {
    ISASRegistryForTreasury public immutable registry;

    mapping(uint256 => uint256) public agentBalances;
    mapping(uint256 => mapping(address => bool)) public agentOperators;
    mapping(address => bool) public authorizedSpenders;

    event AgentFunded(uint256 indexed agentId, address indexed from, uint256 amount);
    event AgentWithdrawal(uint256 indexed agentId, address indexed to, uint256 amount);
    event AgentSpend(
        uint256 indexed agentId,
        address indexed spender,
        address indexed to,
        uint256 amount,
        bytes32 reasonId
    );
    event AgentOperatorUpdated(uint256 indexed agentId, address indexed operator, bool allowed);
    event AuthorizedSpenderUpdated(address indexed spender, bool allowed);

    modifier onlyAgentBuilder(uint256 agentId) {
        SASTypes.AgentConfig memory agent = registry.getAgent(agentId);
        require(agent.builder == msg.sender, "SASAgentTreasury: not agent builder");
        _;
    }

    constructor(address initialOwner, address registryAddress) Ownable(initialOwner) {
        require(registryAddress != address(0), "SASAgentTreasury: zero registry");
        registry = ISASRegistryForTreasury(registryAddress);
    }

    function setAuthorizedSpender(address spender, bool allowed) external onlyOwner {
        require(spender != address(0), "SASAgentTreasury: zero spender");
        authorizedSpenders[spender] = allowed;
        emit AuthorizedSpenderUpdated(spender, allowed);
    }

    function setAgentOperator(uint256 agentId, address operator, bool allowed)
        external
        onlyAgentBuilder(agentId)
    {
        require(operator != address(0), "SASAgentTreasury: zero operator");
        agentOperators[agentId][operator] = allowed;
        emit AgentOperatorUpdated(agentId, operator, allowed);
    }

    function fundAgent(uint256 agentId) external payable {
        require(msg.value > 0, "SASAgentTreasury: zero amount");
        registry.getAgent(agentId); // reverts if agent is missing
        agentBalances[agentId] += msg.value;
        emit AgentFunded(agentId, msg.sender, msg.value);
    }

    function withdrawAgentBalance(uint256 agentId, uint256 amount, address to)
        external
        nonReentrant
        onlyAgentBuilder(agentId)
    {
        require(to != address(0), "SASAgentTreasury: zero recipient");
        require(amount > 0 && amount <= agentBalances[agentId], "SASAgentTreasury: invalid amount");

        agentBalances[agentId] -= amount;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "SASAgentTreasury: withdraw transfer failed");
        emit AgentWithdrawal(agentId, to, amount);
    }

    function spendFromAgent(uint256 agentId, address to, uint256 amount, bytes32 reasonId)
        external
        nonReentrant
    {
        require(to != address(0), "SASAgentTreasury: zero recipient");
        require(amount > 0, "SASAgentTreasury: zero amount");

        SASTypes.AgentConfig memory agent = registry.getAgent(agentId);
        bool allowed = msg.sender == agent.builder
            || agentOperators[agentId][msg.sender]
            || authorizedSpenders[msg.sender];
        require(allowed, "SASAgentTreasury: unauthorized spender");
        require(amount <= agentBalances[agentId], "SASAgentTreasury: insufficient balance");

        agentBalances[agentId] -= amount;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "SASAgentTreasury: spend transfer failed");
        emit AgentSpend(agentId, msg.sender, to, amount, reasonId);
    }

    receive() external payable {}
}
