import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

  // Deploy HPC Token — 1B minted to deployer
  const HPCToken = await ethers.getContractFactory("HPCToken");
  const token = await HPCToken.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const totalSupply = await token.totalSupply();

  console.log("\n=== Deployment Complete ===");
  console.log("HPCToken:", tokenAddr);
  console.log("Total supply:", ethers.formatEther(totalSupply), "HPC");
  console.log("Owner:", await token.owner());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
