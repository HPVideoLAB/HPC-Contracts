import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HPCToken, HPCDistributor } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

describe("HPCDistributor", () => {
  let token: HPCToken;
  let distributor: HPCDistributor;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  const e = (n: number) => ethers.parseEther(n.toString());

  // 构建 Merkle Tree
  let tree: StandardMerkleTree<[string, bigint]>;
  let aliceAmount: bigint;
  let bobAmount: bigint;
  let carolAmount: bigint;
  let expiryTime: number;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const HPCToken = await ethers.getContractFactory("HPCToken");
    token = await HPCToken.deploy(owner.address);

    aliceAmount = e(10_000);
    bobAmount = e(20_000);
    carolAmount = e(30_000);

    // 构建 Merkle Tree
    const values: [string, bigint][] = [
      [alice.address, aliceAmount],
      [bob.address, bobAmount],
      [carol.address, carolAmount],
    ];
    tree = StandardMerkleTree.of(values, ["address", "uint256"]);

    const currentTime = await time.latest();
    expiryTime = currentTime + 180 * 24 * 3600; // 180 天

    const HPCDistributor = await ethers.getContractFactory("HPCDistributor");
    distributor = await HPCDistributor.deploy(
      await token.getAddress(),
      tree.root,
      expiryTime,
      owner.address
    );

    // 转入空投代币
    await token.transfer(await distributor.getAddress(), e(60_000));
  });

  function getProof(address: string): string[] {
    for (const [i, v] of tree.entries()) {
      if (v[0] === address) {
        return tree.getProof(i);
      }
    }
    throw new Error("address not in tree");
  }

  describe("Claim", () => {
    it("alice 正常 claim", async () => {
      const proof = getProof(alice.address);
      await distributor.connect(alice).claim(aliceAmount, proof);
      expect(await token.balanceOf(alice.address)).to.equal(aliceAmount);
      expect(await distributor.hasClaimed(alice.address)).to.equal(true);
      expect(await distributor.totalClaimed()).to.equal(aliceAmount);
    });

    it("bob 正常 claim", async () => {
      const proof = getProof(bob.address);
      await distributor.connect(bob).claim(bobAmount, proof);
      expect(await token.balanceOf(bob.address)).to.equal(bobAmount);
    });

    it("多人分别 claim", async () => {
      await distributor.connect(alice).claim(aliceAmount, getProof(alice.address));
      await distributor.connect(bob).claim(bobAmount, getProof(bob.address));
      await distributor.connect(carol).claim(carolAmount, getProof(carol.address));
      expect(await distributor.totalClaimed()).to.equal(aliceAmount + bobAmount + carolAmount);
    });
  });

  describe("Claim 失败场景", () => {
    it("重复 claim 应 revert", async () => {
      const proof = getProof(alice.address);
      await distributor.connect(alice).claim(aliceAmount, proof);
      await expect(
        distributor.connect(alice).claim(aliceAmount, proof)
      ).to.be.revertedWithCustomError(distributor, "AlreadyClaimed");
    });

    it("无效 proof 应 revert", async () => {
      const wrongProof = getProof(bob.address);
      await expect(
        distributor.connect(alice).claim(aliceAmount, wrongProof)
      ).to.be.revertedWithCustomError(distributor, "InvalidProof");
    });

    it("错误金额应 revert", async () => {
      const proof = getProof(alice.address);
      await expect(
        distributor.connect(alice).claim(e(99999), proof)
      ).to.be.revertedWithCustomError(distributor, "InvalidProof");
    });

    it("非受益人地址 claim 应 revert", async () => {
      const [, , , , outsider] = await ethers.getSigners();
      const proof = getProof(alice.address);
      await expect(
        distributor.connect(outsider).claim(aliceAmount, proof)
      ).to.be.revertedWithCustomError(distributor, "InvalidProof");
    });
  });

  describe("过期回收", () => {
    it("过期前 recover 应 revert", async () => {
      await expect(
        distributor.recover(owner.address)
      ).to.be.revertedWithCustomError(distributor, "NotExpired");
    });

    it("过期后 owner 可回收未领取代币", async () => {
      // alice 先 claim
      await distributor.connect(alice).claim(aliceAmount, getProof(alice.address));

      // 快进到过期后
      await time.increaseTo(expiryTime + 1);

      const ownerBalBefore = await token.balanceOf(owner.address);
      await distributor.recover(owner.address);
      const ownerBalAfter = await token.balanceOf(owner.address);

      // 应回收 60000 - 10000 (alice claimed) = 50000
      expect(ownerBalAfter - ownerBalBefore).to.equal(e(50_000));
    });

    it("非 owner 不能回收", async () => {
      await time.increaseTo(expiryTime + 1);
      await expect(
        distributor.connect(alice).recover(alice.address)
      ).to.be.revertedWithCustomError(distributor, "OwnableUnauthorizedAccount");
    });

    it("回收地址不能为零地址", async () => {
      await time.increaseTo(expiryTime + 1);
      await expect(
        distributor.recover(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(distributor, "ZeroAddress");
    });
  });
});
