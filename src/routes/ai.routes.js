const express = require('express');
const router = express.Router();
const { db } = require('../../database');

// GET /api/ai/analyze - Phân tích kho thông minh đa phương pháp (ABC Analysis, FEFO, 5S & Sắp xếp chống ám mùi)
router.get('/analyze', (req, res) => {
  try {
    // 1. Phân tích thiếu tồn (Low Stock)
    const lowStockItems = db.prepare(`
      SELECT p.id, p.sku, p.name, p.unit, p.min_stock, p.abc_class, COALESCE(i.quantity, 0) as current_stock,
             (p.min_stock - COALESCE(i.quantity, 0)) as deficit, COALESCE(i.zone, 'Kệ trung tâm') as zone
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE COALESCE(i.quantity, 0) <= p.min_stock
      ORDER BY p.abc_class ASC, deficit DESC
    `).all();

    // 2. Phân tích cận date (FEFO - First Expired First Out)
    const expiringSoonItems = db.prepare(`
      SELECT p.id, p.sku, p.name, p.unit, i.quantity as current_stock, i.expiry_date,
             ROUND(JULIANDAY(i.expiry_date) - JULIANDAY('now')) as days_left, COALESCE(i.zone, 'Kệ trung tâm') as zone
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.expiry_date IS NOT NULL AND (JULIANDAY(i.expiry_date) - JULIANDAY('now')) <= 45
      ORDER BY days_left ASC
    `).all();

    // 3. Phân loại ABC thống kê
    const abcStats = db.prepare(`
      SELECT 
        COALESCE(p.abc_class, 'B') as abc_class,
        COUNT(p.id) as item_count,
        COALESCE(SUM(i.quantity * p.cost_price), 0) as total_val
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      GROUP BY p.abc_class
    `).all();

    // 4. Kiểm tra quy tắc sắp xếp chống ám mùi (Cross-contamination prevention)
    const chemicalInFoodZones = db.prepare(`
      SELECT p.name, i.zone
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE p.category = 'Hóa mỹ phẩm' AND (i.zone LIKE '%thực phẩm%' OR i.zone LIKE '%bánh kẹo%' OR i.zone LIKE '%gia vị%')
    `).all();

    // 5. Tổng hợp thông điệp AI thông minh
    const totalProdCount = db.prepare('SELECT COUNT(*) as cnt FROM products').get().cnt || 1;
    const lowCount = lowStockItems.length;
    const expiryCount = expiringSoonItems.length;

    // Tính điểm sức khỏe kho (100 điểm chuẩn)
    let healthScore = 100 - (lowCount * 7) - (expiryCount * 8) - (chemicalInFoodZones.length * 10);
    healthScore = Math.max(25, Math.min(100, healthScore));

    // Lời khuyên & Khuyến nghị chắt lọc cho tiệm tạp hóa
    const recommendations = [];

    // Gợi ý FEFO
    if (expiringSoonItems.length > 0) {
      const firstExp = expiringSoonItems[0];
      recommendations.push({
        type: 'FEFO_EXPIRY',
        badge: 'CẬN DATE (FEFO)',
        color: 'rose',
        text: `Phát hiện "${firstExp.name}" chỉ còn ${firstExp.days_left} ngày hết hạn (Tồn: ${firstExp.current_stock} ${firstExp.unit}). Đề xuất: Đưa ra mặt tiền quầy thu ngân hoặc bán combo để giải phóng trước khi quá hạn!`
      });
    }

    // Gợi ý ABC Analysis
    const classA_Low = lowStockItems.filter(item => item.abc_class === 'A');
    if (classA_Low.length > 0) {
      const topA = classA_Low[0];
      recommendations.push({
        type: 'ABC_PRIORITY',
        badge: 'HÀNG CHỦ LỰC (NHÓM A)',
        color: 'amber',
        text: `Mặt hàng Nhóm A "${topA.name}" đang thiếu ${topA.deficit} ${topA.unit}. Đây là hàng quay vòng nhanh thiết yếu của tiệm, cần ưu tiên lập phiếu nhập gấp để không mất khách.`
      });
    } else if (lowStockItems.length > 0) {
      const topLow = lowStockItems[0];
      recommendations.push({
        type: 'LOW_STOCK',
        badge: 'BỔ SUNG TỒN KHO',
        color: 'sky',
        text: `Có ${lowCount} mặt hàng đang chạm đáy cảnh báo (như ${topLow.name}). Cần nhập thêm để duy trì định mức an toàn.`
      });
    }

    // Gợi ý sắp xếp 5S & Vị trí kệ
    if (chemicalInFoodZones.length > 0) {
      recommendations.push({
        type: 'LAYOUT_5S',
        badge: 'QUY TẮC CHỐNG ÁM MÙI',
        color: 'violet',
        text: `Cảnh báo sắp xếp: Mặt hàng "${chemicalInFoodZones[0].name}" đang để chung khu vực thực phẩm. Hãy chuyển ngay sang Kệ Hóa Mỹ Phẩm cách ly để tránh ám mùi xà phòng vào bánh kẹo/mì gói!`
      });
    } else {
      recommendations.push({
        type: 'LAYOUT_5S',
        badge: 'SẮP XẾP KHO 5S',
        color: 'emerald',
        text: `Nguyên tắc sắp xếp kệ tiệm tạp hóa: Tầng 1 (Sàn kho) xếp hàng nặng (bao gạo, két bia, thùng nước); Tầng 2 (Ngang tầm mắt 0.9m - 1.5m) trưng bày hàng Nhóm A bán chạy; Tầng 3 (Tầng cao) để hàng nhẹ và dự trữ.`
      });
    }

    // Câu tóm tắt cốt lõi
    let mainMessage = '';
    if (lowCount > 0 && expiryCount > 0) {
      mainMessage = `Có ${lowCount} mặt hàng đang ở mức tồn kho thấp và ${expiryCount} sản phẩm cận date cần ưu tiên xuất trước (nguyên tắc FEFO). Đề xuất kiểm tra ngay danh mục Nhóm A và quầy bánh kẹo/sữa.`;
    } else if (lowCount > 0) {
      mainMessage = `Có ${lowCount} sản phẩm đang ở mức tồn kho thấp. Đề xuất ưu tiên nhập bổ sung các mặt hàng thiết yếu Nhóm A để đáp ứng nhu cầu khách mua.`;
    } else if (expiryCount > 0) {
      mainMessage = `Kho hàng có ${expiryCount} mặt hàng cận date trong 45 ngày tới. Hãy đảo vị trí xếp ra phía trước để bán trước tránh hỏng hàng.`;
    } else {
      mainMessage = `Kho hàng hiện ở trạng thái rất tốt (Điểm sức khỏe: ${healthScore}/100). Tất cả mặt hàng đều trong ngưỡng an toàn và vị trí sắp xếp chuẩn 5S.`;
    }

    res.json({
      success: true,
      data: {
        ai_message: mainMessage,
        health_score: healthScore,
        low_stock_count: lowCount,
        expiring_count: expiryCount,
        critical_items: lowStockItems.slice(0, 5),
        expiring_items: expiringSoonItems.slice(0, 5),
        abc_breakdown: abcStats,
        recommendations: recommendations,
        analyzed_at: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
