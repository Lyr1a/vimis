const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/stock-in - Danh sách các phiếu nhập hàng
router.get('/', (req, res) => {
  try {
    const receipts = db.prepare(`
      SELECT 
        r.*,
        COUNT(i.id) as total_items,
        SUM(i.quantity) as total_quantity
      FROM stock_in_receipts r
      LEFT JOIN stock_in_items i ON r.id = i.receipt_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `).all();

    res.json({ success: true, data: receipts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stock-in/:id - Chi tiết 1 phiếu nhập hàng kèm các dòng sản phẩm
router.get('/:id', (req, res) => {
  try {
    const receipt = db.prepare('SELECT * FROM stock_in_receipts WHERE id = ?').get(req.params.id);
    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    }

    const items = db.prepare(`
      SELECT item.*, p.sku, p.name as product_name, p.unit
      FROM stock_in_items item
      JOIN products p ON item.product_id = p.id
      WHERE item.receipt_id = ?
    `).all(req.params.id);

    res.json({ success: true, data: { ...receipt, items } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/stock-in - Tạo phiếu nhập hàng VÀ thực hiện tăng tồn kho tự động
router.post('/', (req, res) => {
  try {
    const { supplier_name, warehouse_name, note, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Phiếu nhập phải có ít nhất 1 sản phẩm' });
    }

    // Tự sinh mã phiếu nhập duy nhất PN-YYYYMMDD-XXXX
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const receiptCode = `PN-${dateStr}-${randomSuffix}`;

    const targetSupplier = (supplier_name && supplier_name.trim()) || 'Nhập tự do';
    const targetWarehouse = (warehouse_name && warehouse_name.trim()) || 'Kho Tiệm Tạp Hóa';

    // Chuẩn bị các câu lệnh SQL
    const insertReceipt = db.prepare(`
      INSERT INTO stock_in_receipts (receipt_code, supplier_name, warehouse_name, total_amount, note)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO stock_in_items (receipt_id, product_id, quantity, unit_cost, subtotal)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateInventory = db.prepare(`
      UPDATE inventory 
      SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = ?
    `);

    const getInventoryBalance = db.prepare(`
      SELECT quantity FROM inventory WHERE product_id = ?
    `);

    const insertTransaction = db.prepare(`
      INSERT INTO stock_transactions (product_id, transaction_type, reference_code, quantity_change, balance_after, note)
      VALUES (?, 'STOCK_IN', ?, ?, ?, ?)
    `);

    const executeStockInTx = db.transaction(() => {
      let totalAmount = 0;

      // 1. Kiểm tra tính hợp lệ của danh sách hàng
      for (const item of items) {
        const qty = parseInt(item.quantity) || 0;
        const cost = parseFloat(item.unit_cost) || 0;
        if (qty <= 0) {
          throw new Error('Số lượng sản phẩm nhập phải lớn hơn 0');
        }
        totalAmount += qty * cost;
      }

      // 2. Tạo phiếu nhập
      const receiptRes = insertReceipt.run(
        receiptCode,
        targetSupplier,
        targetWarehouse,
        totalAmount,
        note ? note.trim() : ''
      );
      const receiptId = receiptRes.lastInsertRowid;

      // 3. Xử lý từng dòng sản phẩm & Cập nhật tồn kho
      for (const item of items) {
        const qty = parseInt(item.quantity);
        const cost = parseFloat(item.unit_cost) || 0;
        const subtotal = qty * cost;

        insertItem.run(receiptId, item.product_id, qty, cost, subtotal);
        updateInventory.run(qty, item.product_id);

        const currentInv = getInventoryBalance.get(item.product_id);
        const balanceAfter = currentInv ? currentInv.quantity : qty;

        insertTransaction.run(
          item.product_id,
          receiptCode,
          qty,
          balanceAfter,
          `Nhập hàng từ ${targetSupplier}`
        );
      }

      return { receiptId, receiptCode, totalAmount };
    });

    const result = executeStockInTx();

    res.status(201).json({
      success: true,
      message: `Đã tạo phiếu nhập ${result.receiptCode} và cập nhật tồn kho thành công!`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
