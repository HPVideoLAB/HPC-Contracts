import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const MONTH = 30 * 24 * 3600;

  // ── 1. Deploy HPC Token ──
  const HPCToken = await ethers.getContractFactory("HPCToken");
  const token = await HPCToken.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("HPCToken deployed to:", tokenAddr);

  const totalSupply = await token.totalSupply();
  console.log("Total supply:", ethers.formatEther(totalSupply), "HPC");

  // ── 2. Deploy Vesting ──
  const HPCVesting = await ethers.getContractFactory("HPCVesting");
  const vesting = await HPCVesting.deploy(tokenAddr, deployer.address);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log("HPCVesting deployed to:", vestingAddr);

  // Create 8 vesting schedules matching the DD document
  const schedules = [
    // Core Team: 100M, 0% TGE, 12mo cliff, 20mo linear, revocable
    { total: e(100_000_000), tge: 0n, cliff: 12 * MONTH, linear: 20 * MONTH, revocable: true },
    // Series A: 100M, 0% TGE, 12mo cliff, 20mo linear, not revocable
    { total: e(100_000_000), tge: 0n, cliff: 12 * MONTH, linear: 20 * MONTH, revocable: false },
    // Early Participants: 50M, 0% TGE, 12mo cliff, 20mo linear, not revocable
    { total: e(50_000_000), tge: 0n, cliff: 12 * MONTH, linear: 20 * MONTH, revocable: false },
    // Protocol Foundation: 100M, 0% TGE, 12mo cliff, 20mo linear, revocable
    { total: e(100_000_000), tge: 0n, cliff: 12 * MONTH, linear: 20 * MONTH, revocable: true },
    // GPU Compute: 250M, 0% TGE, 0 cliff, 60mo linear, revocable
    { total: e(250_000_000), tge: 0n, cliff: 0, linear: 60 * MONTH, revocable: true },
    // Ecosystem Growth: 150M, 110M TGE, 0 cliff, 10mo linear (remaining 40M), revocable
    { total: e(150_000_000), tge: e(110_000_000), cliff: 0, linear: 10 * MONTH, revocable: true },
    // Staking Incentives: 70M, 14M TGE, 0 cliff, 5mo linear (remaining 56M), revocable
    { total: e(70_000_000), tge: e(14_000_000), cliff: 0, linear: 5 * MONTH, revocable: true },
    // Competitive Mining: 80M, 16M TGE, 0 cliff, 5mo linear (remaining 64M), revocable
    { total: e(80_000_000), tge: e(16_000_000), cliff: 0, linear: 5 * MONTH, revocable: true },
  ];

  for (const s of schedules) {
    const tx = await vesting.createSchedule(s.total, s.tge, s.cliff, s.linear, s.revocable);
    await tx.wait();
  }
  console.log("8 vesting schedules created");

  // Transfer vesting allocation (900M - 50M airdrop - 50M liquidity = 800M)
  // Actually the vesting covers: 100+100+50+100+250+150+70+80 = 900M
  const vestingAmount = e(900_000_000);
  const txTransfer = await token.transfer(vestingAddr, vestingAmount);
  await txTransfer.wait();
  console.log("Transferred", ethers.formatEther(vestingAmount), "HPC to vesting contract");

  // ── 3. Deploy Distributor (Airdrop) ──
  // NOTE: Replace MERKLE_ROOT with actual root before mainnet deployment
  const PLACEHOLDER_MERKLE_ROOT = ethers.keccak256(ethers.toUtf8Bytes("placeholder"));
  const EXPIRY = Math.floor(Date.now() / 1000) + 180 * 24 * 3600; // 180 days from now

  const HPCDistributor = await ethers.getContractFactory("HPCDistributor");
  const distributor = await HPCDistributor.deploy(
    tokenAddr,
    PLACEHOLDER_MERKLE_ROOT,
    EXPIRY,
    deployer.address
  );
  await distributor.waitForDeployment();
  const distributorAddr = await distributor.getAddress();
  console.log("HPCDistributor deployed to:", distributorAddr);

  // Transfer airdrop allocation (50M)
  const airdropAmount = e(50_000_000);
  const txAirdrop = await token.transfer(distributorAddr, airdropAmount);
  await txAirdrop.wait();
  console.log("Transferred", ethers.formatEther(airdropAmount), "HPC to distributor");

  // ── 4. Deploy Node Staking ──
  const MINIMUM_STAKE = e(1_000);          // 1,000 HPC minimum
  const SLASH_PERCENTAGE = 10n;             // 10%
  const REWARDS_DURATION = 30 * 24 * 3600;  // 30 days per reward period

  const HPCNodeStaking = await ethers.getContractFactory("HPCNodeStaking");
  const staking = await HPCNodeStaking.deploy(
    tokenAddr,               // staking token
    tokenAddr,               // reward token (same token)
    deployer.address,         // owner
    deployer.address,         // slasher (initially deployer, transfer later)
    MINIMUM_STAKE,
    SLASH_PERCENTAGE,
    REWARDS_DURATION
  );
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log("HPCNodeStaking deployed to:", stakingAddr);

  // Remaining 50M (liquidity) stays with deployer

  console.log("\n=== Deployment Summary ===");
  console.log("HPCToken:       ", tokenAddr);
  console.log("HPCVesting:     ", vestingAddr);
  console.log("HPCDistributor: ", distributorAddr);
  console.log("HPCNodeStaking: ", stakingAddr);
  console.log("Deployer balance:", ethers.formatEther(await token.balanceOf(deployer.address)), "HPC (liquidity)");
}

function e(n: number): bigint {
  return BigInt(n) * 10n ** 18n;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
