const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// Helper tính số ngày chênh lệch
function getDaysDiff(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffTime = target - now;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

// GET /api/inventory - Theo dõi tồn kho thực tế, vị trí kệ, phân loại ABC, Hạn sử dụng (FEFO) và Chi tiết từng Thùng/Lô
router.get('/', (req, res) => {
  try {
    const { zone, abc, expiry_filter, import_filter, status, search } = req.query;

    let query = `
      SELECT 
        i.id as inventory_id,
        i.warehouse_name,
        COALESCE(i.location, 'Kệ trưng bày') as location,
        COALESCE(i.zone, 'Kệ trung tâm') as zone,
        COALESCE(i.shelf_level, 'Tầng 2 (Tầm mắt)') as shelf_level,
        i.expiry_date,
        i.last_checked_at,
        i.quantity as current_stock,
        i.updated_at,
        p.id as product_id,
        p.sku,
        p.barcode,
        p.name,
        p.category,
        p.unit,
        p.cost_price,
        p.sale_price,
        p.min_stock,
        COALESCE(p.max_stock, 50) as max_stock,
        COALESCE(p.abc_class, 'B') as abc_class,
        ROUND(JULIANDAY(i.expiry_date) - JULIANDAY('now')) as days_until_expiry,
        CASE 
          WHEN i.quantity <= 0 THEN 'OUT_OF_STOCK'
          WHEN i.quantity <= p.min_stock THEN 'DANGER'
          WHEN i.quantity <= (p.min_stock * 1.5) THEN 'WARNING'
          WHEN i.quantity > COALESCE(p.max_stock, 50) THEN 'OVERSTOCK'
          ELSE 'SAFE'
        END as stock_status,
        CASE
          WHEN i.expiry_date IS NOT NULL AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) <= 0 THEN 'EXPIRED'
          WHEN i.expiry_date IS NOT NULL AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) <= 45 THEN 'EXPIRING_SOON'
          ELSE 'GOOD'
        END as expiry_status,
        (p.min_stock - i.quantity) as deficit
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE 1=1
    `;
    const params = [];

    // Tìm kiếm độc lập: Tên SP, SKU, Barcode, Vị trí Kệ
    if (search && search.trim()) {
      const kw = `%${search.trim()}%`;
      query += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR i.location LIKE ? OR i.zone LIKE ?)`;
      params.push(kw, kw, kw, kw, kw);
    }

    if (zone && zone !== 'ALL') {
      query += ` AND (i.zone LIKE ? OR i.location LIKE ?)`;
      params.push(`%${zone}%`, `%${zone}%`);
    }

    if (abc && abc !== 'ALL') {
      query += ` AND p.abc_class = ?`;
      params.push(abc);
    }

    // Lọc theo Hạn sử dụng (FEFO Filter)
    if (expiry_filter === 'EXPIRING_SOON') {
      query += ` AND i.expiry_date IS NOT NULL AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) <= 45 AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) > 0`;
    } else if (expiry_filter === 'CRITICAL') {
      query += ` AND i.expiry_date IS NOT NULL AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) <= 15 AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) > 0`;
    } else if (expiry_filter === 'EXPIRED') {
      query += ` AND i.expiry_date IS NOT NULL AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) <= 0`;
    } else if (expiry_filter === 'SAFE') {
      query += ` AND (i.expiry_date IS NULL OR (JULIANDAY(i.expiry_date) - JULIANDAY('now')) > 45)`;
    }

    // Lọc theo Thời gian Nhập hàng (Import Date Filter)
    if (import_filter === 'TODAY') {
      query += ` AND EXISTS (SELECT 1 FROM product_batches b WHERE b.product_id = p.id AND b.import_date = DATE('now'))`;
    } else if (import_filter === 'WEEK') {
      query += ` AND EXISTS (SELECT 1 FROM product_batches b WHERE b.product_id = p.id AND (JULIANDAY('now') - JULIANDAY(b.import_date)) <= 7)`;
    } else if (import_filter === 'MONTH') {
      query += ` AND EXISTS (SELECT 1 FROM product_batches b WHERE b.product_id = p.id AND (JULIANDAY('now') - JULIANDAY(b.import_date)) <= 30)`;
    } else if (import_filter === 'OLDER') {
      query += ` AND NOT EXISTS (SELECT 1 FROM product_batches b WHERE b.product_id = p.id AND (JULIANDAY('now') - JULIANDAY(b.import_date)) <= 30)`;
    }

    // Lọc theo tình trạng tồn
    if (status === 'LOW') {
      query += ` AND i.quantity <= p.min_stock AND i.quantity > 0`;
    } else if (status === 'OUT') {
      query += ` AND i.quantity <= 0`;
    } else if (status === 'OVERSTOCK') {
      query += ` AND i.quantity > COALESCE(p.max_stock, 50)`;
    } else if (status === 'SAFE') {
      query += ` AND i.quantity > p.min_stock AND i.quantity <= COALESCE(p.max_stock, 50)`;
    }

    query += ` ORDER BY p.abc_class ASC, i.quantity ASC`;

    const inventoryList = db.prepare(query).all(...params);

    // Lấy thông tin chi tiết từng thùng/lô hàng của tất cả sản phẩm
    const batchQuery = db.prepare(`
      SELECT 
        b.*,
        ROUND(JULIANDAY(b.expiry_date) - JULIANDAY('now')) as days_until_expiry,
        ROUND(JULIANDAY('now') - JULIANDAY(b.import_date)) as days_since_import,
        CASE
          WHEN b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 0 THEN 'EXPIRED'
          WHEN b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 20 THEN 'CRITICAL'
          WHEN b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 45 THEN 'EXPIRING_SOON'
          ELSE 'SAFE'
        END as batch_expiry_status
      FROM product_batches b
      WHERE b.quantity > 0
      ORDER BY 
        b.product_id ASC,
        (CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END) ASC,
        b.expiry_date ASC,
        b.import_date ASC
    `);
    const allBatches = batchQuery.all();

    // Nhóm batches theo product_id
    const batchesByProduct = {};
    allBatches.forEach(b => {
      if (!batchesByProduct[b.product_id]) {
        batchesByProduct[b.product_id] = [];
      }
      batchesByProduct[b.product_id].push(b);
    });

    // Thống kê thông minh
    let safeCount = 0;
    let warningCount = 0;
    let dangerCount = 0;
    let overstockCount = 0;
    let expiringSoonCount = 0;
    let expiredCount = 0;
    let totalUnits = 0;
    let totalStockValue = 0;
    let totalBoxes = 0;

    const enrichedList = inventoryList.map(item => {
      totalUnits += item.current_stock;
      totalStockValue += item.current_stock * item.cost_price;

      if (item.stock_status === 'DANGER' || item.stock_status === 'OUT_OF_STOCK') {
        dangerCount++;
      } else if (item.stock_status === 'WARNING') {
        warningCount++;
      } else if (item.stock_status === 'OVERSTOCK') {
        overstockCount++;
      } else {
        safeCount++;
      }

      if (item.expiry_status === 'EXPIRED') {
        expiredCount++;
      } else if (item.expiry_status === 'EXPIRING_SOON') {
        expiringSoonCount++;
      }

      const itemBatches = batchesByProduct[item.product_id] || [];
      totalBoxes += itemBatches.length;

      // Đếm trạng thái các thùng của sản phẩm này
      let hasExpiredBatch = false;
      let hasExpiringSoonBatch = false;

      itemBatches.forEach(b => {
        if (b.batch_expiry_status === 'EXPIRED') hasExpiredBatch = true;
        if (b.batch_expiry_status === 'EXPIRING_SOON' || b.batch_expiry_status === 'CRITICAL') hasExpiringSoonBatch = true;
      });

      return {
        ...item,
        batches: itemBatches,
        batch_count: itemBatches.length,
        has_multiple_boxes: itemBatches.length > 1,
        has_expired_box: hasExpiredBatch,
        has_expiring_box: hasExpiringSoonBatch,
        latest_import_date: itemBatches.length > 0 ? itemBatches[itemBatches.length - 1].import_date : null
      };
    });

    res.json({
      success: true,
      data: enrichedList,
      summary: {
        total_items: enrichedList.length,
        total_boxes: totalBoxes,
        total_units: totalUnits,
        total_stock_value: totalStockValue,
        safe_count: safeCount,
        warning_count: warningCount,
        danger_count: dangerCount,
        overstock_count: overstockCount,
        expiring_soon_count: expiringSoonCount,
        expired_count: expiredCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/inventory/batches - Lấy danh sách tất cả các Thùng/Lô hàng với bộ lọc đầy đủ
router.get('/batches', (req, res) => {
  try {
    const { product_id, expiry_filter, import_filter, search } = req.query;

    let query = `
      SELECT 
        b.*,
        p.sku,
        p.barcode,
        p.name as product_name,
        p.unit,
        p.cost_price,
        p.sale_price,
        p.category,
        ROUND(JULIANDAY(b.expiry_date) - JULIANDAY('now')) as days_until_expiry,
        ROUND(JULIANDAY('now') - JULIANDAY(b.import_date)) as days_since_import,
        CASE
          WHEN b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 0 THEN 'EXPIRED'
          WHEN b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 20 THEN 'CRITICAL'
          WHEN b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 45 THEN 'EXPIRING_SOON'
          ELSE 'SAFE'
        END as batch_expiry_status
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (product_id) {
      query += ` AND b.product_id = ?`;
      params.push(product_id);
    }

    if (search && search.trim()) {
      const kw = `%${search.trim()}%`;
      query += ` AND (b.batch_code LIKE ? OR b.box_label LIKE ? OR p.name LIKE ? OR p.sku LIKE ? OR b.location LIKE ?)`;
      params.push(kw, kw, kw, kw, kw);
    }

    if (expiry_filter === 'EXPIRED') {
      query += ` AND b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 0`;
    } else if (expiry_filter === 'EXPIRING_SOON') {
      query += ` AND b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 45 AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) > 0`;
    } else if (expiry_filter === 'CRITICAL') {
      query += ` AND b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 20 AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) > 0`;
    } else if (expiry_filter === 'SAFE') {
      query += ` AND (b.expiry_date IS NULL OR (JULIANDAY(b.expiry_date) - JULIANDAY('now')) > 45)`;
    }

    if (import_filter === 'TODAY') {
      query += ` AND b.import_date = DATE('now')`;
    } else if (import_filter === 'WEEK') {
      query += ` AND (JULIANDAY('now') - JULIANDAY(b.import_date)) <= 7`;
    } else if (import_filter === 'MONTH') {
      query += ` AND (JULIANDAY('now') - JULIANDAY(b.import_date)) <= 30`;
    } else if (import_filter === 'OLDER') {
      query += ` AND (JULIANDAY('now') - JULIANDAY(b.import_date)) > 30`;
    }

    query += ` ORDER BY 
      (CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END) ASC,
      b.expiry_date ASC,
      b.import_date DESC`;

    const batches = db.prepare(query).all(...params);
    res.json({ success: true, data: batches, count: batches.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/inventory/batches - Thêm Thùng hàng / Lô hàng mới cho sản phẩm
router.post('/batches', (req, res) => {
  try {
    const { product_id, batch_code, box_label, location, quantity, import_date, expiry_date, note } = req.body;

    if (!product_id) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn sản phẩm' });
    }

    const qty = parseInt(quantity) || 0;
    if (qty <= 0) {
      return res.status(400).json({ success: false, message: 'Số lượng thùng phải lớn hơn 0' });
    }

    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    if (!prod) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    }

    // Tự sinh mã thùng nếu để trống
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(100 + Math.random() * 900);
    const finalBatchCode = (batch_code && batch_code.trim()) || `BOX-${dateStr}-${randSuffix}`;
    const finalBoxLabel = (box_label && box_label.trim()) || `Thùng ${qty} ${prod.unit}`;
    const finalImportDate = (import_date && import_date.trim()) || now.toISOString().slice(0, 10);
    const finalLocation = (location && location.trim()) || 'Kệ trưng bày';

    const insertBatch = db.prepare(`
      INSERT INTO product_batches (product_id, batch_code, box_label, location, quantity, initial_quantity, unit_cost, import_date, expiry_date, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateInv = db.prepare(`
      UPDATE inventory 
      SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = ?
    `);

    const insertTx = db.prepare(`
      INSERT INTO stock_transactions (product_id, batch_id, transaction_type, reference_code, quantity_change, balance_after, note)
      VALUES (?, ?, 'STOCK_IN', ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const batchRes = insertBatch.run(
        product_id,
        finalBatchCode,
        finalBoxLabel,
        finalLocation,
        qty,
        qty,
        prod.cost_price,
        finalImportDate,
        expiry_date || null,
        note || ''
      );
      const batchId = batchRes.lastInsertRowid;

      // Đồng bộ lại inventory
      updateInv.run(qty, product_id);

      // Cập nhật lại hạn dùng sớm nhất (FEFO)
      const earliestBatch = db.prepare(`
        SELECT expiry_date FROM product_batches
        WHERE product_id = ? AND quantity > 0 AND expiry_date IS NOT NULL
        ORDER BY expiry_date ASC LIMIT 1
      `).get(product_id);

      if (earliestBatch) {
        db.prepare('UPDATE inventory SET expiry_date = ? WHERE product_id = ?').run(earliestBatch.expiry_date, product_id);
      }

      const curInv = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(product_id);
      const newTotal = curInv ? curInv.quantity : qty;

      insertTx.run(product_id, batchId, finalBatchCode, qty, newTotal, `Nhập mới thùng: ${finalBoxLabel}`);
      return { batchId, finalBatchCode, newTotal };
    });

    const result = tx();

    res.status(201).json({
      success: true,
      message: `Đã thêm thùng hàng [${result.finalBatchCode}] thành công!`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/inventory/batches/:id - Sửa thông tin thùng hàng (số lượng, HSD, vị trí)
router.put('/batches/:id', (req, res) => {
  try {
    const { box_label, location, quantity, expiry_date, import_date, note } = req.body;
    const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thùng hàng' });
    }

    const newQty = quantity !== undefined ? Math.max(0, parseInt(quantity) || 0) : batch.quantity;
    const qtyDiff = newQty - batch.quantity;

    db.prepare(`
      UPDATE product_batches 
      SET 
        box_label = COALESCE(?, box_label),
        location = COALESCE(?, location),
        quantity = ?,
        expiry_date = ?,
        import_date = COALESCE(?, import_date),
        note = COALESCE(?, note),
        status = CASE WHEN ? = 0 THEN 'DEPLETED' ELSE 'ACTIVE' END
      WHERE id = ?
    `).run(
      box_label, 
      location, 
      newQty, 
      expiry_date !== undefined ? expiry_date : batch.expiry_date, 
      import_date, 
      note, 
      newQty, 
      req.params.id
    );

    // Cập nhật lại tồn tổng inventory nếu số lượng thay đổi
    if (qtyDiff !== 0) {
      db.prepare(`
        UPDATE inventory 
        SET quantity = MAX(0, quantity + ?), updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `).run(qtyDiff, batch.product_id);
    }

    // Cập nhật lại HSD sớm nhất của sản phẩm
    const earliestBatch = db.prepare(`
      SELECT expiry_date FROM product_batches
      WHERE product_id = ? AND quantity > 0 AND expiry_date IS NOT NULL
      ORDER BY expiry_date ASC LIMIT 1
    `).get(batch.product_id);

    db.prepare('UPDATE inventory SET expiry_date = ? WHERE product_id = ?')
      .run(earliestBatch ? earliestBatch.expiry_date : null, batch.product_id);

    res.json({ success: true, message: 'Đã cập nhật thông tin thùng hàng thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/inventory/batches/:id - Xóa thùng hàng
router.delete('/batches/:id', (req, res) => {
  try {
    const batch = db.prepare('SELECT * FROM product_batches WHERE id = ?').get(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thùng hàng' });
    }

    db.transaction(() => {
      db.prepare('DELETE FROM product_batches WHERE id = ?').run(req.params.id);

      // Trừ lại số lượng tồn kho tổng
      db.prepare(`
        UPDATE inventory 
        SET quantity = MAX(0, quantity - ?), updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `).run(batch.quantity, batch.product_id);

      // Cập nhật lại hạn dùng sớm nhất
      const earliest = db.prepare(`
        SELECT expiry_date FROM product_batches 
        WHERE product_id = ? AND quantity > 0 AND expiry_date IS NOT NULL
        ORDER BY expiry_date ASC LIMIT 1
      `).get(batch.product_id);

      db.prepare('UPDATE inventory SET expiry_date = ? WHERE product_id = ?')
        .run(earliest ? earliest.expiry_date : null, batch.product_id);
    })();

    res.json({ success: true, message: 'Đã xóa thùng hàng và cập nhật tồn kho' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/inventory/:id/quantity - Cập nhật nhanh số lượng tồn kho
router.put('/:id/quantity', (req, res) => {
  try {
    const { quantity, delta, note } = req.body;
    const inv = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
    if (!inv) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy mặt hàng tồn kho' });
    }

    let newQty = 0;
    let change = 0;

    if (quantity !== undefined) {
      newQty = Math.max(0, parseInt(quantity) || 0);
      change = newQty - inv.quantity;
    } else if (delta !== undefined) {
      change = parseInt(delta) || 0;
      newQty = Math.max(0, inv.quantity + change);
    }

    db.prepare(`
      UPDATE inventory 
      SET quantity = ?, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newQty, req.params.id);

    db.prepare(`
      INSERT INTO stock_transactions (product_id, transaction_type, reference_code, quantity_change, balance_after, note)
      VALUES (?, 'ADJUST', 'KIEM-KE', ?, ?, ?)
    `).run(inv.product_id, change, newQty, note || 'Kiểm kê kho định kỳ');

    res.json({ success: true, message: 'Cập nhật tồn thành công', new_quantity: newQty });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/inventory/:id/shelf - Cập nhật khu vực và tầng kệ sắp xếp
router.put('/:id/shelf', (req, res) => {
  try {
    const { zone, shelf_level } = req.body;
    if (!zone) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp khu vực sắp xếp' });
    }

    const cleanZone = zone.trim();
    const cleanLevel = shelf_level ? shelf_level.trim() : 'Tầng 2 (Tầm mắt)';
    const fullLocation = `${cleanZone} (${cleanLevel})`;

    db.prepare(`
      UPDATE inventory 
      SET zone = ?, shelf_level = ?, location = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanZone, cleanLevel, fullLocation, req.params.id);

    res.json({ success: true, message: 'Đã cập nhật vị trí kệ kho' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/inventory/:id/audit - Xác nhận đã kiểm đếm hôm nay
router.put('/:id/audit', (req, res) => {
  try {
    db.prepare(`
      UPDATE inventory 
      SET last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    res.json({ success: true, message: 'Đã ghi nhận kiểm đếm kho' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
