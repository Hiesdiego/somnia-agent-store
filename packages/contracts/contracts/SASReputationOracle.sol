// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SASReputationOracle
/// @notice Stores per-epoch objective agent performance snapshots and computed score.
contract SASReputationOracle is Ownable {
    struct ReputationWeights {
        uint256 successRateWeightBps;
        uint256 latencyWeightBps;
        uint256 disputeWeightBps;
        uint256 refundWeightBps;
        uint256 verifierAgreementWeightBps;
        uint256 economicEfficiencyWeightBps;
    }

    struct ReputationSnapshot {
        uint256 epoch;
        uint256 agentId;
        uint256 executions;
        uint256 successRateBps;
        uint256 avgLatencyMs;
        uint256 disputeRateBps;
        uint256 refundRateBps;
        uint256 verifierAgreementBps;
        uint256 economicEfficiencyBps;
        uint256 scoreBps;
        uint256 updatedAt;
        string evidenceURI;
    }

    struct SnapshotInput {
        uint256 agentId;
        uint256 epoch;
        uint256 executions;
        uint256 successRateBps;
        uint256 avgLatencyMs;
        uint256 disputeRateBps;
        uint256 refundRateBps;
        uint256 verifierAgreementBps;
        uint256 economicEfficiencyBps;
        string evidenceURI;
    }

    ReputationWeights public weights;
    uint256 public latencySaturationMs;
    mapping(address => bool) public updaters;
    mapping(uint256 => mapping(uint256 => ReputationSnapshot)) private _snapshots; // agentId => epoch => snapshot
    mapping(uint256 => uint256) public latestEpochByAgent;

    event UpdaterUpdated(address indexed updater, bool allowed);
    event WeightsUpdated(
        uint256 successRateWeightBps,
        uint256 latencyWeightBps,
        uint256 disputeWeightBps,
        uint256 refundWeightBps,
        uint256 verifierAgreementWeightBps,
        uint256 economicEfficiencyWeightBps
    );
    event LatencySaturationUpdated(uint256 latencySaturationMs);
    event ReputationSnapshotSubmitted(
        uint256 indexed agentId,
        uint256 indexed epoch,
        uint256 scoreBps,
        string evidenceURI
    );

    modifier onlyUpdater() {
        require(updaters[msg.sender], "SASReputationOracle: not updater");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {
        weights = ReputationWeights({
            successRateWeightBps: 3000,
            latencyWeightBps: 1500,
            disputeWeightBps: 1500,
            refundWeightBps: 1000,
            verifierAgreementWeightBps: 2000,
            economicEfficiencyWeightBps: 1000
        });
        latencySaturationMs = 300_000;
    }

    function setUpdater(address updater, bool allowed) external onlyOwner {
        require(updater != address(0), "SASReputationOracle: zero updater");
        updaters[updater] = allowed;
        emit UpdaterUpdated(updater, allowed);
    }

    function setWeights(
        uint256 successRateWeightBps,
        uint256 latencyWeightBps,
        uint256 disputeWeightBps,
        uint256 refundWeightBps,
        uint256 verifierAgreementWeightBps,
        uint256 economicEfficiencyWeightBps
    ) external onlyOwner {
        uint256 sum = successRateWeightBps
            + latencyWeightBps
            + disputeWeightBps
            + refundWeightBps
            + verifierAgreementWeightBps
            + economicEfficiencyWeightBps;
        require(sum == 10_000, "SASReputationOracle: weights must sum to 10000");

        weights = ReputationWeights({
            successRateWeightBps: successRateWeightBps,
            latencyWeightBps: latencyWeightBps,
            disputeWeightBps: disputeWeightBps,
            refundWeightBps: refundWeightBps,
            verifierAgreementWeightBps: verifierAgreementWeightBps,
            economicEfficiencyWeightBps: economicEfficiencyWeightBps
        });

        emit WeightsUpdated(
            successRateWeightBps,
            latencyWeightBps,
            disputeWeightBps,
            refundWeightBps,
            verifierAgreementWeightBps,
            economicEfficiencyWeightBps
        );
    }

    function setLatencySaturationMs(uint256 _latencySaturationMs) external onlyOwner {
        require(_latencySaturationMs > 0, "SASReputationOracle: invalid saturation");
        latencySaturationMs = _latencySaturationMs;
        emit LatencySaturationUpdated(_latencySaturationMs);
    }

    function submitSnapshot(SnapshotInput calldata input) external onlyUpdater returns (uint256 scoreBps) {
        require(input.agentId > 0, "SASReputationOracle: invalid agent");
        require(input.epoch > 0, "SASReputationOracle: invalid epoch");
        require(input.successRateBps <= 10_000, "SASReputationOracle: invalid success rate");
        require(input.disputeRateBps <= 10_000, "SASReputationOracle: invalid dispute rate");
        require(input.refundRateBps <= 10_000, "SASReputationOracle: invalid refund rate");
        require(input.verifierAgreementBps <= 10_000, "SASReputationOracle: invalid verifier rate");
        require(input.economicEfficiencyBps <= 10_000, "SASReputationOracle: invalid efficiency");

        uint256 latencyScoreBps = _latencyScore(input.avgLatencyMs);
        uint256 disputeQualityBps = 10_000 - input.disputeRateBps;
        uint256 refundQualityBps = 10_000 - input.refundRateBps;

        scoreBps = (
            input.successRateBps * weights.successRateWeightBps
            + latencyScoreBps * weights.latencyWeightBps
            + disputeQualityBps * weights.disputeWeightBps
            + refundQualityBps * weights.refundWeightBps
            + input.verifierAgreementBps * weights.verifierAgreementWeightBps
            + input.economicEfficiencyBps * weights.economicEfficiencyWeightBps
        ) / 10_000;

        _snapshots[input.agentId][input.epoch] = ReputationSnapshot({
            epoch: input.epoch,
            agentId: input.agentId,
            executions: input.executions,
            successRateBps: input.successRateBps,
            avgLatencyMs: input.avgLatencyMs,
            disputeRateBps: input.disputeRateBps,
            refundRateBps: input.refundRateBps,
            verifierAgreementBps: input.verifierAgreementBps,
            economicEfficiencyBps: input.economicEfficiencyBps,
            scoreBps: scoreBps,
            updatedAt: block.timestamp,
            evidenceURI: input.evidenceURI
        });

        if (input.epoch > latestEpochByAgent[input.agentId]) {
            latestEpochByAgent[input.agentId] = input.epoch;
        }

        emit ReputationSnapshotSubmitted(input.agentId, input.epoch, scoreBps, input.evidenceURI);
    }

    function getSnapshot(uint256 agentId, uint256 epoch)
        external
        view
        returns (ReputationSnapshot memory)
    {
        return _snapshots[agentId][epoch];
    }

    function getLatestSnapshot(uint256 agentId)
        external
        view
        returns (ReputationSnapshot memory)
    {
        uint256 epoch = latestEpochByAgent[agentId];
        return _snapshots[agentId][epoch];
    }

    function _latencyScore(uint256 avgLatencyMs) internal view returns (uint256) {
        if (avgLatencyMs >= latencySaturationMs) return 0;
        uint256 remaining = latencySaturationMs - avgLatencyMs;
        return (remaining * 10_000) / latencySaturationMs;
    }
}
