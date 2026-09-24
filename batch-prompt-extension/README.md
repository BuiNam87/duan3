# Batch Prompt Runner (Chrome extension)

Mở một panel bên phải trình duyệt để gửi lần lượt nhiều prompt vào trang chat AI
(ChatGPT, Gemini, Claude hoặc trang khác). Prompt sau chỉ được gửi khi AI đã trả lời xong prompt trước.

## Cài đặt

1. Mở `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `batch-prompt-extension`
4. Ghim extension lên thanh công cụ, bấm vào icon để mở panel bên phải

## Sử dụng

1. Mở trang chat AI (vd. chatgpt.com) và đăng nhập
2. Mở panel, dán danh sách prompt:
   - **Mỗi dòng = 1 prompt**, hoặc
   - **Ngăn cách bằng dòng `---`** (dùng khi prompt dài nhiều dòng)
3. Bấm **▶ Chạy**. Bấm **■ Dừng** để dừng giữa chừng.

Prompt, cài đặt và selector đã sửa được lưu lại tự động.

## Cách extension biết AI đã trả lời xong

- Chờ nút "Stop" (lúc AI đang trả lời) xuất hiện rồi biến mất, sau đó
- Chờ trang không còn thay đổi trong N giây (**Chờ im lặng**).

Nếu trang không có selector nút Stop thì chỉ dùng cách thứ hai.

## Nếu không chạy được

Giao diện các trang AI hay thay đổi. Mở **Cài đặt** trong panel để sửa selector:

- **Ô nhập**: để trống → tự dò ô nhập lớn nhất trên trang
- **Nút gửi**: để trống → nhấn Enter
- **Nút dừng**: để trống → chỉ chờ trang ngừng thay đổi

Lấy selector: chuột phải vào phần tử → **Inspect** → chuột phải dòng HTML → **Copy → Copy selector**.
Bấm "Khôi phục mặc định cho trang này" để quay về cấu hình gốc.
