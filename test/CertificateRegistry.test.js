const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Trạng thái chứng chỉ (khớp với enum Status trong contract)
const Status = { NotFound: 0n, Valid: 1n, Revoked: 2n };

// Mã băm mẫu: trong thực tế là keccak256 của nội dung file PDF
const hashOf = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

describe("CertificateRegistry", function () {
  async function deployFixture() {
    const [owner, issuerA, issuerB, student, employer, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    // Owner cấp quyền cho 2 đơn vị cấp chứng chỉ
    await registry.setIssuer(issuerA.address, true);
    await registry.setIssuer(issuerB.address, true);

    return { registry, owner, issuerA, issuerB, student, employer, stranger };
  }

  describe("Khởi tạo", function () {
    it("đặt người triển khai làm owner và issuer mặc định", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.isIssuer(owner.address)).to.equal(true);
    });
  });

  describe("Quản lý đơn vị cấp (setIssuer)", function () {
    it("[KB1] owner thêm một issuer và phát sự kiện IssuerUpdated", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.setIssuer(stranger.address, true))
        .to.emit(registry, "IssuerUpdated")
        .withArgs(stranger.address, true);
      expect(await registry.isIssuer(stranger.address)).to.equal(true);
    });

    it("owner có thể gỡ quyền issuer", async function () {
      const { registry, issuerA } = await loadFixture(deployFixture);
      await registry.setIssuer(issuerA.address, false);
      expect(await registry.isIssuer(issuerA.address)).to.equal(false);
    });

    it("người không phải owner không được thay đổi danh sách issuer", async function () {
      const { registry, issuerA, stranger } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuerA).setIssuer(stranger.address, true)
      ).to.be.revertedWithCustomError(registry, "NotOwner");
    });
  });

  describe("Cấp chứng chỉ (issueCertificate)", function () {
    it("[KB2] người không có quyền issuer bị từ chối", async function () {
      const { registry, stranger, student } = await loadFixture(deployFixture);
      await expect(
        registry.connect(stranger).issueCertificate(hashOf("cert-1"), student.address, "")
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("[KB3] issuer cấp chứng chỉ thành công, trạng thái Valid và có sự kiện", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");

      const tx = await registry
        .connect(issuerA)
        .issueCertificate(h, student.address, "data/metadata/CERT-001.json");
      const block = await ethers.provider.getBlock(tx.blockNumber);

      await expect(tx)
        .to.emit(registry, "CertificateIssued")
        .withArgs(h, issuerA.address, student.address, block.timestamp);

      const r = await registry.verifyCertificate(h);
      expect(r.status).to.equal(Status.Valid);
      expect(r.issuer).to.equal(issuerA.address);
      expect(r.holder).to.equal(student.address);
      expect(r.issuedAt).to.equal(BigInt(block.timestamp));
      expect(r.metadataURI).to.equal("data/metadata/CERT-001.json");
    });

    it("[KB4] cấp lại chứng chỉ có cùng hash bị từ chối", async function () {
      const { registry, issuerA, issuerB, student } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");

      await expect(
        registry.connect(issuerA).issueCertificate(h, student.address, "")
      ).to.be.revertedWithCustomError(registry, "AlreadyIssued");

      // Đơn vị khác cũng không thể cấp đè lên cùng hash
      await expect(
        registry.connect(issuerB).issueCertificate(h, student.address, "")
      ).to.be.revertedWithCustomError(registry, "AlreadyIssued");
    });

    it("từ chối cấp cho địa chỉ rỗng (address(0))", async function () {
      const { registry, issuerA } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuerA).issueCertificate(hashOf("cert-1"), ethers.ZeroAddress, "")
      ).to.be.revertedWithCustomError(registry, "InvalidHolder");
    });

    it("issuer bị gỡ quyền thì không cấp được nữa", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      await registry.setIssuer(issuerA.address, false);
      await expect(
        registry.connect(issuerA).issueCertificate(hashOf("cert-1"), student.address, "")
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("ghi nhận đúng timestamp của block", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      const target = (await time.latest()) + 1000;
      await time.setNextBlockTimestamp(target);
      await registry.connect(issuerA).issueCertificate(hashOf("cert-t"), student.address, "");
      const r = await registry.verifyCertificate(hashOf("cert-t"));
      expect(r.issuedAt).to.equal(BigInt(target));
    });
  });

  describe("Xác minh chứng chỉ (verifyCertificate)", function () {
    it("[KB5] chứng chỉ hợp lệ trả về Valid cùng thông tin; ai cũng gọi được", async function () {
      const { registry, issuerA, student, employer } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");

      // Nhà tuyển dụng (không có quyền gì) vẫn xác minh được
      const r = await registry.connect(employer).verifyCertificate(h);
      expect(r.status).to.equal(Status.Valid);
      expect(r.issuer).to.equal(issuerA.address);
    });

    it("[KB6] hash chưa từng được cấp trả về NotFound", async function () {
      const { registry, employer } = await loadFixture(deployFixture);
      const r = await registry.connect(employer).verifyCertificate(hashOf("khong-ton-tai"));
      expect(r.status).to.equal(Status.NotFound);
      expect(r.issuer).to.equal(ethers.ZeroAddress);
      expect(r.holder).to.equal(ethers.ZeroAddress);
      expect(r.issuedAt).to.equal(0n);
    });

    it("[KB10] sửa một ký tự trong nội dung làm hash đổi nên xác minh thất bại", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      const original = "Chung chi: Nguyen Van A - Xep loai: Gioi";
      const tampered = "Chung chi: Nguyen Van A - Xep loai: Xuat sac";
      await registry.connect(issuerA).issueCertificate(hashOf(original), student.address, "");

      expect((await registry.verifyCertificate(hashOf(original))).status).to.equal(Status.Valid);
      expect((await registry.verifyCertificate(hashOf(tampered))).status).to.equal(Status.NotFound);
    });
  });

  describe("Thu hồi chứng chỉ (revokeCertificate)", function () {
    it("[KB7] issuer thu hồi chứng chỉ do mình cấp: trạng thái Revoked và có sự kiện", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");

      const tx = await registry.connect(issuerA).revokeCertificate(h);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      await expect(tx)
        .to.emit(registry, "CertificateRevoked")
        .withArgs(h, issuerA.address, block.timestamp);

      const r = await registry.verifyCertificate(h);
      expect(r.status).to.equal(Status.Revoked);
      // Thu hồi KHÔNG xóa bản ghi: thông tin cấp vẫn còn
      expect(r.issuer).to.equal(issuerA.address);
      expect(r.holder).to.equal(student.address);
    });

    it("[KB8] issuer khác không được thu hồi chứng chỉ không phải của mình", async function () {
      const { registry, issuerA, issuerB, student } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");
      await expect(
        registry.connect(issuerB).revokeCertificate(h)
      ).to.be.revertedWithCustomError(registry, "NotCertificateIssuer");
    });

    it("[KB9] thu hồi chứng chỉ đã thu hồi bị từ chối", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");
      await registry.connect(issuerA).revokeCertificate(h);
      await expect(
        registry.connect(issuerA).revokeCertificate(h)
      ).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
    });

    it("thu hồi chứng chỉ không tồn tại bị từ chối", async function () {
      const { registry, issuerA } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuerA).revokeCertificate(hashOf("khong-ton-tai"))
      ).to.be.revertedWithCustomError(registry, "CertificateNotFound");
    });

    it("người không có quyền issuer không thu hồi được", async function () {
      const { registry, issuerA, student, stranger } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");
      await expect(
        registry.connect(stranger).revokeCertificate(h)
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("chứng chỉ đã thu hồi không thể cấp lại bằng cùng hash", async function () {
      const { registry, issuerA, student } = await loadFixture(deployFixture);
      const h = hashOf("cert-1");
      await registry.connect(issuerA).issueCertificate(h, student.address, "");
      await registry.connect(issuerA).revokeCertificate(h);
      await expect(
        registry.connect(issuerA).issueCertificate(h, student.address, "")
      ).to.be.revertedWithCustomError(registry, "AlreadyIssued");
    });
  });

  describe("Truy vết qua sự kiện (events)", function () {
    it("có thể lọc các chứng chỉ theo holder và theo issuer", async function () {
      const { registry, issuerA, issuerB, student, stranger } = await loadFixture(deployFixture);
      await registry.connect(issuerA).issueCertificate(hashOf("c1"), student.address, "");
      await registry.connect(issuerB).issueCertificate(hashOf("c2"), student.address, "");
      await registry.connect(issuerA).issueCertificate(hashOf("c3"), stranger.address, "");

      const byHolder = await registry.queryFilter(
        registry.filters.CertificateIssued(null, null, student.address)
      );
      expect(byHolder.map((e) => e.args.certHash)).to.have.members([hashOf("c1"), hashOf("c2")]);

      const byIssuer = await registry.queryFilter(
        registry.filters.CertificateIssued(null, issuerA.address, null)
      );
      expect(byIssuer.map((e) => e.args.certHash)).to.have.members([hashOf("c1"), hashOf("c3")]);
    });
  });
});
