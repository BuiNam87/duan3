// File này được tiêm vào trang web (chrome.scripting.executeScript({ files })).
// Có thể bị tiêm lại nhiều lần nên chỉ gán window.BP, không khai báo biến toàn cục.
// Panel gọi từng bước qua window.BP.*
window.BP = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopped = () => window.__bpStop === true;
  const isVisible = (el) => !!el && el.getClientRects().length > 0;

  // Selector hỗ trợ thêm:
  //   "a || b"            thử a trước, không có mới thử b
  //   "button::text(abc)" phần tử khớp selector và có chữ "abc" bên trong
  function findLast(sel) {
    if (!sel) return null;
    for (const part of sel.split("||")) {
      const m = part.trim().match(/^(.*?)::text\((.*)\)$/);
      const css = m ? m[1].trim() : part.trim();
      const text = m ? m[2].trim().toLowerCase() : null;
      let els;
      try {
        els = [...document.querySelectorAll(css || "*")];
      } catch (_) {
        continue;
      }
      els = els.filter(isVisible);
      if (text) els = els.filter((el) => el.textContent.toLowerCase().includes(text));
      if (els.length) return els[els.length - 1];
    }
    return null;
  }

  const isEnabled = (btn) => !!btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
  const isTextField = (el) => el.tagName === "TEXTAREA" || el.tagName === "INPUT";
  const readInput = (el) => (isTextField(el) ? el.value : el.innerText).trim();
  const describe = (el) => {
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30);
    return `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}>${label ? " " + label : ""}`;
  };
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };

  // Tự dò ô nhập: ô textarea/contenteditable lớn nhất đang hiển thị.
  function guessInput() {
    const els = [
      ...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')
    ].filter(isVisible);
    let best = null;
    let bestArea = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > bestArea) {
        best = el;
        bestArea = r.width * r.height;
      }
    }
    return best;
  }

  // Tự đoán nút gửi: đi ngược lên từ ô nhập, ở khối gần nhất có nút bấm thì ưu tiên nút
  // có chữ/nhãn giống "gửi"/type=submit, không có thì lấy nút ở góc phải dưới cùng.
  // Luôn bỏ qua nút xoá/đóng/huỷ (bấm nhầm sẽ xoá mất prompt).
  function guessSendButton(inputEl) {
    const label = (b) => `${b.textContent} ${b.getAttribute("aria-label") || ""} ${b.title || ""}`;
    const kw = /arrow_forward|arrow_upward|send|gửi|submit|generate|bắt đầu tạo/i;
    const bad = /close|clear|xoá|xóa|delete|remove|cancel|huỷ|hủy|\bmic\b|voice|giọng nói/i;
    let node = inputEl.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const btns = [...node.querySelectorAll('button, [role="button"]')].filter(
        (b) => isVisible(b) && !b.contains(inputEl) && !bad.test(label(b))
      );
      if (!btns.length) continue;
      const pref = btns.filter((b) => b.type === "submit" || kw.test(label(b)));
      if (pref.length) return pref[pref.length - 1];
      let best = null;
      let bestScore = -Infinity;
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        if (r.right + r.bottom > bestScore) {
          best = b;
          bestScore = r.right + r.bottom;
        }
      }
      return best;
    }
    return null;
  }

  async function findInput(cfg) {
    for (let i = 0; i < 20; i++) {
      const el = findLast(cfg.input) || (cfg.input ? null : guessInput());
      if (el) return el;
      await sleep(250);
    }
    return guessInput();
  }

  // Chờ tối đa 5s cho nút gửi bấm được.
  async function findSendButton(cfg, input) {
    let btn = null;
    for (let i = 0; i < 20; i++) {
      btn = findLast(cfg.send) || guessSendButton(input);
      if (isEnabled(btn)) break;
      await sleep(250);
    }
    return btn;
  }

  const diag = (input, btn) =>
    ` [ô nhập: ${input ? describe(input) + (readInput(input) ? ", có chữ" : ", TRỐNG") : "không thấy"}; ` +
    `nút gửi: ${btn ? describe(btn) + (isEnabled(btn) ? "" : " (đang bị khoá)") : "không thấy"}]`;

  function fillSynthetic(input, prompt) {
    input.focus();
    if (isTextField(input)) {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(input, prompt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, prompt);
      if (!input.innerText.trim()) {
        input.textContent = prompt;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt }));
      }
    }
  }

  function pressEnter(el) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  // Bấm bằng script: đủ chuỗi sự kiện chuột như người thật (một số trang chỉ nghe pointerdown/mouseup).
  function syntheticClick(el) {
    const { x, y } = center(el);
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.click();
  }

  // Theo dõi dấu hiệu trang đã nhận prompt: ô nhập bị xoá trống, nút gửi bị khoá/biến mất,
  // hoặc có phần tử mới xuất hiện bên ngoài khung nhập (vd. ô ảnh đang tạo).
  function watchSent(cfg, inputEl, btn) {
    let composer = inputEl.parentElement;
    while (btn && composer && !composer.contains(btn)) composer = composer.parentElement;
    composer = composer || inputEl.parentElement;
    let outside = false;
    const obs = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes)
          if (n.nodeType === 1 && !composer.contains(n) && !n.contains(composer)) outside = true;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return {
      async wait(ms) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const cur = inputEl.isConnected ? inputEl : findLast(cfg.input) || guessInput();
          if (!cur || readInput(cur) === "") return true;
          if (btn && (!btn.isConnected || !isEnabled(btn))) return true;
          if (outside) return true;
          await sleep(250);
        }
        return false;
      },
      stop: () => obs.disconnect()
    };
  }

  // Chờ đến khi trang không còn thay đổi trong idleMs.
  const waitIdle = (idleMs, deadline) =>
    new Promise((resolve) => {
      let last = Date.now();
      const obs = new MutationObserver(() => (last = Date.now()));
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      const timer = setInterval(() => {
        if (stopped() || Date.now() - last >= idleMs || Date.now() > deadline) {
          clearInterval(timer);
          obs.disconnect();
          resolve();
        }
      }, 250);
    });

  let watcher = null;

  return {
    // Cách 1: điền + bấm bằng script. Nếu trang không phản hồi, trả về needTrusted
    // để panel thử lại bằng thao tác thật (chrome.debugger).
    async send(prompt, cfg) {
      window.__bpStop = false;
      const input = await findInput(cfg);
      if (!input) return { ok: false, error: "Không tìm thấy ô nhập prompt. Dùng nút 🎯 trong Cài đặt để chọn ô nhập." };
      fillSynthetic(input, prompt);
      await sleep(600);
      const btn = await findSendButton(cfg, input);
      const w = watchSent(cfg, input, isEnabled(btn) ? btn : null);
      if (isEnabled(btn)) syntheticClick(btn);
      else pressEnter(input);
      const sent = await w.wait(4000);
      w.stop();
      if (sent) return { ok: true };
      return { ok: false, needTrusted: true, error: "Trang không phản hồi cú bấm bằng script." + diag(input, btn) };
    },

    // Cách 2 (thao tác thật), bước 1: trả toạ độ ô nhập để panel bấm vào rồi gõ chữ.
    async locateInput(cfg) {
      window.__bpStop = false;
      const input = await findInput(cfg);
      if (!input) return { ok: false, error: "Không tìm thấy ô nhập prompt. Dùng nút 🎯 trong Cài đặt để chọn ô nhập." };
      input.scrollIntoView({ block: "center" });
      await sleep(150);
      input.focus();
      return { ok: true, ...center(input) };
    },

    // Bước 2: kiểm tra chữ đã vào ô, trả toạ độ nút gửi và bắt đầu theo dõi.
    async armSend(cfg, prompt) {
      const input = await findInput(cfg);
      if (!input) return { ok: false, error: "Không tìm thấy ô nhập prompt." };
      const text = readInput(input);
      const want = prompt.trim().slice(0, 20);
      if (!text.includes(want))
        return { ok: false, error: `Gõ chữ vào ô nhập không thành công (ô đang có: "${text.slice(0, 40)}").` };
      const btn = await findSendButton(cfg, input);
      if (!isEnabled(btn))
        return { ok: false, error: "Không tìm thấy nút gửi bấm được. Dùng nút 🎯 trong Cài đặt để chọn nút gửi." + diag(input, btn) };
      btn.scrollIntoView({ block: "center" });
      await sleep(150);
      if (watcher) watcher.stop();
      watcher = watchSent(cfg, input, btn);
      return { ok: true, ...center(btn), diag: diag(input, btn) };
    },

    // Bước 3: chờ dấu hiệu trang đã nhận prompt.
    async awaitSent(ms) {
      if (!watcher) return false;
      const r = await watcher.wait(ms);
      watcher.stop();
      watcher = null;
      return r;
    },

    // Chế độ chat: chờ AI trả lời xong.
    async waitDone(cfg) {
      const start = Date.now();
      const deadline = start + cfg.maxMs;
      if (cfg.stop) {
        while (!stopped() && Date.now() - start < 15000 && !findLast(cfg.stop)) await sleep(300);
        while (!stopped() && Date.now() < deadline && findLast(cfg.stop)) await sleep(500);
      } else {
        await sleep(3000);
      }
      await waitIdle(cfg.idleMs, deadline);
      if (stopped()) return { ok: false, error: "Đã dừng." };
      if (Date.now() > deadline) return { ok: false, error: "Hết thời gian chờ." };
      return { ok: true };
    },

    stop() {
      window.__bpStop = true;
    },

    // Cho người dùng bấm chọn 1 phần tử trên trang, trả về selector của phần tử đó.
    pick() {
      return new Promise((resolve) => {
        const box = document.createElement("div");
        Object.assign(box.style, {
          position: "fixed", zIndex: 2147483647, pointerEvents: "none",
          border: "2px solid #f59e0b", background: "rgba(245,158,11,.15)", borderRadius: "4px"
        });
        const tip = document.createElement("div");
        tip.textContent = "Bấm vào phần tử cần chọn · Esc để huỷ";
        Object.assign(tip.style, {
          position: "fixed", zIndex: 2147483647, top: "8px", left: "50%", transform: "translateX(-50%)",
          background: "#f59e0b", color: "#000", padding: "6px 12px", borderRadius: "6px",
          font: "600 13px system-ui", pointerEvents: "none"
        });
        document.documentElement.append(box, tip);

        const pickTarget = (el) =>
          el.closest('button, [role="button"], textarea, input, [contenteditable="true"], [contenteditable=""]') || el;

        const buildSelector = (el) => {
          const tag = el.tagName.toLowerCase();
          const q = (v) => v.replace(/"/g, '\\"');
          if (el.id && !/\d{4,}|:/.test(el.id)) return "#" + CSS.escape(el.id);
          const testid = el.getAttribute("data-testid");
          if (testid) return `${tag}[data-testid="${q(testid)}"]`;
          const aria = el.getAttribute("aria-label");
          if (aria) return `${tag}[aria-label="${q(aria)}"]`;
          if (el.isContentEditable && el.getAttribute("contenteditable") !== null) return `${tag}[contenteditable="true"]`;
          if (tag === "textarea") return "textarea";
          const text = el.textContent.trim();
          if ((tag === "button" || el.getAttribute("role") === "button") && text && text.length <= 40)
            return `${tag}::text(${text})`;
          const parts = [];
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            let part = n.tagName.toLowerCase();
            if (n.id && !/\d{4,}|:/.test(n.id)) { parts.unshift("#" + CSS.escape(n.id)); break; }
            const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
            if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
            parts.unshift(part);
          }
          return parts.join(" > ");
        };

        // Phủ 1 lớp trong suốt lên trang để bắt cú bấm (kể cả vào nút đang bị khoá, vốn không nhận click).
        const cover = document.createElement("div");
        Object.assign(cover.style, { position: "fixed", inset: "0", zIndex: 2147483646, cursor: "crosshair", background: "transparent" });
        document.documentElement.append(cover);
        const under = (e) => {
          const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x !== cover && x !== box && x !== tip);
          return el ? pickTarget(el) : null;
        };
        const block = (e) => { e.preventDefault(); e.stopPropagation(); };
        const onMove = (e) => {
          const el = under(e);
          if (!el) return;
          const r = el.getBoundingClientRect();
          Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
        };
        const finish = (value) => {
          removeEventListener("keydown", onKey, true);
          cover.remove();
          box.remove();
          tip.remove();
          resolve(value);
        };
        const onClick = (e) => {
          block(e);
          const el = under(e);
          finish(el ? { selector: buildSelector(el), tag: el.tagName.toLowerCase() } : null);
        };
        const onKey = (e) => { if (e.key === "Escape") { block(e); finish(null); } };

        cover.addEventListener("mousemove", onMove);
        ["pointerdown", "mousedown", "mouseup", "pointerup"].forEach((t) => cover.addEventListener(t, block));
        cover.addEventListener("click", onClick);
        addEventListener("keydown", onKey, true);
      });
    }
  };
})();
