# Ohana Nails SEO Image Metadata Editor v2

## Vì sao bị lỗi Failed to fetch?
Bạn đang mở app bằng đường dẫn local dạng `content://media/external/file/...`. Khi bấm xử lý, trình duyệt cố gọi API `/api/process`, nhưng không có server/backend nào đang chạy ở địa chỉ đó nên báo `Failed to fetch`.

Bản này phải chạy qua server online hoặc server trong mạng LAN.

## Chạy thử trên máy tính
```bash
npm install
npm start
```
Mở: http://localhost:3000

## Dùng trên Samsung Tablet
Cách chuẩn là deploy app lên một server có HTTPS, sau đó mở URL app trên tablet.
Ví dụ URL sau khi deploy: `https://ohana-nails-metadata-app.onrender.com`

Nếu frontend và backend cùng nằm trong app này, để trống ô API URL.
Nếu bạn chỉ mở file HTML riêng, hãy nhập API URL online vào ô API URL.

## Deploy nhanh
- Upload folder này lên GitHub.
- Tạo Web Service trên Render/Railway/VPS.
- Build command: `npm install`
- Start command: `npm start`
- Node version: >=18

## Metadata preset
App cố định preset Ohana Nails và chỉ cần nhập Keywords cho từng ảnh.
Nên dùng ảnh JPG/JPEG để GeoSetter đọc đủ EXIF/IPTC/XMP.
