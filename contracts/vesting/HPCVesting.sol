// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HPCVesting
 * @notice Multi-category vesting engine for HPC token distribution.
 *         Supports TGE unlock, cliff period, linear release, and revocable grants.
 *
 *  Categories & Schedules:
 *  ┌──────────────────────┬────────┬─────┬───────┬─────────┬───────────┐
 *  │ Category             │ Amount │ TGE │ Cliff │ Linear  │ Revocable │
 *  ├──────────────────────┼────────┼─────┼───────┼─────────┼───────────┤
 *  │ Core Team            │ 100M   │  0% │ 12mo  │ 20mo    │ Yes       │
 *  │ Series A             │ 100M   │  0% │ 12mo  │ 20mo    │ No        │
 *  │ Early Participants   │  50M   │  0% │ 12mo  │ 20mo    │ No        │
 *  │ Protocol Foundation  │ 100M   │  0% │ 12mo  │ 20mo    │ Yes       │
 *  │ GPU Compute          │ 250M   │  0% │  0    │ 60mo    │ Yes       │
 *  │ Ecosystem Growth     │ 150M   │110M │  0    │ 10mo    │ Yes       │
 *  │ Staking Incentives   │  70M   │ 14M │  0    │  5mo    │ Yes       │
 *  │ Competitive Mining   │  80M   │ 16M │  0    │  5mo    │ Yes       │
 *  └──────────────────────┴────────┴─────┴───────┴─────────┴───────────┘
 */
contract HPCVesting is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ──

    struct Schedule {
        uint256 totalAmount;     // total tokens allocated to this category
        uint256 tgeAmount;       // tokens released at TGE (start)
        uint256 cliffDuration;   // seconds after start before linear vesting begins
        uint256 vestingDuration; // seconds of linear vesting after cliff
        bool revocable;          // whether owner can revoke unvested tokens
    }

    struct Grant {
        uint8 categoryId;
        uint256 amount;       // total grant amount for this beneficiary
        uint256 claimed;      // amount already claimed
        bool revoked;
    }

    // ── State ──

    IERC20 public immutable token;
    uint256 public startTime;       // TGE timestamp
    bool public started;

    /// @dev categoryId => Schedule
    mapping(uint8 => Schedule) public schedules;
    uint8 public scheduleCount;

    /// @dev categoryId => total amount allocated via grants
    mapping(uint8 => uint256) public categoryAllocated;

    /// @dev beneficiary => array of grants
    mapping(address => Grant[]) public grants;

    // ── Events ──

    event VestingStarted(uint256 startTime);
    event ScheduleCreated(uint8 indexed categoryId, uint256 totalAmount);
    event GrantAdded(address indexed beneficiary, uint8 indexed categoryId, uint256 amount, uint256 grantIndex);
    event Claimed(address indexed beneficiary, uint256 amount);
    event GrantRevoked(address indexed beneficiary, uint256 grantIndex, uint256 unvestedReturned);

    // ── Errors ──

    error AlreadyStarted();
    error NotStarted();
    error InvalidSchedule();
    error CategoryAllocationExceeded();
    error GrantNotRevocable();
    error GrantAlreadyRevoked();
    error NothingToClaim();
    error ZeroAddress();
    error ZeroAmount();

    // ── Constructor ──

    constructor(address _token, address _owner) Ownable(_owner) {
        if (_token == address(0)) revert ZeroAddress();
        token = IERC20(_token);
    }

    // ── Admin: Schedule Management ──

    /**
     * @notice Create a new vesting schedule (category). Must be called before start().
     */
    function createSchedule(
        uint256 totalAmount,
        uint256 tgeAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable
    ) external onlyOwner {
        if (started) revert AlreadyStarted();
        if (tgeAmount > totalAmount) revert InvalidSchedule();
        if (vestingDuration == 0 && tgeAmount < totalAmount) revert InvalidSchedule();

        uint8 id = scheduleCount;
        schedules[id] = Schedule({
            totalAmount: totalAmount,
            tgeAmount: tgeAmount,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            revocable: revocable
        });
        scheduleCount = id + 1;

        emit ScheduleCreated(id, totalAmount);
    }

    /**
     * @notice Start the vesting clock (TGE). Irreversible.
     *         Requires contract to hold enough tokens for all schedules.
     */
    error InsufficientBalance();

    function start() external onlyOwner {
        if (started) revert AlreadyStarted();

        uint256 totalRequired;
        for (uint8 i = 0; i < scheduleCount; i++) {
            totalRequired += schedules[i].totalAmount;
        }
        if (token.balanceOf(address(this)) < totalRequired) revert InsufficientBalance();

        started = true;
        startTime = block.timestamp;
        emit VestingStarted(block.timestamp);
    }

    // ── Admin: Grant Management ──

    /**
     * @notice Add a vesting grant for a beneficiary under a specific category.
     * @param beneficiary The recipient address
     * @param categoryId  The schedule category
     * @param amount      Token amount for this grant
     */
    function addGrant(
        address beneficiary,
        uint8 categoryId,
        uint256 amount
    ) external onlyOwner {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (categoryId >= scheduleCount) revert InvalidSchedule();

        Schedule storage schedule = schedules[categoryId];
        if (categoryAllocated[categoryId] + amount > schedule.totalAmount) {
            revert CategoryAllocationExceeded();
        }

        categoryAllocated[categoryId] += amount;

        uint256 grantIndex = grants[beneficiary].length;
        grants[beneficiary].push(Grant({
            categoryId: categoryId,
            amount: amount,
            claimed: 0,
            revoked: false
        }));

        emit GrantAdded(beneficiary, categoryId, amount, grantIndex);
    }

    /**
     * @notice Batch-add grants for multiple beneficiaries in a single category.
     */
    function addGrantsBatch(
        uint8 categoryId,
        address[] calldata beneficiaries,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(beneficiaries.length == amounts.length, "length mismatch");
        if (categoryId >= scheduleCount) revert InvalidSchedule();

        Schedule storage schedule = schedules[categoryId];
        uint256 totalNew;

        for (uint256 i = 0; i < beneficiaries.length; i++) {
            if (beneficiaries[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            totalNew += amounts[i];

            uint256 grantIndex = grants[beneficiaries[i]].length;
            grants[beneficiaries[i]].push(Grant({
                categoryId: categoryId,
                amount: amounts[i],
                claimed: 0,
                revoked: false
            }));
            emit GrantAdded(beneficiaries[i], categoryId, amounts[i], grantIndex);
        }

        if (categoryAllocated[categoryId] + totalNew > schedule.totalAmount) {
            revert CategoryAllocationExceeded();
        }
        categoryAllocated[categoryId] += totalNew;
    }

    /**
     * @notice Revoke a grant. Only works for revocable categories.
     *         Unvested tokens are returned to the owner.
     */
    function revokeGrant(address beneficiary, uint256 grantIndex) external onlyOwner nonReentrant {
        Grant storage grant = grants[beneficiary][grantIndex];
        Schedule storage schedule = schedules[grant.categoryId];

        if (!schedule.revocable) revert GrantNotRevocable();
        if (grant.revoked) revert GrantAlreadyRevoked();

        uint256 vested = _vestedAmount(grant, schedule);
        uint256 unvested = grant.amount - vested;

        grant.revoked = true;
        grant.amount = vested; // shrink to vested only

        categoryAllocated[grant.categoryId] -= unvested;

        if (unvested > 0) {
            token.safeTransfer(owner(), unvested);
        }

        emit GrantRevoked(beneficiary, grantIndex, unvested);
    }

    // ── Beneficiary: Claim ──

    /**
     * @notice Claim all available vested tokens across all grants.
     */
    function claim() external nonReentrant {
        if (!started) revert NotStarted();

        uint256 totalClaimable;
        Grant[] storage userGrants = grants[msg.sender];

        for (uint256 i = 0; i < userGrants.length; i++) {
            Grant storage grant = userGrants[i];
            if (grant.revoked && grant.claimed >= grant.amount) continue;

            Schedule storage schedule = schedules[grant.categoryId];
            uint256 vested = _vestedAmount(grant, schedule);
            uint256 amount = vested - grant.claimed;

            if (amount > 0) {
                grant.claimed += amount;
                totalClaimable += amount;
            }
        }

        if (totalClaimable == 0) revert NothingToClaim();

        token.safeTransfer(msg.sender, totalClaimable);
        emit Claimed(msg.sender, totalClaimable);
    }

    // ── View Functions ──

    /**
     * @notice Get total claimable amount for a beneficiary.
     */
    function claimable(address beneficiary) external view returns (uint256 total) {
        if (!started) return 0;

        Grant[] storage userGrants = grants[beneficiary];
        for (uint256 i = 0; i < userGrants.length; i++) {
            Grant storage grant = userGrants[i];
            if (grant.revoked && grant.claimed >= grant.amount) continue;

            Schedule storage schedule = schedules[grant.categoryId];
            uint256 vested = _vestedAmount(grant, schedule);
            total += vested - grant.claimed;
        }
    }

    /**
     * @notice Get number of grants for a beneficiary.
     */
    function grantCount(address beneficiary) external view returns (uint256) {
        return grants[beneficiary].length;
    }

    /**
     * @notice Get grant details for a beneficiary at a specific index.
     */
    function getGrant(address beneficiary, uint256 index) external view returns (
        uint8 categoryId,
        uint256 amount,
        uint256 claimed,
        bool revoked
    ) {
        Grant storage grant = grants[beneficiary][index];
        return (grant.categoryId, grant.amount, grant.claimed, grant.revoked);
    }

    // ── Internal ──

    function _vestedAmount(
        Grant storage grant,
        Schedule storage schedule
    ) internal view returns (uint256) {
        if (!started) return 0;

        // After revoke, grant.amount was set to exact vested amount at revoke time.
        // No recalculation needed — return it directly to avoid TGE pro-rata distortion.
        if (grant.revoked) return grant.amount;

        uint256 elapsed = block.timestamp - startTime;

        // TGE portion (pro-rata of grant vs category total)
        uint256 grantTge = 0;
        if (schedule.tgeAmount > 0 && schedule.totalAmount > 0) {
            grantTge = (grant.amount * schedule.tgeAmount) / schedule.totalAmount;
        }

        uint256 vestingPortion = grant.amount - grantTge;

        // Before cliff: only TGE
        if (elapsed < schedule.cliffDuration) {
            return grantTge;
        }

        // After cliff: TGE + linear portion
        if (schedule.vestingDuration == 0) {
            return grant.amount;
        }

        uint256 elapsedAfterCliff = elapsed - schedule.cliffDuration;
        if (elapsedAfterCliff >= schedule.vestingDuration) {
            return grant.amount;
        }

        uint256 linearVested = (vestingPortion * elapsedAfterCliff) / schedule.vestingDuration;
        return grantTge + linearVested;
    }
}
