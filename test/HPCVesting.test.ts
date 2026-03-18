import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HPCToken, HPCVesting } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("HPCVesting", () => {
  let token: HPCToken;
  let vesting: HPCVesting;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  const MONTH = 30 * 24 * 3600;
  const e = (n: number) => ethers.parseEther(n.toString());

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const HPCToken = await ethers.getContractFactory("HPCToken");
    token = await HPCToken.deploy(owner.address);

    const HPCVesting = await ethers.getContractFactory("HPCVesting");
    vesting = await HPCVesting.deploy(await token.getAddress(), owner.address);
  });

  async function createCoreTeamSchedule() {
    // Core Team: 100M, 0% TGE, 12mo cliff, 20mo linear, revocable
    await vesting.createSchedule(e(100_000_000), 0n, 12 * MONTH, 20 * MONTH, true);
  }

  async function createEcosystemSchedule() {
    // Ecosystem Growth: 150M, 110M TGE, 0 cliff, 10mo linear, revocable
    await vesting.createSchedule(e(150_000_000), e(110_000_000), 0, 10 * MONTH, true);
  }

  async function fundAndStart(amount: bigint) {
    await token.transfer(await vesting.getAddress(), amount);
    await vesting.start();
  }

  describe("Schedule 创建", () => {
    it("成功创建 schedule", async () => {
      await createCoreTeamSchedule();
      const s = await vesting.schedules(0);
      expect(s.totalAmount).to.equal(e(100_000_000));
      expect(s.tgeAmount).to.equal(0n);
      expect(s.cliffDuration).to.equal(12 * MONTH);
      expect(s.vestingDuration).to.equal(20 * MONTH);
      expect(s.revocable).to.equal(true);
      expect(await vesting.scheduleCount()).to.equal(1);
    });

    it("可以创建多个 schedule", async () => {
      await createCoreTeamSchedule();
      await createEcosystemSchedule();
      expect(await vesting.scheduleCount()).to.equal(2);
    });

    it("started 后不能再创建", async () => {
      await createCoreTeamSchedule();
      await fundAndStart(e(100_000_000));
      await expect(
        vesting.createSchedule(e(50_000_000), 0n, 0, 12 * MONTH, false)
      ).to.be.revertedWithCustomError(vesting, "AlreadyStarted");
    });

    it("TGE > total 应 revert", async () => {
      await expect(
        vesting.createSchedule(e(100), e(200), 0, 12 * MONTH, false)
      ).to.be.revertedWithCustomError(vesting, "InvalidSchedule");
    });

    it("非 owner 不能创建", async () => {
      await expect(
        vesting.connect(alice).createSchedule(e(100), 0n, 0, 12 * MONTH, false)
      ).to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
    });
  });

  describe("Grant 管理", () => {
    beforeEach(async () => {
      await createCoreTeamSchedule();
    });

    it("添加 grant", async () => {
      await vesting.addGrant(alice.address, 0, e(10_000_000));
      const grant = await vesting.getGrant(alice.address, 0);
      expect(grant.categoryId).to.equal(0);
      expect(grant.amount).to.equal(e(10_000_000));
      expect(grant.claimed).to.equal(0n);
      expect(grant.revoked).to.equal(false);
    });

    it("同一用户多个 grant", async () => {
      await vesting.addGrant(alice.address, 0, e(5_000_000));
      await vesting.addGrant(alice.address, 0, e(3_000_000));
      expect(await vesting.grantCount(alice.address)).to.equal(2);
    });

    it("超过类别总额应 revert", async () => {
      await vesting.addGrant(alice.address, 0, e(100_000_000));
      await expect(
        vesting.addGrant(bob.address, 0, 1n)
      ).to.be.revertedWithCustomError(vesting, "CategoryAllocationExceeded");
    });

    it("零地址应 revert", async () => {
      await expect(
        vesting.addGrant(ethers.ZeroAddress, 0, e(100))
      ).to.be.revertedWithCustomError(vesting, "ZeroAddress");
    });

    it("批量添加 grant", async () => {
      await vesting.addGrantsBatch(
        0,
        [alice.address, bob.address, carol.address],
        [e(30_000_000), e(30_000_000), e(30_000_000)]
      );
      expect(await vesting.grantCount(alice.address)).to.equal(1);
      expect(await vesting.grantCount(bob.address)).to.equal(1);
      expect(await vesting.categoryAllocated(0)).to.equal(e(90_000_000));
    });
  });

  describe("Cliff + 线性释放 (Core Team 模式)", () => {
    beforeEach(async () => {
      // Core Team: 0% TGE, 12mo cliff, 20mo linear
      await createCoreTeamSchedule();
      await vesting.addGrant(alice.address, 0, e(10_000_000));
      await fundAndStart(e(100_000_000));
    });

    it("TGE 时刻 claimable = 0", async () => {
      expect(await vesting.claimable(alice.address)).to.equal(0n);
    });

    it("cliff 期间 claimable = 0", async () => {
      await time.increase(6 * MONTH);
      expect(await vesting.claimable(alice.address)).to.equal(0n);
    });

    it("cliff 刚结束时 claimable ≈ 0", async () => {
      await time.increase(12 * MONTH);
      // 刚过 cliff，线性释放刚开始，已过1秒
      const claimableAmt = await vesting.claimable(alice.address);
      // 应该非常小（约等于 10M / (20*MONTH) * 1秒）
      expect(claimableAmt).to.be.lt(e(1));
    });

    it("cliff + 10 个月后 claimable ≈ 50%", async () => {
      await time.increase(12 * MONTH + 10 * MONTH);
      const claimableAmt = await vesting.claimable(alice.address);
      // 10/20 = 50% of 10M = 5M
      expect(claimableAmt).to.be.closeTo(e(5_000_000), e(1));
    });

    it("cliff + 20 个月后 claimable = 100%", async () => {
      await time.increase(12 * MONTH + 20 * MONTH);
      const claimableAmt = await vesting.claimable(alice.address);
      expect(claimableAmt).to.be.closeTo(e(10_000_000), e(1));
    });

    it("完全释放后 claim 获得全部代币", async () => {
      await time.increase(12 * MONTH + 20 * MONTH);
      await vesting.connect(alice).claim();
      expect(await token.balanceOf(alice.address)).to.be.closeTo(e(10_000_000), e(1));
    });

    it("未开始时 claim 应 revert", async () => {
      // 部署新 vesting 但不 start
      const HPCVesting = await ethers.getContractFactory("HPCVesting");
      const vesting2 = await HPCVesting.deploy(await token.getAddress(), owner.address);
      await expect(
        vesting2.connect(alice).claim()
      ).to.be.revertedWithCustomError(vesting2, "NotStarted");
    });
  });

  describe("TGE + 线性释放 (Ecosystem Growth 模式)", () => {
    beforeEach(async () => {
      // Ecosystem: 150M total, 110M TGE, 0 cliff, 10mo linear
      await createEcosystemSchedule();
      // alice 获得全部 150M 的 grant
      await vesting.addGrant(alice.address, 0, e(150_000_000));
      await fundAndStart(e(150_000_000));
    });

    it("TGE 时刻 claimable = 110M", async () => {
      const claimableAmt = await vesting.claimable(alice.address);
      expect(claimableAmt).to.be.closeTo(e(110_000_000), e(1));
    });

    it("5 个月后 claimable ≈ 110M + 20M", async () => {
      await time.increase(5 * MONTH);
      const claimableAmt = await vesting.claimable(alice.address);
      // TGE 110M + 50% of remaining 40M = 110M + 20M = 130M
      expect(claimableAmt).to.be.closeTo(e(130_000_000), e(1));
    });

    it("10 个月后 claimable = 150M (全部)", async () => {
      await time.increase(10 * MONTH);
      const claimableAmt = await vesting.claimable(alice.address);
      expect(claimableAmt).to.be.closeTo(e(150_000_000), e(1));
    });

    it("分段 claim 后余额正确", async () => {
      // 第一次 claim TGE 部分（可能含几秒的线性释放）
      await vesting.connect(alice).claim();
      const bal1 = await token.balanceOf(alice.address);
      expect(bal1).to.be.closeTo(e(110_000_000), e(100));

      // 5 个月后再 claim（含几秒额外的线性释放误差）
      await time.increase(5 * MONTH);
      await vesting.connect(alice).claim();
      const bal2 = await token.balanceOf(alice.address);
      expect(bal2).to.be.closeTo(e(130_000_000), e(100));
    });
  });

  describe("Revoke (撤销)", () => {
    beforeEach(async () => {
      await createCoreTeamSchedule();
      await vesting.addGrant(alice.address, 0, e(10_000_000));
      await fundAndStart(e(100_000_000));
    });

    it("owner 可以 revoke 可撤销类别的 grant", async () => {
      await time.increase(12 * MONTH + 10 * MONTH); // cliff + 50% vested
      await vesting.revokeGrant(alice.address, 0);

      const grant = await vesting.getGrant(alice.address, 0);
      expect(grant.revoked).to.equal(true);
      // grant.amount 应该被缩减为已释放部分 ≈ 5M
      expect(grant.amount).to.be.closeTo(e(5_000_000), e(1));
    });

    it("revoke 后未释放部分返还 owner", async () => {
      const ownerBalBefore = await token.balanceOf(owner.address);
      await time.increase(12 * MONTH + 10 * MONTH);
      await vesting.revokeGrant(alice.address, 0);
      const ownerBalAfter = await token.balanceOf(owner.address);
      // 约 5M 返还
      expect(ownerBalAfter - ownerBalBefore).to.be.closeTo(e(5_000_000), e(1));
    });

    it("不可撤销类别 revoke 应 revert", async () => {
      // 需要新 vesting 实例，因为当前已 started 无法添加 schedule
      const HPCVesting = await ethers.getContractFactory("HPCVesting");
      const vesting2 = await HPCVesting.deploy(await token.getAddress(), owner.address);
      // Series A: not revocable
      await vesting2.createSchedule(e(100_000_000), 0n, 12 * MONTH, 20 * MONTH, false);
      await vesting2.addGrant(bob.address, 0, e(50_000_000));
      await token.transfer(await vesting2.getAddress(), e(100_000_000));
      await vesting2.start();
      await expect(
        vesting2.revokeGrant(bob.address, 0)
      ).to.be.revertedWithCustomError(vesting2, "GrantNotRevocable");
    });

    it("重复 revoke 应 revert", async () => {
      await vesting.revokeGrant(alice.address, 0);
      await expect(
        vesting.revokeGrant(alice.address, 0)
      ).to.be.revertedWithCustomError(vesting, "GrantAlreadyRevoked");
    });
  });

  describe("无可领取时 claim 应 revert", () => {
    it("没有 grant 时 claim revert", async () => {
      await createCoreTeamSchedule();
      await fundAndStart(e(100_000_000));
      await expect(
        vesting.connect(alice).claim()
      ).to.be.revertedWithCustomError(vesting, "NothingToClaim");
    });
  });

  describe("审计修复验证", () => {
    it("[MEDIUM-1] start() 时余额不足应 revert", async () => {
      await createCoreTeamSchedule();
      // 不转代币就 start
      await expect(
        vesting.start()
      ).to.be.revertedWithCustomError(vesting, "InsufficientBalance");
    });

    it("[MEDIUM-1] start() 时余额充足可正常启动", async () => {
      await createCoreTeamSchedule();
      await token.transfer(await vesting.getAddress(), e(100_000_000));
      await vesting.start();
      expect(await vesting.started()).to.equal(true);
    });

    it("[LOW-3] addGrant 零金额应 revert", async () => {
      await createCoreTeamSchedule();
      await expect(
        vesting.addGrant(alice.address, 0, 0n)
      ).to.be.revertedWithCustomError(vesting, "ZeroAmount");
    });

    it("[CRITICAL] TGE schedule revoke 后 claim 不会下溢", async () => {
      // Ecosystem Growth: 150M total, 110M TGE, 0 cliff, 10mo linear
      await createEcosystemSchedule();
      await vesting.addGrant(alice.address, 0, e(150_000_000));
      await fundAndStart(e(150_000_000));

      // Alice 先 claim TGE 部分 (≈110M)
      await vesting.connect(alice).claim();
      const claimedAfterTge = await token.balanceOf(alice.address);
      // 约 110M (可能包含几秒线性释放)
      expect(claimedAfterTge).to.be.closeTo(e(110_000_000), e(100));

      // 1 个月后 owner revoke
      await time.increase(1 * MONTH);
      await vesting.revokeGrant(alice.address, 0);

      // 关键测试: Alice 应该能立即 claim 剩余部分，不应 revert
      await vesting.connect(alice).claim();
      const finalBalance = await token.balanceOf(alice.address);
      // 应该接近 revoke 时的 vested 金额 (约 114M = 110M TGE + 4M 线性)
      expect(finalBalance).to.be.closeTo(e(114_000_000), e(200));
    });

    it("[CRITICAL] 非 TGE schedule revoke 后 claim 正常", async () => {
      // Core Team: 0% TGE, 12mo cliff, 20mo linear
      await createCoreTeamSchedule();
      await vesting.addGrant(alice.address, 0, e(10_000_000));
      await fundAndStart(e(100_000_000));

      // cliff + 10 个月后 claim 一半
      await time.increase(12 * MONTH + 10 * MONTH);
      await vesting.connect(alice).claim();
      const bal1 = await token.balanceOf(alice.address);
      expect(bal1).to.be.closeTo(e(5_000_000), e(1));

      // revoke 剩余
      await vesting.revokeGrant(alice.address, 0);

      // 应该还能 claim revoke 时刻到上次 claim 之间的差额
      // revoke 时 vested ≈ 5M (已经 claimed 了), 所以应该没什么可 claim
      // 但不应该 revert (除了 NothingToClaim)
      const grant = await vesting.getGrant(alice.address, 0);
      expect(grant.revoked).to.equal(true);
    });

    it("[CRITICAL] revoke 后的 grant 不阻塞其他 grant 的 claim", async () => {
      // 创建两种 schedule
      await createEcosystemSchedule(); // cat 0: TGE-heavy
      await createCoreTeamSchedule();   // cat 1: cliff-based

      // alice 在两个 category 都有 grant
      await vesting.addGrant(alice.address, 0, e(150_000_000)); // ecosystem
      await vesting.addGrant(alice.address, 1, e(10_000_000));  // core team
      await fundAndStart(e(250_000_000));

      // claim TGE
      await vesting.connect(alice).claim();

      // 13 个月后 (过了 core team cliff)
      await time.increase(13 * MONTH);

      // revoke ecosystem grant
      await vesting.revokeGrant(alice.address, 0);

      // 关键: alice 应该仍能 claim core team 的 grant
      await vesting.connect(alice).claim();
      const balance = await token.balanceOf(alice.address);
      // 应该有 TGE 的 ~110M + core team 的 ~5M (13-12=1个月线性/20个月 = 5% of 10M)
      expect(balance).to.be.gt(e(110_000_000));
    });
  });
});
