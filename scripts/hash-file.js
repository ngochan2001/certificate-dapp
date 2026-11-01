/**
 * Tính mã băm keccak256 của file (đúng cách frontend tính khi cấp/xác minh chứng chỉ).
 *
 *   npm run hash -- data/sample-pdfs/CERT-001.pdf   -> in hash của 1 file
 *   npm run hash -- --all                           -> tính hash toàn bộ PDF mẫu, ghi vào data/hashes.json
 */
const fs = require("fs");
const path = require("path");
const { keccak256 } = require("ethers");

const ROOT = path.join(__dirname, "..");
const hashFile = (p) => keccak256(fs.readFileSync(p));

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log("Cách dùng:\n  npm run hash -- <đường-dẫn-file>\n  npm run hash -- --all");
    process.exit(1);
  }

  if (arg === "--all") {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "certificates.json"), "utf8"));
    const out = {};
    for (const c of cfg.certificates) {
      const file = `data/sample-pdfs/${c.id}.pdf`;
      out[c.id] = { file, keccak256: hashFile(path.join(ROOT, file)) };
    }
    for (const t of cfg.tampered || []) {
      const file = `data/sample-pdfs/${t.file}`;
      out[t.file.replace(/\.pdf$/, "")] = {
        file,
        keccak256: hashFile(path.join(ROOT, file)),
        ghi_chu: "Bản bị sửa: " + t.change + " (không được cấp trên chuỗi)",
      };
    }
    fs.writeFileSync(path.join(ROOT, "data", "hashes.json"), JSON.stringify(out, null, 2) + "\n");
    for (const [k, v] of Object.entries(out)) console.log(k.padEnd(22), v.keccak256);
    console.log("\nĐã ghi data/hashes.json");
    return;
  }

  console.log(hashFile(path.resolve(arg)));
}

main();
