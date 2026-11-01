/**
 * Đo lượng gas của từng hàm ghi dữ liệu (chạy trên mạng Hardhat trong bộ nhớ).
 *
 *   npm run gas
 *
 * Kết quả ghi vào docs/gas-report.md. Lưu ý: gas phụ thuộc phiên bản compiler,
 * cấu hình optimizer và độ dài chuỗi metadataURI; phí thực tế = gas x giá gas của mạng.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const hashOf = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function main() {
  const [owner, issuer, student] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy();
  const deployRc = await registry.deploymentTransaction().wait();

  const rows = [];
  const add = (name, rc, note) => rows.push({ name, gas: rc.gasUsed, note });

  add("Triển khai contract", deployRc, "Một lần duy nhất");

  add("setIssuer (thêm issuer mới)", await (await registry.setIssuer(issuer.address, true)).wait(), "Ghi 1 ô lưu trữ mới");

  const r = registry.connect(issuer);
  const uri = "data/metadata/CERT-001.json";

  add("issueCertificate (metadataURI rỗng)", await (await r.issueCertificate(hashOf("a"), student.address, "")).wait(), "Chứng chỉ đầu tiên, không URI");
  add(`issueCertificate (URI ${uri.length} ký tự)`, await (await r.issueCertificate(hashOf("b"), student.address, uri)).wait(), "Có đường dẫn metadata");
  add("revokeCertificate", await (await r.revokeCertificate(hashOf("b"))).wait(), "Chỉ cập nhật trạng thái");

  const verifyGas = await registry.verifyCertificate.estimateGas(hashOf("a"));

  let md = "# Báo cáo gas (đo thực tế trên mạng Hardhat)\n\n";
  md += `Compiler: solc 0.8.26, optimizer bật (runs = 200).\n\n`;
  md += "| Thao tác | Gas sử dụng | Ghi chú |\n|---|---:|---|\n";
  for (const x of rows) md += `| ${x.name} | ${x.gas.toString()} | ${x.note} |\n`;
  md += `| verifyCertificate (hàm view) | 0 khi gọi ngoài chuỗi | Ước lượng nếu gọi như giao dịch: ${verifyGas.toString()} gas |\n`;

  console.log(md);
  fs.writeFileSync(path.join(__dirname, "..", "docs", "gas-report.md"), md);
  console.log("Đã ghi docs/gas-report.md");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
