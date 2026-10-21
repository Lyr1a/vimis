const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'vimis.db');
const db = new Database(dbPath);

// Kích hoạt foreign keys và WAL mode
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  // 1. Bảng Người dùng / Tài khoản (Users)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff', -- 'admin', 'cashier', 'warehouse', 'staff'
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Bảng Sản phẩm (Products)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      barcode TEXT,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'Mặt hàng thông dụng',
      unit TEXT DEFAULT 'Cái',
      cost_price REAL DEFAULT 0,
      sale_price REAL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 5,
      max_stock INTEGER NOT NULL DEFAULT 50,
      abc_class TEXT NOT NULL DEFAULT 'B',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe migrations for products
  try { db.exec('ALTER TABLE products ADD COLUMN barcode TEXT;'); } catch (e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN abc_class TEXT DEFAULT 'B';"); } catch (e) {}
  try { db.exec('ALTER TABLE products ADD COLUMN max_stock INTEGER DEFAULT 50;'); } catch (e) {}

  // 3. Bảng Tồn kho Tổng hợp (Inventory)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      warehouse_name TEXT DEFAULT 'Kho Tiệm Tạp Hóa',
      location TEXT DEFAULT 'Kệ trưng bày',
      zone TEXT DEFAULT 'Kệ trung tâm',
      shelf_level TEXT DEFAULT 'Tầng 2 (Tầm mắt)',
      quantity INTEGER NOT NULL DEFAULT 0,
      expiry_date DATE,
      last_checked_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, warehouse_name)
    );
  `);

  // Safe migrations for inventory
  try { db.exec("ALTER TABLE inventory ADD COLUMN zone TEXT DEFAULT 'Kệ trung tâm';"); } catch (e) {}
  try { db.exec("ALTER TABLE inventory ADD COLUMN shelf_level TEXT DEFAULT 'Tầng 2 (Tầm mắt)';"); } catch (e) {}
  try { db.exec('ALTER TABLE inventory ADD COLUMN expiry_date DATE;'); } catch (e) {}
  try { db.exec('ALTER TABLE inventory ADD COLUMN last_checked_at DATETIME;'); } catch (e) {}

  // 4. Bảng Thùng hàng / Lô hàng (Batches / Lots / Boxes)
  // Giải quyết bài toán: 1 nhãn sản phẩm có nhiều thùng với hạn sử dụng và ngày nhập khác nhau!
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_code TEXT NOT NULL,                     -- Mã thùng / Lô (VD: THUNG-01, LOT-202610-01)
      box_label TEXT,                               -- Tên nhãn thùng (VD: Thùng 30 gói, Lô Kệ A1)
      warehouse_name TEXT DEFAULT 'Kho Tiệm Tạp Hóa',
      location TEXT DEFAULT 'Kệ trưng bày',
      quantity INTEGER NOT NULL DEFAULT 0,          -- Số lượng còn lại trong thùng
      initial_quantity INTEGER NOT NULL DEFAULT 0,  -- Số lượng lúc nhập thùng
      unit_cost REAL DEFAULT 0,                     -- Giá vốn nhập của thùng này
      import_date DATE DEFAULT (DATE('now')),        -- Ngày nhập thùng
      expiry_date DATE,                             -- Hạn sử dụng của thùng này
      status TEXT DEFAULT 'ACTIVE',                 -- 'ACTIVE', 'DEPLETED', 'EXPIRED'
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Bảng Nhập hàng (Stock In)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_in_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT UNIQUE NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT 'Nhập tự do',
      warehouse_name TEXT NOT NULL DEFAULT 'Kho Tiệm Tạp Hóa',
      total_amount REAL DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_in_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES stock_in_receipts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES product_batches(id),
      batch_code TEXT,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      subtotal REAL NOT NULL
    );
  `);

  // Safe migrations for stock_in_items
  try { db.exec('ALTER TABLE stock_in_items ADD COLUMN batch_id INTEGER;'); } catch (e) {}
  try { db.exec('ALTER TABLE stock_in_items ADD COLUMN batch_code TEXT;'); } catch (e) {}

  // 6. Bảng Xuất hàng / Bán lẻ (Stock Out)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_out_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_code TEXT UNIQUE NOT NULL,
      customer_name TEXT DEFAULT 'Khách lẻ',
      reason TEXT DEFAULT 'Bán lẻ tại tiệm', -- 'Bán lẻ', 'Hư hỏng / Hết hạn', 'Trả hàng NCC'
      payment_method TEXT DEFAULT 'CASH',    -- 'CASH', 'TRANSFER', 'CARD'
      amount_received REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_out_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES stock_out_receipts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES product_batches(id),
      batch_code TEXT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL
    );
  `);

  // Safe migrations for stock_out
  try { db.exec("ALTER TABLE stock_out_receipts ADD COLUMN payment_method TEXT DEFAULT 'CASH';"); } catch (e) {}
  try { db.exec('ALTER TABLE stock_out_receipts ADD COLUMN amount_received REAL DEFAULT 0;'); } catch (e) {}
  try { db.exec('ALTER TABLE stock_out_receipts ADD COLUMN change_amount REAL DEFAULT 0;'); } catch (e) {}
  try { db.exec('ALTER TABLE stock_out_items ADD COLUMN batch_id INTEGER;'); } catch (e) {}
  try { db.exec('ALTER TABLE stock_out_items ADD COLUMN batch_code TEXT;'); } catch (e) {}

  // 7. Bảng Lịch sử biến động kho (Stock Transactions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES product_batches(id),
      transaction_type TEXT NOT NULL, -- 'STOCK_IN', 'STOCK_OUT', 'ADJUST', 'INIT', 'BULK_SYNC'
      reference_code TEXT,
      quantity_change INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try { db.exec('ALTER TABLE stock_transactions ADD COLUMN batch_id INTEGER;'); } catch (e) {}

  // Seed Tài khoản mẫu nếu bảng users rỗng
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, password, full_name, role, phone)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertUser.run('admin', 'admin123', 'Nguyễn Văn Chủ Tiệm', 'admin', '0909123456');
    insertUser.run('thungan', '123456', 'Trần Thị Thu Ngân (Thu ngân POS)', 'cashier', '0912987654');
    insertUser.run('kiemkho', '123456', 'Lê Văn Kiểm Kho (Nhập hàng)', 'warehouse', '0988776655');
    console.log('✅ Khởi tạo tài khoản mẫu thành công: admin / thungan / kiemkho');
  }

  // Cập nhật Barcode chuẩn cho các mặt hàng hiện có nếu đang null
  const defaultBarcodes = {
    'TH-HAOHAO': '8934563138164',
    'TH-TIGER-LON': '8934822212330',
    'NUOC-LAVIE-500': '8934588012111',
    'DAU-TUONGAN-1L': '8934680010010',
    'MAM-NAMNGU-900': '8934563242205',
    'COCA-LOC-6': '8935049500544',
    'SUA-ONGTHO-DO': '8934673121020',
    'GIAT-OMO-36KG': '8934868128031',
    'GAO-ST25-5KG': '8938501230055',
    'BANH-CHOCOPIE': '8935001701011'
  };

  const updateBarcode = db.prepare('UPDATE products SET barcode = ? WHERE sku = ? AND (barcode IS NULL OR barcode = \'\')');
  for (const [sku, barcode] of Object.entries(defaultBarcodes)) {
    updateBarcode.run(barcode, sku);
  }

  // Khởi tạo Dữ liệu Thùng/Lô hàng mẫu (Product Batches) nếu bảng product_batches đang rỗng
  const batchCount = db.prepare('SELECT COUNT(*) as cnt FROM product_batches').get().cnt;
  if (batchCount === 0) {
    console.log('🔄 Đang khởi tạo các lô/thùng hàng mẫu với các hạn sử dụng khác nhau...');

    // Lấy danh sách sản phẩm hiện tại
    const products = db.prepare('SELECT * FROM products').all();
    const prodMap = {};
    products.forEach(p => { prodMap[p.sku] = p; });

    // Tính ngày tương đối
    const fmtDate = (daysFromNow) => {
      const d = new Date();
      d.setDate(d.getDate() + daysFromNow);
      return d.toISOString().split('T')[0];
    };

    // Định nghĩa các thùng hàng mẫu để giải quyết triệt để bài toán:
    // 1 sản phẩm có nhiều thùng với hạn sử dụng và ngày nhập khác nhau
    const sampleBatches = [
      // Mì Hảo Hảo: Có 3 thùng với các hạn dùng khác nhau
      { sku: 'TH-HAOHAO', batch_code: 'HH-THUNG-01', box_label: 'Thùng 01 (Kệ mì A1)', qty: 4, days_import: -15, days_exp: 10, location: 'Kệ mì A1' },   // Sắp hết hạn (10 ngày)
      { sku: 'TH-HAOHAO', batch_code: 'HH-THUNG-02', box_label: 'Thùng 02 (Kệ mì A1)', qty: 10, days_import: -5, days_exp: 65, location: 'Kệ mì A1' },   // Còn hạn 65 ngày
      { sku: 'TH-HAOHAO', batch_code: 'HH-THUNG-03', box_label: 'Thùng 03 (Kho sau)', qty: 20, days_import: 0, days_exp: 180, location: 'Kho sau nhà' }, // Mới nhập hôm nay

      // Bánh Chocopie: Có 1 thùng ĐÃ HẾT HẠN và 1 thùng CÒN HẠN
      { sku: 'BANH-CHOCOPIE', batch_code: 'CP-BOX-01', box_label: 'Thùng 01 (Kệ C2)', qty: 2, days_import: -40, days_exp: -2, location: 'Kệ bánh kẹo C2' }, // ĐÃ HẾT HẠN 2 ngày!
      { sku: 'BANH-CHOCOPIE', batch_code: 'CP-BOX-02', box_label: 'Thùng 02 (Kệ C2)', qty: 10, days_import: -2, days_exp: 90, location: 'Kệ bánh kẹo C2' },  // Còn hạn 90 ngày

      // Bia Tiger lon:
      { sku: 'TH-TIGER-LON', batch_code: 'TIG-BOX-01', box_label: 'Thùng 01 (Kho bia)', qty: 3, days_import: 0, days_exp: 150, location: 'Kho bia sau nhà' },

      // Dầu ăn Tường An: 2 thùng khác ngày nhập và hạn sử dụng
      { sku: 'DAU-TUONGAN-1L', batch_code: 'DA-LOT-01', box_label: 'Thùng A (Kệ B2)', qty: 12, days_import: -10, days_exp: 120, location: 'Kệ gia vị B2' },
      { sku: 'DAU-TUONGAN-1L', batch_code: 'DA-LOT-02', box_label: 'Thùng B (Kho)', qty: 12, days_import: 0, days_exp: 240, location: 'Kệ gia vị B2' },

      // Nước mắm Nam Ngư: 1 thùng cận hạn (18 ngày), 1 thùng date xa
      { sku: 'MAM-NAMNGU-900', batch_code: 'NN-THUNG-01', box_label: 'Thùng 01 (Quầy trước)', qty: 10, days_import: -20, days_exp: 18, location: 'Kệ gia vị B1' }, // Cận date 18 ngày
      { sku: 'MAM-NAMNGU-900', batch_code: 'NN-THUNG-02', box_label: 'Thùng 02 (Kho)', qty: 20, days_import: -1, days_exp: 300, location: 'Kệ gia vị B1' },

      // Coca-Cola:
      { sku: 'COCA-LOC-6', batch_code: 'COCA-01', box_label: 'Lốc Tủ mát', qty: 8, days_import: -3, days_exp: 35, location: 'Tủ mát trước tiệm' }, // Sắp hết hạn 35 ngày
      { sku: 'COCA-LOC-6', batch_code: 'COCA-02', box_label: 'Thùng kho dự trữ', qty: 10, days_import: 0, days_exp: 120, location: 'Tủ mát trước tiệm' },

      // Sữa Ông Thọ:
      { sku: 'SUA-ONGTHO-DO', batch_code: 'OT-THUNG-01', box_label: 'Thùng Kệ C1', qty: 20, days_import: -4, days_exp: 210, location: 'Kệ sữa C1' },
      { sku: 'SUA-ONGTHO-DO', batch_code: 'OT-THUNG-02', box_label: 'Thùng Kho', qty: 20, days_import: 0, days_exp: 210, location: 'Kệ sữa C1' },

      // Nước giặt OMO:
      { sku: 'GIAT-OMO-36KG', batch_code: 'OMO-LOT-01', box_label: 'Lô D1', qty: 12, days_import: 0, days_exp: 365, location: 'Kệ hóa mỹ phẩm D1' },

      // Gạo ST25:
      { sku: 'GAO-ST25-5KG', batch_code: 'GAO-BAO-01', box_label: 'Lô Bao Gạo', qty: 15, days_import: -6, days_exp: 180, location: 'Khu vực bao gạo' },

      // Nước LaVie:
      { sku: 'NUOC-LAVIE-500', batch_code: 'LAVIE-01', box_label: 'Thùng Tủ mát', qty: 2, days_import: 0, days_exp: 200, location: 'Tủ mát trước tiệm' }
    ];

    const insertBatch = db.prepare(`
      INSERT INTO product_batches (product_id, batch_code, box_label, location, quantity, initial_quantity, unit_cost, import_date, expiry_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateInvTotal = db.prepare(`
      UPDATE inventory 
      SET quantity = ?, expiry_date = ?, location = ?, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = ?
    `);

    const insertBatchTx = db.transaction(() => {
      for (const b of sampleBatches) {
        const prod = prodMap[b.sku];
        if (!prod) continue;

        const importDate = fmtDate(b.days_import);
        const expDate = fmtDate(b.days_exp);
        const status = b.days_exp <= 0 ? 'EXPIRED' : 'ACTIVE';

        insertBatch.run(
          prod.id,
          b.batch_code,
          b.box_label,
          b.location,
          b.qty,
          b.qty,
          prod.cost_price,
          importDate,
          expDate,
          status
        );
      }

      // Đồng bộ lại tổng tồn kho và hạn dùng gần nhất (FEFO) trong bảng inventory
      for (const prod of products) {
        const batches = db.prepare(`
          SELECT quantity, expiry_date, location
          FROM product_batches 
          WHERE product_id = ? AND quantity > 0
          ORDER BY (CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END), expiry_date ASC
        `).all(prod.id);

        if (batches.length > 0) {
          const totalQty = batches.reduce((sum, item) => sum + item.quantity, 0);
          const earliestExp = batches[0].expiry_date;
          const loc = batches[0].location;
          updateInvTotal.run(totalQty, earliestExp, loc, prod.id);
        }
      }
    });

    insertBatchTx();
    console.log('✅ Đã tạo các thùng hàng mẫu thành công với đầy đủ hạn sử dụng và phân loại!');
  }
}

/**
 * Trừ tồn kho tự động theo quy tắc FEFO (First Expired, First Out)
 * Khi khách mua hàng / thanh toán, hệ thống sẽ tự động trừ vào thùng có hạn sử dụng gần nhất trước!
 */
function deductStockFEFO(productId, quantityToDeduct, referenceCode, reason = 'Bán lẻ', note = '') {
  if (quantityToDeduct <= 0) return { deducted: 0, batchesUsed: [] };

  // Lấy các thùng hàng đang có tồn > 0, sắp xếp theo hạn sử dụng tăng dần (thùng hết hạn trước trừ trước)
  const batches = db.prepare(`
    SELECT * FROM product_batches 
    WHERE product_id = ? AND quantity > 0
    ORDER BY 
      (CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END) ASC,
      expiry_date ASC,
      import_date ASC,
      id ASC
  `).all(productId);

  let remainingToDeduct = quantityToDeduct;
  const batchesUsed = [];

  const updateBatch = db.prepare(`
    UPDATE product_batches 
    SET quantity = ?, status = CASE WHEN ? = 0 THEN 'DEPLETED' ELSE status END
    WHERE id = ?
  `);

  for (const b of batches) {
    if (remainingToDeduct <= 0) break;

    const deductFromThisBatch = Math.min(b.quantity, remainingToDeduct);
    const newBatchQty = b.quantity - deductFromThisBatch;

    updateBatch.run(newBatchQty, newBatchQty, b.id);
    remainingToDeduct -= deductFromThisBatch;

    batchesUsed.push({
      batch_id: b.id,
      batch_code: b.batch_code,
      box_label: b.box_label,
      expiry_date: b.expiry_date,
      deducted_qty: deductFromThisBatch,
      remaining_in_batch: newBatchQty
    });
  }

  // Cập nhật lại tồn tổng và hạn dùng sớm nhất còn lại trong bảng inventory
  const remainingBatches = db.prepare(`
    SELECT quantity, expiry_date FROM product_batches 
    WHERE product_id = ? AND quantity > 0
    ORDER BY (CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END), expiry_date ASC
  `).all(productId);

  const newTotalStock = remainingBatches.reduce((acc, cur) => acc + cur.quantity, 0);
  const nextEarliestExp = remainingBatches.length > 0 ? remainingBatches[0].expiry_date : null;

  db.prepare(`
    UPDATE inventory 
    SET quantity = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE product_id = ?
  `).run(newTotalStock, nextEarliestExp, productId);

  // Ghi nhận lịch sử giao dịch kho
  const batchNoteStr = batchesUsed.map(b => `${b.batch_code} (-${b.deducted_qty})`).join(', ');
  const fullNote = `${reason}: Trừ kho thùng [${batchNoteStr}] ${note ? `• ${note}` : ''}`;

  db.prepare(`
    INSERT INTO stock_transactions (product_id, transaction_type, reference_code, quantity_change, balance_after, note)
    VALUES (?, 'STOCK_OUT', ?, ?, ?, ?)
  `).run(productId, referenceCode, -quantityToDeduct, newTotalStock, fullNote);

  return {
    deducted: quantityToDeduct - remainingToDeduct,
    newTotalStock,
    batchesUsed
  };
}

module.exports = {
  db,
  initDatabase,
  deductStockFEFO
};
