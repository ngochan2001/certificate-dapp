/* Certificate DApp - logic giao diện
 * Thư viện: ethers v6 (frontend/lib/ethers.umd.min.js), qrcode-generator (frontend/lib/qrcode.js)
 * Cấu hình contract (địa chỉ + ABI) được đọc từ frontend/contract.json (do `npm run deploy` tạo ra).
 */
(() => {
  "use strict";

  const { ethers } = window;
  const $ = (sel, root = document) => root.querySelector(sel);

  const STATUS = ["NotFound", "Valid", "Revoked"];
  const ERR_VI = {
    NotOwner: "Chỉ chủ hợp đồng (owner) mới thực hiện được thao tác này.",
    NotIssuer: "Ví của bạn chưa được cấp quyền đơn vị cấp chứng chỉ.",
    AlreadyIssued: "Chứng chỉ này (cùng mã băm) đã được cấp trước đó, không thể cấp lại.",
    CertificateNotFound: "Không tìm thấy chứng chỉ với mã băm này.",
    NotCertificateIssuer: "Chỉ đơn vị đã cấp chứng chỉ này mới được thu hồi.",
    AlreadyRevoked: "Chứng chỉ này đã bị thu hồi trước đó.",
    InvalidHolder: "Địa chỉ ví người nhận không hợp lệ.",
  };
  const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

  const state = {
    cfg: null,
    readProvider: null,
    readContract: null,
    signer: null,
    account: null,
    writeContract: null,
    isOwner: false,
    isIssuer: false,
    qrUrl: "",
  };

  /* ---------- Tiện ích DOM / định dạng ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const short = (a) => (a ? a.slice(0, 6) + "..." + a.slice(-4) : "");
  const fmtTime = (ts) => new Date(Number(ts) * 1000).toLocaleString("vi-VN");
  const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const fromBlock = () => (state.cfg && state.cfg.deployBlock) || 0;

  // Truy vấn sự kiện tới block MỚI NHẤT lấy trực tiếp từ node. Không dùng "latest" mặc định của ethers
  // vì provider có thể trả số block đã cache nên chưa thấy sự kiện của giao dịch vừa xác nhận.
  async function queryEvents(filter) {
    const latest = parseInt(await state.readProvider.send("eth_blockNumber", []), 16);
    return state.readContract.queryFilter(filter, fromBlock(), latest);
  }

  function statusBadge(status) {
    const map = {
      Valid: ["badge badge-green", "Hợp lệ"],
      Revoked: ["badge badge-orange", "Đã thu hồi"],
      NotFound: ["badge badge-red", "Không tìm thấy"],
    };
    const [cls, label] = map[status] || map.NotFound;
    return h("span", { class: cls }, label);
  }

  function setMsg(el, kind, text) {
    el.className = "msg " + (kind || "");
    el.textContent = text || "";
  }

  function showBanner(kind, text) {
    const b = $("#banner");
    b.className = "banner " + kind;
    b.textContent = text;
  }
  function hideBanner() {
    $("#banner").className = "banner hidden";
  }

  function friendlyError(e) {
    if (!e) return "Đã xảy ra lỗi không xác định.";
    if (e.code === "ACTION_REJECTED" || e.code === 4001) return "Bạn đã từ chối giao dịch trong ví.";
    let name = (e.revert && e.revert.name) || e.errorName;
    if (!name && state.cfg) {
      const iface = new ethers.Interface(state.cfg.abi);
      const candidates = [
        e.data,
        e.error && e.error.data,
        e.info && e.info.error && e.info.error.data,
        e.info && e.info.error && e.info.error.data && e.info.error.data.data,
        e.error && e.error.data && e.error.data.data,
      ];
      for (const d of candidates) {
        if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) {
          try {
            const parsed = iface.parseError(d);
            if (parsed) { name = parsed.name; break; }
          } catch (_) { /* thử ứng viên tiếp theo */ }
        }
      }
    }
    if (name && ERR_VI[name]) return ERR_VI[name];
    return e.shortMessage || e.reason || e.message || String(e);
  }

  async function hashFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return ethers.keccak256(bytes);
  }

  function verifyUrl(hash) {
    const base = location.href.split(/[?#]/)[0];
    return base + "?verify=" + hash;
  }

  /* ---------- Khởi tạo & cấu hình ---------- */
  async function loadConfig() {
    try {
      const res = await fetch("contract.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.cfg = await res.json();
    } catch (e) {
      showBanner(
        "error",
        "Chưa có frontend/contract.json. Hãy chạy `npm run node` (terminal 1), rồi `npm run setup` (terminal 2) và mở trang qua `npm run serve`."
      );
      return false;
    }

    state.readProvider = new ethers.JsonRpcProvider(state.cfg.rpcUrl, Number(state.cfg.chainId), { staticNetwork: true });
    state.readContract = new ethers.Contract(state.cfg.address, state.cfg.abi, state.readProvider);
    $("#contract-label").textContent = "Contract: " + short(state.cfg.address) + " | chainId " + state.cfg.chainId;

    try {
      const code = await state.readProvider.getCode(state.cfg.address);
      if (code === "0x") {
        showBanner(
          "error",
          "Không có contract tại địa chỉ trong contract.json. Có thể bạn đã khởi động lại `npm run node` mà chưa chạy lại `npm run setup`."
        );
        return false;
      }
    } catch (e) {
      showBanner("error", "Không kết nối được tới " + state.cfg.rpcUrl + ". Hãy chạy `npm run node` trước.");
      return false;
    }
    return true;
  }

  /* ---------- Kết nối ví ---------- */
  async function ensureChain() {
    const want = "0x" + Number(state.cfg.chainId).toString(16);
    const cur = await window.ethereum.request({ method: "eth_chainId" });
    if (String(cur).toLowerCase() === want.toLowerCase()) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
    } catch (e) {
      if (e && (e.code === 4902 || /unrecognized chain|not added/i.test(e.message || ""))) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: want,
            chainName: "Hardhat Localhost",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [state.cfg.rpcUrl],
          }],
        });
      } else {
        throw e;
      }
    }
  }

  async function connect() {
    if (!state.cfg) return;
    if (!window.ethereum) {
      showBanner("error", "Không tìm thấy ví. Hãy cài MetaMask (hoặc ví tương thích) để cấp/thu hồi chứng chỉ. Bạn vẫn xác minh được mà không cần ví.");
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await ensureChain();
      const provider = new ethers.BrowserProvider(window.ethereum);
      state.signer = await provider.getSigner();
      state.account = await state.signer.getAddress();
      state.writeContract = new ethers.Contract(state.cfg.address, state.cfg.abi, state.signer);

      const owner = await state.readContract.owner();
      state.isOwner = sameAddr(owner, state.account);
      state.isIssuer = await state.readContract.isIssuer(state.account);

      renderWalletState();
      hideBanner();
    } catch (e) {
      showBanner("error", "Không kết nối được ví: " + friendlyError(e));
    }
  }

  function renderWalletState() {
    $("#btn-connect").classList.add("hidden");
    $("#net-badge").className = "badge badge-green";
    $("#net-badge").textContent = "Đã kết nối";
    $("#account-label").textContent = short(state.account);
    $("#account-label").title = state.account;

    const roles = $("#role-badges");
    roles.replaceChildren();
    if (state.isOwner) roles.append(h("span", { class: "badge badge-blue" }, "Owner"));
    if (state.isIssuer) roles.append(h("span", { class: "badge badge-blue" }, "Đơn vị cấp"));
    if (!state.isOwner && !state.isIssuer) roles.append(h("span", { class: "badge badge-grey" }, "Người dùng"));

    const allowed = { wallet: true, issuer: state.isIssuer, owner: state.isOwner };
    document.querySelectorAll(".tab[data-needs]").forEach((t) => {
      t.classList.toggle("hidden", !allowed[t.dataset.needs]);
    });
  }

  /* ---------- Tab ---------- */
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + name));
    if (name === "mine") loadMine();
    if (name === "manage") loadManage();
    if (name === "admin") loadAdmin();
  }

  /* ---------- Xác minh ---------- */
  async function fetchHistory(hash) {
    const c = state.readContract;
    const [issued, revoked] = await Promise.all([
      queryEvents(c.filters.CertificateIssued(hash)),
      queryEvents(c.filters.CertificateRevoked(hash)),
    ]);
    const all = [
      ...issued.map((e) => ({ label: "Cấp chứng chỉ", e })),
      ...revoked.map((e) => ({ label: "Thu hồi chứng chỉ", e })),
    ].sort((a, b) => a.e.blockNumber - b.e.blockNumber || a.e.index - b.e.index);
    for (const item of all) {
      const block = await state.readProvider.getBlock(item.e.blockNumber);
      item.time = block ? block.timestamp : 0;
    }
    return all;
  }

  async function fetchMetadata(uri) {
    // Chỉ đọc metadata dạng đường dẫn tương đối trong thư mục data/ của dự án
    if (!/^data\/[\w\-./]+\.json$/.test(uri || "") || uri.includes("..")) return null;
    try {
      const res = await fetch("../" + uri, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch (_) {
      return null;
    }
  }

  async function verifyHash(hash, opts = {}) {
    const box = $("#verify-result");
    if (!state.readContract) return;
    if (!HASH_RE.test(hash)) {
      box.replaceChildren(h("div", { class: "result notfound" }, h("h3", null, "Mã băm không hợp lệ"), h("p", null, "Mã băm cần có dạng 0x và 64 ký tự hex.")));
      return;
    }
    box.replaceChildren(h("div", { class: "card muted" }, "Đang tra cứu trên Blockchain..."));

    try {
      const r = await state.readContract.verifyCertificate(hash);
      const status = STATUS[Number(r.status)];
      const history = status === "NotFound" ? [] : await fetchHistory(hash);

      const view = { Valid: ["valid", "Chứng chỉ HỢP LỆ"], Revoked: ["revoked", "Chứng chỉ ĐÃ BỊ THU HỒI"], NotFound: ["notfound", "KHÔNG TÌM THẤY chứng chỉ"] }[status];
      let explain;
      if (status === "Valid") {
        explain = opts.fromFile
          ? "Mã băm của file khớp với bản ghi do đơn vị cấp ghi lên Blockchain và chứng chỉ chưa bị thu hồi."
          : "Mã băm này đã được đơn vị cấp ghi lên Blockchain và chưa bị thu hồi. Để chắc chắn file bạn đang cầm là bản gốc, hãy tải file lên ở \"Cách 1\".";
      } else if (status === "Revoked") {
        explain = "Đơn vị cấp đã thu hồi chứng chỉ này. Không nên chấp nhận.";
      } else {
        explain = opts.fromFile
          ? "Không có bản ghi nào khớp với file này. File có thể đã bị chỉnh sửa (dù chỉ một ký tự) hoặc chưa từng được cấp qua hệ thống."
          : "Không có chứng chỉ nào ứng với mã băm này.";
      }

      const parts = [h("div", { class: "result " + view[0] }, h("h3", null, view[1]), h("p", null, explain))];

      const rows = [["Mã băm (keccak256)", h("span", { class: "mono" }, hash)]];
      if (opts.fileName) rows.unshift(["File", opts.fileName]);
      if (status !== "NotFound") {
        rows.push(
          ["Đơn vị cấp (ví)", h("span", { class: "mono" }, r.issuer)],
          ["Người nhận (ví)", h("span", { class: "mono" }, r.holder)],
          ["Thời điểm cấp", fmtTime(r.issuedAt)],
          ["Metadata URI", r.metadataURI ? h("span", { class: "mono" }, r.metadataURI) : "(không có)"]
        );
      }
      parts.push(
        h("div", { class: "card" },
          h("table", { class: "kv" }, h("tbody", null, rows.map(([k, v]) => h("tr", null, h("th", null, k), h("td", null, v)))))
        )
      );

      if (history.length) {
        parts.push(
          h("div", { class: "card" },
            h("h3", { style: "margin-top:0" }, "Lịch sử trên chuỗi (truy vết)"),
            h("div", { class: "table-wrap" },
              h("table", { class: "list" },
                h("thead", null, h("tr", null, h("th", null, "Sự kiện"), h("th", null, "Thời gian"), h("th", null, "Block"), h("th", null, "Giao dịch"))),
                h("tbody", null, history.map((x) =>
                  h("tr", null, h("td", null, x.label), h("td", null, fmtTime(x.time)), h("td", null, x.e.blockNumber), h("td", { class: "mono small", title: x.e.transactionHash }, short(x.e.transactionHash)))
                ))
              )
            )
          )
        );
      }

      const meta = status === "NotFound" ? null : await fetchMetadata(r.metadataURI);
      if (meta) {
        const labels = { type: "Loại", title: "Tên", studentName: "Người nhận", studentId: "Mã số", result: "Kết quả", issueDate: "Ngày cấp", issuerName: "Đơn vị cấp" };
        parts.push(
          h("div", { class: "card" },
            h("h3", { style: "margin-top:0" }, "Thông tin mô tả (off-chain)"),
            h("p", { class: "muted small" }, "Dữ liệu này nằm ngoài Blockchain nên chỉ mang tính tham khảo. Căn cứ tin cậy là mã băm của file đã được ghi trên chuỗi."),
            h("table", { class: "kv" }, h("tbody", null, Object.entries(labels).filter(([k]) => meta[k]).map(([k, label]) => h("tr", null, h("th", null, label), h("td", null, meta[k])))))
          )
        );
      }

      box.replaceChildren(...parts);
    } catch (e) {
      box.replaceChildren(h("div", { class: "result notfound" }, h("h3", null, "Không tra cứu được"), h("p", null, friendlyError(e))));
    }
  }

  async function onVerifyFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const info = $("#verify-file-info");
    info.textContent = "Đang tính mã băm...";
    const hash = await hashFile(file);
    info.textContent = file.name + " (" + file.size + " byte)";
    $("#verify-hash").value = hash;
    await verifyHash(hash, { fromFile: true, fileName: file.name });
  }

  async function loadSamples() {
    try {
      const res = await fetch("../data/hashes.json", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = $("#sample-list");
      list.replaceChildren();
      for (const [id, v] of Object.entries(data)) {
        list.append(
          h("div", { class: "sample" },
            h("span", null, id),
            h("button", { class: "btn small", type: "button", onclick: () => { $("#verify-hash").value = v.keccak256; verifyHash(v.keccak256); } }, "Xác minh"),
            h("a", { class: "btn small", href: "../" + v.file, target: "_blank", rel: "noopener" }, "Mở PDF")
          )
        );
      }
      $("#samples").classList.remove("hidden");
    } catch (_) { /* không có dữ liệu mẫu thì bỏ qua */ }
  }

  /* ---------- QR ---------- */
  function showQr(hash) {
    state.qrUrl = verifyUrl(hash);
    const qr = window.qrcode(0, "M");
    qr.addData(state.qrUrl);
    qr.make();
    const box = $("#qr-box");
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    $("#qr-hash").textContent = hash;
    $("#qr-dialog").showModal();
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "Đã sao chép";
      setTimeout(() => (btn.textContent = old), 1500);
    } catch (_) {
      window.prompt("Sao chép liên kết:", text);
    }
  }

  /* ---------- Chứng chỉ của tôi (holder) ---------- */
  async function loadMine() {
    const box = $("#mine-list");
    if (!state.account) { box.replaceChildren(h("p", { class: "muted" }, "Hãy kết nối ví.")); return; }
    box.replaceChildren(h("p", { class: "muted" }, "Đang tải..."));
    try {
      const c = state.readContract;
      const events = await queryEvents(c.filters.CertificateIssued(null, null, state.account));
      if (!events.length) { box.replaceChildren(h("p", { class: "muted" }, "Ví này chưa được cấp chứng chỉ nào.")); return; }
      const cards = [];
      for (const e of events.slice().reverse()) {
        const hash = e.args.certHash;
        const r = await c.verifyCertificate(hash);
        const meta = await fetchMetadata(r.metadataURI);
        cards.push(
          h("div", { class: "card cert-card" },
            h("div", null,
              h("h4", null, meta ? meta.type + ": " + meta.title : "Chứng chỉ"),
              h("div", { class: "small muted" }, "Cấp lúc " + fmtTime(r.issuedAt) + " bởi " + short(r.issuer)),
              h("div", { class: "mono small" }, hash)
            ),
            h("div", { class: "row" },
              statusBadge(STATUS[Number(r.status)]),
              h("button", { class: "btn small", type: "button", onclick: () => showQr(hash) }, "Mã QR"),
              h("button", { class: "btn small", type: "button", onclick: () => { showTab("verify"); $("#verify-hash").value = hash; verifyHash(hash); } }, "Xác minh")
            )
          )
        );
      }
      box.replaceChildren(...cards);
    } catch (e) {
      box.replaceChildren(h("p", { class: "msg error" }, friendlyError(e)));
    }
  }

  /* ---------- Cấp chứng chỉ (issuer) ---------- */
  async function onIssueFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    $("#issue-hash").value = "Đang tính...";
    $("#issue-hash").value = await hashFile(file);
  }

  async function issue() {
    const msg = $("#issue-msg");
    const hash = $("#issue-hash").value.trim();
    const holder = $("#issue-holder").value.trim();
    const uri = $("#issue-uri").value.trim();
    if (!HASH_RE.test(hash)) return setMsg(msg, "error", "Hãy chọn file chứng chỉ hoặc nhập mã băm hợp lệ (0x + 64 ký tự hex).");
    if (!ethers.isAddress(holder)) return setMsg(msg, "error", "Địa chỉ ví người nhận không hợp lệ.");
    if (!state.writeContract) return setMsg(msg, "error", "Hãy kết nối ví trước.");

    const btn = $("#btn-issue");
    btn.disabled = true;
    try {
      const existing = await state.readContract.verifyCertificate(hash);
      if (Number(existing.status) !== 0) throw Object.assign(new Error(), { errorName: "AlreadyIssued" });

      setMsg(msg, "info", "Vui lòng xác nhận giao dịch trong ví...");
      const tx = await state.writeContract.issueCertificate(hash, holder, uri);
      setMsg(msg, "info", "Đã gửi giao dịch " + short(tx.hash) + ", đang chờ xác nhận...");
      await tx.wait();
      setMsg(msg, "ok", "Đã cấp chứng chỉ thành công. Giao dịch: " + tx.hash);
      msg.append(" ", h("button", { class: "btn small", type: "button", onclick: () => showQr(hash) }, "Xem mã QR"));
    } catch (e) {
      setMsg(msg, "error", friendlyError(e));
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Quản lý đã cấp / thu hồi ---------- */
  async function loadManage() {
    const box = $("#manage-list");
    if (!state.account) { box.replaceChildren(h("p", { class: "muted" }, "Hãy kết nối ví.")); return; }
    box.replaceChildren(h("p", { class: "muted" }, "Đang tải..."));
    try {
      const c = state.readContract;
      const events = await queryEvents(c.filters.CertificateIssued(null, state.account, null));
      if (!events.length) { box.replaceChildren(h("p", { class: "muted" }, "Ví này chưa cấp chứng chỉ nào.")); return; }
      const rows = [];
      for (const e of events.slice().reverse()) {
        const hash = e.args.certHash;
        const r = await c.verifyCertificate(hash);
        const status = STATUS[Number(r.status)];
        rows.push(
          h("tr", null,
            h("td", { class: "mono small", title: hash }, short(hash)),
            h("td", { class: "mono small", title: r.holder }, short(r.holder)),
            h("td", null, fmtTime(r.issuedAt)),
            h("td", null, statusBadge(status)),
            h("td", null, status === "Valid" ? h("button", { class: "btn small danger", type: "button", onclick: () => revoke(hash) }, "Thu hồi") : "")
          )
        );
      }
      box.replaceChildren(
        h("div", { class: "card table-wrap" },
          h("table", { class: "list" },
            h("thead", null, h("tr", null, h("th", null, "Mã băm"), h("th", null, "Người nhận"), h("th", null, "Thời điểm cấp"), h("th", null, "Trạng thái"), h("th", null, ""))),
            h("tbody", null, rows)
          )
        )
      );
    } catch (e) {
      box.replaceChildren(h("p", { class: "msg error" }, friendlyError(e)));
    }
  }

  async function revoke(hash) {
    const msg = $("#manage-msg");
    if (!window.confirm("Thu hồi chứng chỉ này? Thao tác ghi lên Blockchain và không thể hoàn tác.\n\n" + hash)) return;
    try {
      setMsg(msg, "info", "Vui lòng xác nhận giao dịch trong ví...");
      const tx = await state.writeContract.revokeCertificate(hash);
      setMsg(msg, "info", "Đã gửi giao dịch " + short(tx.hash) + ", đang chờ xác nhận...");
      await tx.wait();
      setMsg(msg, "ok", "Đã thu hồi chứng chỉ. Giao dịch: " + tx.hash);
      await loadManage();
    } catch (e) {
      setMsg(msg, "error", friendlyError(e));
    }
  }

  /* ---------- Quản trị (owner) ---------- */
  async function setIssuer(allowed) {
    const msg = $("#admin-msg");
    const addr = $("#admin-addr").value.trim();
    if (!ethers.isAddress(addr)) return setMsg(msg, "error", "Địa chỉ ví không hợp lệ.");
    try {
      setMsg(msg, "info", "Vui lòng xác nhận giao dịch trong ví...");
      const tx = await state.writeContract.setIssuer(addr, allowed);
      setMsg(msg, "info", "Đã gửi giao dịch " + short(tx.hash) + ", đang chờ xác nhận...");
      await tx.wait();
      setMsg(msg, "ok", (allowed ? "Đã cấp quyền cho " : "Đã gỡ quyền của ") + addr);
      await loadAdmin();
    } catch (e) {
      setMsg(msg, "error", friendlyError(e));
    }
  }

  async function loadAdmin() {
    const box = $("#admin-list");
    box.replaceChildren(h("p", { class: "muted" }, "Đang tải..."));
    try {
      const c = state.readContract;
      const events = await queryEvents(c.filters.IssuerUpdated());
      const addrs = [...new Set(events.map((e) => e.args.issuer))];
      const rows = [];
      for (const a of addrs) {
        const active = await c.isIssuer(a);
        rows.push(h("tr", null, h("td", { class: "mono small" }, a), h("td", null, active ? statusBadge("Valid") : h("span", { class: "badge badge-grey" }, "Đã gỡ quyền"))));
      }
      box.replaceChildren(
        h("div", { class: "card table-wrap" },
          h("table", { class: "list" }, h("thead", null, h("tr", null, h("th", null, "Địa chỉ ví"), h("th", null, "Quyền cấp chứng chỉ"))), h("tbody", null, rows))
        )
      );
    } catch (e) {
      box.replaceChildren(h("p", { class: "msg error" }, friendlyError(e)));
    }
  }

  /* ---------- Gắn sự kiện & chạy ---------- */
  function bindEvents() {
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
    $("#btn-connect").addEventListener("click", connect);
    $("#verify-file").addEventListener("change", onVerifyFile);
    $("#btn-verify").addEventListener("click", () => verifyHash($("#verify-hash").value.trim()));
    $("#verify-hash").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyHash(e.target.value.trim()); });
    $("#issue-file").addEventListener("change", onIssueFile);
    $("#btn-issue").addEventListener("click", issue);
    $("#btn-manage-refresh").addEventListener("click", loadManage);
    $("#btn-admin-add").addEventListener("click", () => setIssuer(true));
    $("#btn-admin-remove").addEventListener("click", () => setIssuer(false));
    $("#qr-close").addEventListener("click", () => $("#qr-dialog").close());
    $("#qr-copy").addEventListener("click", (e) => copyText(state.qrUrl, e.currentTarget));

    if (window.ethereum && window.ethereum.on) {
      window.ethereum.on("accountsChanged", () => location.reload());
      window.ethereum.on("chainChanged", () => location.reload());
    }
  }

  async function init() {
    bindEvents();
    const ok = await loadConfig();
    if (!ok) return;
    loadSamples();

    // Mở từ mã QR: ?verify=0x...
    const hash = new URLSearchParams(location.search).get("verify");
    if (hash) {
      $("#verify-hash").value = hash;
      verifyHash(hash);
    }

    // Nếu ví đã được cấp quyền truy cập trước đó thì tự kết nối lại
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts && accounts.length) connect();
      } catch (_) { /* bỏ qua */ }
    }
  }

  init();
})();
