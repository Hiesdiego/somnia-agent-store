// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SASVerifierRegistry
/// @notice Stakes and lifecycle for verifier agents.
contract SASVerifierRegistry is Ownable, ReentrancyGuard {
    struct VerifierProfile {
        bool active;
        uint256 stake;
        uint256 acceptedReports;
        uint256 rejectedReports;
        uint256 slashCount;
        uint256 joinedAt;
        string metadataURI;
    }

    uint256 public minStake;
    mapping(address => VerifierProfile) public verifiers;
    mapping(address => bool) public reportWriters;

    event VerifierRegistered(address indexed verifier, uint256 stake, string metadataURI);
    event VerifierStakeAdded(address indexed verifier, uint256 amount, uint256 newStake);
    event VerifierStakeWithdrawn(address indexed verifier, address indexed to, uint256 amount);
    event VerifierStatusUpdated(address indexed verifier, bool active);
    event VerifierSlashed(address indexed verifier, uint256 amount, address indexed recipient);
    event VerifierReportRecorded(address indexed verifier, bool agreed);
    event MinStakeUpdated(uint256 minStake);
    event ReportWriterUpdated(address indexed writer, bool allowed);

    modifier onlyReportWriter() {
        require(reportWriters[msg.sender], "SASVerifierRegistry: not report writer");
        _;
    }

    constructor(address initialOwner, uint256 _minStake) Ownable(initialOwner) {
        require(_minStake > 0, "SASVerifierRegistry: min stake is zero");
        minStake = _minStake;
    }

    function setMinStake(uint256 _minStake) external onlyOwner {
        require(_minStake > 0, "SASVerifierRegistry: min stake is zero");
        minStake = _minStake;
        emit MinStakeUpdated(_minStake);
    }

    function setReportWriter(address writer, bool allowed) external onlyOwner {
        require(writer != address(0), "SASVerifierRegistry: zero writer");
        reportWriters[writer] = allowed;
        emit ReportWriterUpdated(writer, allowed);
    }

    function registerVerifier(string calldata metadataURI) external payable {
        VerifierProfile storage profile = verifiers[msg.sender];
        if (profile.joinedAt == 0) {
            require(msg.value >= minStake, "SASVerifierRegistry: insufficient initial stake");
            verifiers[msg.sender] = VerifierProfile({
                active: true,
                stake: msg.value,
                acceptedReports: 0,
                rejectedReports: 0,
                slashCount: 0,
                joinedAt: block.timestamp,
                metadataURI: metadataURI
            });
            emit VerifierRegistered(msg.sender, msg.value, metadataURI);
            return;
        }

        if (msg.value > 0) {
            profile.stake += msg.value;
            emit VerifierStakeAdded(msg.sender, msg.value, profile.stake);
        }

        require(profile.stake >= minStake, "SASVerifierRegistry: stake below minimum");
        profile.active = true;
        profile.metadataURI = metadataURI;
        emit VerifierStatusUpdated(msg.sender, true);
    }

    function addStake() external payable {
        require(msg.value > 0, "SASVerifierRegistry: zero amount");
        VerifierProfile storage profile = verifiers[msg.sender];
        require(profile.joinedAt != 0, "SASVerifierRegistry: not registered");
        profile.stake += msg.value;
        emit VerifierStakeAdded(msg.sender, msg.value, profile.stake);
    }

    function setVerifierActive(bool active) external {
        VerifierProfile storage profile = verifiers[msg.sender];
        require(profile.joinedAt != 0, "SASVerifierRegistry: not registered");
        if (active) {
            require(profile.stake >= minStake, "SASVerifierRegistry: stake below minimum");
        }
        profile.active = active;
        emit VerifierStatusUpdated(msg.sender, active);
    }

    function adminSetVerifierActive(address verifier, bool active) external onlyOwner {
        VerifierProfile storage profile = verifiers[verifier];
        require(profile.joinedAt != 0, "SASVerifierRegistry: verifier missing");
        if (active) {
            require(profile.stake >= minStake, "SASVerifierRegistry: stake below minimum");
        }
        profile.active = active;
        emit VerifierStatusUpdated(verifier, active);
    }

    function withdrawStake(uint256 amount, address to) external nonReentrant {
        require(to != address(0), "SASVerifierRegistry: zero recipient");
        VerifierProfile storage profile = verifiers[msg.sender];
        require(profile.joinedAt != 0, "SASVerifierRegistry: not registered");
        require(!profile.active, "SASVerifierRegistry: deactivate before withdraw");
        require(amount > 0 && amount <= profile.stake, "SASVerifierRegistry: invalid amount");

        profile.stake -= amount;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "SASVerifierRegistry: withdraw transfer failed");

        emit VerifierStakeWithdrawn(msg.sender, to, amount);
    }

    function slashVerifier(address verifier, uint256 amount, address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "SASVerifierRegistry: zero recipient");
        VerifierProfile storage profile = verifiers[verifier];
        require(profile.joinedAt != 0, "SASVerifierRegistry: verifier missing");
        require(amount > 0 && amount <= profile.stake, "SASVerifierRegistry: invalid slash amount");

        profile.stake -= amount;
        profile.slashCount += 1;
        if (profile.stake < minStake) {
            profile.active = false;
        }

        (bool ok, ) = payable(recipient).call{value: amount}("");
        require(ok, "SASVerifierRegistry: slash transfer failed");
        emit VerifierSlashed(verifier, amount, recipient);
    }

    function recordReport(address verifier, bool agreed) external onlyReportWriter {
        VerifierProfile storage profile = verifiers[verifier];
        require(profile.joinedAt != 0, "SASVerifierRegistry: verifier missing");
        if (agreed) {
            profile.acceptedReports += 1;
        } else {
            profile.rejectedReports += 1;
        }
        emit VerifierReportRecorded(verifier, agreed);
    }

    function isVerifier(address verifier) external view returns (bool) {
        VerifierProfile storage profile = verifiers[verifier];
        return profile.active && profile.stake >= minStake;
    }

    receive() external payable {}
}
