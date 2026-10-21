const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/alerts - Cảnh báo tồn kho thông minh (Thiếu tồn + Cận date Thùng/Lô FEFO + Vượt định mức)
router.get('/', (req, res) => {
  try {
    // 1. Cảnh báo thiếu tồn (Low Stock)
    const lowStockQuery = `
      SELECT 
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
        COALESCE(i.quantity, 0) as current_stock,
        COALESCE(i.zone, 'Kệ trưng bày') as zone,
        COALESCE(i.shelf_level, 'Tầng 2') as shelf_level,
        i.expiry_date,
        (p.min_stock - COALESCE(i.quantity, 0)) as deficit,
        CASE 
          WHEN COALESCE(i.quantity, 0) <= 0 THEN 'OUT_OF_STOCK'
          WHEN COALESCE(i.quantity, 0) <= (p.min_stock / 2) THEN 'CRITICAL'
          ELSE 'WARNING'
        END as severity,
        MAX(10, (p.min_stock * 2) - COALESCE(i.quantity, 0)) as suggested_reorder_qty
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE COALESCE(i.quantity, 0) <= p.min_stock
      ORDER BY (COALESCE(i.quantity, 0) - p.min_stock) ASC, p.abc_class ASC
    `;
    const lowStockItems = db.prepare(lowStockQuery).all();

    // 2. Cảnh báo Thùng/Lô hàng cận date & Hết hạn theo FEFO (Chi tiết từng Thùng)
    const expiringBatchesQuery = `
      SELECT 
        b.id as batch_id,
        b.batch_code,
        b.box_label,
        b.quantity as batch_quantity,
        b.location as batch_location,
        b.import_date,
        b.expiry_date,
        p.id as product_id,
        p.sku,
        p.barcode,
        p.name,
        p.category,
        p.unit,
        ROUND(JULIANDAY(b.expiry_date) - JULIANDAY('now')) as days_until_expiry,
        ROUND(JULIANDAY('now') - JULIANDAY(b.import_date)) as days_since_import,
        CASE 
          WHEN (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 0 THEN 'EXPIRED'
          WHEN (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 15 THEN 'CRITICAL_EXPIRY'
          ELSE 'EXPIRING_SOON'
        END as expiry_severity
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 45
      ORDER BY days_until_expiry ASC
    `;
    const allExpiringBatches = db.prepare(expiringBatchesQuery).all();

    const expiredBatches = allExpiringBatches.filter(b => b.days_until_expiry <= 0);
    const expiringSoonBatches = allExpiringBatches.filter(b => b.days_until_expiry > 0);

    // 3. Cảnh báo ôm hàng vượt định mức (Overstock)
    const overstockQuery = `
      SELECT 
        p.id as product_id,
        p.sku,
        p.name,
        p.category,
        p.unit,
        i.quantity as current_stock,
        COALESCE(p.max_stock, 50) as max_stock,
        (i.quantity - COALESCE(p.max_stock, 50)) as excess_qty,
        COALESCE(i.zone, 'Kệ trưng bày') as zone
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.quantity > COALESCE(p.max_stock, 50)
      ORDER BY excess_qty DESC
    `;
    const overstockItems = db.prepare(overstockQuery).all();

    res.json({
      success: true,
      data: lowStockItems,
      count: lowStockItems.length,
      expiring_items: allExpiringBatches,
      expiring_count: allExpiringBatches.length,
      expired_batches: expiredBatches,
      expired_count: expiredBatches.length,
      expiring_soon_batches: expiringSoonBatches,
      expiring_soon_count: expiringSoonBatches.length,
      overstock_items: overstockItems,
      overstock_count: overstockItems.length,
      total_alerts: lowStockItems.length + allExpiringBatches.length + overstockItems.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
