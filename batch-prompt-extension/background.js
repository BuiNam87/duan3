// Bấm vào icon extension sẽ mở panel bên phải.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Đổi tên file ảnh do Flow tải xuống thành Flow/<thư mục>/<số>.<đuôi>.
// Đặt ở background để chỉ có đúng 1 bộ đổi tên (mở panel ở nhiều cửa sổ cũng không tranh nhau).
// Panel ghi lượt tải đang chờ vào chrome.storage.session (bpExpect), background đổi tên rồi báo lại.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  chrome.storage.session.get("bpExpect").then(({ bpExpect: e }) => {
    if (!e || Date.now() - e.ts > 200000) return suggest();
    chrome.storage.session.remove("bpExpect");
    const ext =
      (item.filename.match(/\.([a-z0-9]{2,5})$/i) || [])[1] ||
      ({ "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" }[item.mime] || "png");
    suggest({ filename: `Flow/${e.folder}/${e.n}.${ext.toLowerCase()}`, conflictAction: "uniquify" });
    chrome.runtime.sendMessage({ type: "bp-downloaded", token: e.token, name: item.filename }).catch(() => {});
  });
  return true; // gọi suggest bất đồng bộ
});
