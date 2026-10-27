// ==============================================================================
// VIMIS GROCERY STORE MANAGEMENT - CLIENT APP SCRIPT (Apple Minimalist Edition)
// Features: Multi-box/Batch management, FEFO, POS Scanner Auto-Deduct, Time Filters
// ==============================================================================

// App Global State
let currentUser = null;

let cachedProducts = [];
let cachedInventory = [];
let cachedAlerts = { lowStock: [], expiring: [] };
let dashboardData = null;
let aiAnalysisData = null;

// POS State
let posCart = [];
let posPaymentMethod = 'CASH';
let posSelectedCategory = 'ALL';

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  // KHÔNG đăng nhập sẵn: Chỉ khôi phục nếu người dùng đã đăng nhập hợp lệ trước đó
  const savedUser = localStorage.getItem('vimis_user');
  if (savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && parsed.username && parsed.role) {
        currentUser = parsed;
        showAppLayout();
        return;
      }
    } catch (e) {
      localStorage.removeItem('vimis_user');
    }
  }

  // Mặc định: Hiển thị màn hình đăng nhập yêu cầu người dùng đăng nhập
  currentUser = null;
  showLoginScreen();

  // Keyboard shortcut: F2 or F9 for POS
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      switchScreen('pos');
    }
  });
});

// ==================== ROLE CONFIGURATION ====================
function getCurrentRoleConfig() {
  const role = (currentUser && currentUser.role) || 'guest';
  return {
    isAdmin: role === 'admin',
    isCashier: role === 'cashier',
    isWarehouse: role === 'warehouse' || role === 'staff',
    canManageUsers: role === 'admin',
    canViewCostPrice: role === 'admin',
    canManageProducts: role === 'admin'
  };
}

// ==================== API HELPER ====================
async function apiFetch(url, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  if (currentUser && currentUser.role) {
    headers['x-user-role'] = currentUser.role;
    headers['x-username'] = currentUser.username;
  }

  return fetch(url, {
    ...options,
    headers
  });
}

function formatVND(amount) {
  const num = Math.round(Number(amount) || 0);
  return num.toLocaleString('vi-VN') + ' đ';
}

function showToast(title, message, isSuccess = true) {
  const toast = document.getElementById('toast');
  const toastTitle = document.getElementById('toast-title');
  const toastMsg = document.getElementById('toast-msg');
  const toastIcon = document.getElementById('toast-icon');

  toastTitle.textContent = title;
  toastMsg.textContent = message;

  if (isSuccess) {
    toastIcon.textContent = '✓';
    toastIcon.className = 'w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0';
  } else {
    toastIcon.textContent = '!';
    toastIcon.className = 'w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-xs shrink-0';
  }

  toast.classList.remove('opacity-0', 'translate-y-[-100px]', 'pointer-events-none');
  toast.classList.add('opacity-100', 'translate-y-0');

  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-[-100px]', 'pointer-events-none');
  }, 3200);
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isClosed = sidebar.classList.contains('-translate-x-full');
  if (isClosed) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function closeMobileSidebarIfOpen() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

// ==================== AUTHENTICATION ====================
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    showToast('Lỗi', 'Vui lòng nhập tài khoản và mật khẩu!', false);
    return;
  }

  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();

    if (result.success && (result.user || result.data)) {
      currentUser = result.user || result.data;
      localStorage.setItem('vimis_user', JSON.stringify(currentUser));
      showToast('Đăng nhập thành công', `Chào mừng ${currentUser.full_name} (${currentUser.role === 'admin' ? 'Chủ tiệm' : 'Thu ngân'})`);
      showAppLayout();
    } else {
      showToast('Đăng nhập thất bại', result.message || 'Sai tên đăng nhập hoặc mật khẩu!', false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

function quickFillLogin(username, password) {
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
}

function handleLogout() {
  localStorage.removeItem('vimis_user');
  currentUser = null;
  const uInput = document.getElementById('login-username');
  const pInput = document.getElementById('login-password');
  if (uInput) uInput.value = '';
  if (pInput) pInput.value = '';
  showLoginScreen();
  showToast('Đã đăng xuất', 'Vui lòng chọn tài khoản để đăng nhập lại.');
}

function showLoginScreen() {
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('app-layout').classList.add('hidden');
}

function showAppLayout() {
  if (!currentUser) {
    showLoginScreen();
    return;
  }

  document.getElementById('screen-login').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');
  updateUserProfileUI();
  applyRolePermissions();

  // Thu ngân ưu tiên mở ngay quầy quét mã POS
  if (currentUser.role === 'cashier') {
    switchScreen('pos');
  } else {
    switchScreen('dashboard');
  }
}

function updateUserProfileUI() {
  if (!currentUser) return;
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const avatarEl = document.getElementById('user-avatar');

  if (nameEl) nameEl.textContent = currentUser.full_name || 'Người dùng';
  if (roleEl) {
    const roleNames = {
      admin: 'Chủ tiệm',
      cashier: 'Thu ngân',
      warehouse: 'Quản kho',
      staff: 'Nhân viên',
      guest: 'Khách'
    };
    roleEl.textContent = roleNames[currentUser.role] || currentUser.role || 'Nhân viên';
  }
  if (avatarEl) {
    const nameStr = currentUser.full_name || 'AD';
    const initials = nameStr.split(' ').map(w => w[0]).slice(-2).join('').toUpperCase();
    avatarEl.textContent = initials || 'AD';
  }
}

function applyRolePermissions() {
  const roleCfg = getCurrentRoleConfig();

  // Tab Người dùng: chỉ Admin có quyền
  const userBtn = document.querySelector('[data-menu="users"]');
  if (userBtn) {
    userBtn.style.display = roleCfg.canManageUsers ? 'flex' : 'none';
  }

  // Tab Báo cáo tài chính: chỉ Admin
  const reportBtn = document.querySelector('[data-menu="reports"]');
  if (reportBtn) {
    reportBtn.style.display = roleCfg.isAdmin ? 'flex' : 'none';
  }

  // Tab Nhập hàng: thu ngân chỉ xem hoặc ẩn
  const stockInBtn = document.querySelector('[data-menu="stock-in"]');
  if (stockInBtn && roleCfg.isCashier) {
    stockInBtn.style.display = 'none';
  } else if (stockInBtn) {
    stockInBtn.style.display = 'flex';
  }
}

// ==================== SCREEN SWITCHER ====================
function switchScreen(screenId) {
  // Hide all subviews
  document.querySelectorAll('.subview').forEach(el => el.classList.add('hidden'));

  // Show target subview
  const target = document.getElementById(`view-${screenId}`);
  if (target) {
    target.classList.remove('hidden');
  }

  // Update sidebar active status
  document.querySelectorAll('.sidebar-item').forEach(btn => {
    const menu = btn.getAttribute('data-menu');
    if (menu === screenId) {
      btn.classList.add('sidebar-active');
    } else {
      btn.classList.remove('sidebar-active');
    }
  });

  // Screen specific loaders
  if (screenId === 'dashboard') {
    loadDashboard();
    loadAiQuickSummary();
  } else if (screenId === 'pos') {
    loadPosView();
  } else if (screenId === 'products') {
    loadProducts();
  } else if (screenId === 'inventory') {
    loadInventory();
  } else if (screenId === 'stock-in') {
    populateStockInDropdown();
  } else if (screenId === 'stock-out') {
    populateStockOutDropdown();
  } else if (screenId === 'alerts') {
    loadAlerts();
  } else if (screenId === 'rfid') {
    loadRfidView();
  } else if (screenId === 'transactions') {
    loadTransactions();
  } else if (screenId === 'reports') {
    loadReports();
  } else if (screenId === 'users') {
    loadUsers();
  }
}

// ==================== DASHBOARD MODULE ====================
async function loadDashboard() {
  try {
    const res = await apiFetch('/api/dashboard/stats');
    const result = await res.json();

    if (result.success) {
      dashboardData = result.data;
      renderDashboardUI(dashboardData);
    }
  } catch (error) {
    console.error('Lỗi nạp dashboard:', error);
  }
}

function renderDashboardUI(data) {
  if (!data) return;

  document.getElementById('stat-total-sku').textContent = `${data.total_sku} Mặt hàng`;
  document.getElementById('stat-class-a').textContent = `${data.class_a_count} hàng nhóm A bán chạy`;
  document.getElementById('stat-total-units').textContent = `${data.total_units.toLocaleString('vi-VN')} SP`;
  document.getElementById('stat-total-batches').textContent = `${data.total_batches || 0} Lô/Thùng hàng`;

  const roleCfg = getCurrentRoleConfig();
  if (roleCfg.canViewCostPrice) {
    document.getElementById('stat-total-value').textContent = formatVND(data.total_value);
  } else {
    document.getElementById('stat-total-value').textContent = '🔒 Bảo mật';
  }
  document.getElementById('stat-sale-value').textContent = `Doanh thu dự kiến: ${formatVND(data.total_sale_value)}`;

  document.getElementById('stat-alert-count').textContent = data.alert_count;
  document.getElementById('stat-expiring-count').textContent = data.expiring_count;

  updateAlertBadges(data.alert_count + data.expiring_count);

  // Expiring preview (FEFO)
  const expContainer = document.getElementById('dashboard-expiring-list');
  if (data.expiring_preview && data.expiring_preview.length > 0) {
    expContainer.innerHTML = data.expiring_preview.map(p => {
      const isCritical = p.days_left <= 15;
      const isExpired = p.days_left <= 0;
      let badgeClass = 'apple-badge-warning';
      let statusText = `Còn ${p.days_left} ngày`;

      if (isExpired) {
        badgeClass = 'apple-badge-danger';
        statusText = 'ĐÃ QUÁ HẠN';
      } else if (isCritical) {
        badgeClass = 'apple-badge-danger';
        statusText = `Gấp: ${p.days_left} ngày`;
      }

      return `
        <div class="p-2.5 rounded-xl bg-[#F9F9FA] border border-[#E5E5EA] flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-[#1D1D1F]">${p.name}</div>
            <div class="text-[11px] text-[#86868B] flex items-center gap-1.5 mt-0.5">
              <span class="font-mono bg-[#E5E5EA] px-1 rounded">${p.batch_code || 'Thùng'}</span>
              <span>Tồn: ${p.current_stock} ${p.unit}</span>
              <span>• HSD: ${p.expiry_date}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">
            ${statusText}
          </span>
        </div>
      `;
    }).join('');
  } else {
    expContainer.innerHTML = `<div class="text-xs text-[#86868B] py-3 text-center">Tất cả thùng hàng đều có hạn sử dụng an toàn!</div>`;
  }

  // Low stock preview
  const lowContainer = document.getElementById('dashboard-low-stock-list');
  if (data.low_stock_preview && data.low_stock_preview.length > 0) {
    lowContainer.innerHTML = data.low_stock_preview.map(p => `
      <div class="p-2.5 rounded-xl bg-[#F9F9FA] border border-[#E5E5EA] flex items-center justify-between text-xs">
        <div>
          <div class="font-bold text-[#1D1D1F] flex items-center gap-1">
            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${p.abc_class === 'A' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'apple-badge-neutral'}">${p.abc_class}</span>
            <span>${p.name}</span>
          </div>
          <div class="text-[11px] text-[#C62828] font-medium mt-0.5">Tồn: ${p.current_stock} / Min: ${p.min_stock} ${p.unit} (Thiếu: ${p.deficit})</div>
        </div>
        <button onclick="quickStockIn('${p.sku}')" class="px-2.5 py-1 apple-btn-dark text-[11px] font-semibold">
          + Nhập bù
        </button>
      </div>
    `).join('');
  } else {
    lowContainer.innerHTML = `<div class="text-xs text-[#86868B] py-3 text-center">Tất cả mặt hàng đều đạt định mức tồn an toàn!</div>`;
  }

  // Recent Activities
  const recentBody = document.getElementById('dashboard-recent-tx-body');
  if (data.recent_activities && data.recent_activities.length > 0) {
    recentBody.innerHTML = data.recent_activities.map(tx => {
      const isPositive = tx.quantity_change > 0;
      const typeLabel = tx.transaction_type === 'STOCK_OUT' ? 'Bán/Xuất' : (tx.transaction_type === 'STOCK_IN' ? 'Nhập kho' : 'Kiểm kê');
      return `
        <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA]">
          <td class="py-2.5 px-3 text-[#86868B] text-[11px]">${tx.created_at ? tx.created_at.slice(5, 16) : '--'}</td>
          <td class="py-2.5 px-3 font-semibold text-[#1D1D1F]">${typeLabel}</td>
          <td class="py-2.5 px-3 font-medium text-[#1D1D1F]">${tx.product_name}</td>
          <td class="py-2.5 px-3 text-center font-bold ${isPositive ? 'text-emerald-600' : 'text-[#FF3B30]'}">
            ${isPositive ? '+' : ''}${tx.quantity_change} ${tx.unit}
          </td>
          <td class="py-2.5 px-3 text-center font-mono text-[#1D1D1F]">${tx.balance_after}</td>
          <td class="py-2.5 px-3 text-[#86868B] text-[11px] truncate max-w-xs">${tx.note || tx.reference_code || '--'}</td>
        </tr>
      `;
    }).join('');
  }
}

async function loadAiQuickSummary() {
  try {
    const res = await apiFetch('/api/ai/analyze');
    const result = await res.json();
    if (result.success && result.data) {
      aiAnalysisData = result.data;
      const summaryEl = document.getElementById('dashboard-ai-summary');
      if (summaryEl) {
        summaryEl.textContent = `${result.data.ai_message} (Điểm sức khỏe kho: ${Math.round(result.data.health_score || 0)}/100)`;
      }
    }
  } catch (e) {
    console.error('AI summary error:', e);
  }
}

// ==============================================================================
// POS CHECKOUT MODULE (Quét mã thanh toán & Tự động trừ kho theo FEFO)
// ==============================================================================
async function loadPosView() {
  await loadProductsForPos();
  renderPosCatalog();
  renderPosCart();
  
  // Auto focus barcode input
  setTimeout(() => {
    const input = document.getElementById('pos-barcode-input');
    if (input) input.focus();
  }, 100);
}

async function loadProductsForPos() {
  try {
    const res = await apiFetch('/api/products');
    const result = await res.json();
    if (result.success) {
      cachedProducts = result.data;
    }
  } catch (e) {
    console.error('Lỗi tải sản phẩm POS:', e);
  }
}

function filterPosCatalog(cat) {
  posSelectedCategory = cat;
  document.querySelectorAll('.pos-cat-btn').forEach(btn => {
    btn.className = 'pos-cat-btn px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]';
  });
  event.target.className = 'pos-cat-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#1D1D1F] text-white';
  renderPosCatalog();
}

function renderPosCatalog() {
  const grid = document.getElementById('pos-catalog-grid');
  if (!grid) return;

  let items = cachedProducts || [];
  if (posSelectedCategory !== 'ALL') {
    items = items.filter(p => p.category === posSelectedCategory);
  }

  if (items.length === 0) {
    grid.innerHTML = `<div class="col-span-3 py-8 text-center text-xs text-[#86868B]">Không có mặt hàng nào.</div>`;
    return;
  }

  grid.innerHTML = items.map(p => {
    const isOut = p.current_stock <= 0;
    return `
      <div onclick="${isOut ? '' : `addToPosCart(${p.id})`}"
           class="p-3 rounded-xl border border-[#E5E5EA] bg-white hover:border-[#1D1D1F] transition cursor-pointer flex flex-col justify-between select-none ${isOut ? 'opacity-40 cursor-not-allowed bg-slate-50' : 'hover:shadow-sm'}">
        <div>
          <div class="flex items-center justify-between gap-1 mb-1">
            <span class="text-[10px] font-mono text-[#86868B] truncate">${p.sku}</span>
            <span class="px-1.5 py-0.2 rounded text-[9px] font-bold ${isOut ? 'apple-badge-danger' : 'apple-badge-neutral'}">
              ${isOut ? 'Hết hàng' : `Tồn: ${p.current_stock}`}
            </span>
          </div>
          <div class="font-bold text-xs text-[#1D1D1F] line-clamp-2 leading-tight">${p.name}</div>
        </div>

        <div class="mt-2 pt-2 border-t border-[#E5E5EA] flex items-center justify-between">
          <div class="font-bold text-xs text-[#1D1D1F]">${formatVND(p.sale_price)}</div>
          <button class="w-6 h-6 rounded-lg bg-[#F2F2F7] hover:bg-[#1D1D1F] hover:text-white text-[#1D1D1F] font-bold text-xs flex items-center justify-center transition">
            +
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function handlePosBarcodeInput(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    triggerBarcodeSubmit();
  }
}

function triggerBarcodeSubmit() {
  const input = document.getElementById('pos-barcode-input');
  const query = input.value.trim().toLowerCase();
  if (!query) return;

  // Search exact barcode first, then exact sku, then name contains
  let match = cachedProducts.find(p => p.barcode && p.barcode.toLowerCase() === query);
  if (!match) {
    match = cachedProducts.find(p => p.sku && p.sku.toLowerCase() === query);
  }
  if (!match) {
    match = cachedProducts.find(p => p.name && p.name.toLowerCase().includes(query));
  }

  if (match) {
    if (match.current_stock <= 0) {
      showToast('Hết hàng', `Mặt hàng "${match.name}" đã hết tồn kho!`, false);
    } else {
      addToPosCart(match.id);
      showToast('Đã quét thành công', `Đã thêm 1 ${match.unit} "${match.name}" vào giỏ`);
    }
    input.value = '';
  } else {
    showToast('Không tìm thấy', `Không tìm thấy sản phẩm có mã "${query}"`, false);
  }
  input.focus();
}

function addToPosCart(productId) {
  const product = cachedProducts.find(p => p.id === productId);
  if (!product) return;

  const existing = posCart.find(item => item.product_id === productId);
  const currentCartQty = existing ? existing.quantity : 0;

  if (currentCartQty + 1 > product.current_stock) {
    showToast('Hết tồn kho', `Sản phẩm "${product.name}" chỉ còn tồn ${product.current_stock} ${product.unit}!`, false);
    return;
  }

  if (existing) {
    existing.quantity += 1;
    existing.subtotal = existing.quantity * existing.unit_price;
  } else {
    posCart.push({
      product_id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      unit: product.unit,
      unit_price: product.sale_price,
      quantity: 1,
      subtotal: product.sale_price,
      max_stock: product.current_stock
    });
  }

  renderPosCart();
}

function changePosCartQty(productId, delta) {
  const item = posCart.find(i => i.product_id === productId);
  if (!item) return;

  const newQty = item.quantity + delta;
  if (newQty <= 0) {
    removePosCartItem(productId);
    return;
  }

  if (newQty > item.max_stock) {
    showToast('Vượt tồn kho', `Chỉ còn tồn ${item.max_stock} ${item.unit}!`, false);
    return;
  }

  item.quantity = newQty;
  item.subtotal = item.quantity * item.unit_price;
  renderPosCart();
}

function removePosCartItem(productId) {
  posCart = posCart.filter(i => i.product_id !== productId);
  renderPosCart();
}

function clearPosCart() {
  posCart = [];
  renderPosCart();
}

function setPosPaymentMethod(pm) {
  posPaymentMethod = pm;
  const cashBtn = document.getElementById('pos-pm-cash');
  const transBtn = document.getElementById('pos-pm-transfer');

  if (pm === 'CASH') {
    cashBtn.className = 'py-2 px-3 rounded-xl border text-xs font-semibold bg-[#1D1D1F] text-white';
    transBtn.className = 'py-2 px-3 rounded-xl border border-[#E5E5EA] bg-[#F9F9FA] text-[#1D1D1F] text-xs font-semibold hover:bg-[#F2F2F7]';
  } else {
    transBtn.className = 'py-2 px-3 rounded-xl border text-xs font-semibold bg-[#1D1D1F] text-white';
    cashBtn.className = 'py-2 px-3 rounded-xl border border-[#E5E5EA] bg-[#F9F9FA] text-[#1D1D1F] text-xs font-semibold hover:bg-[#F2F2F7]';
  }
}

function calculatePosChange() {
  const total = posCart.reduce((sum, item) => sum + item.subtotal, 0);
  const receivedInput = document.getElementById('pos-received-amount');
  const received = parseFloat(receivedInput.value) || 0;
  const change = Math.max(0, received - total);

  document.getElementById('pos-change-amount').textContent = formatVND(change);
}

function renderPosCart() {
  const container = document.getElementById('pos-cart-items');
  const totalEl = document.getElementById('pos-total-amount');

  if (!container) return;

  if (posCart.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center text-xs text-[#86868B] space-y-1">
        <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg></div>
        <div>Chưa có sản phẩm nào trong giỏ.</div>
        <div class="text-[11px] text-[#A1A1A6]">Quét mã vạch hoặc bấm vào sản phẩm bên trái</div>
      </div>
    `;
    if (totalEl) totalEl.textContent = '0 đ';
    document.getElementById('pos-received-amount').value = '';
    document.getElementById('pos-change-amount').textContent = '0 đ';
    return;
  }

  let totalAmount = 0;

  container.innerHTML = posCart.map(item => {
    totalAmount += item.subtotal;
    return `
      <div class="py-2.5 flex items-center justify-between text-xs">
        <div class="flex-1 pr-2">
          <div class="font-bold text-[#1D1D1F] leading-tight">${item.name}</div>
          <div class="text-[11px] text-[#86868B] font-mono mt-0.5">${formatVND(item.unit_price)} / ${item.unit}</div>
        </div>

        <!-- Quantity adjust -->
        <div class="flex items-center gap-1.5 bg-[#F2F2F7] p-1 rounded-lg shrink-0">
          <button onclick="changePosCartQty(${item.product_id}, -1)" class="w-5 h-5 rounded bg-white text-[#1D1D1F] font-bold flex items-center justify-center hover:bg-slate-200">-</button>
          <span class="font-bold px-1.5 min-w-[20px] text-center">${item.quantity}</span>
          <button onclick="changePosCartQty(${item.product_id}, 1)" class="w-5 h-5 rounded bg-white text-[#1D1D1F] font-bold flex items-center justify-center hover:bg-slate-200">+</button>
        </div>

        <div class="w-24 text-right shrink-0">
          <div class="font-bold text-[#1D1D1F]">${formatVND(item.subtotal)}</div>
          <button onclick="removePosCartItem(${item.product_id})" class="text-[10px] text-[#FF3B30] hover:underline">Xóa</button>
        </div>
      </div>
    `;
  }).join('');

  if (totalEl) totalEl.textContent = formatVND(totalAmount);
  
  // Set received to total by default if empty
  const recInput = document.getElementById('pos-received-amount');
  if (recInput && (!recInput.value || parseFloat(recInput.value) < totalAmount)) {
    recInput.value = totalAmount;
  }
  calculatePosChange();
}

async function handlePosCheckout() {
  if (posCart.length === 0) {
    showToast('Giỏ hàng rỗng', 'Vui lòng quét hoặc chọn ít nhất 1 sản phẩm để thanh toán!', false);
    return;
  }

  const total = posCart.reduce((sum, item) => sum + item.subtotal, 0);
  const receivedInput = document.getElementById('pos-received-amount');
  const received = parseFloat(receivedInput.value) || total;
  const change = Math.max(0, received - total);

  const payload = {
    customer_name: 'Khách lẻ tại tiệm',
    reason: 'Bán lẻ tại tiệm',
    payment_method: posPaymentMethod,
    amount_received: received,
    change_amount: change,
    note: `Thanh toán quầy POS (${posPaymentMethod === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'})`,
    items: posCart.map(item => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price
    }))
  };

  try {
    const res = await apiFetch('/api/stock-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success && result.data) {
      showToast('Đã thanh toán & Trừ kho!', `Mã HĐ: ${result.data.receiptCode}`);
      showCheckoutReceiptModal(result.data);
      clearPosCart();
      loadProductsForPos();
      loadInventory();
      loadDashboard();
    } else {
      showToast('Lỗi thanh toán', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi hệ thống', error.message, false);
  }
}

function showCheckoutReceiptModal(data) {
  const modal = document.getElementById('modal-checkout-receipt');
  document.getElementById('receipt-code-display').textContent = `Mã HĐ: ${data.receiptCode}`;
  document.getElementById('receipt-time-display').textContent = new Date().toLocaleString('vi-VN');
  document.getElementById('receipt-customer-display').textContent = data.customerName || 'Khách lẻ tại tiệm';
  document.getElementById('receipt-total-display').textContent = formatVND(data.totalAmount);
  document.getElementById('receipt-received-display').textContent = formatVND(data.amountReceived);
  document.getElementById('receipt-change-display').textContent = formatVND(data.changeAmount);

  const listEl = document.getElementById('receipt-items-list');
  if (data.deductionDetails && data.deductionDetails.length > 0) {
    listEl.innerHTML = data.deductionDetails.map(item => {
      const p = cachedProducts.find(prod => prod.id === item.product_id);
      const prodName = p ? p.name : `Sản phẩm #${item.product_id}`;
      const batchStr = item.batches_used && item.batches_used.length > 0
        ? item.batches_used.map(b => `${b.batch_code} (-${b.deducted_qty})`).join(', ')
        : 'Trừ trực tiếp';

      return `
        <div class="py-1 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-[#1D1D1F]">${prodName} x ${item.quantity}</div>
            <div class="text-[10px] text-emerald-700 font-mono">Đã trừ thùng: ${batchStr}</div>
          </div>
          <div class="font-bold text-[#1D1D1F]">${formatVND(item.subtotal)}</div>
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
}

function closeReceiptModal() {
  document.getElementById('modal-checkout-receipt').classList.add('hidden');
  const input = document.getElementById('pos-barcode-input');
  if (input) input.focus();
}

// ==============================================================================
// INVENTORY & MULTI-BOX/BATCH MODULE (FEFO & Time Filtering)
// ==============================================================================
async function loadInventory() {
  try {
    const search = document.getElementById('inv-search')?.value || '';
    const importFilter = document.getElementById('inv-filter-import')?.value || 'ALL';
    const expiryFilter = document.getElementById('inv-filter-expiry')?.value || 'ALL';
    const zone = document.getElementById('inv-filter-zone')?.value || 'ALL';

    const url = new URL('/api/inventory', window.location.origin);
    if (search) url.searchParams.append('search', search);
    if (importFilter && importFilter !== 'ALL') url.searchParams.append('import_filter', importFilter);
    if (expiryFilter && expiryFilter !== 'ALL') url.searchParams.append('expiry_filter', expiryFilter);
    if (zone && zone !== 'ALL') url.searchParams.append('zone', zone);

    const res = await apiFetch(url);
    const result = await res.json();

    if (result.success) {
      cachedInventory = result.data;
      renderInventoryTable(cachedInventory, result.summary);
      
      const badge = document.getElementById('menu-batch-count');
      if (badge) badge.textContent = result.summary.total_boxes || cachedInventory.length;
    }
  } catch (error) {
    console.error('Lỗi nạp tồn kho:', error);
  }
}

function renderInventoryTable(items, summary) {
  const tbody = document.getElementById('inventory-table-body');
  if (!tbody) return;

  if (summary) {
    document.getElementById('inv-safe-count').textContent = `${summary.safe_count} Mặt hàng`;
    document.getElementById('inv-expiring-count').textContent = `${summary.expiring_soon_count || 0} Thùng`;
    document.getElementById('inv-expired-count').textContent = `${summary.expired_count || 0} Thùng`;
    document.getElementById('inv-danger-count').textContent = `${summary.danger_count} Mặt hàng`;
  }

  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-[#86868B] text-xs">Không tìm thấy mặt hàng hoặc thùng hàng nào phù hợp với bộ lọc.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(p => {
    const isDanger = p.current_stock <= p.min_stock;
    const isOut = p.current_stock <= 0;
    const isOverstock = p.current_stock > p.max_stock;
    const batches = p.batches || [];
    const hasBatches = batches.length > 0;

    // Stock Status Badge
    let statusBadge = '';
    if (isOut) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold apple-badge-danger">Hết hàng</span>`;
    } else if (isDanger) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold apple-badge-danger">Thiếu hàng</span>`;
    } else if (isOverstock) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium apple-badge-neutral">Vượt Max</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium apple-badge-safe">An toàn</span>`;
    }

    // Batch & Expiry overview badge
    let boxSummaryBadge = '';
    if (hasBatches) {
      let expiredCount = batches.filter(b => b.batch_expiry_status === 'EXPIRED').length;
      let expiringCount = batches.filter(b => b.batch_expiry_status === 'EXPIRING_SOON' || b.batch_expiry_status === 'CRITICAL').length;

      let tagColor = 'apple-badge-neutral';
      let tagText = `${batches.length} Thùng`;

      if (expiredCount > 0) {
        tagColor = 'apple-badge-danger';
        tagText = `⚠️ ${expiredCount} Thùng Hết Hạn / ${batches.length} Thùng`;
      } else if (expiringCount > 0) {
        tagColor = 'apple-badge-warning';
        tagText = `▲ ${expiringCount} Thùng Cận Hạn / ${batches.length} Thùng`;
      }

      boxSummaryBadge = `
        <div class="flex flex-col items-center gap-1">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${tagColor}">
            ${tagText}
          </span>
          <button onclick="toggleBatchDrawer(${p.product_id})" class="text-[10px] text-[#0071E3] hover:underline font-medium">
            Chi tiết từng thùng ▼
          </button>
        </div>
      `;
    } else {
      boxSummaryBadge = `<span class="text-[11px] text-[#86868B]">Chưa có thùng</span>`;
    }

    // Render batch drawer rows
    const drawerHtml = hasBatches ? `
      <tr id="batch-drawer-${p.product_id}" class="hidden bg-[#F9F9FA]/70 border-b border-[#E5E5EA]">
        <td colspan="8" class="p-3 pl-12">
          <div class="apple-card p-3 space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider flex items-center gap-1.5">
                <span>Danh sách các Thùng hàng của "${p.name}"</span>
                <span class="text-[#86868B] font-normal text-[11px]">(Tự động ưu tiên xuất thùng hết hạn trước - FEFO)</span>
              </span>
              <button onclick="openBatchModal(${p.product_id})" class="px-2.5 py-1 apple-btn-dark text-[10px] font-semibold">
                + Thêm thùng mới
              </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              ${batches.map(b => {
                const isExp = b.batch_expiry_status === 'EXPIRED';
                const isCrit = b.batch_expiry_status === 'CRITICAL';
                const isNear = b.batch_expiry_status === 'EXPIRING_SOON';
                let expBadge = 'apple-badge-safe';
                let expLabel = `Còn ${b.days_until_expiry} ngày`;

                if (isExp) {
                  expBadge = 'apple-badge-danger font-bold';
                  expLabel = `ĐÃ HẾT HẠN (${Math.abs(b.days_until_expiry)} ngày)`;
                } else if (isCrit || isNear) {
                  expBadge = 'apple-badge-warning font-bold';
                  expLabel = `Cận date: còn ${b.days_until_expiry} ngày ⚠️`;
                }

                return `
                  <div class="p-2.5 rounded-xl border border-[#E5E5EA] bg-white text-xs space-y-1.5 shadow-xs">
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-[#1D1D1F] font-mono">${b.batch_code}</span>
                      <span class="px-2 py-0.2 rounded-full text-[9px] ${expBadge}">
                        ${expLabel}
                      </span>
                    </div>

                    <div class="text-[11px] text-[#1D1D1F] font-medium">${b.box_label || 'Thùng hàng'}</div>

                    <div class="grid grid-cols-2 gap-1 text-[10px] text-[#86868B] pt-1 border-t border-[#E5E5EA]">
                      <div>Tồn: <strong class="text-[#1D1D1F]">${b.quantity} ${p.unit}</strong></div>
                      <div>Vị trí: <strong class="text-[#1D1D1F]">${b.location || 'Kệ'}</strong></div>
                      <div>Nhập: <strong>${b.import_date || '--'}</strong></div>
                      <div>HSD: <strong class="${isExp ? 'text-rose-600' : (isNear ? 'text-amber-700' : 'text-[#1D1D1F]')}">${b.expiry_date || '--'}</strong></div>
                    </div>

                    <div class="flex items-center justify-end gap-1.5 pt-1 text-[10px]">
                      <button onclick="openBatchModal(${p.product_id}, ${b.id})" class="text-[#0071E3] hover:underline font-medium">Sửa</button>
                      <span class="text-[#E5E5EA]">•</span>
                      <button onclick="deleteBatch(${b.id}, '${b.batch_code}')" class="text-[#FF3B30] hover:underline font-medium">Xóa thùng</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </td>
      </tr>
    ` : '';

    return `
      <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA] ${isDanger ? 'bg-rose-50/15' : ''}">
        <td class="py-3 px-4 text-center">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${p.abc_class === 'A' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'apple-badge-neutral'}">${p.abc_class}</span>
        </td>

        <td class="py-3 px-4 font-semibold text-[#1D1D1F]">
          <div>${p.name}</div>
          <div class="text-[10px] text-[#86868B] font-mono">${p.sku} ${p.barcode ? `• ${p.barcode}` : ''}</div>
        </td>

        <!-- Shelf Location -->
        <td class="py-3 px-4">
          <div class="flex items-center gap-1.5">
            <div>
              <div class="font-bold text-[#1D1D1F] text-xs">${p.zone}</div>
              <div class="text-[10px] text-[#86868B]">${p.shelf_level}</div>
            </div>
            <button onclick="openShelfModal(${p.inventory_id}, '${p.name}', '${p.zone}', '${p.shelf_level}')" class="p-1 text-[#86868B] hover:text-[#0071E3] transition" title="Đổi vị trí kệ">
              📍
            </button>
          </div>
        </td>

        <!-- Batches / Boxes Overview -->
        <td class="py-3 px-4 text-center">
          ${boxSummaryBadge}
        </td>

        <!-- Inline Stock Quantity Adjustment -->
        <td class="py-3 px-4 text-center">
          <div class="inline-flex items-center gap-1 bg-[#F2F2F7] border border-[#E5E5EA] rounded-lg p-0.5">
            <button onclick="adjustStockDelta(${p.inventory_id}, -1)" class="w-5 h-5 rounded bg-white text-[#1D1D1F] font-bold text-xs flex items-center justify-center hover:bg-slate-200">-</button>
            <span onclick="updateStockDirectly(${p.inventory_id}, ${p.current_stock})" class="font-bold text-xs px-2 cursor-pointer hover:text-[#0071E3] ${isDanger ? 'text-[#FF3B30]' : 'text-[#1D1D1F]'}" title="Bấm để kiểm kê trực tiếp">${p.current_stock}</span>
            <button onclick="adjustStockDelta(${p.inventory_id}, 1)" class="w-5 h-5 rounded bg-white text-[#1D1D1F] font-bold text-xs flex items-center justify-center hover:bg-slate-200">+</button>
            <span class="text-[10px] text-[#86868B] pr-1">${p.unit}</span>
          </div>
        </td>

        <td class="py-3 px-4 text-center text-xs text-[#86868B]">
          <span class="font-bold text-[#1D1D1F]">${p.min_stock}</span> - <span class="font-bold text-[#86868B]">${p.max_stock}</span>
        </td>

        <td class="py-3 px-4 text-center">${statusBadge}</td>

        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="openBatchModal(${p.product_id})" class="px-2 py-1 apple-btn-secondary text-[10px] font-semibold" title="Thêm thùng mới">
              + Thùng
            </button>
            <button onclick="confirmAudit(${p.inventory_id})" class="px-2 py-1 bg-white hover:bg-slate-100 text-[#1D1D1F] border border-[#E5E5EA] rounded text-[10px] font-medium" title="Xác nhận kiểm đếm hôm nay">
              ✓ Đếm
            </button>
          </div>
        </td>
      </tr>
      ${drawerHtml}
    `;
  }).join('');
}

function toggleBatchDrawer(productId) {
  const row = document.getElementById(`batch-drawer-${productId}`);
  if (row) {
    row.classList.toggle('hidden');
  }
}

async function adjustStockDelta(inventoryId, delta) {
  try {
    const res = await apiFetch(`/api/inventory/${inventoryId}/quantity`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta, note: 'Kiểm kê nhanh từ bảng kho' })
    });
    const result = await res.json();
    if (result.success) {
      loadInventory();
      loadDashboard();
    }
  } catch (error) {
    showToast('Lỗi', error.message, false);
  }
}

async function updateStockDirectly(inventoryId, currentVal) {
  const newVal = prompt(`Nhập số lượng tồn kho thực tế kiểm đếm (Hiện tại: ${currentVal}):`, currentVal);
  if (newVal === null) return;
  const qty = parseInt(newVal);
  if (isNaN(qty) || qty < 0) {
    alert('Số lượng không hợp lệ');
    return;
  }

  try {
    const res = await apiFetch(`/api/inventory/${inventoryId}/quantity`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: qty, note: 'Kiểm kê trực tiếp' })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Đã cập nhật', `Tồn kho mới: ${result.new_quantity}`);
      loadInventory();
      loadDashboard();
    }
  } catch (error) {
    showToast('Lỗi', error.message, false);
  }
}

async function confirmAudit(inventoryId) {
  try {
    const res = await apiFetch(`/api/inventory/${inventoryId}/audit`, { method: 'PUT' });
    const result = await res.json();
    if (result.success) {
      showToast('Đã kiểm đếm', 'Đã ghi nhận kiểm kê mặt hàng thành công!');
    }
  } catch (error) {
    showToast('Lỗi', error.message, false);
  }
}

// ==================== BATCH MODAL (Thêm / Sửa Thùng Hàng) ====================
function openBatchModal(productId = null, batchId = null) {
  const modal = document.getElementById('modal-batch');
  const title = document.getElementById('modal-batch-title');
  const select = document.getElementById('modal-batch-product-id');

  // Populate product options
  select.innerHTML = cachedProducts.map(p => `
    <option value="${p.id}" ${p.id === productId ? 'selected' : ''}>[${p.sku}] ${p.name}</option>
  `).join('');

  if (batchId) {
    title.textContent = 'Chỉnh Sửa Thông Tin Thùng Hàng';
    document.getElementById('modal-batch-id').value = batchId;

    // Find batch in cachedInventory
    let foundBatch = null;
    for (const inv of cachedInventory) {
      if (inv.batches) {
        const b = inv.batches.find(item => item.id === batchId);
        if (b) { foundBatch = b; break; }
      }
    }

    if (foundBatch) {
      select.value = foundBatch.product_id;
      document.getElementById('modal-batch-code').value = foundBatch.batch_code;
      document.getElementById('modal-batch-label').value = foundBatch.box_label || '';
      document.getElementById('modal-batch-qty').value = foundBatch.quantity;
      document.getElementById('modal-batch-location').value = foundBatch.location || '';
      document.getElementById('modal-batch-import-date').value = foundBatch.import_date || '';
      document.getElementById('modal-batch-expiry-date').value = foundBatch.expiry_date || '';
      document.getElementById('modal-batch-note').value = foundBatch.note || '';
    }
  } else {
    title.textContent = 'Thêm Thùng Hàng Mới (Box/Batch)';
    document.getElementById('modal-batch-id').value = '';
    
    // Auto generate box code
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(100 + Math.random() * 900);
    document.getElementById('modal-batch-code').value = `THUNG-${dateStr}-${randSuffix}`;
    document.getElementById('modal-batch-label').value = 'Thùng hàng mới';
    document.getElementById('modal-batch-qty').value = '10';
    document.getElementById('modal-batch-location').value = 'Kệ trưng bày';
    document.getElementById('modal-batch-import-date').value = now.toISOString().slice(0, 10);
    document.getElementById('modal-batch-expiry-date').value = '';
    document.getElementById('modal-batch-note').value = '';
  }

  modal.classList.remove('hidden');
}

function closeBatchModal() {
  document.getElementById('modal-batch').classList.add('hidden');
}

async function handleSaveBatch(e) {
  e.preventDefault();
  const batchId = document.getElementById('modal-batch-id').value;
  const productId = parseInt(document.getElementById('modal-batch-product-id').value);
  const batchCode = document.getElementById('modal-batch-code').value.trim();
  const boxLabel = document.getElementById('modal-batch-label').value.trim();
  const qty = parseInt(document.getElementById('modal-batch-qty').value) || 0;
  const location = document.getElementById('modal-batch-location').value.trim();
  const importDate = document.getElementById('modal-batch-import-date').value;
  const expiryDate = document.getElementById('modal-batch-expiry-date').value || null;
  const note = document.getElementById('modal-batch-note').value.trim();

  const payload = {
    product_id: productId,
    batch_code: batchCode,
    box_label: boxLabel,
    quantity: qty,
    location,
    import_date: importDate,
    expiry_date: expiryDate,
    note
  };

  try {
    let res;
    if (batchId) {
      res = await apiFetch(`/api/inventory/batches/${batchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await apiFetch('/api/inventory/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const result = await res.json();
    if (result.success) {
      showToast('Thành công', result.message);
      closeBatchModal();
      loadInventory();
      loadDashboard();
    } else {
      showToast('Lỗi lưu thùng', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

async function deleteBatch(batchId, batchCode) {
  if (!confirm(`Bạn có chắc chắn muốn xóa thùng hàng [${batchCode}]? Số lượng tồn kho tương ứng sẽ bị giảm trừ.`)) return;

  try {
    const res = await apiFetch(`/api/inventory/batches/${batchId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Đã xóa', result.message);
      loadInventory();
      loadDashboard();
    } else {
      showToast('Lỗi', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

// Modal đổi vị trí kệ
function openShelfModal(invId, prodName, zone, shelfLevel) {
  document.getElementById('modal-shelf-inv-id').value = invId;
  document.getElementById('modal-shelf-prod-name').textContent = prodName;
  document.getElementById('modal-shelf-zone').value = zone || 'Kệ trưng bày';
  document.getElementById('modal-shelf-level').value = shelfLevel || 'Tầng 2 (Tầm mắt)';
  document.getElementById('modal-shelf').classList.remove('hidden');
}

function closeShelfModal() {
  document.getElementById('modal-shelf').classList.add('hidden');
}

async function handleSaveShelfLocation(e) {
  e.preventDefault();
  const invId = document.getElementById('modal-shelf-inv-id').value;
  const zone = document.getElementById('modal-shelf-zone').value;
  const shelf_level = document.getElementById('modal-shelf-level').value;

  try {
    const res = await apiFetch(`/api/inventory/${invId}/shelf`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, shelf_level })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Thành công', result.message);
      closeShelfModal();
      loadInventory();
    } else {
      showToast('Lỗi', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

// ==============================================================================
// PRODUCTS MODULE (Independent Search & ABC)
// ==============================================================================
async function loadProducts() {
  try {
    const search = document.getElementById('prod-search')?.value || '';
    const cat = document.getElementById('prod-filter-cat')?.value || 'ALL';
    const abc = document.getElementById('prod-filter-abc')?.value || 'ALL';

    const url = new URL('/api/products', window.location.origin);
    if (search) url.searchParams.append('search', search);
    if (cat && cat !== 'ALL') url.searchParams.append('category', cat);
    if (abc && abc !== 'ALL') url.searchParams.append('abc', abc);

    const res = await apiFetch(url);
    const result = await res.json();

    if (result.success) {
      cachedProducts = result.data;
      renderProductTable(cachedProducts);
      const countBadge = document.getElementById('menu-product-count');
      if (countBadge) countBadge.textContent = cachedProducts.length;
    }
  } catch (error) {
    console.error('Lỗi nạp sản phẩm:', error);
  }
}

function renderProductTable(items) {
  const tbody = document.getElementById('product-table-body');
  const roleCfg = getCurrentRoleConfig();

  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-[#86868B] text-xs">Không tìm thấy sản phẩm nào phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(p => {
    const isLow = p.current_stock <= p.min_stock;
    const isOut = p.current_stock <= 0;

    let abcBadge = '';
    if (p.abc_class === 'A') {
      abcBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200" title="Nhóm A: Hàng bán chạy nhất">Nhóm A</span>`;
    } else if (p.abc_class === 'B') {
      abcBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold apple-badge-neutral" title="Nhóm B: Bán vừa">Nhóm B</span>`;
    } else {
      abcBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium apple-badge-neutral" title="Nhóm C: Quay vòng chậm">Nhóm C</span>`;
    }

    const costDisplay = roleCfg.canViewCostPrice 
      ? formatVND(p.cost_price) 
      : `<span class="text-[10px] text-[#86868B]">🔒 Bảo mật</span>`;

    return `
      <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA] ${isLow ? 'bg-rose-50/15' : ''}">
        <td class="py-3 px-4 text-center">${abcBadge}</td>
        <td class="py-3 px-4">
          <div class="font-mono font-bold text-[#1D1D1F]">${p.sku}</div>
          <div class="text-[10px] text-[#86868B] font-mono">${p.barcode || 'Chưa có barcode'}</div>
        </td>
        <td class="py-3 px-4 font-semibold text-[#1D1D1F]">
          <div>${p.name}</div>
          <div class="text-[10px] text-[#86868B] font-normal">Ngành: ${p.category}</div>
        </td>
        <td class="py-3 px-4">
          <div class="font-medium text-[#1D1D1F] text-xs">${p.zone || 'Kệ trưng bày'}</div>
          <div class="text-[10px] text-[#86868B] font-medium">${p.shelf_level || 'Tầng 2'}</div>
        </td>
        <td class="py-3 px-4 text-center text-[#86868B]">${p.unit}</td>
        <td class="py-3 px-4 text-right font-mono text-[#86868B]">${costDisplay}</td>
        <td class="py-3 px-4 text-right font-mono font-bold text-[#1D1D1F]">${formatVND(p.sale_price)}</td>
        <td class="py-3 px-4 text-center text-xs text-[#86868B]">
          <span class="font-bold text-[#1D1D1F]">${p.min_stock}</span> - <span class="font-bold text-[#86868B]">${p.max_stock || 50}</span>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="text-sm font-black ${isLow ? 'text-[#FF3B30]' : 'text-[#1D1D1F]'}">${p.current_stock}</span>
          <div class="text-[10px] text-[#86868B]">${p.unit}</div>
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="quickStockIn('${p.sku}')" class="px-2 py-1 apple-btn-secondary text-[11px] font-semibold" title="Nhập hàng">
              + Nhập
            </button>
            ${roleCfg.canManageProducts ? `
              <button onclick="openProductModal(${p.id})" class="p-1 text-[#86868B] hover:text-[#0071E3] transition" title="Chỉnh sửa">
                ✏️
              </button>
              <button onclick="deleteProduct(${p.id}, '${p.name}')" class="p-1 text-[#86868B] hover:text-[#FF3B30] transition" title="Xóa">
                🗑️
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openProductModal(prodId = null) {
  const roleCfg = getCurrentRoleConfig();
  if (!roleCfg.canManageProducts) {
    showToast('Giới hạn phân quyền', 'Chỉ Chủ cửa hàng mới có quyền tạo hoặc sửa mặt hàng!', false);
    return;
  }

  const modal = document.getElementById('modal-product');
  const title = document.getElementById('modal-product-title');
  const initContainer = document.getElementById('modal-prod-init-stock-container');

  if (prodId) {
    const p = cachedProducts.find(item => item.id === prodId);
    if (!p) return;
    title.textContent = 'Chỉnh Sửa Mặt Hàng';
    document.getElementById('modal-prod-id').value = p.id;
    document.getElementById('modal-prod-sku').value = p.sku;
    document.getElementById('modal-prod-sku').disabled = true;
    document.getElementById('modal-prod-barcode').value = p.barcode || '';
    document.getElementById('modal-prod-name').value = p.name;
    document.getElementById('modal-prod-abc').value = p.abc_class || 'B';
    document.getElementById('modal-prod-cat').value = p.category;
    document.getElementById('modal-prod-unit').value = p.unit;
    document.getElementById('modal-prod-cost').value = p.cost_price;
    document.getElementById('modal-prod-price').value = p.sale_price;
    document.getElementById('modal-prod-min').value = p.min_stock;
    document.getElementById('modal-prod-max').value = p.max_stock || 50;
    document.getElementById('modal-prod-zone').value = p.zone || 'Kệ trưng bày';
    document.getElementById('modal-prod-shelf-level').value = p.shelf_level || 'Tầng 2 (Tầm mắt)';
    if (initContainer) initContainer.classList.add('hidden');
  } else {
    title.textContent = 'Thêm Mặt Hàng Mới Vào Kho';
    document.getElementById('modal-prod-id').value = '';
    document.getElementById('modal-prod-sku').value = '';
    document.getElementById('modal-prod-sku').disabled = false;
    document.getElementById('modal-prod-barcode').value = '';
    document.getElementById('modal-prod-name').value = '';
    document.getElementById('modal-prod-abc').value = 'B';
    document.getElementById('modal-prod-cat').value = 'Thực phẩm khô';
    document.getElementById('modal-prod-unit').value = 'Thùng';
    document.getElementById('modal-prod-cost').value = '';
    document.getElementById('modal-prod-price').value = '';
    document.getElementById('modal-prod-min').value = '5';
    document.getElementById('modal-prod-max').value = '50';
    document.getElementById('modal-prod-zone').value = 'Kệ trưng bày';
    document.getElementById('modal-prod-shelf-level').value = 'Tầng 2 (Tầm mắt)';
    if (initContainer) initContainer.classList.remove('hidden');
    document.getElementById('modal-prod-init-stock').value = '0';
  }

  modal.classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('modal-product').classList.add('hidden');
}

async function handleSaveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('modal-prod-id').value;

  const payload = {
    sku: document.getElementById('modal-prod-sku').value.trim().toUpperCase(),
    barcode: document.getElementById('modal-prod-barcode').value.trim(),
    name: document.getElementById('modal-prod-name').value.trim(),
    category: document.getElementById('modal-prod-cat').value,
    abc_class: document.getElementById('modal-prod-abc').value,
    unit: document.getElementById('modal-prod-unit').value,
    cost_price: parseFloat(document.getElementById('modal-prod-cost').value) || 0,
    sale_price: parseFloat(document.getElementById('modal-prod-price').value) || 0,
    min_stock: parseInt(document.getElementById('modal-prod-min').value) || 5,
    max_stock: parseInt(document.getElementById('modal-prod-max').value) || 50,
    zone: document.getElementById('modal-prod-zone').value,
    shelf_level: document.getElementById('modal-prod-shelf-level').value
  };

  try {
    let res;
    if (id) {
      res = await apiFetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      payload.initial_stock = parseInt(document.getElementById('modal-prod-init-stock').value) || 0;
      res = await apiFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const result = await res.json();
    if (result.success) {
      showToast('Thành công', result.message);
      closeProductModal();
      loadProducts();
      loadDashboard();
    } else {
      showToast('Lỗi', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi hệ thống', error.message, false);
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`Bạn có chắc chắn muốn xóa mặt hàng "${name}" khỏi danh mục kho?`)) return;

  try {
    const res = await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Đã xóa', `Đã xóa sản phẩm "${name}" thành công`);
      loadProducts();
      loadDashboard();
    } else {
      showToast('Lỗi', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi', error.message, false);
  }
}

// ==============================================================================
// STOCK IN MODULE
// ==============================================================================
function switchStockInTab(mode) {
  const singleBtn = document.getElementById('tab-btn-single-stockin');
  const bulkBtn = document.getElementById('tab-btn-bulk-stockin');
  const singlePane = document.getElementById('pane-stockin-single');
  const bulkPane = document.getElementById('pane-stockin-bulk');

  if (mode === 'single') {
    singleBtn.className = "px-4 py-2 rounded-xl apple-btn-dark font-bold text-xs shadow-xs transition";
    bulkBtn.className = "px-4 py-2 rounded-xl apple-btn-secondary text-[#1D1D1F] font-medium text-xs transition";
    singlePane.classList.remove('hidden');
    bulkPane.classList.add('hidden');
  } else {
    bulkBtn.className = "px-4 py-2 rounded-xl apple-btn-dark font-bold text-xs shadow-xs transition";
    singleBtn.className = "px-4 py-2 rounded-xl apple-btn-secondary text-[#1D1D1F] font-medium text-xs transition";
    bulkPane.classList.remove('hidden');
    singlePane.classList.add('hidden');
  }
}

async function populateStockInDropdown(selectedSku = null) {
  try {
    const res = await apiFetch('/api/products');
    const result = await res.json();
    if (result.success) {
      cachedProducts = result.data;
      const select = document.getElementById('stockin-product-select');
      select.innerHTML = cachedProducts.map(p => `
        <option value="${p.id}" data-cost="${p.cost_price || 0}" data-unit="${p.unit}" ${p.sku === selectedSku ? 'selected' : ''}>
          [${p.sku}] ${p.name} (Tồn hiện tại: ${p.current_stock} ${p.unit})
        </option>
      `).join('');

      updateStockInFormFields();
    }
  } catch (error) {
    console.error('Lỗi nạp dropdown nhập hàng:', error);
  }
}

function updateStockInFormFields() {
  const select = document.getElementById('stockin-product-select');
  if (!select.options || select.options.length === 0) return;

  const selectedOption = select.options[select.selectedIndex];
  if (!selectedOption) return;

  const cost = selectedOption.dataset.cost || 0;
  document.getElementById('stockin-cost').value = cost;
  calculateStockInTotal();
}

function calculateStockInTotal() {
  const qty = parseInt(document.getElementById('stockin-qty').value) || 0;
  const cost = parseFloat(document.getElementById('stockin-cost').value) || 0;
  const total = qty * cost;
  document.getElementById('stockin-total-display').textContent = formatVND(total);
}

function quickStockIn(sku, suggestedQty = null) {
  switchScreen('stock-in');
  populateStockInDropdown(sku).then(() => {
    if (suggestedQty) {
      document.getElementById('stockin-qty').value = suggestedQty;
      calculateStockInTotal();
    }
  });
}

async function handleStockIn(e) {
  e.preventDefault();
  const select = document.getElementById('stockin-product-select');
  const productId = parseInt(select.value);
  const qty = parseInt(document.getElementById('stockin-qty').value) || 0;
  const cost = parseFloat(document.getElementById('stockin-cost').value) || 0;
  const supplier = document.getElementById('stockin-supplier').value;
  const warehouse = document.getElementById('stockin-warehouse').value;
  const batchCode = document.getElementById('stockin-batch-code').value.trim();
  const batchExpiry = document.getElementById('stockin-batch-expiry').value || null;
  const note = document.getElementById('stockin-note').value;

  if (qty <= 0) {
    showToast('Lỗi', 'Số lượng nhập phải lớn hơn 0', false);
    return;
  }

  const payload = {
    supplier_name: supplier,
    warehouse_name: warehouse,
    note: note,
    items: [{
      product_id: productId,
      quantity: qty,
      unit_cost: cost,
      batch_code: batchCode,
      expiry_date: batchExpiry
    }]
  };

  try {
    const res = await apiFetch('/api/stock-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      // Also save batch record if batch expiry or code provided
      if (batchExpiry || batchCode) {
        await apiFetch('/api/inventory/batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: productId,
            batch_code: batchCode || undefined,
            box_label: `Thùng nhập từ ${supplier}`,
            quantity: qty,
            expiry_date: batchExpiry,
            note: `Nhập theo phiếu ${result.data.receiptCode}`
          })
        });
      }

      showToast('Đã nhập hàng!', result.message);
      switchScreen('inventory');
    } else {
      showToast('Lỗi nhập hàng', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

async function handleBulkSyncPaste() {
  const text = document.getElementById('bulk-paste-text').value.trim();
  if (!text) {
    showToast('Lỗi', 'Vui lòng dán danh sách hàng hóa vào ô văn bản!', false);
    return;
  }

  try {
    const res = await apiFetch('/api/inventory/bulk-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const result = await res.json();

    if (result.success) {
      showToast('Thành công', result.message);
      document.getElementById('bulk-paste-text').value = '';
      switchScreen('inventory');
    } else {
      showToast('Lỗi đồng bộ', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

// ==============================================================================
// STOCK OUT MODULE (Manual / Disposal)
// ==============================================================================
async function populateStockOutDropdown(selectedSku = null) {
  try {
    const res = await apiFetch('/api/products');
    const result = await res.json();
    if (result.success) {
      cachedProducts = result.data;
      const select = document.getElementById('stockout-product-select');
      select.innerHTML = cachedProducts.map(p => `
        <option value="${p.id}" data-price="${p.sale_price}" data-stock="${p.current_stock}" data-unit="${p.unit}" ${p.sku === selectedSku ? 'selected' : ''}>
          [${p.sku}] ${p.name} (Tồn hiện có: ${p.current_stock} ${p.unit})
        </option>
      `).join('');

      updateStockOutFormFields();
    }
  } catch (error) {
    console.error('Lỗi nạp dropdown xuất kho:', error);
  }
}

function updateStockOutFormFields() {
  const select = document.getElementById('stockout-product-select');
  if (!select.options || select.options.length === 0) return;

  const selectedOption = select.options[select.selectedIndex];
  if (!selectedOption) return;

  const price = selectedOption.dataset.price || 0;
  const stock = selectedOption.dataset.stock || 0;
  const unit = selectedOption.dataset.unit || '';

  document.getElementById('stockout-price').value = price;
  document.getElementById('stockout-avail-hint').textContent = `Tồn kho hiện có: ${stock} ${unit}`;
  calculateStockOutTotal();
}

function calculateStockOutTotal() {
  const qty = parseInt(document.getElementById('stockout-qty').value) || 0;
  const price = parseFloat(document.getElementById('stockout-price').value) || 0;
  const total = qty * price;
  document.getElementById('stockout-total-display').textContent = formatVND(total);
}

async function handleStockOut(e) {
  e.preventDefault();
  const select = document.getElementById('stockout-product-select');
  const productId = parseInt(select.value);
  const qty = parseInt(document.getElementById('stockout-qty').value) || 0;
  const unitPrice = parseFloat(document.getElementById('stockout-price').value) || 0;
  const customerName = document.getElementById('stockout-customer').value;
  const reason = document.getElementById('stockout-reason').value;
  const note = document.getElementById('stockout-note').value;

  if (qty <= 0) {
    showToast('Lỗi', 'Số lượng xuất phải lớn hơn 0', false);
    return;
  }

  const payload = {
    customer_name: customerName,
    reason: reason,
    note: note,
    items: [{ product_id: productId, quantity: qty, unit_price: unitPrice }]
  };

  try {
    const res = await apiFetch('/api/stock-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      showToast('Đã xuất kho!', result.message);
      switchScreen('inventory');
    } else {
      showToast('Lỗi xuất kho', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

// ==============================================================================
// ALERTS MODULE (FEFO & Batches)
// ==============================================================================
async function loadAlerts() {
  try {
    const res = await apiFetch('/api/alerts');
    const result = await res.json();

    if (result.success) {
      renderAlertsUI(result);
      updateAlertBadges((result.count || 0) + (result.expiring_count || 0));
    }
  } catch (error) {
    console.error('Lỗi tải cảnh báo:', error);
  }
}

function updateAlertBadges(count) {
  const countDisplay = count || 0;
  const menuBadge = document.getElementById('menu-alert-badge');
  const headerDot = document.getElementById('header-alert-badge');
  const summaryNumber = document.getElementById('alert-summary-number');

  if (menuBadge) menuBadge.textContent = countDisplay;
  if (summaryNumber) summaryNumber.textContent = `${countDisplay} mục`;

  if (headerDot) {
    if (countDisplay > 0) {
      headerDot.classList.remove('hidden');
    } else {
      headerDot.classList.add('hidden');
    }
  }
}

function renderAlertsUI(data) {
  // 1. Render Expiring / Expired Batches (FEFO)
  const expTbody = document.getElementById('alert-expiring-table-body');
  const expItems = data.expiring_items || [];

  if (expItems.length === 0) {
    expTbody.innerHTML = `<tr><td colspan="8" class="py-5 text-center text-[#86868B] text-xs">🎉 Không có thùng hàng nào cận date trong 45 ngày tới. Tất cả đều an toàn!</td></tr>`;
  } else {
    expTbody.innerHTML = expItems.map(item => {
      const isExpired = item.days_until_expiry <= 0;
      const isCritical = item.days_until_expiry <= 15;

      let badgeClass = 'apple-badge-warning';
      let statusText = 'CẬN HẠN';
      let adviceText = '👉 Xếp ra quầy bán trước (FEFO)';

      if (isExpired) {
        badgeClass = 'apple-badge-danger font-bold';
        statusText = 'ĐÃ HẾT HẠN';
        adviceText = '🚫 Thu hồi & Hủy hàng ngay';
      } else if (isCritical) {
        badgeClass = 'apple-badge-danger font-bold';
        statusText = 'RẤT GẤP';
        adviceText = '⚡ Giảm giá / Khuyến mãi đẩy hàng';
      }

      return `
        <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA] text-xs ${isExpired ? 'bg-rose-50/20' : ''}">
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">
              ${statusText}
            </span>
          </td>
          <td class="py-2.5 px-3 font-bold text-[#1D1D1F]">${item.name}</td>
          <td class="py-2.5 px-3 font-mono font-semibold text-[#1D1D1F]">
            <div>${item.batch_code}</div>
            <div class="text-[10px] text-[#86868B] font-normal">${item.box_label || ''}</div>
          </td>
          <td class="py-2.5 px-3 text-center font-bold text-[#1D1D1F]">${item.batch_quantity} ${item.unit}</td>
          <td class="py-2.5 px-3 text-[#86868B]">${item.batch_location || 'Kệ'}</td>
          <td class="py-2.5 px-3 font-mono font-bold text-[#1D1D1F]">${item.expiry_date}</td>
          <td class="py-2.5 px-3 text-center font-bold ${isExpired ? 'text-[#FF3B30]' : 'text-[#E65100]'}">
            ${isExpired ? `Quá hạn ${Math.abs(item.days_until_expiry)} ngày` : `Còn ${item.days_until_expiry} ngày`}
          </td>
          <td class="py-2.5 px-3 text-center font-medium text-xs">
            ${adviceText}
          </td>
        </tr>
      `;
    }).join('');
  }

  // 2. Render Low Stock Table
  const lowTbody = document.getElementById('alert-lowstock-table-body');
  const lowItems = data.data || [];

  if (lowItems.length === 0) {
    lowTbody.innerHTML = `<tr><td colspan="7" class="py-5 text-center text-[#86868B] text-xs">🎉 Tất cả mặt hàng đều đạt ngưỡng tồn kho an toàn!</td></tr>`;
  } else {
    lowTbody.innerHTML = lowItems.map(item => {
      const isOut = item.current_stock <= 0;
      return `
        <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA] text-xs">
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isOut ? 'apple-badge-danger' : 'apple-badge-warning'}">
              ${isOut ? 'HẾT HÀNG' : 'THIẾU TỒN'}
            </span>
          </td>
          <td class="py-2.5 px-3 font-bold text-[#1D1D1F]">${item.name}</td>
          <td class="py-2.5 px-3 text-[#86868B]">${item.zone}</td>
          <td class="py-2.5 px-3 text-center">
            <span class="font-bold text-[#FF3B30]">${item.current_stock}</span> / <span class="text-[#86868B]">${item.min_stock} ${item.unit}</span>
          </td>
          <td class="py-2.5 px-3 text-center font-bold text-[#FF3B30]">-${item.deficit}</td>
          <td class="py-2.5 px-3 text-center font-bold text-emerald-700">+${item.suggested_reorder_qty} ${item.unit}</td>
          <td class="py-2.5 px-3 text-center">
            <button onclick="quickStockIn('${item.sku}', ${item.suggested_reorder_qty})" class="px-2.5 py-1 apple-btn-dark text-[10px] font-semibold">
              + Nhập bù
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

// ==============================================================================
// TRANSACTIONS MODULE (Independent Search)
// ==============================================================================
async function loadTransactions() {
  try {
    const search = document.getElementById('tx-search')?.value || '';
    const type = document.getElementById('tx-filter-type')?.value || 'ALL';

    const url = new URL('/api/transactions', window.location.origin);
    if (search) url.searchParams.append('search', search);
    if (type && type !== 'ALL') url.searchParams.append('type', type);

    const res = await apiFetch(url);
    const result = await res.json();

    if (result.success) {
      renderTransactionsTable(result.data);
    }
  } catch (error) {
    console.error('Lỗi nạp biến động kho:', error);
  }
}

function renderTransactionsTable(items) {
  const tbody = document.getElementById('transaction-table-body');
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-[#86868B] text-xs">Không có dữ liệu lịch sử phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(tx => {
    const isPositive = tx.quantity_change > 0;
    const typeNames = {
      'STOCK_OUT': 'Xuất bán lẻ & Trừ tồn',
      'STOCK_IN': 'Nhập kho hàng',
      'ADJUST': 'Kiểm kê kho',
      'INIT': 'Khởi tạo đầu kỳ'
    };

    return `
      <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA] text-xs">
        <td class="py-3 px-4 text-[#86868B]">${tx.created_at ? tx.created_at.slice(0, 19).replace('T', ' ') : '--'}</td>
        <td class="py-3 px-4 font-mono font-bold text-[#1D1D1F]">${tx.reference_code || '--'}</td>
        <td class="py-3 px-4 font-semibold text-[#1D1D1F]">${typeNames[tx.transaction_type] || tx.transaction_type}</td>
        <td class="py-3 px-4 font-medium text-[#1D1D1F]">
          <div>${tx.product_name}</div>
          <div class="text-[10px] text-[#86868B] font-mono">${tx.sku}</div>
        </td>
        <td class="py-3 px-4 text-center font-bold ${isPositive ? 'text-emerald-600' : 'text-[#FF3B30]'}">
          ${isPositive ? '+' : ''}${tx.quantity_change} ${tx.unit}
        </td>
        <td class="py-3 px-4 text-center font-mono font-bold text-[#1D1D1F]">${tx.balance_after}</td>
        <td class="py-3 px-4 text-[#86868B] max-w-sm">${tx.note || '--'}</td>
      </tr>
    `;
  }).join('');
}

// ==============================================================================
// REPORTS MODULE
// ==============================================================================
async function loadReports() {
  try {
    const res = await apiFetch('/api/reports/inventory-valuation');
    const result = await res.json();

    if (result.success) {
      renderReportsUI(result.data);
    }
  } catch (error) {
    console.error('Lỗi tải báo cáo:', error);
  }
}

function renderReportsUI(data) {
  const container = document.getElementById('reports-content-container');
  if (!container || !data) return;

  const roleCfg = getCurrentRoleConfig();

  container.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
      <div class="apple-card p-4">
        <div class="text-[11px] text-[#86868B] font-medium">Tổng vốn hàng tồn</div>
        <div class="text-xl font-bold text-[#1D1D1F] mt-1">${roleCfg.canViewCostPrice ? formatVND(data.total_valuation) : '🔒 Bảo mật'}</div>
      </div>
      <div class="apple-card p-4">
        <div class="text-[11px] text-[#86868B] font-medium">Tổng giá trị bán niêm yết</div>
        <div class="text-xl font-bold text-emerald-700 mt-1">${formatVND(data.total_retail_value)}</div>
      </div>
      <div class="apple-card p-4">
        <div class="text-[11px] text-[#86868B] font-medium">Lợi nhuận gộp dự kiến</div>
        <div class="text-xl font-bold text-[#0071E3] mt-1">${roleCfg.canViewCostPrice ? formatVND(data.potential_profit) : '🔒 Bảo mật'}</div>
      </div>
    </div>
  `;
}

// ==============================================================================
// USERS MODULE
// ==============================================================================
async function loadUsers() {
  try {
    const res = await apiFetch('/api/users');
    const result = await res.json();
    if (result.success) {
      renderUsersTable(result.data);
    }
  } catch (error) {
    console.error('Lỗi nạp người dùng:', error);
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('user-table-body');
  if (!tbody || !users) return;

  const roleLabels = {
    admin: 'Chủ tiệm (Toàn quyền)',
    cashier: 'Thu ngân (POS)',
    warehouse: 'Quản kho (Nhập hàng)',
    staff: 'Nhân viên'
  };

  tbody.innerHTML = users.map(u => `
    <tr class="hover:bg-[#F9F9FA] transition border-b border-[#E5E5EA] text-xs">
      <td class="py-3 px-4 font-mono font-bold text-[#1D1D1F]">${u.username}</td>
      <td class="py-3 px-4 font-semibold text-[#1D1D1F]">${u.full_name}</td>
      <td class="py-3 px-4 text-[#86868B]">${roleLabels[u.role] || u.role}</td>
      <td class="py-3 px-4 text-[#86868B] font-mono">${u.phone || '--'}</td>
      <td class="py-3 px-4 text-center">
        ${u.username !== 'admin' ? `
          <button onclick="deleteUser(${u.id}, '${u.username}')" class="text-[#FF3B30] hover:underline text-[11px] font-semibold">
            Xóa
          </button>
        ` : '<span class="text-[10px] text-[#86868B]">Cố định</span>'}
      </td>
    </tr>
  `).join('');
}

function openUserModal() {
  document.getElementById('modal-user-id').value = '';
  document.getElementById('modal-user-username').value = '';
  document.getElementById('modal-user-fullname').value = '';
  document.getElementById('modal-user-password').value = '';
  document.getElementById('modal-user-phone').value = '';
  document.getElementById('modal-user').classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('modal-user').classList.add('hidden');
}

async function handleSaveUser(e) {
  e.preventDefault();
  const username = document.getElementById('modal-user-username').value.trim();
  const full_name = document.getElementById('modal-user-fullname').value.trim();
  const password = document.getElementById('modal-user-password').value;
  const role = document.getElementById('modal-user-role').value;
  const phone = document.getElementById('modal-user-phone').value.trim();

  if (!username || !full_name || !password) {
    showToast('Lỗi', 'Vui lòng điền đủ tên đăng nhập, họ tên và mật khẩu!', false);
    return;
  }

  try {
    const res = await apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name, password, role, phone })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Thành công', result.message);
      closeUserModal();
      loadUsers();
    } else {
      showToast('Lỗi', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi kết nối', error.message, false);
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Bạn có chắc muốn xóa tài khoản "${username}"?`)) return;

  try {
    const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Đã xóa', result.message);
      loadUsers();
    } else {
      showToast('Lỗi', result.message, false);
    }
  } catch (error) {
    showToast('Lỗi', error.message, false);
  }
}

// ==============================================================================
// AI COPILOT MODAL
// ==============================================================================
async function openAiCopilotModal() {
  const modal = document.getElementById('modal-ai-copilot');
  const loading = document.getElementById('ai-modal-loading');
  const content = document.getElementById('ai-modal-content');

  modal.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.classList.add('hidden');

  try {
    const res = await apiFetch('/api/ai/analyze');
    const result = await res.json();

    if (result.success && result.data) {
      loading.classList.add('hidden');
      content.classList.remove('hidden');

      const d = result.data;
      const score = Math.round(d.health_score || 0);
      document.getElementById('ai-health-score').textContent = `${score}/100`;

      const statusEl = document.getElementById('ai-health-status');
      if (statusEl) {
        if (score >= 80) {
          statusEl.className = 'px-3 py-1 rounded-full text-xs font-semibold apple-badge-safe';
          statusEl.textContent = 'Kho vận hành tối ưu';
        } else if (score >= 50) {
          statusEl.className = 'px-3 py-1 rounded-full text-xs font-semibold apple-badge-warning';
          statusEl.textContent = 'Cần lưu ý bổ sung & đảo date';
        } else {
          statusEl.className = 'px-3 py-1 rounded-full text-xs font-semibold apple-badge-danger';
          statusEl.textContent = 'Nguy cơ thiếu hàng / Cận hạn';
        }
      }

      const msgEl = document.getElementById('ai-modal-main-message');
      if (msgEl) {
        msgEl.textContent = d.ai_message || '';
      }

      const list = document.getElementById('ai-suggestions-list');
      if (d.recommendations && d.recommendations.length > 0) {
        list.innerHTML = d.recommendations.map(r => {
          let badgeColorClass = 'bg-slate-100 text-slate-800 border-slate-200';
          if (r.color === 'rose') badgeColorClass = 'bg-rose-50 text-rose-700 border-rose-200';
          else if (r.color === 'amber') badgeColorClass = 'bg-amber-50 text-amber-800 border-amber-200';
          else if (r.color === 'emerald') badgeColorClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
          else if (r.color === 'sky') badgeColorClass = 'bg-sky-50 text-sky-700 border-sky-200';

          return `
            <div class="p-3.5 rounded-xl border border-black/[0.06] bg-[#F9F9FA] space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold border uppercase tracking-wider ${badgeColorClass}">
                  ${r.badge || 'KHUYẾN NGHỊ'}
                </span>
              </div>
              <div class="text-[#1D1D1F] text-xs leading-relaxed font-medium">${r.text || r.detail || ''}</div>
            </div>
          `;
        }).join('');
      } else {
        list.innerHTML = `<div class="text-xs text-[#86868B] py-3 text-center">Kho hàng đang được vận hành rất chuẩn xác và tối ưu!</div>`;
      }
    }
  } catch (e) {
    loading.textContent = 'Lỗi kết nối AI Copilot: ' + e.message;
  }
}

function closeAiCopilotModal() {
  document.getElementById('modal-ai-copilot').classList.add('hidden');
}

// ==============================================================================
// RFID MODULE (Quản lý & Quét thẻ RFID tốc độ cao)
// ==============================================================================
let cachedRfidTags = [];

async function loadRfidView() {
  await Promise.all([
    loadRfidTags(),
    loadRfidLogs()
  ]);
}

async function loadRfidTags() {
  try {
    const search = document.getElementById('rfid-search')?.value || '';
    const url = new URL('/api/rfid/tags', window.location.origin);
    if (search.trim()) url.searchParams.append('search', search.trim());

    const res = await apiFetch(url);
    const result = await res.json();

    if (result.success) {
      cachedRfidTags = result.data || [];
      renderRfidTable(cachedRfidTags);

      const totalEl = document.getElementById('stat-rfid-total');
      const batchesEl = document.getElementById('stat-rfid-batches');
      const prodEl = document.getElementById('stat-rfid-products');
      const badgeEl = document.getElementById('menu-rfid-count');

      const batchCount = cachedRfidTags.filter(t => t.item_type === 'BATCH').length;
      const prodCount = cachedRfidTags.filter(t => t.item_type === 'PRODUCT').length;

      if (totalEl) totalEl.textContent = `${cachedRfidTags.length} Thẻ`;
      if (batchesEl) batchesEl.textContent = `${batchCount} Thùng`;
      if (prodEl) prodEl.textContent = `${prodCount} SP`;
      if (badgeEl) badgeEl.textContent = `${cachedRfidTags.length}`;
    }
  } catch (error) {
    console.error('Lỗi tải danh sách RFID:', error);
  }
}

function renderRfidTable(tags) {
  const tbody = document.getElementById('rfid-table-body');
  if (!tbody) return;

  if (tags.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-[#86868B]">Chưa có mã thẻ RFID nào được gắn.</td></tr>`;
    return;
  }

  tbody.innerHTML = tags.map(t => {
    const isBatch = t.item_type === 'BATCH';
    const typeBadge = isBatch
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">Lô Thùng</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Sản phẩm</span>`;

    return `
      <tr class="hover:bg-[#F9F9FA] transition border-b border-black/[0.05]">
        <td class="py-3 px-4 font-mono font-bold text-xs text-indigo-600">
          <div class="flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6m-6 4h4"/></svg>
            <span>${t.rfid_tag}</span>
          </div>
        </td>
        <td class="py-3 px-4">${typeBadge}</td>
        <td class="py-3 px-4 font-bold text-[#1D1D1F]">${t.name}</td>
        <td class="py-3 px-4 font-mono text-[#86868B] text-xs">${t.batch_code || t.sku}</td>
        <td class="py-3 px-4 text-center font-bold text-[#1D1D1F]">${t.current_stock} ${t.unit}</td>
        <td class="py-3 px-4 text-[#86868B]">${t.location || '--'}</td>
        <td class="py-3 px-4 font-mono text-xs ${t.expiry_date ? 'text-amber-700 font-semibold' : 'text-[#86868B]'}">${t.expiry_date || 'Theo từng thùng'}</td>
        <td class="py-3 px-4 text-center">
          <button onclick="testRfidScan('${t.rfid_tag}')" class="apple-btn px-2.5 py-1 apple-btn-secondary text-xs font-medium">
            Quét thử
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadRfidLogs() {
  try {
    const res = await apiFetch('/api/rfid/logs');
    const result = await res.json();
    const tbody = document.getElementById('rfid-logs-table-body');
    if (!tbody) return;

    if (result.success && result.data && result.data.length > 0) {
      tbody.innerHTML = result.data.slice(0, 15).map(l => {
        const timeStr = l.created_at ? l.created_at.slice(5, 19).replace('T', ' ') : '--';
        return `
          <tr class="hover:bg-[#F9F9FA] transition border-b border-black/[0.05]">
            <td class="py-2.5 px-3 font-mono text-[11px] text-[#86868B]">${timeStr}</td>
            <td class="py-2.5 px-3 font-mono text-xs text-indigo-600 font-semibold">${l.rfid_tag}</td>
            <td class="py-2.5 px-3 font-medium text-xs text-[#1D1D1F]">${l.scan_type}</td>
            <td class="py-2.5 px-3 text-xs font-semibold text-[#1D1D1F]">${l.product_name || '--'}</td>
            <td class="py-2.5 px-3 text-xs font-bold text-center text-[#1D1D1F]">${l.quantity || 1}</td>
            <td class="py-2.5 px-3 text-xs text-[#86868B]">${l.location || '--'}</td>
            <td class="py-2.5 px-3 text-xs text-[#86868B]">${l.note || '--'}</td>
          </tr>
        `;
      }).join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-[#86868B]">Chưa có lịch sử quét thẻ RFID.</td></tr>`;
    }
  } catch (e) {
    console.error('Lỗi nạp nhật ký RFID:', e);
  }
}

function handleRfidQuickScan(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    triggerRfidQuickScan();
  }
}

async function triggerRfidQuickScan() {
  const input = document.getElementById('rfid-quick-input');
  const tag = input?.value.trim();
  if (!tag) {
    showToast('Lỗi', 'Vui lòng nhập hoặc quét mã thẻ RFID!', false);
    return;
  }

  await testRfidScan(tag);
  if (input) input.value = '';
}

async function testRfidScan(tag) {
  try {
    const res = await apiFetch('/api/rfid/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, scan_type: 'INSPECTION' })
    });
    const result = await res.json();

    if (result.success && result.data && result.data.length > 0) {
      const match = result.data[0];
      if (match.found) {
        showToast('Nhận diện thẻ RFID thành công!', `[${match.type}] ${match.data.product_name} • Tồn: ${match.data.quantity} ${match.data.unit}`);
      } else {
        showToast('Mã thẻ chưa gán', `Thẻ "${tag}" chưa được liên kết với sản phẩm hoặc thùng nào`, false);
      }
      loadRfidLogs();
    }
  } catch (e) {
    showToast('Lỗi quét RFID', e.message, false);
  }
}

function openRfidScanModal() {
  document.getElementById('modal-rfid-scan').classList.remove('hidden');
  const results = document.getElementById('rfid-bulk-results-container');
  if (results) results.classList.add('hidden');
}

function closeRfidScanModal() {
  document.getElementById('modal-rfid-scan').classList.add('hidden');
}

function fillSampleRfidTags() {
  const area = document.getElementById('rfid-bulk-tags-input');
  if (area) {
    area.value = 'E28011606000020420000001\nRFID-HH-01\nRFID-CP-02\nRFID-TIG-01\nRFID-UNKNOWN-999';
  }
}

async function submitBulkRfidScan() {
  const area = document.getElementById('rfid-bulk-tags-input');
  const purpose = document.getElementById('rfid-scan-purpose')?.value || 'INSPECTION';
  const text = area?.value.trim() || '';

  if (!text) {
    showToast('Danh sách trống', 'Vui lòng nhập ít nhất 1 mã thẻ RFID!', false);
    return;
  }

  const tags = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  try {
    const res = await apiFetch('/api/rfid/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags, scan_type: purpose })
    });
    const result = await res.json();

    if (result.success) {
      const container = document.getElementById('rfid-bulk-results-container');
      const stats = document.getElementById('rfid-bulk-stats');
      const list = document.getElementById('rfid-bulk-results-list');

      container.classList.remove('hidden');
      stats.textContent = `Đã nhận diện: ${result.matched} / ${result.total_scanned} thẻ`;

      list.innerHTML = result.data.map(item => {
        if (item.found) {
          return `
            <div class="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs flex items-center justify-between">
              <div>
                <span class="font-bold text-emerald-800">${item.data.product_name}</span>
                <span class="text-emerald-600 font-mono text-[10px] ml-1">(${item.tag})</span>
              </div>
              <span class="font-bold text-emerald-800">${item.data.quantity} ${item.data.unit}</span>
            </div>
          `;
        } else {
          return `
            <div class="p-2 rounded-lg bg-rose-50 border border-rose-200 text-xs flex items-center justify-between">
              <span class="text-rose-700 font-mono">${item.tag}</span>
              <span class="text-rose-600 text-[11px]">Chưa đăng ký</span>
            </div>
          `;
        }
      }).join('');

      showToast('Quét RFID hoàn tất', `Nhận diện ${result.matched} sản phẩm/thùng hàng`);
      loadRfidLogs();
      loadInventory();
      loadDashboard();
    }
  } catch (e) {
    showToast('Lỗi quét RFID hàng loạt', e.message, false);
  }
}

