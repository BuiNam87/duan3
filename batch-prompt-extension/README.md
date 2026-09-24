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

## Dùng với Google Flow

1. Mở dự án trong Flow, chọn trước **Hình ảnh/Video, tỉ lệ, model (vd. Nano Banana Pro), số lượng x1–x4**.
   Extension chỉ điền prompt và bấm gửi, không đổi các lựa chọn này.
2. Mở panel → tự nhận là **Google Flow**, chế độ **gửi xong chờ cố định 20 giây** rồi gửi prompt tiếp theo.
3. Nếu Flow báo đang tạo quá nhiều cùng lúc, tăng số giây chờ trong **Cài đặt**.

### Thanh vàng "đang gỡ lỗi trình duyệt này"

Một số trang (như Flow) bỏ qua cú bấm do script tạo ra. Khi đó extension tự chuyển sang
**thao tác thật** qua `chrome.debugger`: bấm chuột và gõ phím giống hệt người dùng.
Lúc này Chrome hiện thanh vàng "Batch Prompt Runner đã bắt đầu gỡ lỗi trình duyệt này".
Đó là bình thường, **đừng bấm Huỷ** khi đang chạy. Chạy xong thanh sẽ tự tắt.
Khi đang chạy, không di chuột/gõ phím vào tab đó để khỏi lẫn thao tác.

Gặp lỗi ở prompt nào thì extension dừng lại ngay, để khỏi tốn tín dụng vô ích.

Nếu dòng tiến độ báo lỗi: mở **Cài đặt**, bấm **🎯 Chọn** cạnh "Nút gửi" rồi bấm vào nút mũi tên gửi trên trang
(làm tương tự với "Ô nhập prompt" nếu cần). Extension sẽ tự lấy selector và ghi nhớ.

Cú pháp selector mở rộng:
- `a || b`: thử `a` trước, không có mới thử `b`
- `button::text(arrow_forward)`: nút có chứa chữ `arrow_forward` (tên icon Google)

## Cách extension biết AI đã trả lời xong (chế độ chat)

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
