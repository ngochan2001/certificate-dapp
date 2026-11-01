// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CertificateRegistry
/// @notice Lưu mã băm (hash) của chứng chỉ để cấp, thu hồi và xác minh.
/// @dev File chứng chỉ (PDF) lưu off-chain; on-chain chỉ lưu hash và thông tin tối thiểu.
contract CertificateRegistry {
    // ---------- Kiểu dữ liệu ----------
    enum Status { NotFound, Valid, Revoked }

    struct Certificate {
        address issuer;      // đơn vị cấp (ví của trường)
        address holder;      // ví của người được cấp
        uint64 issuedAt;     // thời điểm cấp (timestamp của block)
        Status status;       // trạng thái chứng chỉ
        string metadataURI;  // liên kết dữ liệu off-chain (không chứa thông tin cá nhân nhạy cảm)
    }

    // ---------- Trạng thái ----------
    address public owner;
    mapping(address => bool) public isIssuer;
    mapping(bytes32 => Certificate) private certificates; // certHash => Certificate

    // ---------- Sự kiện ----------
    event IssuerUpdated(address indexed issuer, bool allowed);
    event CertificateIssued(
        bytes32 indexed certHash,
        address indexed issuer,
        address indexed holder,
        uint64 issuedAt
    );
    event CertificateRevoked(bytes32 indexed certHash, address indexed issuer, uint64 revokedAt);

    // ---------- Lỗi tùy chỉnh ----------
    error NotOwner();
    error NotIssuer();
    error AlreadyIssued();
    error CertificateNotFound();
    error NotCertificateIssuer();
    error AlreadyRevoked();
    error InvalidHolder();

    // ---------- Phân quyền ----------
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert NotIssuer();
        _;
    }

    constructor() {
        owner = msg.sender;
        isIssuer[msg.sender] = true;
        emit IssuerUpdated(msg.sender, true);
    }

    /// @notice Thêm hoặc gỡ quyền cấp chứng chỉ của một đơn vị.
    function setIssuer(address issuer, bool allowed) external onlyOwner {
        isIssuer[issuer] = allowed;
        emit IssuerUpdated(issuer, allowed);
    }

    /// @notice Cấp chứng chỉ mới.
    /// @param certHash Mã băm (32 byte) của file chứng chỉ, tính ở phía client.
    /// @param holder Địa chỉ ví của người được cấp.
    /// @param metadataURI Liên kết dữ liệu off-chain (có thể để rỗng).
    function issueCertificate(
        bytes32 certHash,
        address holder,
        string calldata metadataURI
    ) external onlyIssuer {
        if (holder == address(0)) revert InvalidHolder();
        if (certificates[certHash].status != Status.NotFound) revert AlreadyIssued();

        uint64 nowTs = uint64(block.timestamp);
        certificates[certHash] = Certificate({
            issuer: msg.sender,
            holder: holder,
            issuedAt: nowTs,
            status: Status.Valid,
            metadataURI: metadataURI
        });

        emit CertificateIssued(certHash, msg.sender, holder, nowTs);
    }

    /// @notice Thu hồi chứng chỉ (chỉ đơn vị đã cấp mới được thu hồi).
    function revokeCertificate(bytes32 certHash) external onlyIssuer {
        Certificate storage c = certificates[certHash];
        if (c.status == Status.NotFound) revert CertificateNotFound();
        if (c.issuer != msg.sender) revert NotCertificateIssuer();
        if (c.status == Status.Revoked) revert AlreadyRevoked();

        c.status = Status.Revoked;
        emit CertificateRevoked(certHash, msg.sender, uint64(block.timestamp));
    }

    /// @notice Xác minh chứng chỉ. Hàm view nên không tốn phí gas khi gọi từ bên ngoài.
    function verifyCertificate(bytes32 certHash)
        external
        view
        returns (
            Status status,
            address issuer,
            address holder,
            uint64 issuedAt,
            string memory metadataURI
        )
    {
        Certificate storage c = certificates[certHash];
        return (c.status, c.issuer, c.holder, c.issuedAt, c.metadataURI);
    }
}
