// Các hàm dưới đây được tiêm vào trang web qua chrome.scripting.executeScript,
// nên phải tự chứa hết (không dùng biến bên ngoài).

async function runPromptInPage(prompt, cfg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopped = () => window.__bpStop === true;
  window.__bpStop = false;

  const isVisible = (el) => !!el && el.getClientRects().length > 0;
  // Selector hỗ trợ thêm:
  //   "a || b"            thử a trước, không có mới thử b
  //   "button::text(abc)" phần tử khớp selector và có chữ "abc" bên trong
  const findLast = (sel) => {
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
  };
  const isEnabled = (btn) =>
    btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";

  // Tự dò ô nhập: ô textarea/contenteditable lớn nhất đang hiển thị.
  const guessInput = () => {
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
  };

  const describe = (el) => {
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30);
    return `<${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}>${label ? " " + label : ""}`;
  };

  // Tự đoán nút gửi: đi ngược lên từ ô nhập, ở khối gần nhất có nút bấm thì ưu tiên nút
  // có chữ/nhãn giống "gửi"/type=submit, không có thì lấy nút ở góc phải dưới cùng.
  // Luôn bỏ qua nút xoá/đóng/huỷ (bấm nhầm sẽ xoá mất prompt).
  const guessSendButton = (inputEl) => {
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
  };

  const isTextField = (el) => el.tagName === "TEXTAREA" || el.tagName === "INPUT";
  const readInput = (el) => (isTextField(el) ? el.value : el.innerText).trim();

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

  const pressEnter = (el) => {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  };

  // Theo dõi dấu hiệu trang đã nhận prompt: ô nhập bị xoá trống, nút gửi bị khoá/biến mất,
  // hoặc có phần tử mới xuất hiện bên ngoài khung nhập (vd. ô ảnh đang tạo).
  const watchSent = (inputEl, btn) => {
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
  };

  // 1. Tìm ô nhập
  let input = null;
  for (let i = 0; i < 20 && !input; i++) {
    input = findLast(cfg.input) || (cfg.input ? null : guessInput());
    if (!input) await sleep(250);
  }
  if (!input) input = guessInput();
  if (!input) return { ok: false, error: "Không tìm thấy ô nhập prompt. Dùng nút 🎯 trong Cài đặt để chọn ô nhập." };

  // 2. Điền prompt
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
  await sleep(600);

  // 3. Gửi: bấm nút gửi (theo selector, không có thì tự đoán), cuối cùng mới nhấn Enter
  const filled = readInput(input) !== "";
  let sendBtn = null;
  for (let i = 0; i < 20; i++) {
    sendBtn = findLast(cfg.send) || guessSendButton(input);
    if (isEnabled(sendBtn)) break;
    await sleep(250);
  }
  const diag = () =>
    ` [ô nhập: ${describe(input)}${filled ? ", đã điền chữ" : ", KHÔNG điền được chữ"}; ` +
    `nút gửi: ${sendBtn ? describe(sendBtn) + (isEnabled(sendBtn) ? "" : " (đang bị khoá)") : "không thấy"}]`;

  const watcher = watchSent(input, isEnabled(sendBtn) ? sendBtn : null);
  if (isEnabled(sendBtn)) sendBtn.click();
  else pressEnter(input);

  let sent = await watcher.wait(5000);
  if (!sent && isEnabled(sendBtn)) {
    // Thử lại bằng Enter nếu bấm nút không có tác dụng
    pressEnter(input);
    sent = await watcher.wait(3000);
  }
  watcher.stop();
  if (!sent) {
    return {
      ok: false,
      error: (sendBtn
        ? "Đã bấm gửi nhưng trang không phản hồi. Dùng nút 🎯 trong Cài đặt để chọn lại nút gửi."
        : "Không bấm được nút gửi. Dùng nút 🎯 trong Cài đặt để chọn nút gửi.") + diag()
    };
  }

  // Chế độ "chỉ gửi": không chờ kết quả, panel sẽ tự chờ số giây cố định.
  if (cfg.waitMode === "fixed") return { ok: true };

  // 4. Chờ AI trả lời xong
  const start = Date.now();
  const deadline = start + cfg.maxMs;
  if (cfg.stop) {
    // Chờ nút dừng xuất hiện (tối đa 15s), rồi chờ nó biến mất.
    while (!stopped() && Date.now() - start < 15000 && !findLast(cfg.stop)) await sleep(300);
    while (!stopped() && Date.now() < deadline && findLast(cfg.stop)) await sleep(500);
  } else {
    await sleep(3000);
  }
  await waitIdle(cfg.idleMs, deadline);

  if (stopped()) return { ok: false, error: "Đã dừng." };
  if (Date.now() > deadline) return { ok: false, error: "Hết thời gian chờ." };
  return { ok: true };
}

function stopInPage() {
  window.__bpStop = true;
}

// Cho người dùng bấm chọn 1 phần tử trên trang, trả về selector của phần tử đó.
function pickElementInPage() {
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
