# Báo cáo gas (đo thực tế trên mạng Hardhat)

Compiler: solc 0.8.26, optimizer bật (runs = 200).

| Thao tác | Gas sử dụng | Ghi chú |
|---|---:|---|
| Triển khai contract | 619831 | Một lần duy nhất |
| setIssuer (thêm issuer mới) | 47723 | Ghi 1 ô lưu trữ mới |
| issueCertificate (metadataURI rỗng) | 74947 | Chứng chỉ đầu tiên, không URI |
| issueCertificate (URI 27 ký tự) | 95331 | Có đường dẫn metadata |
| revokeCertificate | 33513 | Chỉ cập nhật trạng thái |
| verifyCertificate (hàm view) | 0 khi gọi ngoài chuỗi | Ước lượng nếu gọi như giao dịch: 29207 gas |
