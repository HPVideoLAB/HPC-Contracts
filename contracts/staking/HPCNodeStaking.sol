// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HPCConstants} from "../libraries/HPCConstants.sol";

/**
 * @title HPCNodeStaking
 * @notice GPU node staking contract with:
 *         - Configurable minimum stake
 *         - 7-day unstake cooldown
 *         - Slashing mechanism (independent slasher role)
 *         - Synthetix StakingRewards-style reward distribution
 */
contract HPCNodeStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── State ──

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    address public slasher;
    uint256 public minimumStake;
    uint256 public slashPercentage; // 0-50, basis = 100

    // Reward accounting (Synthetix pattern)
    uint256 public rewardRate;          // tokens per second
    uint256 public rewardPeriodEnd;
    uint256 public rewardsDuration;     // seconds for each reward period
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    uint256 public totalStaked;

    struct StakeInfo {
        uint256 amount;
        uint256 unstakeRequestTime;    // 0 = no pending unstake
        uint256 unstakeRequestAmount;
        uint256 rewardPerTokenPaid;
        uint256 rewardsAccrued;
        uint256 lastSlashTime;         // cooldown: prevent rapid-fire slashing
    }

    mapping(address => StakeInfo) public stakes;

    uint256 public constant SLASH_COOLDOWN = 1 days;

    // ── Events ──

    event Staked(address indexed user, uint256 amount);
    event UnstakeRequested(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event Slashed(address indexed user, uint256 amount);
    event SlasherUpdated(address indexed newSlasher);
    event MinimumStakeUpdated(uint256 newMinimum);
    event SlashPercentageUpdated(uint256 newPercentage);
    event RewardAdded(uint256 reward, uint256 duration);

    // ── Errors ──

    error ZeroAddress();
    error ZeroAmount();
    error BelowMinimumStake();
    error CooldownNotElapsed();
    error NoUnstakePending();
    error InsufficientStake();
    error NotSlasher();
    error SlashPercentageTooHigh();
    error RewardDurationZero();
    error UnstakeAlreadyPending();
    error RewardTooHigh();
    error SlashCooldownActive();

    // ── Modifiers ──

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            StakeInfo storage info = stakes[account];
            info.rewardsAccrued = earned(account);
            info.rewardPerTokenPaid = rewardPerTokenStored;
        }
        _;
    }

    modifier onlySlasher() {
        if (msg.sender != slasher) revert NotSlasher();
        _;
    }

    // ── Constructor ──

    constructor(
        address _stakingToken,
        address _rewardToken,
        address _owner,
        address _slasher,
        uint256 _minimumStake,
        uint256 _slashPercentage,
        uint256 _rewardsDuration
    ) Ownable(_owner) {
        if (_stakingToken == address(0) || _rewardToken == address(0)) revert ZeroAddress();
        if (_slashPercentage > HPCConstants.MAX_SLASH_PERCENTAGE) revert SlashPercentageTooHigh();
        if (_rewardsDuration == 0) revert RewardDurationZero();

        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        slasher = _slasher;
        minimumStake = _minimumStake;
        slashPercentage = _slashPercentage;
        rewardsDuration = _rewardsDuration;
    }

    // ── Staking ──

    /**
     * @notice Stake tokens to become a GPU node operator.
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        StakeInfo storage info = stakes[msg.sender];
        uint256 newBalance = info.amount + amount;
        if (newBalance < minimumStake) revert BelowMinimumStake();

        info.amount = newBalance;
        totalStaked += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Request to unstake. Starts the 7-day cooldown.
     * @param amount Amount to unstake
     */
    function requestUnstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        StakeInfo storage info = stakes[msg.sender];
        if (info.unstakeRequestAmount > 0) revert UnstakeAlreadyPending();
        if (amount > info.amount) revert InsufficientStake();

        // If remaining balance would be non-zero but below minimum, must unstake all
        uint256 remaining = info.amount - amount;
        if (remaining > 0 && remaining < minimumStake) revert BelowMinimumStake();

        info.unstakeRequestTime = block.timestamp;
        info.unstakeRequestAmount = amount;

        emit UnstakeRequested(msg.sender, amount);
    }

    /**
     * @notice Complete unstake after cooldown has elapsed.
     */
    function withdraw() external nonReentrant updateReward(msg.sender) {
        StakeInfo storage info = stakes[msg.sender];
        if (info.unstakeRequestAmount == 0) revert NoUnstakePending();
        if (block.timestamp < info.unstakeRequestTime + HPCConstants.UNSTAKE_COOLDOWN) {
            revert CooldownNotElapsed();
        }

        // Cap to actual balance in case of slashing after unstake request
        uint256 amount = info.unstakeRequestAmount;
        if (amount > info.amount) {
            amount = info.amount;
        }

        info.amount -= amount;
        info.unstakeRequestAmount = 0;
        info.unstakeRequestTime = 0;
        totalStaked -= amount;

        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ── Rewards (Synthetix Pattern) ──

    /**
     * @notice Claim accumulated rewards.
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        StakeInfo storage info = stakes[msg.sender];
        uint256 reward = info.rewardsAccrued;
        if (reward == 0) revert ZeroAmount();

        info.rewardsAccrued = 0;
        rewardToken.safeTransfer(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < rewardPeriodEnd ? block.timestamp : rewardPeriodEnd;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored +
            ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        StakeInfo storage info = stakes[account];
        return (info.amount * (rewardPerToken() - info.rewardPerTokenPaid)) / 1e18
            + info.rewardsAccrued;
    }

    // ── Slashing ──

    /**
     * @notice Slash a misbehaving node operator. Only callable by the slasher role.
     * @param user The node operator to slash
     */
    function slash(address user) external onlySlasher nonReentrant updateReward(user) {
        StakeInfo storage info = stakes[user];
        if (info.amount == 0) revert ZeroAmount();
        if (block.timestamp < info.lastSlashTime + SLASH_COOLDOWN) revert SlashCooldownActive();

        info.lastSlashTime = block.timestamp;

        uint256 slashAmount = (info.amount * slashPercentage) / 100;
        info.amount -= slashAmount;
        totalStaked -= slashAmount;

        // Slashed tokens are sent to owner (may be forwarded to VaultLock or black-hole)
        stakingToken.safeTransfer(owner(), slashAmount);
        emit Slashed(user, slashAmount);
    }

    // ── Admin ──

    /**
     * @notice Notify the contract of new reward tokens and start a reward period.
     * @param reward Amount of reward tokens to distribute
     */
    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        if (block.timestamp >= rewardPeriodEnd) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = rewardPeriodEnd - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Verify contract holds enough reward tokens
        uint256 balance = rewardToken.balanceOf(address(this));
        if (address(rewardToken) == address(stakingToken)) {
            balance -= totalStaked;
        }
        if (rewardRate > balance / rewardsDuration) revert RewardTooHigh();

        lastUpdateTime = block.timestamp;
        rewardPeriodEnd = block.timestamp + rewardsDuration;

        emit RewardAdded(reward, rewardsDuration);
    }

    function setSlasher(address _slasher) external onlyOwner {
        slasher = _slasher;
        emit SlasherUpdated(_slasher);
    }

    function setMinimumStake(uint256 _minimumStake) external onlyOwner {
        minimumStake = _minimumStake;
        emit MinimumStakeUpdated(_minimumStake);
    }

    function setSlashPercentage(uint256 _percentage) external onlyOwner {
        if (_percentage > HPCConstants.MAX_SLASH_PERCENTAGE) revert SlashPercentageTooHigh();
        slashPercentage = _percentage;
        emit SlashPercentageUpdated(_percentage);
    }

    // ── View ──

    function getStakeInfo(address user) external view returns (
        uint256 amount,
        uint256 unstakeRequestTime,
        uint256 unstakeRequestAmount,
        uint256 pendingRewards,
        uint256 lastSlashTime
    ) {
        StakeInfo storage info = stakes[user];
        return (info.amount, info.unstakeRequestTime, info.unstakeRequestAmount, earned(user), info.lastSlashTime);
    }
}
