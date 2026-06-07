// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SASMultisigWallet
/// @notice Lightweight N-of-M multisig for SAS governance operations.
/// @dev Owner-management functions are `onlySelf`, meaning they can only be
///      changed via successful multisig execution.
contract SASMultisigWallet {
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    address[] private _owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    Transaction[] private _transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event Deposit(address indexed sender, uint256 amount, uint256 balance);
    event TransactionSubmitted(
        uint256 indexed txId,
        address indexed owner,
        address indexed to,
        uint256 value,
        bytes data
    );
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event TransactionRevoked(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(
        uint256 indexed txId,
        address indexed owner,
        bool success,
        bytes returnData
    );
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 indexed threshold);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "SASMultisig: caller not owner");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "SASMultisig: caller not self");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < _transactions.length, "SASMultisig: tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!_transactions[txId].executed, "SASMultisig: tx already executed");
        _;
    }

    modifier notConfirmed(uint256 txId) {
        require(!isConfirmed[txId][msg.sender], "SASMultisig: tx already confirmed");
        _;
    }

    constructor(address[] memory owners_, uint256 threshold_) {
        require(owners_.length > 0, "SASMultisig: owners required");
        require(
            threshold_ > 0 && threshold_ <= owners_.length,
            "SASMultisig: invalid threshold"
        );

        for (uint256 i = 0; i < owners_.length; i++) {
            address owner = owners_[i];
            require(owner != address(0), "SASMultisig: zero owner");
            require(!isOwner[owner], "SASMultisig: duplicate owner");

            isOwner[owner] = true;
            _owners.push(owner);
            emit OwnerAdded(owner);
        }

        threshold = threshold_;
        emit ThresholdChanged(threshold_);
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner returns (uint256 txId) {
        require(to != address(0), "SASMultisig: zero target");
        txId = _transactions.length;

        _transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                confirmations: 0
            })
        );

        emit TransactionSubmitted(txId, msg.sender, to, value, data);
    }

    function confirmTransaction(
        uint256 txId
    ) external onlyOwner txExists(txId) notExecuted(txId) notConfirmed(txId) {
        isConfirmed[txId][msg.sender] = true;
        _transactions[txId].confirmations += 1;
        emit TransactionConfirmed(txId, msg.sender);
    }

    function revokeConfirmation(
        uint256 txId
    ) external onlyOwner txExists(txId) notExecuted(txId) {
        require(isConfirmed[txId][msg.sender], "SASMultisig: tx not confirmed");

        isConfirmed[txId][msg.sender] = false;
        _transactions[txId].confirmations -= 1;
        emit TransactionRevoked(txId, msg.sender);
    }

    function executeTransaction(
        uint256 txId
    ) external onlyOwner txExists(txId) notExecuted(txId) {
        Transaction storage txn = _transactions[txId];
        require(
            txn.confirmations >= threshold,
            "SASMultisig: insufficient confirmations"
        );

        txn.executed = true;
        (bool success, bytes memory returnData) = txn.to.call{value: txn.value}(
            txn.data
        );

        emit TransactionExecuted(txId, msg.sender, success, returnData);
        if (!success) {
            _revertWithReason(returnData);
        }
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return _transactions.length;
    }

    function getTransaction(
        uint256 txId
    )
        external
        view
        txExists(txId)
        returns (
            address to,
            uint256 value,
            bytes memory data,
            bool executed,
            uint256 confirmations
        )
    {
        Transaction memory txn = _transactions[txId];
        return (
            txn.to,
            txn.value,
            txn.data,
            txn.executed,
            txn.confirmations
        );
    }

    function addOwner(address owner) external onlySelf {
        require(owner != address(0), "SASMultisig: zero owner");
        require(!isOwner[owner], "SASMultisig: already owner");

        isOwner[owner] = true;
        _owners.push(owner);
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlySelf {
        require(isOwner[owner], "SASMultisig: not owner");
        require(_owners.length > 1, "SASMultisig: at least one owner required");

        isOwner[owner] = false;

        uint256 len = _owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (_owners[i] == owner) {
                _owners[i] = _owners[len - 1];
                _owners.pop();
                emit OwnerRemoved(owner);
                break;
            }
        }

        if (threshold > _owners.length) {
            threshold = _owners.length;
            emit ThresholdChanged(threshold);
        }
    }

    function replaceOwner(address oldOwner, address newOwner) external onlySelf {
        require(isOwner[oldOwner], "SASMultisig: old owner not found");
        require(newOwner != address(0), "SASMultisig: zero new owner");
        require(!isOwner[newOwner], "SASMultisig: new owner already exists");

        isOwner[oldOwner] = false;
        isOwner[newOwner] = true;

        for (uint256 i = 0; i < _owners.length; i++) {
            if (_owners[i] == oldOwner) {
                _owners[i] = newOwner;
                break;
            }
        }

        emit OwnerRemoved(oldOwner);
        emit OwnerAdded(newOwner);
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        require(
            newThreshold > 0 && newThreshold <= _owners.length,
            "SASMultisig: invalid threshold"
        );
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    function _revertWithReason(bytes memory returnData) private pure {
        if (returnData.length == 0) {
            revert("SASMultisig: tx failed");
        }
        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}

