const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/rfid/tags - Lấy danh sách thẻ RFID đã gắn với sản phẩm hoặc lô thùng
router.get('/tags', (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT 
        'PRODUCT' as item_type,
        p.id as item_id,
        p.sku,
        p.name,
        p.unit,
        p.rfid_tag,
        COALESCE(i.location, 'Kệ trưng bày') as location,
        COALESCE(i.zone, 'Kệ trung tâm') as zone,
        COALESCE(i.quantity, 0) as current_stock,
        NULL as batch_code,
        NULL as expiry_date
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.rfid_tag IS NOT NULL AND p.rfid_tag != ''

      UNION ALL

      SELECT 
        'BATCH' as item_type,
        b.id as item_id,
        p.sku,
        p.name || ' (' || b.box_label || ')' as name,
        p.unit,
        b.rfid_tag,
        b.location,
        'Kho' as zone,
        b.quantity as current_stock,
        b.batch_code,
        b.expiry_date
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      WHERE b.rfid_tag IS NOT NULL AND b.rfid_tag != ''
    `;

    let tags = db.prepare(query).all();
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      tags = tags.filter(t => 
        (t.rfid_tag && t.rfid_tag.toLowerCase().includes(q)) ||
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.sku && t.sku.toLowerCase().includes(q)) ||
        (t.batch_code && t.batch_code.toLowerCase().includes(q))
      );
    }

    res.json({ success: true, data: tags, total: tags.length });
  } catch (error) {
    console.error('Lỗi lấy danh sách RFID tags:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/rfid/scan - Quét 1 hoặc nhiều mã thẻ RFID (Reader scan)
router.post('/scan', (req, res) => {
  try {
    const { tag, tags, scan_type = 'INSPECTION', location, note } = req.body;
    const tagList = tags && Array.isArray(tags) ? tags : (tag ? [tag] : []);

    if (tagList.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp ít nhất 1 mã thẻ RFID!' });
    }

    const scanResults = [];

    for (const rawTag of tagList) {
      const cleanTag = String(rawTag).trim();
      if (!cleanTag) continue;

      // 1. Tìm theo Batch trước (chính xác đến từng thùng hàng)
      let batch = db.prepare(`
        SELECT b.*, p.sku, p.name as product_name, p.unit, p.sale_price, p.cost_price
        FROM product_batches b
        JOIN products p ON b.product_id = p.id
        WHERE b.rfid_tag = ?
      `).get(cleanTag);

      if (batch) {
        db.prepare(`
          INSERT INTO rfid_logs (rfid_tag, scan_type, product_id, batch_id, quantity, location, note)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(cleanTag, scan_type, batch.product_id, batch.id, batch.quantity, location || batch.location, note || 'Quét thùng qua RFID');

        scanResults.push({
          tag: cleanTag,
          found: true,
          type: 'BATCH',
          data: {
            batch_id: batch.id,
            product_id: batch.product_id,
            product_name: batch.product_name,
            sku: batch.sku,
            batch_code: batch.batch_code,
            box_label: batch.box_label,
            quantity: batch.quantity,
            unit: batch.unit,
            sale_price: batch.sale_price,
            expiry_date: batch.expiry_date,
            location: batch.location
          }
        });
        continue;
      }

      // 2. Tìm theo Product
      let product = db.prepare(`
        SELECT p.*, COALESCE(i.quantity, 0) as current_stock, i.location, i.zone, i.shelf_level, i.expiry_date
        FROM products p
        LEFT JOIN inventory i ON p.id = i.product_id
        WHERE p.rfid_tag = ?
      `).get(cleanTag);

      if (product) {
        db.prepare(`
          INSERT INTO rfid_logs (rfid_tag, scan_type, product_id, quantity, location, note)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(cleanTag, scan_type, product.id, 1, location || product.location, note || 'Quét sản phẩm qua RFID');

        scanResults.push({
          tag: cleanTag,
          found: true,
          type: 'PRODUCT',
          data: {
            product_id: product.id,
            product_name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            quantity: product.current_stock,
            unit: product.unit,
            sale_price: product.sale_price,
            location: product.location,
            zone: product.zone,
            shelf_level: product.shelf_level,
            expiry_date: product.expiry_date
          }
        });
        continue;
      }

      // Không tìm thấy
      scanResults.push({
        tag: cleanTag,
        found: false,
        message: 'Thẻ RFID chưa được gán cho sản phẩm hay thùng hàng nào.'
      });
    }

    res.json({
      success: true,
      total_scanned: tagList.length,
      matched: scanResults.filter(r => r.found).length,
      data: scanResults
    });
  } catch (error) {
    console.error('Lỗi quét RFID:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/rfid/assign - Gán mã thẻ RFID cho sản phẩm hoặc thùng hàng
router.post('/assign', (req, res) => {
  try {
    const { rfid_tag, target_type, target_id } = req.body;
    if (!rfid_tag || !target_type || !target_id) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin: rfid_tag, target_type (PRODUCT/BATCH) và target_id' });
    }

    const cleanTag = rfid_tag.trim();

    if (target_type === 'PRODUCT') {
      db.prepare('UPDATE products SET rfid_tag = ? WHERE id = ?').run(cleanTag, target_id);
    } else if (target_type === 'BATCH') {
      db.prepare('UPDATE product_batches SET rfid_tag = ? WHERE id = ?').run(cleanTag, target_id);
    } else {
      return res.status(400).json({ success: false, message: 'target_type không hợp lệ! Chỉ chấp nhận PRODUCT hoặc BATCH.' });
    }

    res.json({
      success: true,
      message: `Đã gán thành công mã RFID "${cleanTag}" cho ${target_type === 'PRODUCT' ? 'sản phẩm' : 'thùng hàng'} #${target_id}`
    });
  } catch (error) {
    console.error('Lỗi gán mã RFID:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/rfid/logs - Lịch sử quét RFID
router.get('/logs', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT 
        l.*,
        p.name as product_name,
        p.sku,
        b.batch_code,
        b.box_label
      FROM rfid_logs l
      LEFT JOIN products p ON l.product_id = p.id
      LEFT JOIN product_batches b ON l.batch_id = b.id
      ORDER BY l.id DESC
      LIMIT 100
    `).all();

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Lỗi lấy lịch sử RFID logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

