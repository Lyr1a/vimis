const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('../database');

// Khởi tạo CSDL SQLite & Dữ liệu mẫu tạp hóa
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), system: 'VIMIS Grocery Store Management' });
});

// Gắn các Routes nghiệp vụ VIMIS
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/inventory', require('./routes/inventory.routes'));
app.use('/api/stock-in', require('./routes/stockin.routes'));
app.use('/api/stock-out', require('./routes/stockout.routes'));
app.use('/api/transactions', require('./routes/transaction.routes'));
app.use('/api/alerts', require('./routes/alert.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/reports', require('./routes/report.routes'));
app.use('/api/ai', require('./routes/ai.routes'));

// Catch-all route chuyển về index.html cho SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Khởi động Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🏪 VIMIS Tiệm Tạp Hóa đã sẵn sàng!`);
  console.log(`📡 Truy cập tại: http://localhost:${PORT}`);
  console.log(`🔑 Tài khoản mặc định:`);
  console.log(`   - Chủ tiệm:  admin    / admin123`);
  console.log(`   - Thu ngân:  nhanvien / 123456`);
  console.log(`✨ Đã tích hợp đầy đủ:`);
  console.log(`   - Quản lý sản phẩm, tồn kho, cảnh báo hết hàng`);
  console.log(`   - Nhập hàng (Stock In) & Xuất hàng/Bán lẻ (Stock Out)`);
  console.log(`   - Lịch sử biến động xuất nhập tồn (Audit Log)`);
  console.log(`   - Báo cáo tài chính & doanh thu`);
  console.log(`   - Phân tích kho thông minh bằng AI (VIMIS Copilot)`);
  console.log(`====================================================`);
});
