import { expect } from "chai";
import { ethers } from "hardhat";
import { HPCToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("HPCToken", () => {
  let token: HPCToken;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1B

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const HPCToken = await ethers.getContractFactory("HPCToken");
    token = await HPCToken.deploy(owner.address);
  });

  describe("部署", () => {
    it("名称和符号正确", async () => {
      expect(await token.name()).to.equal("HPVideo");
      expect(await token.symbol()).to.equal("HPC");
    });

    it("总供应量为 10 亿", async () => {
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    });

    it("全部供应量分配给 deployer", async () => {
      expect(await token.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY);
    });

    it("decimals 为 18", async () => {
      expect(await token.decimals()).to.equal(18);
    });

    it("owner 设置正确", async () => {
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("转账", () => {
    it("正常转账", async () => {
      const amount = ethers.parseEther("1000");
      await token.transfer(alice.address, amount);
      expect(await token.balanceOf(alice.address)).to.equal(amount);
      expect(await token.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY - amount);
    });

    it("余额不足时 revert", async () => {
      await expect(
        token.connect(alice).transfer(bob.address, 1n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });

  describe("无 burn 功能", () => {
    it("合约上不存在 burn 方法", async () => {
      expect((token as any).burn).to.be.undefined;
      expect((token as any).burnFrom).to.be.undefined;
    });

    it("可以转入黑洞地址 (0x...dead)", async () => {
      const deadAddress = "0x000000000000000000000000000000000000dEaD";
      const amount = ethers.parseEther("1000");
      await token.transfer(deadAddress, amount);
      expect(await token.balanceOf(deadAddress)).to.equal(amount);
      // totalSupply 不变
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    });
  });

  describe("Ownable2Step 所有权转移", () => {
    it("两步转移所有权", async () => {
      await token.transferOwnership(alice.address);
      // 中间状态：owner 仍然是原 owner
      expect(await token.owner()).to.equal(owner.address);
      // alice 接受所有权
      await token.connect(alice).acceptOwnership();
      expect(await token.owner()).to.equal(alice.address);
    });

    it("非 pending owner 不能接受", async () => {
      await token.transferOwnership(alice.address);
      await expect(
        token.connect(bob).acceptOwnership()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Permit (EIP-2612)", () => {
    it("通过签名授权", async () => {
      const amount = ethers.parseEther("1000");
      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock!.timestamp + 3600;
      const nonce = await token.nonces(owner.address);
      const domain = {
        name: "HPVideo",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress(),
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        owner: owner.address,
        spender: alice.address,
        value: amount,
        nonce: nonce,
        deadline: deadline,
      };
      const sig = await owner.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await token.permit(owner.address, alice.address, amount, deadline, v, r, s);
      expect(await token.allowance(owner.address, alice.address)).to.equal(amount);
    });
  });
});
