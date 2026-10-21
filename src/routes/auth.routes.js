const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// POST /api/auth/login - Đăng nhập tài khoản
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu' });
    }

    const user = db.prepare('SELECT id, username, password, full_name, role, phone, created_at FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());

    if (!user) {
      return res.status(401).json({ success: false, message: 'Tài khoản không tồn tại trong hệ thống' });
    }

    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác' });
    }

    // Không trả về trường password
    const { password: _, ...userInfo } = user;

    res.json({
      success: true,
      message: 'Đăng nhập thành công',
      data: userInfo,
      user: userInfo
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

