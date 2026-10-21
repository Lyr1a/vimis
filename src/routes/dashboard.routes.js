const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/dashboard/stats - Tổng hợp chỉ số chuyên sâu Quản Lý Kho Tạp Hóa
router.get('/stats', (req, res) => {
  try {
    // 1. Tổng số mặt hàng
    const totalSku = db.prepare('SELECT COUNT(*) as count FROM products').get().count;

    // 2. Tổng sản phẩm tồn & Trị giá vốn kho
    const invStats = db.prepare(`
      SELECT 
        COALESCE(SUM(i.quantity), 0) as total_units,
        COALESCE(SUM(i.quantity * p.cost_price), 0) as total_value,
        COALESCE(SUM(i.quantity * p.sale_price), 0) as total_sale_value
      FROM inventory i
      JOIN products p ON i.product_id = p.id
    `).get();

    // 3. Số mặt hàng Nhóm A (chủ lực)
    const classACount = db.prepare('SELECT COUNT(*) as count FROM products WHERE abc_class = \'A\'').get().count;

    // 4. Cảnh báo thiếu tồn (Low Stock)
    const alertCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE COALESCE(i.quantity, 0) <= p.min_stock
    `).get().count;

    // 5. Cảnh báo thùng cận date (FEFO - Expiring Soon <= 45 ngày)
    const expiringCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM product_batches
      WHERE quantity > 0 AND expiry_date IS NOT NULL AND (JULIANDAY(expiry_date) - JULIANDAY('now')) <= 45
    `).get().count;

    // Tổng số thùng hàng đang hoạt động
    const totalBatches = db.prepare(`
      SELECT COUNT(*) as count FROM product_batches WHERE quantity > 0
    `).get().count;

    // 6. Số phiếu xuất / hóa đơn hôm nay
    const todaySales = db.prepare(`
      SELECT 
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as revenue
      FROM stock_out_receipts
      WHERE DATE(created_at) = DATE('now')
    `).get();

    // 7. Hoạt động kiểm kê & biến động gần đây
    const recentActivities = db.prepare(`
      SELECT 
        tx.id,
        tx.transaction_type,
        tx.reference_code,
        tx.quantity_change,
        tx.balance_after,
        tx.note,
        tx.created_at,
        p.sku,
        p.name as product_name,
        p.unit
      FROM stock_transactions tx
      JOIN products p ON tx.product_id = p.id
      ORDER BY tx.created_at DESC, tx.id DESC
      LIMIT 8
    `).all();

    // 8. Top mặt hàng cần nhập gấp (Low Stock Preview)
    const lowStockPreview = db.prepare(`
      SELECT 
        p.sku,
        p.name,
        p.unit,
        p.min_stock,
        COALESCE(p.abc_class, 'B') as abc_class,
        COALESCE(i.quantity, 0) as current_stock,
        (p.min_stock - COALESCE(i.quantity, 0)) as deficit,
        COALESCE(i.zone, 'Kệ trung tâm') as zone
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE COALESCE(i.quantity, 0) <= p.min_stock
      ORDER BY p.abc_class ASC, (COALESCE(i.quantity, 0) - p.min_stock) ASC
      LIMIT 5
    `).all();

    // 9. Top thùng hàng cận date (FEFO Preview)
    const expiringPreview = db.prepare(`
      SELECT 
        p.sku,
        p.name,
        p.unit,
        b.batch_code,
        b.box_label,
        b.quantity as current_stock,
        b.expiry_date,
        ROUND(JULIANDAY(b.expiry_date) - JULIANDAY('now')) as days_left,
        b.location as zone
      FROM product_batches b
      JOIN products p ON b.product_id = p.id
      WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL AND (JULIANDAY(b.expiry_date) - JULIANDAY('now')) <= 45
      ORDER BY days_left ASC
      LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        total_sku: totalSku,
        total_units: invStats.total_units,
        total_value: invStats.total_value,
        total_sale_value: invStats.total_sale_value,
        total_batches: totalBatches,
        class_a_count: classACount,
        alert_count: alertCount,
        expiring_count: expiringCount,
        today_sales_count: todaySales.count,
        today_revenue: todaySales.revenue,
        recent_activities: recentActivities,
        low_stock_preview: lowStockPreview,
        expiring_preview: expiringPreview
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
