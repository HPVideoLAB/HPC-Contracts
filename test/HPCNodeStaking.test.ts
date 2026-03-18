import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HPCToken, HPCNodeStaking } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("HPCNodeStaking", () => {
  let token: HPCToken;
  let staking: HPCNodeStaking;
  let owner: SignerWithAddress;
  let slasher: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const e = (n: number) => ethers.parseEther(n.toString());
  const DAY = 24 * 3600;
  const COOLDOWN = 7 * DAY;
  const MINIMUM_STAKE = e(1_000);
  const SLASH_PCT = 10n;
  const REWARDS_DURATION = 30 * DAY;

  beforeEach(async () => {
    [owner, slasher, alice, bob] = await ethers.getSigners();

    const HPCToken = await ethers.getContractFactory("HPCToken");
    token = await HPCToken.deploy(owner.address);

    const HPCNodeStaking = await ethers.getContractFactory("HPCNodeStaking");
    staking = await HPCNodeStaking.deploy(
      await token.getAddress(),
      await token.getAddress(),
      owner.address,
      slasher.address,
      MINIMUM_STAKE,
      SLASH_PCT,
      REWARDS_DURATION
    );

    // 给 alice 和 bob 一些代币用于质押
    await token.transfer(alice.address, e(100_000));
    await token.transfer(bob.address, e(100_000));

    // 授权 staking 合约
    await token.connect(alice).approve(await staking.getAddress(), ethers.MaxUint256);
    await token.connect(bob).approve(await staking.getAddress(), ethers.MaxUint256);
  });

  describe("质押", () => {
    it("正常质押", async () => {
      await staking.connect(alice).stake(e(5_000));
      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(e(5_000));
      expect(await staking.totalStaked()).to.equal(e(5_000));
    });

    it("低于最低质押量应 revert", async () => {
      await expect(
        staking.connect(alice).stake(e(500))
      ).to.be.revertedWithCustomError(staking, "BelowMinimumStake");
    });

    it("零数量应 revert", async () => {
      await expect(
        staking.connect(alice).stake(0n)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("多次质押累加", async () => {
      await staking.connect(alice).stake(e(5_000));
      await staking.connect(alice).stake(e(3_000));
      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(e(8_000));
    });

    it("多用户质押", async () => {
      await staking.connect(alice).stake(e(5_000));
      await staking.connect(bob).stake(e(10_000));
      expect(await staking.totalStaked()).to.equal(e(15_000));
    });
  });

  describe("解质押 (7天冷却期)", () => {
    beforeEach(async () => {
      await staking.connect(alice).stake(e(10_000));
    });

    it("请求解质押", async () => {
      await staking.connect(alice).requestUnstake(e(10_000));
      const info = await staking.getStakeInfo(alice.address);
      expect(info.unstakeRequestAmount).to.equal(e(10_000));
      expect(info.unstakeRequestTime).to.be.gt(0);
    });

    it("冷却期内不能 withdraw", async () => {
      await staking.connect(alice).requestUnstake(e(10_000));
      await time.increase(3 * DAY); // 只过了3天
      await expect(
        staking.connect(alice).withdraw()
      ).to.be.revertedWithCustomError(staking, "CooldownNotElapsed");
    });

    it("冷却期后成功 withdraw", async () => {
      await staking.connect(alice).requestUnstake(e(10_000));
      await time.increase(COOLDOWN + 1);
      await staking.connect(alice).withdraw();

      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(0n);
      expect(await token.balanceOf(alice.address)).to.equal(e(100_000));
    });

    it("没有 pending unstake 时 withdraw 应 revert", async () => {
      await expect(
        staking.connect(alice).withdraw()
      ).to.be.revertedWithCustomError(staking, "NoUnstakePending");
    });

    it("部分解质押后余额不能低于最低要求", async () => {
      // 尝试解质押到剩余低于 minimumStake
      await expect(
        staking.connect(alice).requestUnstake(e(9_500)) // 剩余 500 < 1000
      ).to.be.revertedWithCustomError(staking, "BelowMinimumStake");
    });

    it("部分解质押到 0 是允许的", async () => {
      await staking.connect(alice).requestUnstake(e(10_000));
      await time.increase(COOLDOWN + 1);
      await staking.connect(alice).withdraw();
      expect((await staking.getStakeInfo(alice.address)).amount).to.equal(0n);
    });

    it("超过质押余额应 revert", async () => {
      await expect(
        staking.connect(alice).requestUnstake(e(20_000))
      ).to.be.revertedWithCustomError(staking, "InsufficientStake");
    });
  });

  describe("罚没", () => {
    beforeEach(async () => {
      await staking.connect(alice).stake(e(10_000));
    });

    it("slasher 可以罚没", async () => {
      await staking.connect(slasher).slash(alice.address);
      const info = await staking.getStakeInfo(alice.address);
      // 10% of 10000 = 1000 被罚没
      expect(info.amount).to.equal(e(9_000));
      expect(await staking.totalStaked()).to.equal(e(9_000));
    });

    it("罚没金额转给 owner", async () => {
      const ownerBalBefore = await token.balanceOf(owner.address);
      await staking.connect(slasher).slash(alice.address);
      const ownerBalAfter = await token.balanceOf(owner.address);
      expect(ownerBalAfter - ownerBalBefore).to.equal(e(1_000));
    });

    it("非 slasher 不能罚没", async () => {
      await expect(
        staking.connect(alice).slash(alice.address)
      ).to.be.revertedWithCustomError(staking, "NotSlasher");
    });

    it("owner 也不能直接罚没（除非也是 slasher）", async () => {
      await expect(
        staking.connect(owner).slash(alice.address)
      ).to.be.revertedWithCustomError(staking, "NotSlasher");
    });

    it("质押为 0 时罚没应 revert", async () => {
      await expect(
        staking.connect(slasher).slash(bob.address)
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });
  });

  describe("奖励分发 (Synthetix 模式)", () => {
    beforeEach(async () => {
      await staking.connect(alice).stake(e(10_000));

      // owner 授权并发送奖励代币到 staking 合约
      const rewardAmount = e(30_000);
      await token.transfer(await staking.getAddress(), rewardAmount);
      await staking.notifyRewardAmount(rewardAmount);
    });

    it("质押后积累奖励", async () => {
      await time.increase(15 * DAY); // 过去一半时间
      const earned = await staking.earned(alice.address);
      // 应约 15000 (30000 * 15/30)
      expect(earned).to.be.closeTo(e(15_000), e(100));
    });

    it("claim 奖励", async () => {
      await time.increase(REWARDS_DURATION);
      const aliceBalBefore = await token.balanceOf(alice.address);
      await staking.connect(alice).claimReward();
      const aliceBalAfter = await token.balanceOf(alice.address);
      expect(aliceBalAfter - aliceBalBefore).to.be.closeTo(e(30_000), e(100));
    });

    it("两个质押者平分奖励", async () => {
      await staking.connect(bob).stake(e(10_000));
      await time.increase(REWARDS_DURATION);

      const aliceEarned = await staking.earned(alice.address);
      const bobEarned = await staking.earned(bob.address);

      // alice 独占前面一段，bob 加入后平分
      // 总和应接近 30000
      expect(aliceEarned + bobEarned).to.be.closeTo(e(30_000), e(100));
      // bob 应该少于 alice（因为加入晚）
      expect(bobEarned).to.be.lt(aliceEarned);
    });

    it("没有奖励时 claim 应 revert", async () => {
      await expect(
        staking.connect(bob).claimReward()
      ).to.be.revertedWithCustomError(staking, "ZeroAmount");
    });
  });

  describe("管理功能", () => {
    it("owner 可以修改 slasher", async () => {
      await staking.setSlasher(alice.address);
      expect(await staking.slasher()).to.equal(alice.address);
    });

    it("owner 可以修改最低质押量", async () => {
      await staking.setMinimumStake(e(5_000));
      expect(await staking.minimumStake()).to.equal(e(5_000));
    });

    it("owner 可以修改罚没比例", async () => {
      await staking.setSlashPercentage(25n);
      expect(await staking.slashPercentage()).to.equal(25n);
    });

    it("罚没比例超过 50% 应 revert", async () => {
      await expect(
        staking.setSlashPercentage(51n)
      ).to.be.revertedWithCustomError(staking, "SlashPercentageTooHigh");
    });

    it("非 owner 不能修改设置", async () => {
      await expect(
        staking.connect(alice).setSlasher(alice.address)
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("审计修复验证", () => {
    it("[HIGH-1] 罚没后 withdraw 不会下溢，返回实际可用金额", async () => {
      await staking.connect(alice).stake(e(10_000));
      // 请求全额解质押
      await staking.connect(alice).requestUnstake(e(10_000));
      // 罚没 10% → amount 变为 9000，但 unstakeRequestAmount 仍为 10000
      await staking.connect(slasher).slash(alice.address);
      // 7 天后 withdraw 应成功，只取回 9000
      await time.increase(COOLDOWN + 1);
      await staking.connect(alice).withdraw();

      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(0n);
      // alice 最初 100000，质押 10000 → 90000，罚没 1000 → 只取回 9000
      expect(await token.balanceOf(alice.address)).to.equal(e(99_000));
    });

    it("[MEDIUM-2] 已有 pending unstake 时不能再次 requestUnstake", async () => {
      await staking.connect(alice).stake(e(10_000));
      await staking.connect(alice).requestUnstake(e(5_000));
      await expect(
        staking.connect(alice).requestUnstake(e(3_000))
      ).to.be.revertedWithCustomError(staking, "UnstakeAlreadyPending");
    });

    it("[MEDIUM-2] withdraw 后可以发起新的 unstake 请求", async () => {
      await staking.connect(alice).stake(e(10_000));
      await staking.connect(alice).requestUnstake(e(5_000));
      await time.increase(COOLDOWN + 1);
      await staking.connect(alice).withdraw();
      // 现在可以发起新请求
      await staking.connect(alice).requestUnstake(e(5_000));
      const info = await staking.getStakeInfo(alice.address);
      expect(info.unstakeRequestAmount).to.equal(e(5_000));
    });

    it("[MEDIUM-3] notifyRewardAmount 超出余额应 revert", async () => {
      await staking.connect(alice).stake(e(10_000));
      // 不转入奖励代币就通知 → 应 revert
      await expect(
        staking.notifyRewardAmount(e(1_000_000))
      ).to.be.revertedWithCustomError(staking, "RewardTooHigh");
    });

    it("[HIGH-2] slash 冷却期防止单交易连续罚没", async () => {
      await staking.connect(alice).stake(e(10_000));
      // 第一次 slash 成功
      await staking.connect(slasher).slash(alice.address);
      const info1 = await staking.getStakeInfo(alice.address);
      expect(info1.amount).to.equal(e(9_000));

      // 立即再次 slash 应被冷却期拒绝
      await expect(
        staking.connect(slasher).slash(alice.address)
      ).to.be.revertedWithCustomError(staking, "SlashCooldownActive");

      // 1 天后可以再次 slash
      await time.increase(DAY + 1);
      await staking.connect(slasher).slash(alice.address);
      const info2 = await staking.getStakeInfo(alice.address);
      expect(info2.amount).to.equal(e(8_100)); // 9000 * 90% = 8100
    });
  });
});
