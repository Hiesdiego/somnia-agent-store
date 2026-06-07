// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../SASTypes.sol";

interface ISASBillingLike {
    function resolveExecution(
        uint256 executionId,
        SASTypes.ExecutionStatus status,
        bytes calldata result,
        uint256 somniaRequestId
    ) external;
}

contract MockExecutor {
    uint256 public runtimeBudget;
    uint256 public lastValue;

    struct LastCall {
        uint256 executionId;
        uint256 agentId;
        address subscriber;
        bytes payload;
    }

    LastCall public lastCall;

    function setRuntimeBudget(uint256 value) external {
        runtimeBudget = value;
    }

    function quoteRuntimeBudget(SASTypes.AgentType agentType) external view returns (uint256) {
        return agentType == SASTypes.AgentType.CUSTOM_OFFCHAIN ? 0 : runtimeBudget;
    }

    function execute(
        uint256 executionId,
        SASTypes.AgentConfig memory agent,
        address subscriber,
        bytes calldata payload
    ) external payable {
        lastValue = msg.value;
        lastCall = LastCall({
            executionId: executionId,
            agentId: agent.id,
            subscriber: subscriber,
            payload: payload
        });
    }

    function resolveOnBilling(
        address billing,
        uint256 executionId,
        SASTypes.ExecutionStatus status,
        bytes calldata result,
        uint256 somniaRequestId
    ) external {
        ISASBillingLike(billing).resolveExecution(executionId, status, result, somniaRequestId);
    }
}
