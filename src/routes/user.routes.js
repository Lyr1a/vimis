const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// Middleware phân quyền: Chỉ Chủ cửa hàng mới được truy cập quản lý nhân viên
router.use((req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'admin';
  if (userRole !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Chỉ Chủ cửa hàng mới có quyền xem và quản lý tài khoản nhân viên!'
    });
  }
  next();
});

// GET /api/users - Danh sách người dùng
router.get('/', (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, full_name, role, phone, created_at FROM users ORDER BY id ASC').all();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/users - Tạo tài khoản người dùng mới
router.post('/', (req, res) => {
  try {
    const { username, password, full_name, role, phone } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đủ Tên đăng nhập, Mật khẩu và Họ tên' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(cleanUsername);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Tên đăng nhập này đã được sử dụng' });
    }

    const info = db.prepare(`
      INSERT INTO users (username, password, full_name, role, phone)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanUsername, password, full_name.trim(), role || 'staff', phone ? phone.trim() : '');

    const newUser = db.prepare('SELECT id, username, full_name, role, phone, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);

    res.status(201).json({ success: true, message: 'Thêm tài khoản thành công', data: newUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/users/:id - Cập nhật tài khoản
router.put('/:id', (req, res) => {
  try {
    const { full_name, role, phone, password } = req.body;
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (password && password.trim()) {
      db.prepare(`
        UPDATE users 
        SET full_name = ?, role = ?, phone = ?, password = ?
        WHERE id = ?
      `).run(full_name || '', role || 'staff', phone || '', password.trim(), req.params.id);
    } else {
      db.prepare(`
        UPDATE users 
        SET full_name = ?, role = ?, phone = ?
        WHERE id = ?
      `).run(full_name || '', role || 'staff', phone || '', req.params.id);
    }

    const updated = db.prepare('SELECT id, username, full_name, role, phone, created_at FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, message: 'Cập nhật tài khoản thành công', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/users/:id - Xóa tài khoản
router.delete('/:id', (req, res) => {
  try {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (user.username === 'admin') {
      return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản Quản trị viên chính (admin)' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Đã xóa tài khoản thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

