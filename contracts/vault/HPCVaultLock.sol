// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HPCVaultLock
 * @notice 代币锁仓合约。任何人可存入 HPC，每笔存入锁定 1 年。
 *         锁定期满后 owner 可提取对应代币。
 */
contract HPCVaultLock is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant LOCK_DURATION = 365 days;

    struct Deposit {
        address depositor;   // 存入者
        uint256 amount;      // 存入数量
        uint256 unlockTime;  // 解锁时间
        bool withdrawn;      // 是否已被 owner 提取
    }

    Deposit[] public deposits;
    uint256 public totalLocked;    // 当前锁定中的总量
    uint256 public totalDeposited; // 历史存入总量

    // ── Events ──

    event Deposited(uint256 indexed depositId, address indexed depositor, uint256 amount, uint256 unlockTime);
    event Withdrawn(uint256 indexed depositId, address indexed to, uint256 amount);

    // ── Errors ──

    error ZeroAmount();
    error StillLocked(uint256 unlockTime);
    error AlreadyWithdrawn();
    error ZeroAddress();

    constructor(address _token, address _owner) Ownable(_owner) {
        if (_token == address(0)) revert ZeroAddress();
        token = IERC20(_token);
    }

    /**
     * @notice 存入代币，锁定 1 年。任何人都可调用。
     * @param amount 存入数量
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 unlockTime = block.timestamp + LOCK_DURATION;
        uint256 depositId = deposits.length;

        deposits.push(Deposit({
            depositor: msg.sender,
            amount: amount,
            unlockTime: unlockTime,
            withdrawn: false
        }));

        totalLocked += amount;
        totalDeposited += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(depositId, msg.sender, amount, unlockTime);
    }

    /**
     * @notice Owner 提取已解锁的存款。
     * @param depositId 存款 ID
     * @param to 接收地址
     */
    function withdraw(uint256 depositId, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        Deposit storage d = deposits[depositId];
        if (d.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < d.unlockTime) revert StillLocked(d.unlockTime);

        d.withdrawn = true;
        totalLocked -= d.amount;

        token.safeTransfer(to, d.amount);
        emit Withdrawn(depositId, to, d.amount);
    }

    /**
     * @notice Owner 批量提取多个已解锁存款。
     * @param depositIds 存款 ID 数组
     * @param to 接收地址
     */
    function withdrawBatch(uint256[] calldata depositIds, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        uint256 totalAmount;
        for (uint256 i = 0; i < depositIds.length; i++) {
            Deposit storage d = deposits[depositIds[i]];
            if (d.withdrawn) revert AlreadyWithdrawn();
            if (block.timestamp < d.unlockTime) revert StillLocked(d.unlockTime);

            d.withdrawn = true;
            totalAmount += d.amount;
        }

        totalLocked -= totalAmount;
        token.safeTransfer(to, totalAmount);

        for (uint256 i = 0; i < depositIds.length; i++) {
            emit Withdrawn(depositIds[i], to, deposits[depositIds[i]].amount);
        }
    }

    // ── View ──

    /**
     * @notice 获取存款总数。
     */
    function depositCount() external view returns (uint256) {
        return deposits.length;
    }

    /**
     * @notice 查询某笔存款详情。
     */
    function getDeposit(uint256 depositId) external view returns (
        address depositor,
        uint256 amount,
        uint256 unlockTime,
        bool withdrawn,
        bool unlocked
    ) {
        Deposit storage d = deposits[depositId];
        return (d.depositor, d.amount, d.unlockTime, d.withdrawn, block.timestamp >= d.unlockTime);
    }
}
