const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/products - Lấy danh sách sản phẩm (có tìm kiếm, lọc danh mục, lọc trạng thái kho, phân loại ABC)
router.get('/', (req, res) => {
  try {
    const { search, category, status, abc, zone } = req.query;
    let query = `
      SELECT 
        p.*, 
        COALESCE(p.abc_class, 'B') as abc_class,
        COALESCE(p.max_stock, 50) as max_stock,
        COALESCE(i.quantity, 0) as current_stock, 
        COALESCE(i.location, 'Kệ trưng bày') as location,
        COALESCE(i.zone, 'Kệ trung tâm') as zone,
        COALESCE(i.shelf_level, 'Tầng 2 (Tầm mắt)') as shelf_level,
        i.expiry_date,
        (SELECT COUNT(*) FROM product_batches b WHERE b.product_id = p.id AND b.quantity > 0) as batch_count,
        CASE
          WHEN COALESCE(i.quantity, 0) <= 0 THEN 'OUT'
          WHEN COALESCE(i.quantity, 0) <= p.min_stock THEN 'LOW'
          WHEN COALESCE(i.quantity, 0) > COALESCE(p.max_stock, 50) THEN 'OVERSTOCK'
          ELSE 'SAFE'
        END as stock_status
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE 1=1
    `;
    const params = [];

    if (search && search.trim()) {
      const kw = `%${search.trim()}%`;
      query += ` AND (p.sku LIKE ? OR p.name LIKE ? OR p.barcode LIKE ?)`;
      params.push(kw, kw, kw);
    }

    if (category && category !== 'ALL') {
      query += ` AND p.category = ?`;
      params.push(category);
    }

    if (abc && abc !== 'ALL') {
      query += ` AND p.abc_class = ?`;
      params.push(abc);
    }

    if (zone && zone !== 'ALL') {
      query += ` AND i.zone LIKE ?`;
      params.push(`%${zone}%`);
    }

    if (status === 'LOW') {
      query += ` AND COALESCE(i.quantity, 0) <= p.min_stock AND COALESCE(i.quantity, 0) > 0`;
    } else if (status === 'OUT') {
      query += ` AND COALESCE(i.quantity, 0) <= 0`;
    } else if (status === 'SAFE') {
      query += ` AND COALESCE(i.quantity, 0) > p.min_stock`;
    }

    query += ` ORDER BY p.abc_class ASC, p.id DESC`;
    let products = db.prepare(query).all(...params);

    // Phân quyền bảo mật: Chỉ Chủ cửa hàng (admin) mới được xem giá vốn nhập hàng!
    const userRole = req.headers['x-user-role'] || 'admin';
    if (userRole !== 'admin') {
      products = products.map(p => ({
        ...p,
        cost_price: null,
        cost_price_hidden: true
      }));
    }

    res.json({ success: true, data: products, count: products.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/products/:id - Lấy chi tiết 1 sản phẩm
router.get('/:id', (req, res) => {
  try {
    const product = db.prepare(`
      SELECT p.*, COALESCE(i.quantity, 0) as current_stock, COALESCE(i.location, 'Kệ trưng bày') as location,
             COALESCE(i.zone, 'Kệ trung tâm') as zone, COALESCE(i.shelf_level, 'Tầng 2') as shelf_level, i.expiry_date
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    }
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/products - Tạo sản phẩm mới
router.post('/', (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'admin';
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Chủ cửa hàng mới có quyền thêm mặt hàng mới vào danh mục!' });
    }

    const { sku, barcode, name, category, unit, cost_price, sale_price, min_stock, max_stock, abc_class, initial_stock, zone, shelf_level, expiry_date } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp tên sản phẩm' });
    }

    let cleanSku = sku ? sku.trim().toUpperCase() : '';
    if (!cleanSku) {
      const randomSuffix = Math.floor(100 + Math.random() * 900);
      cleanSku = 'TH-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + randomSuffix;
    }

    const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(cleanSku);
    if (existing) {
      return res.status(400).json({ success: false, message: `Mã sản phẩm "${cleanSku}" đã tồn tại trên hệ thống!` });
    }

    const insertProd = db.prepare(`
      INSERT INTO products (sku, barcode, name, category, unit, cost_price, sale_price, min_stock, max_stock, abc_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertInv = db.prepare(`
      INSERT INTO inventory (product_id, warehouse_name, location, zone, shelf_level, expiry_date, quantity)
      VALUES (?, 'Kho Tiệm Tạp Hóa', ?, ?, ?, ?, ?)
    `);

    const insertTx = db.prepare(`
      INSERT INTO stock_transactions (product_id, transaction_type, reference_code, quantity_change, balance_after, note)
      VALUES (?, 'INIT', 'INIT-PROD', ?, ?, 'Khởi tạo sản phẩm')
    `);

    const initStockVal = Math.max(0, parseInt(initial_stock) || 0);
    const targetZone = zone ? zone.trim() : 'Kệ trung tâm';
    const targetShelf = shelf_level ? shelf_level.trim() : 'Tầng 2 (Tầm mắt)';
    const fullLoc = `${targetZone} (${targetShelf})`;

    const createTx = db.transaction(() => {
      const result = insertProd.run(
        cleanSku,
        barcode ? barcode.trim() : null,
        name.trim(),
        category || 'Mặt hàng thông dụng',
        unit || 'Cái',
        parseFloat(cost_price) || 0,
        parseFloat(sale_price) || 0,
        Math.max(1, parseInt(min_stock) || 5),
        Math.max(10, parseInt(max_stock) || 50),
        abc_class || 'B'
      );
      const prodId = result.lastInsertRowid;
      insertInv.run(prodId, fullLoc, targetZone, targetShelf, expiry_date || null, initStockVal);

      if (initStockVal > 0) {
        insertTx.run(prodId, initStockVal, initStockVal);
      }
      return prodId;
    });

    const newId = createTx();
    const newProduct = db.prepare(`
      SELECT p.*, i.quantity as current_stock, i.location, i.zone, i.shelf_level, i.expiry_date
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      WHERE p.id = ?
    `).get(newId);

    res.status(201).json({ success: true, message: 'Thêm sản phẩm thành công', data: newProduct });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/products/:id - Chỉnh sửa sản phẩm
router.put('/:id', (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'admin';
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Chủ cửa hàng mới có quyền chỉnh sửa thông tin hàng hóa!' });
    }

    const { name, barcode, category, unit, cost_price, sale_price, min_stock, max_stock, abc_class, zone, shelf_level, expiry_date } = req.body;

    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!prod) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    }

    db.prepare(`
      UPDATE products 
      SET 
        name = COALESCE(?, name),
        barcode = COALESCE(?, barcode),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        cost_price = COALESCE(?, cost_price),
        sale_price = COALESCE(?, sale_price),
        min_stock = COALESCE(?, min_stock),
        max_stock = COALESCE(?, max_stock),
        abc_class = COALESCE(?, abc_class)
      WHERE id = ?
    `).run(
      name ? name.trim() : prod.name,
      barcode !== undefined ? (barcode ? barcode.trim() : null) : prod.barcode,
      category || prod.category,
      unit || prod.unit,
      cost_price !== undefined ? parseFloat(cost_price) : prod.cost_price,
      sale_price !== undefined ? parseFloat(sale_price) : prod.sale_price,
      min_stock !== undefined ? parseInt(min_stock) : prod.min_stock,
      max_stock !== undefined ? parseInt(max_stock) : prod.max_stock,
      abc_class || prod.abc_class,
      req.params.id
    );

    if (zone || shelf_level || expiry_date !== undefined) {
      const currentInv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(req.params.id);
      const newZone = zone ? zone.trim() : (currentInv ? currentInv.zone : 'Kệ trung tâm');
      const newShelf = shelf_level ? shelf_level.trim() : (currentInv ? currentInv.shelf_level : 'Tầng 2 (Tầm mắt)');
      const newLoc = `${newZone} (${newShelf})`;
      const newExp = expiry_date !== undefined ? expiry_date : (currentInv ? currentInv.expiry_date : null);

      db.prepare(`
        UPDATE inventory 
        SET zone = ?, shelf_level = ?, location = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `).run(newZone, newShelf, newLoc, newExp, req.params.id);
    }

    const updated = db.prepare(`
      SELECT p.*, i.quantity as current_stock, i.location, i.zone, i.shelf_level, i.expiry_date
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.id = ?
    `).get(req.params.id);

    res.json({ success: true, message: 'Cập nhật sản phẩm thành công', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/products/:id - Xóa sản phẩm
router.delete('/:id', (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'admin';
    if (userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ Chủ cửa hàng mới có quyền xóa sản phẩm khỏi danh mục!' });
    }

    const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần xóa' });
    }
    res.json({ success: true, message: 'Đã xóa sản phẩm thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
