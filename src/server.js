const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('../database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware CORS & Body parsing
app.use(cors());
app.use(express.json());

// Tự động khởi tạo CSDL SQLite WASM trước khi xử lý request
let dbReadyPromise = null;
app.use(async (req, res, next) => {
  if (!dbReadyPromise) {
    dbReadyPromise = initDatabase();
  }
  try {
    await dbReadyPromise;
    next();
  } catch (err) {
    console.error('Lỗi khởi tạo Database:', err);
    res.status(500).json({ success: false, message: 'Database initialization failed: ' + err.message });
  }
});

// Phục vụ file tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), system: 'VIMIS Grocery & RFID Warehouse Management' });
});

// Gắn các API Routes
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
app.use('/api/rfid', require('./routes/rfid.routes'));

// Catch-all SPA route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Export app cho Vercel Serverless Function & Chạy local nếu được gọi trực tiếp
if (require.main === module) {
  initDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🏪 VIMIS Tiệm Tạp Hóa & RFID Kho đã sẵn sàng!`);
      console.log(`📡 Truy cập tại: http://localhost:${PORT}`);
      console.log(`🔑 Tài khoản mặc định:`);
      console.log(`   - Chủ tiệm:  admin    / admin123`);
      console.log(`   - Thu ngân:  thungan  / 123456`);
      console.log(`   - Kiểm kho:  kiemkho  / 123456`);
      console.log(`📡 Đã tích hợp RFID Reader & Auto-deduct FEFO`);
      console.log(`====================================================`);
    });
  });
}

module.exports = app;
