// Các hàm dưới đây được tiêm vào trang web qua chrome.scripting.executeScript,
// nên phải tự chứa hết (không dùng biến bên ngoài).

async function runPromptInPage(prompt, cfg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopped = () => window.__bpStop === true;
  window.__bpStop = false;

  const isVisible = (el) => !!el && el.getClientRects().length > 0;
  const findLast = (sel) => {
    if (!sel) return null;
    try {
      const els = [...document.querySelectorAll(sel)].filter(isVisible);
      return els[els.length - 1] || null;
    } catch (_) {
      return null;
    }
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

  // 1. Tìm ô nhập
  let input = null;
  for (let i = 0; i < 20 && !input; i++) {
    input = findLast(cfg.input) || (cfg.input ? null : guessInput());
    if (!input) await sleep(250);
  }
  if (!input) input = guessInput();
  if (!input) return { ok: false, error: "Không tìm thấy ô nhập prompt." };

  // 2. Điền prompt
  input.focus();
  if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(input, prompt);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, prompt);
    if (!input.innerText.trim()) {
      input.textContent = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt }));
    }
  }
  await sleep(600);

  // 3. Gửi: bấm nút gửi nếu có, không thì nhấn Enter
  let sendBtn = null;
  if (cfg.send) {
    for (let i = 0; i < 20; i++) {
      sendBtn = findLast(cfg.send);
      if (isEnabled(sendBtn)) break;
      await sleep(250);
    }
  }
  if (isEnabled(sendBtn)) {
    sendBtn.click();
  } else {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent("keydown", opts));
    input.dispatchEvent(new KeyboardEvent("keypress", opts));
    input.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

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
