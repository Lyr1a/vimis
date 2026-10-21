# VIMIS - Hệ Thống Quản Trị Kho Hàng Thông Minh (MVP)

Hệ thống quản lý tồn kho và cảnh báo thiếu hàng tự động phát triển theo đúng chuẩn 7 màn hình UI/UX và lộ trình ưu tiên MVP:

```
Product ➔ Inventory ➔ Stock In ➔ Stock Update ➔ Low Stock Alert
```

---

## 🚀 Cách Chạy Ứng Dụng

### 1. Khởi động Server
```bash
npm start
# Hoặc chạy chế độ dev tự reload:
npm run dev
```

### 2. Mở Ứng Dụng
Truy cập trình duyệt tại: **`http://localhost:3000`**

---

## 🏗️ Cấu Trúc Dự Án

```
g:\vimis\
├── database.js               # Kết nối SQLite (better-sqlite3) & Seed dữ liệu ban đầu
├── package.json              # Khai báo dependencies (express, cors, better-sqlite3)
├── test_api.js               # Script kiểm thử tự động toàn diện cho 5 module ưu tiên
├── vimis.db                  # File CSDL SQLite thực tế lưu trữ dữ liệu
├── src\
│   ├── server.js             # Express Server chính kết nối API & phục vụ giao diện
│   └── routes\
│       ├── product.routes.js     # Ưu tiên 1: CRUD Sản phẩm & kiểm tra SKU
│       ├── inventory.routes.js   # Ưu tiên 2: Theo dõi tồn kho thực tế & vị trí kệ
│       ├── stockin.routes.js     # Ưu tiên 3 & 4: Lập phiếu nhập kho & Tự động Stock Update
│       ├── alert.routes.js       # Ưu tiên 5: Cảnh báo Tồn kho <= Min Stock & Gợi ý nhập bù
│       └── dashboard.routes.js   # Bảng chỉ số KPI & Nhật ký biến động kho
└── public\
    ├── index.html            # Giao diện SPA 7 màn hình tương tác
    └── app.js                # Xử lý logic gọi REST API & cập nhật trạng thái
```

---

## 📡 Danh Sách API Endpoints

### 1. Product Module (`/api/products`)
- `GET /api/products`: Danh sách sản phẩm (hỗ trợ `?search=` và `?category=`).
- `GET /api/products/:id`: Chi tiết 1 sản phẩm.
- `POST /api/products`: Thêm mới sản phẩm + khởi tạo tồn kho ban đầu.
- `DELETE /api/products/:id`: Xóa sản phẩm.

### 2. Inventory Module (`/api/inventory`)
- `GET /api/inventory`: Lấy bảng tồn kho thực tế, phân loại `SAFE`, `WARNING`, `DANGER`, `CRITICAL`.
- `PUT /api/inventory/:id/location`: Cập nhật vị trí kệ kho.

### 3. Stock In & Stock Update (`/api/stock-in`)
- `GET /api/stock-in`: Danh sách các phiếu nhập hàng.
- `GET /api/stock-in/:id`: Chi tiết phiếu nhập và các mặt hàng trong phiếu.
- `POST /api/stock-in`: Lập phiếu nhập kho và **tự động cộng dồn tồn kho (Stock Update)** trong một SQLite Transaction an toàn tuyệt đối.

### 4. Low Stock Alert (`/api/alerts`)
- `GET /api/alerts`: Danh sách sản phẩm có $\text{Tồn kho} \le \text{Min Stock}$, tính lượng thiếu hụt và số lượng đề xuất nhập bù.
- `GET /api/alerts/count`: Số lượng cảnh báo hiện tại (phục vụ badge thanh tiêu đề).

### 5. Dashboard (`/api/dashboard/stats`)
- `GET /api/dashboard/stats`: Thống kê tổng quan KPI (Tổng SKU, Tổng sản phẩm trong kho, Giá trị kho tính bằng VND, Số phiếu nhập, Cảnh báo nguy cấp, Hoạt động gần đây).

---

## 🧪 Kết Quả Kiểm Thử (Automated Test)
Chạy lệnh sau để kiểm tra toàn bộ luồng nghiệp vụ:
```bash
node test_api.js
```
Kết quả: 100% các bài kiểm tra từ thêm sản phẩm, kiểm kê kho, lập phiếu nhập, tự động cộng tồn kho đến giải phóng cảnh báo thiếu hàng đều thành công.
