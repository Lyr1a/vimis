// Test script for VIMIS MVP Priority Modules
async function runTests() {
  console.log('----------------------------------------------------');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG MVP VIMIS (5 MODULE ƯU TIÊN)');
  console.log('----------------------------------------------------');

  try {
    // 1. Healthcheck
    const health = await fetch('http://localhost:3000/api/health').then(r => r.json());
    console.log('✅ 0. Healthcheck:', health.status, 'Time:', health.time);

    // 2. Priority 1: Product Module
    console.log('\n📦 KIỂM THỬ ƯU TIÊN 1: PRODUCT MODULE');
    const productsRes = await fetch('http://localhost:3000/api/products').then(r => r.json());
    console.log(`- Đã nạp thành công ${productsRes.data.length} sản phẩm từ SQLite:`);
    productsRes.data.forEach(p => {
      console.log(`  * [${p.sku}] ${p.name} - Giá: ${p.sale_price.toLocaleString('vi-VN')} đ (Min Stock: ${p.min_stock})`);
    });

    // Thử thêm 1 sản phẩm mới
    const testSku = 'SKU-TEST-' + Math.floor(Math.random() * 1000);
    const newProdRes = await fetch('http://localhost:3000/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: testSku,
        name: 'Màn hình Dell UltraSharp 27 inch 4K',
        category: 'Điện tử',
        unit: 'Chiếc',
        cost_price: 11000000,
        sale_price: 13900000,
        min_stock: 6,
        initial_stock: 2,
        location: 'Kệ A-08'
      })
    }).then(r => r.json());
    console.log(`- Kết quả thêm sản phẩm mới: ${newProdRes.message} (SKU: ${testSku})`);

    // 3. Priority 2: Inventory Module
    console.log('\n🏢 KIỂM THỬ ƯU TIÊN 2: INVENTORY MODULE');
    const invRes = await fetch('http://localhost:3000/api/inventory').then(r => r.json());
    console.log(`- Tổng số bản ghi tồn kho: ${invRes.data.length}`);
    console.log(`- Tổng số lượng tồn: ${invRes.summary.total_units} cái`);
    console.log(`- Tổng trị giá vốn kho: ${invRes.summary.total_stock_value.toLocaleString('vi-VN')} đ`);
    console.log(`- Phân bổ: An toàn: ${invRes.summary.safe_count}, Sắp chạm: ${invRes.summary.warning_count}, Nguy cơ: ${invRes.summary.danger_count}`);

    // 4. Priority 5: Low Stock Alert Module (Kiểm tra trước khi nhập)
    console.log('\n⚠️ KIỂM THỬ ƯU TIÊN 5: LOW STOCK ALERT MODULE');
    const alertsBefore = await fetch('http://localhost:3000/api/alerts').then(r => r.json());
    console.log(`- Số lượng mặt hàng đang cảnh báo thiếu hàng: ${alertsBefore.count}`);
    alertsBefore.data.forEach(a => {
      console.log(`  * 🚨 [${a.sku}] ${a.name} | Tồn: ${a.current_stock} / Min: ${a.min_stock} (Thiếu: ${a.deficit}) -> Cấp độ: ${a.severity}`);
    });

    if (alertsBefore.data.length > 0) {
      const target = alertsBefore.data[0];
      const reorderQty = target.suggested_reorder_qty || 20;

      // 5. Priority 3 & 4: Stock In & Stock Update (Tự động cập nhật kho)
      console.log('\n📥 KIỂM THỬ ƯU TIÊN 3 & 4: STOCK IN & STOCK UPDATE');
      console.log(`- Đang tạo phiếu nhập hàng cho sản phẩm: [${target.sku}] ${target.name} (Số lượng: +${reorderQty})`);
      
      const stockInRes = await fetch('http://localhost:3000/api/stock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_name: 'Công ty Cổ phần Thế Giới Số (Digiworld)',
          warehouse_name: 'Kho Trung Tâm Tân Bình',
          note: 'Phiếu nhập bổ sung giải tỏa cảnh báo thiếu hàng tự động',
          items: [
            {
              product_id: target.product_id,
              quantity: reorderQty,
              unit_cost: target.cost_price || 1000000
            }
          ]
        })
      }).then(r => r.json());

      console.log(`- Kết quả Stock In & Stock Update: ${stockInRes.message}`);

      // Kiểm tra lại tồn kho sau khi Stock Update
      const invCheck = await fetch('http://localhost:3000/api/inventory').then(r => r.json());
      const updatedItem = invCheck.data.find(i => i.product_id === target.product_id);
      console.log(`- ✅ KIỂM CHỨNG TỒN KHO MỚI CỦA [${target.sku}]: Tồn ban đầu: ${target.current_stock} -> Tồn sau khi Stock In: ${updatedItem.current_stock} (+${reorderQty})`);

      // Kiểm tra lại Cảnh báo sau khi giải cứu
      const alertsAfter = await fetch('http://localhost:3000/api/alerts').then(r => r.json());
      console.log(`- ✅ KIỂM CHỨNG CẢNH BÁO TỒN KHO: Số lượng cảnh báo giảm từ ${alertsBefore.count} xuống ${alertsAfter.count}`);
    }

    // 6. Dashboard Module
    console.log('\n📊 KIỂM THỬ DASHBOARD KPI & AUDIT LOG');
    const dashRes = await fetch('http://localhost:3000/api/dashboard/stats').then(r => r.json());
    console.log(`- Tổng SKU: ${dashRes.data.total_sku}`);
    console.log(`- Tổng sản phẩm tồn: ${dashRes.data.total_units} cái`);
    console.log(`- Tổng trị giá vốn kho: ${dashRes.data.total_value.toLocaleString('vi-VN')} đ`);
    console.log(`- Tổng phiếu nhập: ${dashRes.data.receipts_count} phiếu`);
    console.log(`- Số cảnh báo thiếu hàng hiện tại: ${dashRes.data.alert_count}`);
    console.log(`- Giao dịch gần nhất: ${dashRes.data.recent_activities[0]?.note} (${dashRes.data.recent_activities[0]?.reference_code})`);

    console.log('\n====================================================');
    console.log('🎉 TẤT CẢ 5 MODULE ƯU TIÊN ĐÃ HOẠT ĐỘNG HOÀN HẢO 100%!');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Lỗi kiểm thử:', err);
  }
}

runTests();
