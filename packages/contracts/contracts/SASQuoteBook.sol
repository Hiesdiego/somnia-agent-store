// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SASTypes.sol";

interface ISASRegistryForQuoteBook {
    function getAgent(uint256 agentId) external view returns (SASTypes.AgentConfig memory);
}

/// @title SASQuoteBook
/// @notice Agent-to-agent RFQ and quote negotiation primitive.
contract SASQuoteBook is Ownable {
    enum RFQStatus {
        OPEN,
        QUOTED,
        ACCEPTED,
        CANCELLED,
        EXPIRED
    }

    struct RFQ {
        uint256 id;
        uint256 requesterAgentId;
        address requester;
        bytes32 taskHash;
        uint256 maxPrice;
        uint256 responseDeadline;
        RFQStatus status;
        uint256 acceptedQuoteId;
    }

    struct Quote {
        uint256 id;
        uint256 rfqId;
        uint256 providerAgentId;
        address provider;
        uint256 price;
        uint256 etaSeconds;
        uint256 confidenceBps;
        string metadataURI;
        bool accepted;
    }

    ISASRegistryForQuoteBook public immutable registry;
    uint256 public rfqCount;
    uint256 public quoteCount;

    mapping(uint256 => RFQ) public rfqs;
    mapping(uint256 => Quote) public quotes;
    mapping(uint256 => uint256[]) private _rfqQuoteIds;

    event RFQCreated(
        uint256 indexed rfqId,
        uint256 indexed requesterAgentId,
        address indexed requester,
        bytes32 taskHash,
        uint256 maxPrice,
        uint256 responseDeadline
    );
    event QuoteSubmitted(
        uint256 indexed quoteId,
        uint256 indexed rfqId,
        uint256 indexed providerAgentId,
        address provider,
        uint256 price,
        uint256 etaSeconds,
        uint256 confidenceBps
    );
    event QuoteAccepted(uint256 indexed rfqId, uint256 indexed quoteId);
    event RFQCancelled(uint256 indexed rfqId);
    event RFQExpired(uint256 indexed rfqId);

    constructor(address initialOwner, address registryAddress) Ownable(initialOwner) {
        require(registryAddress != address(0), "SASQuoteBook: zero registry");
        registry = ISASRegistryForQuoteBook(registryAddress);
    }

    modifier onlyRequester(uint256 rfqId) {
        require(rfqs[rfqId].requester == msg.sender, "SASQuoteBook: not RFQ requester");
        _;
    }

    function createRFQ(
        uint256 requesterAgentId,
        bytes32 taskHash,
        uint256 maxPrice,
        uint256 responseDeadline
    ) external returns (uint256 rfqId) {
        require(maxPrice > 0, "SASQuoteBook: max price is zero");
        require(responseDeadline > block.timestamp, "SASQuoteBook: invalid deadline");

        SASTypes.AgentConfig memory requesterAgent = registry.getAgent(requesterAgentId);
        require(requesterAgent.builder == msg.sender, "SASQuoteBook: not requester builder");

        rfqCount++;
        rfqId = rfqCount;

        rfqs[rfqId] = RFQ({
            id: rfqId,
            requesterAgentId: requesterAgentId,
            requester: msg.sender,
            taskHash: taskHash,
            maxPrice: maxPrice,
            responseDeadline: responseDeadline,
            status: RFQStatus.OPEN,
            acceptedQuoteId: 0
        });

        emit RFQCreated(
            rfqId,
            requesterAgentId,
            msg.sender,
            taskHash,
            maxPrice,
            responseDeadline
        );
    }

    function submitQuote(
        uint256 rfqId,
        uint256 providerAgentId,
        uint256 price,
        uint256 etaSeconds,
        uint256 confidenceBps,
        string calldata metadataURI
    ) external returns (uint256 quoteId) {
        RFQ storage rfq = rfqs[rfqId];
        require(rfq.id != 0, "SASQuoteBook: RFQ missing");
        require(rfq.status == RFQStatus.OPEN || rfq.status == RFQStatus.QUOTED, "SASQuoteBook: RFQ closed");
        require(block.timestamp <= rfq.responseDeadline, "SASQuoteBook: RFQ expired");
        require(price > 0 && price <= rfq.maxPrice, "SASQuoteBook: invalid price");
        require(confidenceBps <= 10_000, "SASQuoteBook: invalid confidence");

        SASTypes.AgentConfig memory providerAgent = registry.getAgent(providerAgentId);
        require(providerAgent.builder == msg.sender, "SASQuoteBook: not provider builder");

        quoteCount++;
        quoteId = quoteCount;

        quotes[quoteId] = Quote({
            id: quoteId,
            rfqId: rfqId,
            providerAgentId: providerAgentId,
            provider: msg.sender,
            price: price,
            etaSeconds: etaSeconds,
            confidenceBps: confidenceBps,
            metadataURI: metadataURI,
            accepted: false
        });

        _rfqQuoteIds[rfqId].push(quoteId);
        rfq.status = RFQStatus.QUOTED;

        emit QuoteSubmitted(
            quoteId,
            rfqId,
            providerAgentId,
            msg.sender,
            price,
            etaSeconds,
            confidenceBps
        );
    }

    function acceptQuote(uint256 rfqId, uint256 quoteId) external onlyRequester(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        require(rfq.status == RFQStatus.OPEN || rfq.status == RFQStatus.QUOTED, "SASQuoteBook: RFQ closed");
        require(block.timestamp <= rfq.responseDeadline, "SASQuoteBook: RFQ expired");

        Quote storage quote = quotes[quoteId];
        require(quote.id != 0, "SASQuoteBook: quote missing");
        require(quote.rfqId == rfqId, "SASQuoteBook: quote mismatch");

        quote.accepted = true;
        rfq.status = RFQStatus.ACCEPTED;
        rfq.acceptedQuoteId = quoteId;
        emit QuoteAccepted(rfqId, quoteId);
    }

    function cancelRFQ(uint256 rfqId) external onlyRequester(rfqId) {
        RFQ storage rfq = rfqs[rfqId];
        require(rfq.status == RFQStatus.OPEN || rfq.status == RFQStatus.QUOTED, "SASQuoteBook: RFQ closed");
        rfq.status = RFQStatus.CANCELLED;
        emit RFQCancelled(rfqId);
    }

    function markRFQExpired(uint256 rfqId) external {
        RFQ storage rfq = rfqs[rfqId];
        require(rfq.id != 0, "SASQuoteBook: RFQ missing");
        require(block.timestamp > rfq.responseDeadline, "SASQuoteBook: deadline not reached");
        require(rfq.status == RFQStatus.OPEN || rfq.status == RFQStatus.QUOTED, "SASQuoteBook: RFQ closed");
        rfq.status = RFQStatus.EXPIRED;
        emit RFQExpired(rfqId);
    }

    function getRFQQuotes(uint256 rfqId) external view returns (Quote[] memory list) {
        uint256[] storage ids = _rfqQuoteIds[rfqId];
        list = new Quote[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = quotes[ids[i]];
        }
    }
}
