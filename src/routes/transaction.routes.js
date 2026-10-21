const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/transactions - Lịch sử biến động xuất/nhập/kiểm kê kho
router.get('/', (req, res) => {
  try {
    const { search, type, limit } = req.query;

    let query = `
      SELECT 
        tx.id,
        tx.transaction_type,
        tx.reference_code,
        tx.quantity_change,
        tx.balance_after,
        tx.note,
        tx.created_at,
        p.id as product_id,
        p.sku,
        p.name as product_name,
        p.category,
        p.unit
      FROM stock_transactions tx
      JOIN products p ON tx.product_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'ALL') {
      query += ` AND tx.transaction_type = ?`;
      params.push(type);
    }

    if (search && search.trim()) {
      query += ` AND (p.name LIKE ? OR p.sku LIKE ? OR tx.reference_code LIKE ? OR tx.note LIKE ?)`;
      const kw = `%${search.trim()}%`;
      params.push(kw, kw, kw, kw);
    }

    query += ` ORDER BY tx.created_at DESC, tx.id DESC`;

    const maxLimit = parseInt(limit) || 100;
    query += ` LIMIT ?`;
    params.push(maxLimit);

    const transactions = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

