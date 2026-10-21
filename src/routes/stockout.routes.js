const express = require('express');
const router = express.Router();
const { db, deductStockFEFO } = require('../../database');

// GET /api/stock-out - Danh sách các phiếu xuất hàng / bán hàng
router.get('/', (req, res) => {
  try {
    const receipts = db.prepare(`
      SELECT 
        r.*,
        COUNT(i.id) as total_items,
        SUM(i.quantity) as total_quantity
      FROM stock_out_receipts r
      LEFT JOIN stock_out_items i ON r.id = i.receipt_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `).all();

    res.json({ success: true, data: receipts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stock-out/:id - Chi tiết 1 phiếu xuất hàng kèm các dòng sản phẩm và thùng đã trừ
router.get('/:id', (req, res) => {
  try {
    const receipt = db.prepare('SELECT * FROM stock_out_receipts WHERE id = ?').get(req.params.id);
    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu xuất' });
    }

    const items = db.prepare(`
      SELECT item.*, p.sku, p.name as product_name, p.unit, p.barcode
      FROM stock_out_items item
      JOIN products p ON item.product_id = p.id
      WHERE item.receipt_id = ?
    `).all(req.params.id);

    res.json({ success: true, data: { ...receipt, items } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/stock-out - Tạo phiếu xuất hàng VÀ thực hiện trừ kho tự động theo quy tắc FEFO
router.post('/', (req, res) => {
  try {
    const { 
      customer_name, 
      reason, 
      note, 
      items, 
      payment_method = 'CASH',
      amount_received = 0,
      change_amount = 0
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Phiếu xuất phải có ít nhất 1 sản phẩm' });
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const receiptCode = reason === 'Bán lẻ tại tiệm' || reason === 'Bán lẻ'
      ? `HD-${dateStr}-${randomSuffix}`
      : `PX-${dateStr}-${randomSuffix}`;

    const targetCustomer = (customer_name && customer_name.trim()) || 'Khách lẻ tại tiệm';
    const targetReason = (reason && reason.trim()) || 'Bán lẻ';

    const insertReceipt = db.prepare(`
      INSERT INTO stock_out_receipts (receipt_code, customer_name, reason, payment_method, amount_received, change_amount, total_amount, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO stock_out_items (receipt_id, product_id, batch_id, batch_code, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const getInventoryBalance = db.prepare(`
      SELECT quantity FROM inventory WHERE product_id = ?
    `);

    const executeStockOutTx = db.transaction(() => {
      let totalAmount = 0;

      // 1. Kiểm tra số lượng tồn kho trước khi xuất
      for (const item of items) {
        const qty = parseInt(item.quantity) || 0;
        const price = parseFloat(item.unit_price) || 0;
        if (qty <= 0) {
          throw new Error('Số lượng xuất phải lớn hơn 0');
        }

        const inv = getInventoryBalance.get(item.product_id);
        const currentQty = inv ? inv.quantity : 0;
        if (currentQty < qty) {
          const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(item.product_id);
          const prodName = prod ? prod.name : `ID ${item.product_id}`;
          throw new Error(`Mặt hàng "${prodName}" chỉ còn tồn ${currentQty}, không đủ để bán/xuất ${qty}!`);
        }

        totalAmount += qty * price;
      }

      // 2. Tạo phiếu xuất / hóa đơn
      const finalAmountReceived = amount_received > 0 ? parseFloat(amount_received) : totalAmount;
      const finalChangeAmount = Math.max(0, finalAmountReceived - totalAmount);

      const receiptRes = insertReceipt.run(
        receiptCode,
        targetCustomer,
        targetReason,
        payment_method,
        finalAmountReceived,
        finalChangeAmount,
        totalAmount,
        note ? note.trim() : ''
      );
      const receiptId = receiptRes.lastInsertRowid;

      // 3. Trừ kho tự động theo quy tắc FEFO (First Expired, First Out)
      const deductionDetails = [];

      for (const item of items) {
        const qty = parseInt(item.quantity);
        const price = parseFloat(item.unit_price);
        const subtotal = qty * price;

        // Trừ tồn từ thùng có HSD gần nhất trước
        const fefoResult = deductStockFEFO(
          item.product_id,
          qty,
          receiptCode,
          targetReason,
          `Khách hàng: ${targetCustomer}`
        );

        // Lưu thông tin chi tiết các thùng bị trừ
        if (fefoResult.batchesUsed.length > 0) {
          for (const b of fefoResult.batchesUsed) {
            insertItem.run(
              receiptId,
              item.product_id,
              b.batch_id,
              b.batch_code,
              b.deducted_qty,
              price,
              b.deducted_qty * price
            );
          }
        } else {
          // Trường hợp không có bản ghi batch
          insertItem.run(receiptId, item.product_id, null, null, qty, price, subtotal);
        }

        deductionDetails.push({
          product_id: item.product_id,
          quantity: qty,
          unit_price: price,
          subtotal,
          new_total_stock: fefoResult.newTotalStock,
          batches_used: fefoResult.batchesUsed
        });
      }

      return {
        receiptId,
        receiptCode,
        totalAmount,
        amountReceived: finalAmountReceived,
        changeAmount: finalChangeAmount,
        customerName: targetCustomer,
        reason: targetReason,
        paymentMethod: payment_method,
        deductionDetails
      };
    });

    const result = executeStockOutTx();

    res.status(201).json({
      success: true,
      message: `Đã thanh toán & trừ kho thành công đơn hàng ${result.receiptCode}`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
