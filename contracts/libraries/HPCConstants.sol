// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library HPCConstants {
    // ── Total Supply ──
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 1 Billion HPC

    // ── Allocation Amounts (raw token, 18 decimals) ──
    uint256 internal constant CORE_TEAM          = 100_000_000 * 1e18;
    uint256 internal constant SERIES_A            = 100_000_000 * 1e18;
    uint256 internal constant EARLY_PARTICIPANTS  =  50_000_000 * 1e18;
    uint256 internal constant PROTOCOL_FOUNDATION = 100_000_000 * 1e18;
    uint256 internal constant GPU_COMPUTE         = 250_000_000 * 1e18;
    uint256 internal constant ECOSYSTEM_GROWTH    = 150_000_000 * 1e18;
    uint256 internal constant STAKING_INCENTIVES  =  70_000_000 * 1e18;
    uint256 internal constant COMPETITIVE_MINING  =  80_000_000 * 1e18;
    uint256 internal constant AIRDROP             =  50_000_000 * 1e18;
    uint256 internal constant LIQUIDITY           =  50_000_000 * 1e18;

    // ── TGE Unlock Amounts ──
    uint256 internal constant ECOSYSTEM_TGE       = 110_000_000 * 1e18;
    uint256 internal constant STAKING_TGE          =  14_000_000 * 1e18;
    uint256 internal constant MINING_TGE           =  16_000_000 * 1e18;

    // ── Time Constants ──
    uint256 internal constant MONTH = 30 days;

    uint256 internal constant CLIFF_12_MONTHS = 12 * MONTH;
    uint256 internal constant CLIFF_0         = 0;

    uint256 internal constant VESTING_20_MONTHS = 20 * MONTH;
    uint256 internal constant VESTING_60_MONTHS = 60 * MONTH;
    uint256 internal constant VESTING_10_MONTHS = 10 * MONTH;
    uint256 internal constant VESTING_5_MONTHS  =  5 * MONTH;

    // ── Staking Constants ──
    uint256 internal constant UNSTAKE_COOLDOWN = 7 days;
    uint256 internal constant MAX_SLASH_PERCENTAGE = 50; // 50%

    // ── Vesting Category IDs ──
    uint8 internal constant CAT_CORE_TEAM          = 0;
    uint8 internal constant CAT_SERIES_A           = 1;
    uint8 internal constant CAT_EARLY_PARTICIPANTS = 2;
    uint8 internal constant CAT_PROTOCOL_FOUNDATION = 3;
    uint8 internal constant CAT_GPU_COMPUTE        = 4;
    uint8 internal constant CAT_ECOSYSTEM_GROWTH   = 5;
    uint8 internal constant CAT_STAKING_INCENTIVES = 6;
    uint8 internal constant CAT_COMPETITIVE_MINING = 7;
}
