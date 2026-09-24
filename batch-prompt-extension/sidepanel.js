const $ = (id) => document.getElementById(id);
const els = {
  siteInfo: $("siteInfo"),
  prompts: $("prompts"),
  splitMode: $("splitMode"),
  count: $("count"),
  startBtn: $("startBtn"),
  stopBtn: $("stopBtn"),
  preset: $("preset"),
  selInput: $("selInput"),
  selSend: $("selSend"),
  selStop: $("selStop"),
  waitMode: $("waitMode"),
  fixedSec: $("fixedSec"),
  fixedWrap: $("fixedWrap"),
  doneWrap: $("doneWrap"),
  idleSec: $("idleSec"),
  gapSec: $("gapSec"),
  maxSec: $("maxSec"),
  resetBtn: $("resetBtn"),
  progress: $("progress"),
  autoDl: $("autoDl"),
  dlOpts: $("dlOpts"),
  dlLabel: $("dlLabel"),
  genMaxSec: $("genMaxSec"),
  log: $("log")
};

let running = false;
let stopRequested = false;
let currentTabId = null;
// Cấu hình người dùng đã sửa, lưu theo preset: { flow: {input, send, stop, waitMode, fixedSec}, ... }
let customSelectors = {};

for (const [key, p] of Object.entries(PRESETS)) {
  els.preset.add(new Option(p.name, key));
}

function parsePrompts() {
  const text = els.prompts.value;
  const parts = els.splitMode.value === "dash" ? text.split(/^\s*---\s*$/m) : text.split("\n");
  return parts.map((s) => s.trim()).filter(Boolean);
}

function updateCount() {
  els.count.textContent = `${parsePrompts().length} prompt`;
}

function loadSelectors(presetKey) {
  const base = PRESETS[presetKey];
  const custom = customSelectors[presetKey] || {};
  els.selInput.value = custom.input ?? base.input;
  els.selSend.value = custom.send ?? base.send;
  els.selStop.value = custom.stop ?? base.stop;
  els.waitMode.value = custom.waitMode ?? base.waitMode ?? "done";
  els.fixedSec.value = custom.fixedSec ?? base.fixedSec ?? 20;
  updateWaitUI();
}

function updateWaitUI() {
  const fixed = els.waitMode.value === "fixed";
  els.fixedWrap.hidden = !fixed;
  els.doneWrap.hidden = fixed;
  els.selStop.disabled = fixed;
}

function save() {
  chrome.storage.local.set({
    prompts: els.prompts.value,
    splitMode: els.splitMode.value,
    idleSec: els.idleSec.value,
    gapSec: els.gapSec.value,
    maxSec: els.maxSec.value,
    autoDl: els.autoDl.checked,
    dlLabel: els.dlLabel.value,
    genMaxSec: els.genMaxSec.value,
    customSelectors
  });
}

function saveSelectors() {
  customSelectors[els.preset.value] = {
    input: els.selInput.value.trim(),
    send: els.selSend.value.trim(),
    stop: els.selStop.value.trim(),
    waitMode: els.waitMode.value,
    fixedSec: els.fixedSec.value
  };
  save();
}

async function refreshTab() {
  if (running) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;
  const key = detectPreset(tab.url || "");
  els.preset.value = key;
  loadSelectors(key);
  let host = "";
  try { host = new URL(tab.url).hostname; } catch (_) {}
  els.siteInfo.textContent = `Tab: ${host || "(không xác định)"} · ${PRESETS[key].name}`;
}

function addLogItem(text) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.className = "text";
  span.textContent = text.length > 200 ? text.slice(0, 200) + "…" : text;
  li.appendChild(span);
  els.log.appendChild(li);
  return li;
}

function setState(li, state, error) {
  li.className = state;
  if (error) {
    const e = document.createElement("span");
    e.className = "err";
    e.textContent = "⚠ " + error;
    li.appendChild(e);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tiêm page-runner.js vào trang nếu trang chưa có (vd. vừa tải lại), rồi gọi window.BP[method](...args).
// Không tiêm lại khi đã có, để giữ trạng thái giữa các bước (bộ theo dõi đã gửi).
async function callPage(tabId, method, ...args) {
  const [has] = await chrome.scripting.executeScript({ target: { tabId }, func: () => !!window.BP });
  if (!has?.result) await chrome.scripting.executeScript({ target: { tabId }, files: ["page-runner.js"] });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => window.BP[m](...a),
    args: [method, args]
  });
  return res?.result;
}

// ---- Thao tác thật qua chrome.debugger (trang không phân biệt được với người dùng) ----
let debuggerTab = null;
chrome.debugger.onDetach.addListener((src) => {
  if (src.tabId === debuggerTab) debuggerTab = null;
});

async function attachDebugger(tabId) {
  if (debuggerTab === tabId) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  debuggerTab = tabId;
}

async function detachDebugger() {
  if (debuggerTab == null) return;
  const tabId = debuggerTab;
  debuggerTab = null;
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
}

const cdp = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);

async function realClick(tabId, x, y) {
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function realSend(tabId, prompt, cfg) {
  try {
    await attachDebugger(tabId);
  } catch (err) {
    return { ok: false, error: "Không bật được chế độ thao tác thật: " + err.message };
  }
  const loc = await callPage(tabId, "locateInput", cfg);
  if (!loc?.ok) return loc || { ok: false, error: "Không đọc được trang." };
  await realClick(tabId, loc.x, loc.y);
  await sleep(200);
  // Chọn hết chữ cũ trong ô rồi gõ đè
  const selAll = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, commands: ["selectAll"] };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...selAll });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...selAll });
  await cdp(tabId, "Input.insertText", { text: prompt });
  await sleep(600);
  const arm = await callPage(tabId, "armSend", cfg, prompt);
  if (!arm?.ok) return arm || { ok: false, error: "Không đọc được trang." };
  await realClick(tabId, arm.x, arm.y);
  const sent = await callPage(tabId, "awaitSent", 6000);
  if (sent) return { ok: true };
  return { ok: false, error: "Đã bấm nút gửi (thao tác thật) nhưng trang vẫn không phản hồi." + (arm.diag || "") };
}

// ---- Tự tải ảnh về (Google Flow): mở menu chuột phải của từng ảnh → Tải xuống → mục 2K ----

async function realRightClick(tabId, x, y) {
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
}

async function realEscape(tabId) {
  const k = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...k });
}

// Nhật ký tải xuống gần nhất (xem trong DevTools của panel khi cần gỡ lỗi): window.__dlLog
window.__dlLog = [];
const dlLog = (...a) => { window.__dlLog.push(new Date().toISOString().slice(11, 19) + " " + a.join(" ")); window.__dlLog.splice(0, window.__dlLog.length - 50); };

// Lượt tải đang chờ. Việc đổi tên do background.js làm; panel chỉ ghi lượt tải cần đổi tên
// vào chrome.storage.session rồi chờ background báo lại.
let expectedDownload = null;
chrome.runtime.onMessage.addListener((msg) => {
  const e = expectedDownload;
  if (msg?.type !== "bp-downloaded" || !e || msg.token !== e.token) return;
  expectedDownload = null;
  dlLog("renamed", msg.name, "→", `${e.folder}/${e.n}`);
  e.resolve({ ok: true });
});

// Dự phòng: có lượt tải bắt đầu mà background không đổi tên được thì vẫn ghi nhận đã tải.
chrome.downloads.onCreated.addListener((item) => {
  const e = expectedDownload;
  dlLog("created", item.id, e ? `${e.folder}/${e.n}` : "(không chờ)");
  if (!e) return;
  setTimeout(() => {
    if (expectedDownload === e) {
      expectedDownload = null;
      chrome.storage.session.remove("bpExpect");
      e.resolve({ ok: true, note: `ảnh ${e.n}: đã tải nhưng không đổi được tên/thư mục` });
    }
  }, 4000);
});

function waitForDownload(folder, n, ms) {
  return new Promise((resolve) => {
    const token = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      if (expectedDownload && expectedDownload.token === token) {
        expectedDownload = null;
        chrome.storage.session.remove("bpExpect");
      }
      resolve({ ok: false, error: `ảnh ${n}: Flow chưa tải xuống sau ${Math.round(ms / 1000)}s` });
    }, ms);
    const done = (r) => { clearTimeout(timer); resolve(r); };
    expectedDownload = { folder, n, token, resolve: done };
    chrome.storage.session.set({ bpExpect: { folder, n, token, ts: Date.now() } });
  });
}

function cancelExpectedDownload() {
  const e = expectedDownload;
  expectedDownload = null;
  chrome.storage.session.remove("bpExpect");
  if (e) e.resolve({ ok: false, error: "huỷ" });
}


function slugify(text) {
  const s = text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 50).replace(/-+$/, "") || "prompt";
}

async function downloadOne(tabId, mediaId, folder, n, label) {
  const p = await callPage(tabId, "tilePoint", mediaId);
  if (!p?.ok) return { ok: false, error: `ảnh ${n}: ${p?.error || "không thấy ảnh"}` };
  await realRightClick(tabId, p.x, p.y);
  const dl = await callPage(tabId, "menuItemPoint", "^(tải xuống|download)$", 3000);
  if (!dl?.ok) {
    await realEscape(tabId);
    return { ok: false, error: `ảnh ${n}: không thấy mục "Tải xuống" trong menu (menu có: ${(dl?.labels || []).join(", ") || "trống"})` };
  }
  // Rê chuột vào "Tải xuống" để mở menu con; chưa mở thì bấm.
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: dl.x, y: dl.y });
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let q = await callPage(tabId, "menuItemPoint", esc, 1200);
  if (!q?.ok) {
    await realClick(tabId, dl.x, dl.y);
    q = await callPage(tabId, "menuItemPoint", esc, 2500);
  }
  if (!q?.ok) {
    await realEscape(tabId);
    await realEscape(tabId);
    return { ok: false, error: `ảnh ${n}: không thấy mục "${label}" (menu có: ${(q?.labels || []).join(", ") || "trống"})` };
  }
  const wait = waitForDownload(folder, n, 180000);
  await realClick(tabId, q.x, q.y);
  await sleep(1200);
  if (await callPage(tabId, "menuOpen")) {
    // Bấm xong mà menu vẫn mở = bấm trượt; huỷ chờ để khỏi đợi 3 phút.
    cancelExpectedDownload();
    await realEscape(tabId);
    await realEscape(tabId);
    return { ok: false, error: `ảnh ${n}: bấm vào mục "${q.label}" không có tác dụng` };
  }
  const r = await wait;
  if (await callPage(tabId, "menuOpen")) await realEscape(tabId);
  return r;
}

function setDl(li, text, cls) {
  let el = li.querySelector(".dl");
  if (!el) {
    el = document.createElement("span");
    li.appendChild(el);
  }
  el.className = "dl " + (cls || "");
  el.textContent = text;
}

// Kiểm tra các nhóm ảnh đang chờ; nhóm nào đủ ảnh (hoặc quá thời gian chờ) thì tải về.
// doneIds: ảnh đã tải trong lượt chạy này (để 2 prompt trùng chữ không tải nhầm cùng 1 nhóm).
async function processPending(tabId, pending, dlCfg, doneIds) {
  for (const job of [...pending]) {
    if (stopRequested) return;
    const b = await callPage(tabId, "findBatch", job.prompt, [...job.exclude, ...doneIds]);
    const have = b?.found ? b.ids.length : 0;
    const want = job.expected || b?.tiles || 0;
    const timedOut = Date.now() - job.sentAt > dlCfg.genMaxMs;
    if (!(want > 0 && have >= want) && !timedOut) {
      setDl(job.li, `⏳ đang tạo ảnh ${have}/${want || "?"}`);
      continue;
    }
    pending.splice(pending.indexOf(job), 1);
    b?.ids?.forEach((id) => doneIds.add(id));
    if (!have) {
      setDl(job.li, "⚠ quá thời gian chờ mà chưa thấy ảnh nào, bỏ qua tải về", "err");
      continue;
    }
    try {
      await attachDebugger(tabId);
    } catch (err) {
      setDl(job.li, "⚠ không bật được thao tác thật: " + err.message, "err");
      continue;
    }
    const errors = [];
    let okN = 0;
    for (let k = 0; k < b.ids.length && !stopRequested; k++) {
      setDl(job.li, `⬇ đang tải ${k + 1}/${b.ids.length} (${dlCfg.label})…`);
      const r = await downloadOne(tabId, b.ids[k], job.folder, k + 1, dlCfg.label);
      if (r.ok) okN++;
      else errors.push(r.error);
      if (r.note) errors.push(r.note);
    }
    const note = have < want ? ` (chỉ có ${have}/${want} ảnh)` : "";
    setDl(job.li, `${errors.length ? "⚠" : "✓"} đã tải ${okN}/${b.ids.length} ảnh → Flow/${job.folder}${note}${errors.length ? " · " + errors.join("; ") : ""}`, errors.length ? "err" : "ok");
  }
}

async function start() {
  const prompts = parsePrompts();
  if (!prompts.length) {
    els.siteInfo.textContent = "Chưa có prompt nào.";
    return;
  }
  // Chỉ lấy tab đang mở, giữ nguyên cài đặt đang hiển thị (người dùng có thể đã chọn tay).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const tabId = (currentTabId = tab.id);
  const cfg = {
    input: els.selInput.value.trim(),
    send: els.selSend.value.trim(),
    stop: els.selStop.value.trim(),
    waitMode: els.waitMode.value,
    idleMs: Math.max(1, Number(els.idleSec.value) || 5) * 1000,
    maxMs: Math.max(10, Number(els.maxSec.value) || 300) * 1000
  };
  const dlCfg = {
    on: els.autoDl.checked,
    label: els.dlLabel.value.trim() || "2K",
    genMaxMs: Math.max(30, Number(els.genMaxSec.value) || 300) * 1000
  };
  const pending = [];
  const doneIds = new Set();
  let gapMs = Math.max(0, Number(els.gapSec.value) || 0) * 1000;
  if (cfg.waitMode === "fixed") gapMs += Math.max(0, Number(els.fixedSec.value) || 0) * 1000;

  running = true;
  stopRequested = false;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.log.innerHTML = "";
  const items = prompts.map(addLogItem);
  let okCount = 0;
  // Khi cú bấm bằng script không có tác dụng, các prompt sau dùng luôn thao tác thật.
  let useReal = false;

  try {
    for (let i = 0; i < prompts.length && !stopRequested; i++) {
      els.progress.textContent = `${i + 1}/${prompts.length}`;
      setState(items[i], "running");
      items[i].scrollIntoView({ block: "nearest" });
      let result;
      let before = null;
      let expected = 0;
      try {
        if (dlCfg.on) {
          before = await callPage(tabId, "snapshotMedia");
          expected = await callPage(tabId, "expectedCount");
        }
        if (!useReal) {
          result = (await callPage(tabId, "send", prompts[i], cfg)) || { ok: false, error: "Không nhận được kết quả từ trang." };
          if (!result.ok && result.needTrusted && !stopRequested) useReal = true;
        }
        if (useReal && !stopRequested) {
          els.progress.textContent = `${i + 1}/${prompts.length} · thao tác thật`;
          result = await realSend(tabId, prompts[i], cfg);
        }
        if (result.ok && cfg.waitMode === "done" && !stopRequested) {
          result = (await callPage(tabId, "waitDone", cfg)) || { ok: false, error: "Không nhận được kết quả từ trang." };
        }
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      setState(items[i], result.ok ? "done" : "error", result.ok ? "" : result.error);
      if (result.ok) okCount++;
      if (result.ok && dlCfg.on) {
        const folder = `${String(i + 1).padStart(3, "0")}_${slugify(prompts[i])}`;
        pending.push({ prompt: prompts[i], exclude: before || [], expected, sentAt: Date.now(), folder, li: items[i] });
        setDl(items[i], "⏳ chờ tạo ảnh…");
      }
      if (!result.ok && !stopRequested) break; // lỗi thì dừng để khỏi tốn tín dụng vô ích
      if (i < prompts.length - 1 && !stopRequested) {
        const end = Date.now() + gapMs;
        let nextCheck = 0;
        while (Date.now() < end && !stopRequested) {
          els.progress.textContent = `${i + 1}/${prompts.length} · chờ ${Math.ceil((end - Date.now()) / 1000)}s`;
          if (pending.length && Date.now() >= nextCheck) {
            await processPending(tabId, pending, dlCfg, doneIds);
            nextCheck = Date.now() + 5000;
          }
          await sleep(250);
        }
      }
    }
    // Gửi hết rồi: chờ tải nốt các nhóm ảnh còn lại.
    while (pending.length && !stopRequested) {
      els.progress.textContent = `Đã gửi xong · chờ tải ${pending.length} nhóm ảnh`;
      await processPending(tabId, pending, dlCfg, doneIds);
      if (pending.length) await sleep(5000);
    }
  } finally {
    await detachDebugger();
    els.progress.textContent = `Xong ${okCount}/${prompts.length}${stopRequested ? " (đã dừng)" : ""}`;
    running = false;
    els.startBtn.disabled = false;
    els.stopBtn.disabled = true;
  }
}

async function stop() {
  stopRequested = true;
  els.stopBtn.disabled = true;
  if (currentTabId != null) {
    try {
      await callPage(currentTabId, "stop");
    } catch (_) {}
  }
}

// Sự kiện
els.prompts.addEventListener("input", () => { updateCount(); save(); });
els.splitMode.addEventListener("change", () => { updateCount(); save(); });
[els.idleSec, els.gapSec, els.maxSec, els.dlLabel, els.genMaxSec].forEach((el) => el.addEventListener("change", save));
els.autoDl.addEventListener("change", () => { els.dlOpts.hidden = !els.autoDl.checked; save(); });
[els.selInput, els.selSend, els.selStop, els.fixedSec].forEach((el) => el.addEventListener("change", saveSelectors));
els.waitMode.addEventListener("change", () => { updateWaitUI(); saveSelectors(); });
els.preset.addEventListener("change", () => loadSelectors(els.preset.value));
els.resetBtn.addEventListener("click", () => {
  delete customSelectors[els.preset.value];
  loadSelectors(els.preset.value);
  save();
});
async function pick(field) {
  await refreshTab();
  if (currentTabId == null) return;
  const old = els.siteInfo.textContent;
  els.siteInfo.textContent = "Bấm vào phần tử trên trang web (Esc để huỷ)…";
  try {
    const res = await callPage(currentTabId, "pick");
    if (res?.selector) {
      field.value = res.selector;
      saveSelectors();
      els.siteInfo.textContent = `Đã chọn: ${res.selector}`;
      return;
    }
    els.siteInfo.textContent = old;
  } catch (err) {
    els.siteInfo.textContent = "Không chọn được: " + err.message;
  }
}
$("pickInput").addEventListener("click", () => pick(els.selInput));
$("pickSend").addEventListener("click", () => pick(els.selSend));
els.startBtn.addEventListener("click", start);
els.stopBtn.addEventListener("click", stop);
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") refreshTab(); });

// Khởi tạo
chrome.storage.local.get(null, (data) => {
  if (data.prompts) els.prompts.value = data.prompts;
  if (data.splitMode) els.splitMode.value = data.splitMode;
  if (data.idleSec) els.idleSec.value = data.idleSec;
  if (data.gapSec) els.gapSec.value = data.gapSec;
  if (data.maxSec) els.maxSec.value = data.maxSec;
  els.autoDl.checked = !!data.autoDl;
  els.dlOpts.hidden = !els.autoDl.checked;
  if (data.dlLabel) els.dlLabel.value = data.dlLabel;
  if (data.genMaxSec) els.genMaxSec.value = data.genMaxSec;
  customSelectors = data.customSelectors || {};
  updateCount();
  refreshTab();
});
