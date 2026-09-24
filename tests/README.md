# Test giả lập cho Batch Prompt Runner

Chạy extension thật trong Chrome (điều khiển bằng DevTools Protocol, không qua Playwright để việc tải file
giống Chrome thật) trên một trang giả lập Google Flow.

- `flow-mock.html`: trang giả Flow dựng từ HTML thật (ô nhập ProseMirror, nút "Bắt đầu tạo", nút ✕ "Xoá câu lệnh",
  `.batch-container` + `img.image[data-media-id]`, menu chuột phải → Tải xuống → 1K/2K/4K). Chỉ nhận cú bấm thật
  (`event.isTrusted`), bấm 2K thì chờ 1,5s rồi tải 1 file PNG.
- `cdp-harness.js`: mở Chrome với extension, mở panel + trang giả, tải file vào thư mục tạm.
- `e2e-download.js`: gửi 3 prompt (1 prompt lặp), bật tự tải 2K, in nhật ký và danh sách file tải về.

Chạy (cần Node 22+):

```
cd tests
python -m http.server 8765 --bind 127.0.0.1      # cửa sổ 1
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" node e2e-download.js   # cửa sổ 2
```

Kết quả đúng: 12 file `Flow/001_tao-anh-ho/1..4.png`, `Flow/002_tao-anh-nui-phu-si/1..4.png`, `Flow/003_tao-anh-ho/1..4.png`.
Chrome bản thường có thể chặn `--load-extension`; khi đó dùng Chromium hoặc Chrome for Testing.
