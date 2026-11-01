/**
 * Nạp dữ liệu mẫu lên chuỗi từ data/certificates.json:
 *  - owner (account 0) cấp quyền issuer cho các đơn vị trong file
 *  - mỗi issuer cấp các chứng chỉ của mình (hash = keccak256 của file PDF)
 *  - thu hồi các chứng chỉ có "revoke": true
 * Chạy lại nhiều lần vẫn an toàn (bỏ qua mục đã có). Kết quả ghi vào data/seeded.json.
 *
 *   npm run seed
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const ROOT = path.join(__dirname, "..");
const STATUS = ["NotFound", "Valid", "Revoked"];

async function main() {
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "contract.json"), "utf8"));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "certificates.json"), "utf8"));
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const registry = new ethers.Contract(info.address, info.abi, owner);

  console.log("Contract:", info.address);
  console.log("Owner   :", owner.address, "\n");

  // 1) Cấp quyền issuer
  const issuerByKey = {};
  for (const i of cfg.issuers) {
    const signer = signers[i.accountIndex];
    issuerByKey[i.key] = { ...i, signer };
    if (!(await registry.isIssuer(signer.address))) {
      await (await registry.setIssuer(signer.address, true)).wait();
    }
    console.log(`Issuer  : ${i.name.padEnd(32)} ${signer.address}`);
  }
  console.log("");

  // 2) Cấp / thu hồi chứng chỉ
  const result = [];
  for (const c of cfg.certificates) {
    const file = path.join(ROOT, "data", "sample-pdfs", `${c.id}.pdf`);
    const certHash = ethers.keccak256(fs.readFileSync(file));
    const issuer = issuerByKey[c.issuerKey];
    const holder = signers[c.holderAccountIndex].address;
    const reg = registry.connect(issuer.signer);

    let current = Number((await registry.verifyCertificate(certHash)).status);
    let issueTx = null;
    if (current === 0) {
      const tx = await reg.issueCertificate(certHash, holder, `data/metadata/${c.id}.json`);
      await tx.wait();
      issueTx = tx.hash;
      current = 1;
    }
    let revokeTx = null;
    if (c.revoke && current === 1) {
      const tx = await reg.revokeCertificate(certHash);
      await tx.wait();
      revokeTx = tx.hash;
      current = 2;
    }

    const r = await registry.verifyCertificate(certHash);
    result.push({
      id: c.id,
      studentName: c.studentName,
      title: `${c.type} - ${c.title}`,
      certHash,
      issuer: issuer.signer.address,
      issuerName: issuer.name,
      holder,
      issuedAt: Number(r.issuedAt),
      status: STATUS[Number(r.status)],
      issueTx,
      revokeTx,
    });
    console.log(`${c.id}  ${STATUS[Number(r.status)].padEnd(8)} ${certHash}  (${c.studentName})`);
  }

  fs.writeFileSync(
    path.join(ROOT, "data", "seeded.json"),
    JSON.stringify({ contract: info.address, chainId: info.chainId, certificates: result }, null, 2) + "\n"
  );
  console.log("\nĐã ghi data/seeded.json");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
