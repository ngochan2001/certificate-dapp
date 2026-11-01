#!/usr/bin/env python3
"""
Sinh file PDF chứng chỉ mẫu và file metadata từ data/certificates.json.

Yêu cầu:  pip install reportlab
Chạy:     python3 scripts/generate_sample_pdfs.py

Kết quả:
  data/sample-pdfs/CERT-00X.pdf          (chứng chỉ mẫu, dữ liệu hư cấu)
  data/sample-pdfs/CERT-001_tampered.pdf (bản bị sửa, dùng để demo xác minh thất bại)
  data/metadata/CERT-00X.json            (dữ liệu mô tả off-chain)

Lưu ý: hash của PDF phụ thuộc từng byte của file. Nếu chạy lại script, hãy chạy
lại `npm run hash -- --all` và seed lại dữ liệu trên chuỗi.
"""
import json
import os
import sys

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PDF_DIR = os.path.join(DATA, "sample-pdfs")
META_DIR = os.path.join(DATA, "metadata")

# Cần font hỗ trợ tiếng Việt (có dấu). Thêm đường dẫn font của máy bạn nếu cần.
FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]


def register_fonts():
    for regular, bold in FONT_CANDIDATES:
        if os.path.exists(regular) and os.path.exists(bold):
            pdfmetrics.registerFont(TTFont("VN", regular))
            pdfmetrics.registerFont(TTFont("VN-Bold", bold))
            return
    sys.exit("Không tìm thấy font hỗ trợ tiếng Việt. Hãy sửa FONT_CANDIDATES trong script.")


def draw_certificate(path, cert, issuer_name, result_text):
    # invariant=1: PDF ổn định (không nhúng thời gian tạo), cùng dữ liệu thì cùng byte
    c = canvas.Canvas(path, pagesize=landscape(A4), invariant=1)
    w, h = landscape(A4)
    navy = HexColor("#1f3a5f")
    gold = HexColor("#b8892b")

    # Khung viền
    c.setStrokeColor(navy)
    c.setLineWidth(4)
    c.rect(30, 30, w - 60, h - 60)
    c.setStrokeColor(gold)
    c.setLineWidth(1.5)
    c.rect(40, 40, w - 80, h - 80)

    # Đơn vị cấp
    c.setFillColor(navy)
    c.setFont("VN-Bold", 15)
    c.drawCentredString(w / 2, h - 90, issuer_name.upper())

    # Loại giấy tờ
    c.setFont("VN-Bold", 32)
    c.drawCentredString(w / 2, h - 150, cert["type"].upper())

    c.setFillColor(gold)
    c.setFont("VN", 13)
    c.drawCentredString(w / 2, h - 178, "Chứng nhận rằng")

    # Người nhận
    c.setFillColor(navy)
    c.setFont("VN-Bold", 28)
    c.drawCentredString(w / 2, h - 225, cert["studentName"])

    c.setFont("VN", 13)
    c.drawCentredString(w / 2, h - 252, "Mã số: " + cert["studentId"])

    # Nội dung
    c.setFont("VN", 14)
    c.drawCentredString(w / 2, h - 295, "đã hoàn thành chương trình / đạt yêu cầu:")
    c.setFont("VN-Bold", 20)
    c.drawCentredString(w / 2, h - 328, cert["title"])
    c.setFont("VN", 15)
    c.drawCentredString(w / 2, h - 360, result_text)

    # Ngày cấp, mã chứng chỉ
    c.setFont("VN", 12)
    y, m, d = cert["issueDate"].split("-")
    c.drawString(80, 90, "Ngày cấp: %s/%s/%s" % (d, m, y))
    c.drawRightString(w - 80, 90, "Mã chứng chỉ: " + cert["id"])

    # Cảnh báo dữ liệu hư cấu
    c.setFillColor(HexColor("#aa3333"))
    c.setFont("VN-Bold", 10)
    c.drawCentredString(w / 2, 58, "MẪU DEMO - DỮ LIỆU HƯ CẤU, KHÔNG CÓ GIÁ TRỊ PHÁP LÝ")

    c.showPage()
    c.save()


def main():
    register_fonts()
    os.makedirs(PDF_DIR, exist_ok=True)
    os.makedirs(META_DIR, exist_ok=True)

    with open(os.path.join(DATA, "certificates.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    issuers = {i["key"]: i for i in cfg["issuers"]}

    for cert in cfg["certificates"]:
        issuer_name = issuers[cert["issuerKey"]]["name"]
        pdf_name = cert["id"] + ".pdf"
        draw_certificate(os.path.join(PDF_DIR, pdf_name), cert, issuer_name, cert["result"])

        meta = {
            "id": cert["id"],
            "type": cert["type"],
            "title": cert["title"],
            "studentName": cert["studentName"],
            "studentId": cert["studentId"],
            "result": cert["result"],
            "issueDate": cert["issueDate"],
            "issuerName": issuer_name,
            "file": "data/sample-pdfs/" + pdf_name,
            "note": "Dữ liệu hư cấu phục vụ học tập. Dữ liệu này nằm OFF-CHAIN, chuỗi chỉ lưu mã băm của file PDF.",
        }
        with open(os.path.join(META_DIR, cert["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("Đã tạo", pdf_name)

    # Bản bị sửa (demo: chỉ sửa 1 chi tiết thì hash thay đổi hoàn toàn)
    by_id = {c["id"]: c for c in cfg["certificates"]}
    for t in cfg.get("tampered", []):
        cert = by_id[t["id"]]
        issuer_name = issuers[cert["issuerKey"]]["name"]
        draw_certificate(os.path.join(PDF_DIR, t["file"]), cert, issuer_name, t["result"])
        print("Đã tạo", t["file"], "(bản bị sửa: " + t["change"] + ")")


if __name__ == "__main__":
    main()
