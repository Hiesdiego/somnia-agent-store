// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title SASAdminTimelock
/// @notice Timelock governance controller for SAS v0.1 admin actions.
contract SASAdminTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}

