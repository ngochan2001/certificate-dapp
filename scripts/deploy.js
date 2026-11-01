/**
 * Triển khai CertificateRegistry và ghi frontend/contract.json (địa chỉ + ABI) cho giao diện.
 *
 *   npm run node      (terminal 1: mạng cục bộ)
 *   npm run deploy    (terminal 2)
 */
const fs = require("fs");
const path = require("path");
const { ethers, artifacts, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Người triển khai (owner):", deployer.address);

  const Registry = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const receipt = await registry.deploymentTransaction().wait();
  const address = await registry.getAddress();

  const artifact = await artifacts.readArtifact("CertificateRegistry");
  const { chainId } = await ethers.provider.getNetwork();

  const info = {
    address,
    chainId: Number(chainId),
    rpcUrl: network.config.url || "http://127.0.0.1:8545",
    deployBlock: receipt.blockNumber,
    deployer: deployer.address,
    abi: artifact.abi,
  };

  const outFile = path.join(__dirname, "..", "frontend", "contract.json");
  fs.writeFileSync(outFile, JSON.stringify(info, null, 2) + "\n");

  console.log("CertificateRegistry đã triển khai tại:", address);
  console.log("Đã ghi", path.relative(process.cwd(), outFile));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
