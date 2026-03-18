// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HPCDistributor
 * @notice Merkle-tree based airdrop distribution for HPC tokens.
 *         Supports 5,000-10,000 recipients. Users claim individually to avoid gas limits.
 *         Owner can recover unclaimed tokens after the expiry timestamp.
 */
contract HPCDistributor is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    uint256 public immutable expiryTimestamp;

    mapping(address => bool) public hasClaimed;

    uint256 public totalClaimed;

    // ── Events ──

    event Claimed(address indexed account, uint256 amount);
    event Recovered(address indexed to, uint256 amount);

    // ── Errors ──

    error AlreadyClaimed();
    error InvalidProof();
    error NotExpired();
    error ZeroAddress();

    constructor(
        address _token,
        bytes32 _merkleRoot,
        uint256 _expiryTimestamp,
        address _owner
    ) Ownable(_owner) {
        if (_token == address(0)) revert ZeroAddress();
        require(_expiryTimestamp > block.timestamp, "expiry must be future");

        token = IERC20(_token);
        merkleRoot = _merkleRoot;
        expiryTimestamp = _expiryTimestamp;
    }

    /**
     * @notice Claim airdrop tokens. Caller must provide a valid Merkle proof.
     * @param amount The allocated amount for this address
     * @param proof  The Merkle proof
     */
    function claim(uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        // Verify inclusion: leaf = keccak256(abi.encodePacked(account, amount))
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();

        hasClaimed[msg.sender] = true;
        totalClaimed += amount;

        token.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Recover unclaimed tokens after expiry. Only callable by owner.
     * @param to Destination address for recovered tokens
     */
    function recover(address to) external onlyOwner {
        if (block.timestamp < expiryTimestamp) revert NotExpired();
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(to, balance);
            emit Recovered(to, balance);
        }
    }
}
