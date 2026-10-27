// VIMIS Database Layer - Universal SQLite via sql-wasm-inline (WebAssembly)
// Compatible with both Local Node.js and Vercel Serverless Functions without external .wasm file dependency
const initSqlJs = require('sql.js/dist/sql-wasm-inline.js');
const fs = require('fs');
const path = require('path');

// Determine database file path:
// On Vercel (or read-only lambda environments), use /tmp/vimis.db if available, else local path
const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
const localDbPath = path.join(__dirname, 'vimis.db');
const tempDbPath = path.join('/tmp', 'vimis.db');
const activeDbPath = isVercel ? tempDbPath : localDbPath;

let sqlEngine = null;
let rawDb = null;

function getSqlInstance() {
  if (!rawDb) {
    throw new Error('Database not initialized! Call initDatabase() first.');
  }
  return rawDb;
}

function saveDbToFile() {
  try {
    if (!rawDb) return;
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(activeDbPath, buffer);
  } catch (err) {
    console.warn('Warning: Could not persist database to disk:', err.message);
  }
}

// Wrapper to mimic better-sqlite3 synchronous API over sql.js
class StatementWrapper {
  constructor(sql) {
    this.sql = sql;
  }

  get(...params) {
    const db = getSqlInstance();
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    let stmt;
    try {
      stmt = db.prepare(this.sql);
      if (flatParams && flatParams.length > 0) {
        stmt.bind(flatParams);
      }
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      if (stmt) {
        try { stmt.free(); } catch (_) {}
      }
      throw e;
    }
  }

  all(...params) {
    const db = getSqlInstance();
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const rows = [];
    let stmt;
    try {
      stmt = db.prepare(this.sql);
      if (flatParams && flatParams.length > 0) {
        stmt.bind(flatParams);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (e) {
      if (stmt) {
        try { stmt.free(); } catch (_) {}
      }
      throw e;
    }
  }

  run(...params) {
    const db = getSqlInstance();
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    let stmt;
    try {
      stmt = db.prepare(this.sql);
      if (flatParams && flatParams.length > 0) {
        stmt.bind(flatParams);
      }
      stmt.step();
      stmt.free();

      const lastIdRes = db.exec('SELECT last_insert_rowid() as id, changes() as chg');
      let lastInsertRowid = 0;
      let changes = 1;
      if (lastIdRes && lastIdRes.length > 0 && lastIdRes[0].values.length > 0) {
        lastInsertRowid = lastIdRes[0].values[0][0];
        changes = lastIdRes[0].values[0][1];
      }

      saveDbToFile();
      return { lastInsertRowid, changes };
    } catch (e) {
      if (stmt) {
        try { stmt.free(); } catch (_) {}
      }
      throw e;
    }
  }
}

const db = {
  prepare(sql) {
    return new StatementWrapper(sql);
  },

  exec(sql) {
    const raw = getSqlInstance();
    raw.run(sql);
    saveDbToFile();
  },

  pragma(pragmaStr) {
    try {
      const raw = getSqlInstance();
      raw.run(`PRAGMA ${pragmaStr}`);
    } catch (e) {
      // Ignore unsupported pragmas in in-memory SQLite
    }
  },

  transaction(fn) {
    return (...args) => {
      const raw = getSqlInstance();
      raw.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        raw.run('COMMIT');
        saveDbToFile();
        return result;
      } catch (err) {
        try { raw.run('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
  }
};

let initPromise = null;

async function initDatabase() {
  if (rawDb) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    sqlEngine = await initSqlJs();

    let initialBuffer = null;
    if (fs.existsSync(activeDbPath)) {
      try {
        initialBuffer = fs.readFileSync(activeDbPath);
      } catch (_) {}
    } else if (isVercel && fs.existsSync(localDbPath)) {
      try {
        initialBuffer = fs.readFileSync(localDbPath);
      } catch (_) {}
    }

    if (initialBuffer && initialBuffer.length > 0) {
      try {
        rawDb = new sqlEngine.Database(initialBuffer);
      } catch (e) {
        console.warn('Could not load existing SQLite file, creating fresh DB:', e.message);
        rawDb = new sqlEngine.Database();
      }
    } else {
      rawDb = new sqlEngine.Database();
    }

    // 1. Users
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Products
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE NOT NULL,
        barcode TEXT,
        rfid_tag TEXT,
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

    try { db.exec('ALTER TABLE products ADD COLUMN rfid_tag TEXT;'); } catch (_) {}
    try { db.exec('ALTER TABLE products ADD COLUMN barcode TEXT;'); } catch (_) {}
    try { db.exec("ALTER TABLE products ADD COLUMN abc_class TEXT DEFAULT 'B';"); } catch (_) {}
    try { db.exec('ALTER TABLE products ADD COLUMN max_stock INTEGER DEFAULT 50;'); } catch (_) {}

    // 3. Inventory
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

    try { db.exec("ALTER TABLE inventory ADD COLUMN zone TEXT DEFAULT 'Kệ trung tâm';"); } catch (_) {}
    try { db.exec("ALTER TABLE inventory ADD COLUMN shelf_level TEXT DEFAULT 'Tầng 2 (Tầm mắt)';"); } catch (_) {}
    try { db.exec('ALTER TABLE inventory ADD COLUMN expiry_date DATE;'); } catch (_) {}
    try { db.exec('ALTER TABLE inventory ADD COLUMN last_checked_at DATETIME;'); } catch (_) {}

    // 4. Product Batches
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        batch_code TEXT NOT NULL,
        box_label TEXT,
        rfid_tag TEXT,
        warehouse_name TEXT DEFAULT 'Kho Tiệm Tạp Hóa',
        location TEXT DEFAULT 'Kệ trưng bày',
        quantity INTEGER NOT NULL DEFAULT 0,
        initial_quantity INTEGER NOT NULL DEFAULT 0,
        unit_cost REAL DEFAULT 0,
        import_date DATE DEFAULT (DATE('now')),
        expiry_date DATE,
        status TEXT DEFAULT 'ACTIVE',
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try { db.exec('ALTER TABLE product_batches ADD COLUMN rfid_tag TEXT;'); } catch (_) {}

    // 5. Stock In Receipts
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

    // 6. Stock Out Receipts
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_out_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_code TEXT UNIQUE NOT NULL,
        customer_name TEXT DEFAULT 'Khách lẻ',
        reason TEXT DEFAULT 'Bán lẻ tại tiệm',
        payment_method TEXT DEFAULT 'CASH',
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

    // 7. Stock Transactions
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        batch_id INTEGER REFERENCES product_batches(id),
        transaction_type TEXT NOT NULL,
        reference_code TEXT,
        quantity_change INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. RFID Scan Logs
    db.exec(`
      CREATE TABLE IF NOT EXISTS rfid_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rfid_tag TEXT NOT NULL,
        scan_type TEXT NOT NULL,
        product_id INTEGER REFERENCES products(id),
        batch_id INTEGER REFERENCES product_batches(id),
        quantity INTEGER DEFAULT 1,
        location TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure default demo users always exist (admin, thungan, kiemkho)
    const requiredUsers = [
      { username: 'admin', password: 'admin123', full_name: 'Nguyễn Văn Chủ Tiệm', role: 'admin', phone: '0909123456' },
      { username: 'thungan', password: '123456', full_name: 'Trần Thị Thu Ngân (Thu ngân POS)', role: 'cashier', phone: '0912987654' },
      { username: 'kiemkho', password: '123456', full_name: 'Lê Văn Kiểm Kho (Nhập hàng)', role: 'warehouse', phone: '0988776655' }
    ];

    const checkUserStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
    const insertUserStmt = db.prepare(`
      INSERT INTO users (username, password, full_name, role, phone)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const u of requiredUsers) {
      const exists = checkUserStmt.get(u.username);
      if (!exists) {
        insertUserStmt.run(u.username, u.password, u.full_name, u.role, u.phone);
      }
    }

    // Seed initial products if empty
    const prodCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get()?.cnt || 0;
    if (prodCount === 0) {
      const defaultProducts = [
        { sku: 'TH-HAOHAO', barcode: '8934563138164', rfid: 'E28011606000020420000001', name: 'Mì gói Hảo Hảo Tôm Chua Cay', cat: 'Thực phẩm khô', unit: 'Gói', cost: 3800, price: 4500, min: 20, max: 200, abc: 'A', loc: 'Kệ mì A1', zone: 'Kệ trung tâm', level: 'Tầng 1 (Dễ lấy)' },
        { sku: 'TH-TIGER-LON', barcode: '8934822212330', rfid: 'E28011606000020420000002', name: 'Bia Tiger Crystal lon 330ml', cat: 'Bia & Nước ngọt', unit: 'Lon', cost: 16000, price: 18500, min: 24, max: 240, abc: 'A', loc: 'Kho bia sau nhà', zone: 'Khu đồ uống', level: 'Tầng 1 (Dễ lấy)' },
        { sku: 'NUOC-LAVIE-500', barcode: '8934588012111', rfid: 'E28011606000020420000003', name: 'Nước khoáng thiên nhiên LaVie 500ml', cat: 'Bia & Nước ngọt', unit: 'Chai', cost: 4500, price: 6000, min: 24, max: 120, abc: 'B', loc: 'Tủ mát trước tiệm', zone: 'Tủ mát', level: 'Tầng 2 (Tầm mắt)' },
        { sku: 'DAU-TUONGAN-1L', barcode: '8934680010010', rfid: 'E28011606000020420000004', name: 'Dầu ăn Tường An Cooking Oil 1 Lít', cat: 'Gia vị & Dầu ăn', unit: 'Chai', cost: 42000, price: 49000, min: 10, max: 60, abc: 'B', loc: 'Kệ gia vị B2', zone: 'Kệ gia vị', level: 'Tầng 2 (Tầm mắt)' },
        { sku: 'MAM-NAMNGU-900', barcode: '8934563242205', rfid: 'E28011606000020420000005', name: 'Nước mắm Nam Ngư Đệ Nhị 900ml', cat: 'Gia vị & Dầu ăn', unit: 'Chai', cost: 28000, price: 34000, min: 10, max: 50, abc: 'B', loc: 'Kệ gia vị B1', zone: 'Kệ gia vị', level: 'Tầng 2 (Tầm mắt)' },
        { sku: 'COCA-LOC-6', barcode: '8935049500544', rfid: 'E28011606000020420000006', name: 'Lốc 6 lon Coca-Cola Sleek 320ml', cat: 'Bia & Nước ngọt', unit: 'Lốc', cost: 52000, price: 60000, min: 5, max: 30, abc: 'B', loc: 'Tủ mát trước tiệm', zone: 'Tủ mát', level: 'Tầng 2 (Tầm mắt)' },
        { sku: 'SUA-ONGTHO-DO', barcode: '8934673121020', rfid: 'E28011606000020420000007', name: 'Sữa đặc có đường Ông Thọ Đỏ lon 380g', cat: 'Bánh kẹo & Sữa', unit: 'Lon', cost: 23000, price: 27000, min: 12, max: 60, abc: 'B', loc: 'Kệ sữa C1', zone: 'Kệ trung tâm', level: 'Tầng 2 (Tầm mắt)' },
        { sku: 'GIAT-OMO-36KG', barcode: '8934868128031', rfid: 'E28011606000020420000008', name: 'Bột giặt OMO Đỏ Sạch Nhanh 3.6kg', cat: 'Hóa mỹ phẩm', unit: 'Bao', cost: 145000, price: 168000, min: 4, max: 20, abc: 'C', loc: 'Kệ hóa mỹ phẩm D1', zone: 'Kệ cuối', level: 'Tầng 1 (Dễ lấy)' },
        { sku: 'GAO-ST25-5KG', barcode: '8938501230055', rfid: 'E28011606000020420000009', name: 'Gạo ST25 Thượng Hạng túi 5kg', cat: 'Thực phẩm khô', unit: 'Bao', cost: 160000, price: 195000, min: 5, max: 30, abc: 'A', loc: 'Khu vực bao gạo', zone: 'Khu vực bao gạo', level: 'Tầng 1 (Dễ lấy)' },
        { sku: 'BANH-CHOCOPIE', barcode: '8935001701011', rfid: 'E28011606000020420000010', name: 'Bánh Chocopie Orion hộp 12 cái', cat: 'Bánh kẹo & Sữa', unit: 'Hộp', cost: 48000, price: 58000, min: 6, max: 40, abc: 'B', loc: 'Kệ bánh kẹo C2', zone: 'Kệ trung tâm', level: 'Tầng 3 (Dưới cùng)' }
      ];

      for (const p of defaultProducts) {
        const prodRes = db.prepare(`
          INSERT INTO products (sku, barcode, rfid_tag, name, category, unit, cost_price, sale_price, min_stock, max_stock, abc_class)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(p.sku, p.barcode, p.rfid, p.name, p.cat, p.unit, p.cost, p.price, p.min, p.max, p.abc);

        db.prepare(`
          INSERT INTO inventory (product_id, warehouse_name, location, zone, shelf_level, quantity, expiry_date)
          VALUES (?, 'Kho Tiệm Tạp Hóa', ?, ?, ?, 0, NULL)
        `).run(prodRes.lastInsertRowid, p.loc, p.zone, p.level);
      }
    }

    // Seed batches if empty
    const batchCount = db.prepare('SELECT COUNT(*) as cnt FROM product_batches').get()?.cnt || 0;
    if (batchCount === 0) {
      const products = db.prepare('SELECT * FROM products').all();
      const prodMap = {};
      products.forEach(p => { prodMap[p.sku] = p; });

      const fmtDate = (daysFromNow) => {
        const d = new Date();
        d.setDate(d.getDate() + daysFromNow);
        return d.toISOString().split('T')[0];
      };

      const sampleBatches = [
        { sku: 'TH-HAOHAO', batch_code: 'HH-THUNG-01', box_label: 'Thùng 01 (Kệ mì A1)', rfid: 'RFID-HH-01', qty: 30, days_import: -15, days_exp: 10, loc: 'Kệ mì A1' },
        { sku: 'TH-HAOHAO', batch_code: 'HH-THUNG-02', box_label: 'Thùng 02 (Kệ mì A1)', rfid: 'RFID-HH-02', qty: 50, days_import: -5, days_exp: 65, loc: 'Kệ mì A1' },
        { sku: 'TH-HAOHAO', batch_code: 'HH-THUNG-03', box_label: 'Thùng 03 (Kho sau)', rfid: 'RFID-HH-03', qty: 60, days_import: 0, days_exp: 180, loc: 'Kho sau nhà' },
        { sku: 'BANH-CHOCOPIE', batch_code: 'CP-BOX-01', box_label: 'Thùng 01 (Kệ C2)', rfid: 'RFID-CP-01', qty: 4, days_import: -40, days_exp: -2, loc: 'Kệ bánh kẹo C2' },
        { sku: 'BANH-CHOCOPIE', batch_code: 'CP-BOX-02', box_label: 'Thùng 02 (Kệ C2)', rfid: 'RFID-CP-02', qty: 15, days_import: -2, days_exp: 90, loc: 'Kệ bánh kẹo C2' },
        { sku: 'TH-TIGER-LON', batch_code: 'TIG-BOX-01', box_label: 'Thùng 01 (Kho bia)', rfid: 'RFID-TIG-01', qty: 48, days_import: 0, days_exp: 150, loc: 'Kho bia sau nhà' },
        { sku: 'DAU-TUONGAN-1L', batch_code: 'DA-LOT-01', box_label: 'Thùng A (Kệ B2)', rfid: 'RFID-DA-01', qty: 12, days_import: -10, days_exp: 120, loc: 'Kệ gia vị B2' },
        { sku: 'DAU-TUONGAN-1L', batch_code: 'DA-LOT-02', box_label: 'Thùng B (Kho)', rfid: 'RFID-DA-02', qty: 12, days_import: 0, days_exp: 240, loc: 'Kệ gia vị B2' },
        { sku: 'MAM-NAMNGU-900', batch_code: 'NN-THUNG-01', box_label: 'Thùng 01 (Quầy trước)', rfid: 'RFID-NN-01', qty: 10, days_import: -20, days_exp: 18, loc: 'Kệ gia vị B1' },
        { sku: 'MAM-NAMNGU-900', batch_code: 'NN-THUNG-02', box_label: 'Thùng 02 (Kho)', rfid: 'RFID-NN-02', qty: 20, days_import: -1, days_exp: 300, loc: 'Kệ gia vị B1' },
        { sku: 'COCA-LOC-6', batch_code: 'COCA-01', box_label: 'Lốc Tủ mát', rfid: 'RFID-COCA-01', qty: 8, days_import: -3, days_exp: 35, loc: 'Tủ mát trước tiệm' },
        { sku: 'SUA-ONGTHO-DO', batch_code: 'OT-THUNG-01', box_label: 'Thùng Kệ C1', rfid: 'RFID-OT-01', qty: 24, days_import: -4, days_exp: 210, loc: 'Kệ sữa C1' },
        { sku: 'GIAT-OMO-36KG', batch_code: 'OMO-LOT-01', box_label: 'Lô D1', rfid: 'RFID-OMO-01', qty: 12, days_import: 0, days_exp: 365, loc: 'Kệ hóa mỹ phẩm D1' },
        { sku: 'GAO-ST25-5KG', batch_code: 'GAO-BAO-01', box_label: 'Lô Bao Gạo', rfid: 'RFID-GAO-01', qty: 15, days_import: -6, days_exp: 180, loc: 'Khu vực bao gạo' },
        { sku: 'NUOC-LAVIE-500', batch_code: 'LAVIE-01', box_label: 'Thùng Tủ mát', rfid: 'RFID-LAVIE-01', qty: 24, days_import: 0, days_exp: 200, loc: 'Tủ mát trước tiệm' }
      ];

      for (const b of sampleBatches) {
        const prod = prodMap[b.sku];
        if (!prod) continue;
        const impDate = fmtDate(b.days_import);
        const expDate = fmtDate(b.days_exp);
        const st = b.days_exp <= 0 ? 'EXPIRED' : 'ACTIVE';

        db.prepare(`
          INSERT INTO product_batches (product_id, batch_code, box_label, rfid_tag, location, quantity, initial_quantity, unit_cost, import_date, expiry_date, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(prod.id, b.batch_code, b.box_label, b.rfid, b.loc, b.qty, b.qty, prod.cost_price, impDate, expDate, st);
      }

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
          db.prepare(`
            UPDATE inventory 
            SET quantity = ?, expiry_date = ?, location = ?, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ?
          `).run(totalQty, earliestExp, loc, prod.id);
        }
      }
    }

    // Auto-sync default RFID tags if not present
    const defaultRfidMap = {
      'TH-HAOHAO': 'E28011606000020420000001',
      'TH-TIGER-LON': 'E28011606000020420000002',
      'NUOC-LAVIE-500': 'E28011606000020420000003',
      'DAU-TUONGAN-1L': 'E28011606000020420000004',
      'MAM-NAMNGU-900': 'E28011606000020420000005',
      'COCA-LOC-6': 'E28011606000020420000006',
      'SUA-ONGTHO-DO': 'E28011606000020420000007',
      'GIAT-OMO-36KG': 'E28011606000020420000008',
      'GAO-ST25-5KG': 'E28011606000020420000009',
      'BANH-CHOCOPIE': 'E28011606000020420000010'
    };
    const updProdRfid = db.prepare('UPDATE products SET rfid_tag = ? WHERE sku = ? AND (rfid_tag IS NULL OR rfid_tag = \'\')');
    for (const [sku, rfid] of Object.entries(defaultRfidMap)) {
      updProdRfid.run(rfid, sku);
    }

    const batchRfidMap = {
      'HH-THUNG-01': 'RFID-HH-01',
      'HH-THUNG-02': 'RFID-HH-02',
      'HH-THUNG-03': 'RFID-HH-03',
      'CP-BOX-01': 'RFID-CP-01',
      'CP-BOX-02': 'RFID-CP-02',
      'TIG-BOX-01': 'RFID-TIG-01',
      'DA-LOT-01': 'RFID-DA-01',
      'DA-LOT-02': 'RFID-DA-02',
      'NN-THUNG-01': 'RFID-NN-01',
      'NN-THUNG-02': 'RFID-NN-02',
      'COCA-01': 'RFID-COCA-01',
      'OT-THUNG-01': 'RFID-OT-01',
      'OMO-LOT-01': 'RFID-OMO-01',
      'GAO-BAO-01': 'RFID-GAO-01',
      'LAVIE-01': 'RFID-LAVIE-01'
    };
    const updBatchRfid = db.prepare('UPDATE product_batches SET rfid_tag = ? WHERE batch_code = ? AND (rfid_tag IS NULL OR rfid_tag = \'\')');
    for (const [code, rfid] of Object.entries(batchRfidMap)) {
      updBatchRfid.run(rfid, code);
    }

    saveDbToFile();
    return db;
  })();

  return initPromise;
}

function deductStockFEFO(productId, quantityToDeduct, referenceCode, reason = 'Bán lẻ', note = '') {
  if (quantityToDeduct <= 0) return { deducted: 0, batchesUsed: [] };

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
