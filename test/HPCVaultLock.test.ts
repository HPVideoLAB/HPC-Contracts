import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HPCToken, HPCVaultLock } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("HPCVaultLock", () => {
  let token: HPCToken;
  let vault: HPCVaultLock;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const e = (n: number) => ethers.parseEther(n.toString());
  const YEAR = 365 * 24 * 3600;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const HPCToken = await ethers.getContractFactory("HPCToken");
    token = await HPCToken.deploy(owner.address);

    const HPCVaultLock = await ethers.getContractFactory("HPCVaultLock");
    vault = await HPCVaultLock.deploy(await token.getAddress(), owner.address);

    // 给 alice 和 bob 代币用于存入
    await token.transfer(alice.address, e(100_000));
    await token.transfer(bob.address, e(100_000));
    await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await token.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("存入", () => {
    it("正常存入并锁定 1 年", async () => {
      const tx = await vault.connect(alice).deposit(e(10_000));
      const block = await ethers.provider.getBlock(tx.blockNumber!);
      const expectedUnlock = block!.timestamp + YEAR;

      const d = await vault.getDeposit(0);
      expect(d.depositor).to.equal(alice.address);
      expect(d.amount).to.equal(e(10_000));
      expect(d.unlockTime).to.equal(expectedUnlock);
      expect(d.withdrawn).to.equal(false);
      expect(d.unlocked).to.equal(false);

      expect(await vault.totalLocked()).to.equal(e(10_000));
      expect(await vault.totalDeposited()).to.equal(e(10_000));
      expect(await vault.depositCount()).to.equal(1);
    });

    it("多次存入产生独立记录", async () => {
      await vault.connect(alice).deposit(e(5_000));
      await vault.connect(bob).deposit(e(8_000));
      await vault.connect(alice).deposit(e(3_000));

      expect(await vault.depositCount()).to.equal(3);
      expect(await vault.totalLocked()).to.equal(e(16_000));
      expect(await vault.totalDeposited()).to.equal(e(16_000));
    });

    it("代币确实转入合约", async () => {
      await vault.connect(alice).deposit(e(10_000));
      expect(await token.balanceOf(await vault.getAddress())).to.equal(e(10_000));
      expect(await token.balanceOf(alice.address)).to.equal(e(90_000));
    });

    it("存入 0 应 revert", async () => {
      await expect(
        vault.connect(alice).deposit(0n)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("发出 Deposited 事件", async () => {
      await expect(vault.connect(alice).deposit(e(10_000)))
        .to.emit(vault, "Deposited")
        .withArgs(0, alice.address, e(10_000), () => true);
    });
  });

  describe("Owner 提取", () => {
    beforeEach(async () => {
      await vault.connect(alice).deposit(e(10_000));
    });

    it("锁定期内不能提取", async () => {
      await time.increase(180 * 24 * 3600); // 半年
      await expect(
        vault.withdraw(0, owner.address)
      ).to.be.revertedWithCustomError(vault, "StillLocked");
    });

    it("锁定期满后 owner 可提取", async () => {
      await time.increase(YEAR + 1);
      await vault.withdraw(0, owner.address);

      const d = await vault.getDeposit(0);
      expect(d.withdrawn).to.equal(true);
      expect(d.unlocked).to.equal(true);
      expect(await vault.totalLocked()).to.equal(0n);
      expect(await token.balanceOf(owner.address)).to.be.gt(0n);
    });

    it("可提取到指定地址", async () => {
      await time.increase(YEAR + 1);
      const bobBalBefore = await token.balanceOf(bob.address);
      await vault.withdraw(0, bob.address);
      const bobBalAfter = await token.balanceOf(bob.address);
      expect(bobBalAfter - bobBalBefore).to.equal(e(10_000));
    });

    it("重复提取应 revert", async () => {
      await time.increase(YEAR + 1);
      await vault.withdraw(0, owner.address);
      await expect(
        vault.withdraw(0, owner.address)
      ).to.be.revertedWithCustomError(vault, "AlreadyWithdrawn");
    });

    it("非 owner 不能提取", async () => {
      await time.increase(YEAR + 1);
      await expect(
        vault.connect(alice).withdraw(0, alice.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("提取地址不能为零地址", async () => {
      await time.increase(YEAR + 1);
      await expect(
        vault.withdraw(0, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  describe("批量提取", () => {
    beforeEach(async () => {
      await vault.connect(alice).deposit(e(5_000));
      await vault.connect(bob).deposit(e(8_000));
      await vault.connect(alice).deposit(e(3_000));
    });

    it("批量提取多个已解锁存款", async () => {
      await time.increase(YEAR + 1);
      const ownerBalBefore = await token.balanceOf(owner.address);
      await vault.withdrawBatch([0, 1, 2], owner.address);
      const ownerBalAfter = await token.balanceOf(owner.address);

      expect(ownerBalAfter - ownerBalBefore).to.equal(e(16_000));
      expect(await vault.totalLocked()).to.equal(0n);
    });

    it("批量中有未解锁的应 revert", async () => {
      await time.increase(YEAR + 1);
      // 再新存一笔（这笔还没到期）
      await vault.connect(alice).deposit(e(1_000));
      await expect(
        vault.withdrawBatch([0, 1, 3], owner.address)
      ).to.be.revertedWithCustomError(vault, "StillLocked");
    });

    it("批量中有已提取的应 revert", async () => {
      await time.increase(YEAR + 1);
      await vault.withdraw(0, owner.address);
      await expect(
        vault.withdrawBatch([0, 1], owner.address)
      ).to.be.revertedWithCustomError(vault, "AlreadyWithdrawn");
    });
  });

  describe("查询功能", () => {
    it("getDeposit 返回正确的 unlocked 状态", async () => {
      await vault.connect(alice).deposit(e(10_000));

      let d = await vault.getDeposit(0);
      expect(d.unlocked).to.equal(false);

      await time.increase(YEAR + 1);

      d = await vault.getDeposit(0);
      expect(d.unlocked).to.equal(true);
    });

    it("LOCK_DURATION 为 365 天", async () => {
      expect(await vault.LOCK_DURATION()).to.equal(365 * 24 * 3600);
    });
  });
});
