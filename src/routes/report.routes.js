const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// Helper to calculate date boundaries
function getDateRange(range, fromDate, toDate) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const formatYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let startStr, endStr, label;

  if (fromDate && toDate) {
    startStr = `${fromDate} 00:00:00`;
    endStr = `${toDate} 23:59:59`;
    label = `Từ ${fromDate} đến ${toDate}`;
  } else {
    switch (range) {
      case 'today': {
        const today = formatYMD(now);
        startStr = `${today} 00:00:00`;
        endStr = `${today} 23:59:59`;
        label = `Hôm nay (${today})`;
        break;
      }
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const yStr = formatYMD(y);
        startStr = `${yStr} 00:00:00`;
        endStr = `${yStr} 23:59:59`;
        label = `Hôm qua (${yStr})`;
        break;
      }
      case 'week': {
        const w = new Date(now);
        w.setDate(w.getDate() - 6);
        startStr = `${formatYMD(w)} 00:00:00`;
        endStr = `${formatYMD(now)} 23:59:59`;
        label = `7 ngày qua (${formatYMD(w)} - ${formatYMD(now)})`;
        break;
      }
      case 'month': {
        const mStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01 00:00:00`;
        startStr = mStart;
        endStr = `${formatYMD(now)} 23:59:59`;
        label = `Tháng ${now.getMonth() + 1}/${now.getFullYear()}`;
        break;
      }
      case 'all':
      default: {
        startStr = `2000-01-01 00:00:00`;
        endStr = `${formatYMD(now)} 23:59:59`;
        label = 'Toàn bộ thời gian';
        break;
      }
    }
  }
  return { startStr, endStr, label };
}

// GET /api/reports/xnt - Báo cáo Xuất - Nhập - Tồn chi tiết toàn diện
router.get('/xnt', (req, res) => {
  try {
    const userRole = req.headers['x-user-role'] || 'admin';
    const canViewCost = (userRole === 'admin' || userRole === 'manager');
    const { range = 'month', from_date, to_date, category, search } = req.query;

    const { startStr, endStr, label } = getDateRange(range, from_date, to_date);

    // 1. Fetch filtered products
    let prodQuery = `
      SELECT p.id, p.sku, p.barcode, p.name, p.category, p.unit, p.cost_price, p.sale_price,
             COALESCE(inv.quantity, 0) as current_stock
      FROM products p
      LEFT JOIN inventory inv ON p.id = inv.product_id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'ALL') {
      prodQuery += ` AND p.category = ?`;
      params.push(category);
    }
    if (search && search.trim()) {
      prodQuery += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }

    prodQuery += ` ORDER BY p.category ASC, p.name ASC`;
    const products = db.prepare(prodQuery).all(...params);

    // 2. Aggregate Stock In during period
    const inMap = {};
    const inRows = db.prepare(`
      SELECT sii.product_id, 
             COALESCE(SUM(sii.quantity), 0) as in_qty,
             COALESCE(SUM(sii.subtotal), 0) as in_val
      FROM stock_in_items sii
      JOIN stock_in_receipts sir ON sii.receipt_id = sir.id
      WHERE sir.created_at >= ? AND sir.created_at <= ?
      GROUP BY sii.product_id
    `).all(startStr, endStr);
    inRows.forEach(r => { inMap[r.product_id] = r; });

    // 3. Stock in after endStr (if endStr is earlier than current moment)
    const inAfterMap = {};
    const inAfterRows = db.prepare(`
      SELECT sii.product_id, COALESCE(SUM(sii.quantity), 0) as in_after
      FROM stock_in_items sii
      JOIN stock_in_receipts sir ON sii.receipt_id = sir.id
      WHERE sir.created_at > ?
      GROUP BY sii.product_id
    `).all(endStr);
    inAfterRows.forEach(r => { inAfterMap[r.product_id] = r.in_after; });

    // 4. Aggregate Stock Out during period
    const outMap = {};
    const outRows = db.prepare(`
      SELECT soi.product_id,
             COALESCE(SUM(soi.quantity), 0) as out_qty,
             COALESCE(SUM(soi.subtotal), 0) as out_val
      FROM stock_out_items soi
      JOIN stock_out_receipts sor ON soi.receipt_id = sor.id
      WHERE sor.created_at >= ? AND sor.created_at <= ?
      GROUP BY soi.product_id
    `).all(startStr, endStr);
    outRows.forEach(r => { outMap[r.product_id] = r; });

    // 5. Stock out after endStr
    const outAfterMap = {};
    const outAfterRows = db.prepare(`
      SELECT soi.product_id, COALESCE(SUM(soi.quantity), 0) as out_after
      FROM stock_out_items soi
      JOIN stock_out_receipts sor ON soi.receipt_id = sor.id
      WHERE sor.created_at > ?
      GROUP BY soi.product_id
    `).all(endStr);
    outAfterRows.forEach(r => { outAfterMap[r.product_id] = r.out_after; });

    // 6. Active batches and nearest expiry
    const batchMap = {};
    const batchRows = db.prepare(`
      SELECT product_id, 
             COUNT(id) as batch_count,
             MIN(expiry_date) as nearest_expiry
      FROM product_batches
      WHERE status = 'ACTIVE' AND quantity > 0
      GROUP BY product_id
    `).all();
    batchRows.forEach(b => { batchMap[b.product_id] = b; });

    // 7. Overall receipts count
    const inReceiptCount = db.prepare(`
      SELECT COUNT(id) as count, COALESCE(SUM(total_amount), 0) as total
      FROM stock_in_receipts
      WHERE created_at >= ? AND created_at <= ?
    `).get(startStr, endStr);

    const outReceiptCount = db.prepare(`
      SELECT COUNT(id) as count, COALESCE(SUM(total_amount), 0) as total
      FROM stock_out_receipts
      WHERE created_at >= ? AND created_at <= ?
    `).get(startStr, endStr);

    let totalOpeningUnits = 0;
    let totalOpeningVal = 0;
    let totalInUnits = 0;
    let totalInVal = 0;
    let totalOutUnits = 0;
    let totalOutVal = 0;
    let totalOutCost = 0;
    let totalClosingUnits = 0;
    let totalClosingVal = 0;

    const items = products.map(p => {
      const inInfo = inMap[p.id] || { in_qty: 0, in_val: 0 };
      const outInfo = outMap[p.id] || { out_qty: 0, out_val: 0 };
      const inAfter = inAfterMap[p.id] || 0;
      const outAfter = outAfterMap[p.id] || 0;
      const batchInfo = batchMap[p.id] || { batch_count: 0, nearest_expiry: null };

      // Closing stock at period end
      const closing_qty = Math.max(0, p.current_stock - inAfter + outAfter);
      // Opening stock at period start
      const opening_qty = Math.max(0, closing_qty - inInfo.in_qty + outInfo.out_qty);

      const costPrice = p.cost_price || 0;
      const opening_val = opening_qty * costPrice;
      const in_val = inInfo.in_val || (inInfo.in_qty * costPrice);
      const out_val = outInfo.out_val;
      const out_cost = outInfo.out_qty * costPrice;
      const closing_val = closing_qty * costPrice;
      const gross_profit = out_val - out_cost;

      totalOpeningUnits += opening_qty;
      totalOpeningVal += opening_val;
      totalInUnits += inInfo.in_qty;
      totalInVal += in_val;
      totalOutUnits += outInfo.out_qty;
      totalOutVal += out_val;
      totalOutCost += out_cost;
      totalClosingUnits += closing_qty;
      totalClosingVal += closing_val;

      // Expiry status
      let expiryStatus = 'SAFE';
      let daysRemaining = null;
      if (batchInfo.nearest_expiry) {
        const today = new Date();
        const exp = new Date(batchInfo.nearest_expiry);
        daysRemaining = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
        if (daysRemaining <= 0) expiryStatus = 'EXPIRED';
        else if (daysRemaining <= 30) expiryStatus = 'EXPIRING_SOON';
      }

      return {
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        category: p.category,
        unit: p.unit,
        cost_price: canViewCost ? p.cost_price : null,
        sale_price: p.sale_price,
        opening_qty,
        opening_val: canViewCost ? opening_val : null,
        in_qty: inInfo.in_qty,
        in_val: canViewCost ? in_val : null,
        out_qty: outInfo.out_qty,
        out_val,
        closing_qty,
        closing_val: canViewCost ? closing_val : null,
        gross_profit: canViewCost ? gross_profit : null,
        batch_count: batchInfo.batch_count,
        nearest_expiry: batchInfo.nearest_expiry,
        days_remaining: daysRemaining,
        expiry_status: expiryStatus
      };
    });

    // Top 5 selling
    const topSelling = [...items]
      .filter(i => i.out_qty > 0)
      .sort((a, b) => b.out_qty - a.out_qty)
      .slice(0, 5);

    // Top 5 slow moving
    const slowMoving = [...items]
      .filter(i => i.closing_qty > 0 && i.out_qty === 0)
      .sort((a, b) => b.closing_qty - a.closing_qty)
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        period: {
          range,
          from: startStr,
          to: endStr,
          label
        },
        summary: {
          total_skus: products.length,
          total_opening_units: totalOpeningUnits,
          total_opening_val: canViewCost ? totalOpeningVal : null,
          total_in_units: totalInUnits,
          total_in_val: canViewCost ? totalInVal : null,
          in_receipt_count: inReceiptCount.count,
          total_out_units: totalOutUnits,
          total_out_val: totalOutVal,
          out_receipt_count: outReceiptCount.count,
          total_closing_units: totalClosingUnits,
          total_closing_val: canViewCost ? totalClosingVal : null,
          total_gross_profit: canViewCost ? (totalOutVal - totalOutCost) : null,
          can_view_cost: canViewCost
        },
        items,
        top_selling: topSelling,
        slow_moving: slowMoving
      }
    });
  } catch (error) {
    console.error('Lỗi tính báo cáo XNT:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/inventory-valuation - Alias for valuation & summary
router.get('/inventory-valuation', (req, res) => {
  try {
    const stockVal = db.prepare(`
      SELECT 
        COUNT(DISTINCT p.id) as total_products,
        COALESCE(SUM(i.quantity), 0) as total_quantity,
        COALESCE(SUM(i.quantity * p.cost_price), 0) as total_cost_value,
        COALESCE(SUM(i.quantity * p.sale_price), 0) as total_sale_value
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
    `).get();

    res.json({
      success: true,
      data: {
        total_skus: stockVal.total_products,
        total_quantity: stockVal.total_quantity,
        total_valuation: stockVal.total_cost_value,
        total_retail_value: stockVal.total_sale_value,
        potential_profit: stockVal.total_sale_value - stockVal.total_cost_value
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/summary - Báo cáo tổng quan
router.get('/summary', (req, res) => {
  try {
    const stockVal = db.prepare(`
      SELECT 
        COUNT(DISTINCT p.id) as total_products,
        COALESCE(SUM(i.quantity), 0) as total_quantity,
        COALESCE(SUM(i.quantity * p.cost_price), 0) as total_cost_value,
        COALESCE(SUM(i.quantity * p.sale_price), 0) as total_sale_value
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
    `).get();

    const inStats = db.prepare(`
      SELECT COUNT(id) as receipt_count, COALESCE(SUM(total_amount), 0) as total_in_amount
      FROM stock_in_receipts
    `).get();

    const outStats = db.prepare(`
      SELECT COUNT(id) as receipt_count, COALESCE(SUM(total_amount), 0) as total_out_amount
      FROM stock_out_receipts
    `).get();

    const profitStats = db.prepare(`
      SELECT COALESCE(SUM(item.quantity * (item.unit_price - p.cost_price)), 0) as estimated_gross_profit
      FROM stock_out_items item
      JOIN products p ON item.product_id = p.id
    `).get();

    res.json({
      success: true,
      data: {
        inventory: {
          total_products: stockVal.total_products,
          total_quantity: stockVal.total_quantity,
          total_cost_value: stockVal.total_cost_value,
          total_sale_value: stockVal.total_sale_value,
          potential_margin: stockVal.total_sale_value - stockVal.total_cost_value
        },
        stock_in: inStats,
        stock_out: {
          ...outStats,
          gross_profit: profitStats.estimated_gross_profit
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
