// State management for POS Administration
let posState = {
  currentPanel: 'pos',
  currentInventoryTab: 'stock',
  currentOrderTab: 'pending',
  categories: [],
  dishes: [],
  ingredients: [],
  pendingOrders: [],
  selectedOrder: null,
  walkinCart: {}, // cartKey -> item
  purchaseInputItems: [] // temp items for purchase entry
};

// Chart.js instances to allow destroying and recreating
let charts = {
  dailyRevenue: null,
  topSelling: null,
  hourlyTrend: null,
  scrapLoss: null
};

document.addEventListener('DOMContentLoaded', () => {
  // Set default dates
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  if (document.getElementById('purchaseDate')) document.getElementById('purchaseDate').value = today;
  if (document.getElementById('scrapDate')) document.getElementById('scrapDate').value = today;

  // Initial fetch of static lists
  fetchInitialData();
  
  // Set up refresh timer for pending orders (poll every 8 seconds)
  setInterval(() => {
    if (posState.currentPanel === 'pos') {
      fetchOrdersList();
    }
  }, 8000);
});

async function fetchInitialData() {
  try {
    const [catRes, dishRes, ingRes] = await Promise.all([
      fetch(API_BASE_URL + '/api/categories'),
      fetch(API_BASE_URL + '/api/dishes'),
      fetch(API_BASE_URL + '/api/ingredients')
    ]);
    
    posState.categories = await catRes.json();
    posState.dishes = await dishRes.json();
    posState.ingredients = await ingRes.json();

    // Populate dropdown filters
    populateDropdowns();
    
    // Initial panel load
    switchPanel('pos');
  } catch (error) {
    console.error('Error fetching initial POS data:', error);
  }
}

function populateDropdowns() {
  // Category dropdown for walk-in order modal
  const walkinCat = document.getElementById('walkinCategoryFilter');
  if (walkinCat) {
    walkinCat.innerHTML = '<option value="all">所有分類</option>';
    posState.categories.forEach(cat => {
      walkinCat.innerHTML += `<option value="${cat.category_id}">${cat.category_name}</option>`;
    });
  }

  // Ingredient select for purchase modal
  const purchaseSelect = document.getElementById('purchaseSelectIngredient');
  if (purchaseSelect) {
    purchaseSelect.innerHTML = '<option value="">請選擇食材...</option>';
    posState.ingredients.forEach(ing => {
      purchaseSelect.innerHTML += `<option value="${ing.ingredient_id}">${ing.ingredient_name} (${ing.unit})</option>`;
    });
  }

  // Ingredient select for scrap modal
  const scrapSelect = document.getElementById('scrapSelectIngredient');
  if (scrapSelect) {
    scrapSelect.innerHTML = '<option value="">請選擇食材...</option>';
    posState.ingredients.forEach(ing => {
      scrapSelect.innerHTML += `<option value="${ing.ingredient_id}">${ing.ingredient_name}</option>`;
    });
    // Set up unit label display change trigger
    scrapSelect.addEventListener('change', (e) => {
      const ingId = parseInt(e.target.value);
      const ing = posState.ingredients.find(i => i.ingredient_id === ingId);
      document.getElementById('scrapUnitLabel').value = ing ? ing.unit : '';
    });
  }

  // Category select for create dish modal
  const createDishCat = document.getElementById('createDishCategory');
  if (createDishCat) {
    createDishCat.innerHTML = '';
    posState.categories.forEach(cat => {
      createDishCat.innerHTML += `<option value="${cat.category_id}">${cat.category_name}</option>`;
    });
  }

  // Ingredient select for recipe editor modal
  const recipeSelect = document.getElementById('recipeSelectIngredient');
  if (recipeSelect) {
    recipeSelect.innerHTML = '<option value="">請選擇食材...</option>';
    posState.ingredients.forEach(ing => {
      recipeSelect.innerHTML += `<option value="${ing.ingredient_id}">${ing.ingredient_name} (${ing.unit})</option>`;
    });
  }
}

// ----------------------------------------------------
// Panel / Tab Switching
// ----------------------------------------------------
function switchPanel(panelId) {
  posState.currentPanel = panelId;
  
  // Update nav item active status
  document.querySelectorAll('.sidebar-menu .menu-item').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Match panel toggle
  const matchingBtn = Array.from(document.querySelectorAll('.sidebar-menu .menu-item')).find(btn => 
    btn.getAttribute('onclick').includes(`'${panelId}'`)
  );
  if (matchingBtn) matchingBtn.classList.add('active');

  // Hide all panels, show matching
  document.querySelectorAll('.panel-section').forEach(section => {
    section.classList.remove('active');
  });
  document.getElementById(`panel-${panelId}`).classList.add('active');

  // Load panel specific data
  if (panelId === 'pos') {
    fetchOrdersList();
  } else if (panelId === 'inventory') {
    loadInventoryData();
  } else if (panelId === 'menu') {
    renderMenuTable();
  } else if (panelId === 'reports') {
    loadReportsData();
  }
}

function switchInventoryTab(tabId) {
  posState.currentInventoryTab = tabId;
  document.getElementById('tab-stock-btn').className = tabId === 'stock' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('tab-purchase-btn').className = tabId === 'purchase' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('tab-scrap-btn').className = tabId === 'scrap' ? 'btn btn-primary' : 'btn btn-outline';

  // Hide/Show tables
  document.getElementById('subpanel-stock').style.display = tabId === 'stock' ? 'block' : 'none';
  document.getElementById('subpanel-purchase').style.display = tabId === 'purchase' ? 'block' : 'none';
  document.getElementById('subpanel-scrap').style.display = tabId === 'scrap' ? 'block' : 'none';

  loadInventoryData();
}

// ----------------------------------------------------
// Panel 1: POS Cashier Methods
// ----------------------------------------------------
function switchOrderTab(tab) {
  posState.currentOrderTab = tab;
  document.getElementById('tabPendingOrders').className = tab === 'pending' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('tabHistoryOrders').className = tab === 'history' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('tabPendingOrders').style.padding = '4px 8px';
  document.getElementById('tabHistoryOrders').style.padding = '4px 8px';
  
  const historyDateInput = document.getElementById('historyOrderDate');
  if (historyDateInput) {
    if (tab === 'history') {
      historyDateInput.style.display = 'inline-block';
      if (!historyDateInput.value) {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        historyDateInput.value = `${year}-${month}-${day}`;
      }
    } else {
      historyDateInput.style.display = 'none';
    }
  }

  fetchOrdersList();
}

async function fetchOrdersList() {
  try {
    const status = posState.currentOrderTab === 'history' ? 'Paid' : 'Pending';
    let url = `${API_BASE_URL}/api/orders?status=${status}`;
    if (status === 'Paid') {
      const historyDateInput = document.getElementById('historyOrderDate');
      if (historyDateInput && historyDateInput.value) {
        url += `&date=${historyDateInput.value}`;
      }
    }
    const res = await fetch(url);
    posState.pendingOrders = await res.json();
    renderOrdersList();
  } catch (error) {
    console.error('Error fetching orders:', error);
  }
}

function renderOrdersList() {
  const container = document.getElementById('pendingOrdersList');
  container.innerHTML = '';

  if (posState.pendingOrders.length === 0) {
    container.innerHTML = `
      <div style="grid-column: span 3; text-align:center; padding:40px; color:var(--txt-muted); background:var(--bg-card); border-radius:var(--radius-md); border:1px dashed var(--border);">
        正在顯示 ${posState.currentOrderTab === 'history' ? '歷史' : '待付款'} 訂單      </div>
    `;
    return;
  }

  posState.pendingOrders.forEach(order => {
    const card = document.createElement('div');
    card.className = `pending-order-card animate-fade-in ${posState.selectedOrder && posState.selectedOrder.order_id === order.order_id ? 'selected' : ''}`;
    card.addEventListener('click', () => selectOrderForCheckout(order.order_id));

    // Format local time
    const timeStr = new Date(order.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-table">${order.table_number}</span>
        <span class="order-card-time">${timeStr}</span>
      </div>
      <div class="order-card-summary">訂單編號: #${order.order_id}</div>
      <div class="order-card-total">$${parseFloat(order.total_amount).toFixed(0)}</div>
    `;

    container.appendChild(card);
  });
}

async function selectOrderForCheckout(orderId) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}`);
    const orderDetails = await res.json();
    posState.selectedOrder = orderDetails;

    // Highlight card
    renderOrdersList();

    // Render in Checkout Register
    document.getElementById('checkoutOrderTitle').textContent = `${orderDetails.table_number} (#${orderDetails.order_id}) - ${orderDetails.status}`;
    document.getElementById('checkoutTotalAmount').textContent = `$${parseFloat(orderDetails.total_amount).toFixed(0)}`;
    
    // Render items list
    const itemsList = document.getElementById('checkoutItemsList');
    itemsList.innerHTML = '';
    
    orderDetails.items.forEach(item => {
      let custHtml = '';
      if (item.customizations) {
        try {
          const opts = typeof item.customizations === 'string' ? JSON.parse(item.customizations) : item.customizations;
          if (opts && opts.length > 0) {
            custHtml = `<div style="font-size:0.75rem; color:var(--txt-muted);">${opts.map(o => o.name).join(', ')}</div>`;
          }
        } catch(e) {}
      }

      const row = document.createElement('div');
      row.className = 'checkout-item';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'flex-start';
      row.innerHTML = `
        <div style="flex:1;">
          <div>${item.dish_name} x ${item.quantity}</div>
          ${custHtml}
        </div>
        <span style="font-weight:600; width:60px; text-align:right;">$${(parseFloat(item.price_at_order) * item.quantity).toFixed(0)}</span>
      `;
      itemsList.appendChild(row);
    });

    // Reset cashier input fields
    document.getElementById('cashReceived').value = Math.ceil(parseFloat(orderDetails.total_amount) / 50) * 50; // Auto round to 50s
    calculateChange();

    // Setup button states based on status
    if (orderDetails.status === 'Paid') {
      document.getElementById('checkoutBtn').style.display = 'none';
      document.getElementById('cancelOrderBtn').style.display = 'none';
      document.getElementById('refundOrderBtn').style.display = 'block';
      document.getElementById('refundOrderBtn').disabled = false;
      document.getElementById('cashReceived').disabled = true;
    } else {
      document.getElementById('checkoutBtn').style.display = 'block';
      document.getElementById('cancelOrderBtn').style.display = 'block';
      document.getElementById('refundOrderBtn').style.display = 'none';
      document.getElementById('cashReceived').disabled = false;
      document.getElementById('cancelOrderBtn').disabled = false;
    }
    
    document.getElementById('printReceiptBtn').disabled = false;
  } catch (error) {
    console.error('Error fetching order details:', error);
  }
}

function calculateChange() {
  if (!posState.selectedOrder) return;
  const total = parseFloat(posState.selectedOrder.total_amount);
  const received = parseFloat(document.getElementById('cashReceived').value) || 0;
  const change = received - total;

  const changeLabel = document.getElementById('cashChange');
  if (change >= 0) {
    changeLabel.textContent = `$${change.toFixed(0)}`;
    changeLabel.style.color = 'var(--secondary)';
    document.getElementById('checkoutBtn').disabled = false;
  } else {
    changeLabel.textContent = `不足 $${Math.abs(change).toFixed(0)}`;
    changeLabel.style.color = 'var(--danger)';
    document.getElementById('checkoutBtn').disabled = true; // disable pay if cash is insufficient
  }
}

async function checkoutSelectedOrder() {
  if (!posState.selectedOrder) return;
  const orderId = posState.selectedOrder.order_id;
  const checkoutBtn = document.getElementById('checkoutBtn');
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = '處理中...';

  try {
    const res = await fetch(`${API_BASE_URL}/api/orders/${orderId}/checkout`, { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert(`訂單 #${orderId} 結帳完成！庫存數量已自動扣除。`);
      
      // Clear checkout panel
      posState.selectedOrder = null;
      resetCheckoutPanel();
      
      // Refresh lists
      fetchInitialData(); // Reload ingredients in state
    } else {
      alert(`結帳失敗: ${result.error}`);
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = '確認結帳 (扣庫存)';
    }
  } catch (error) {
    console.error('Error during checkout:', error);
    alert('伺服器連線失敗');
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = '確認結帳 (扣庫存)';
  }
}

async function cancelSelectedOrder() {
  if (!posState.selectedOrder) return;
  if (!confirm(`確定要取消此筆訂單 #${posState.selectedOrder.order_id} 嗎？`)) return;
  
  try {
    const res = await fetch(`${API_BASE_URL}/api/orders/${posState.selectedOrder.order_id}/cancel`, { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      posState.selectedOrder = null;
      resetCheckoutPanel();
      fetchPendingOrders();
    } else {
      alert(`取消失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error cancelling order:', error);
  }
}

async function refundSelectedOrder() {
  if (!posState.selectedOrder) return;
  if (!confirm(`確定作廢並退款此筆訂單 #${posState.selectedOrder.order_id} 嗎？食材庫存將自動退回系統。`)) return;
  
  try {
    const res = await fetch(`${API_BASE_URL}/api/orders/${posState.selectedOrder.order_id}/refund`, { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert('訂單已作廢，庫存已加回');
      posState.selectedOrder = null;
      resetCheckoutPanel();
      fetchOrdersList();
      fetchInitialData();
    } else {
      alert(`作廢失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error refunding order:', error);
  }
}

function printReceipt() {
  if (!posState.selectedOrder) return;
  const o = posState.selectedOrder;
  const printContent = `
    <div style="width:100%; text-align:center;">
      <h2 style="margin:0;">波里早餐店</h2>
      <p style="margin:4px 0;">訂單號碼: #${o.order_id} | 桌號: ${o.table_number}</p>
      <p style="margin:4px 0;">時間: ${new Date().toLocaleString('zh-TW')}</p>
      <hr style="border-top:1px dashed #000; margin:8px 0;">
      <table style="width:100%; text-align:left; font-size:12px;">
        ${o.items.map(i => {
           let cust = '';
           if (i.customizations) {
             try {
               let arr = typeof i.customizations === 'string' ? JSON.parse(i.customizations) : i.customizations;
               if (arr && arr.length) cust = '<br><small style="color:#666;"> - ' + arr.map(a => a.name).join(', ') + '</small>';
             }catch(e){}
           }
           return `<tr><td style="padding:4px 0;">${i.dish_name} x ${i.quantity} ${cust}</td><td style="text-align:right;">$${parseFloat(i.price_at_order)*i.quantity}</td></tr>`;
        }).join('')}
      </table>
      <hr style="border-top:1px dashed #000; margin:8px 0;">
      <div style="display:flex; justify-content:space-between; font-weight:bold;">
        <span>合計金額</span><span>$${o.total_amount}</span>
      </div>
      <p style="font-size:10px; margin-top:16px;">謝謝光臨，歡迎下次再來</p>
    </div>
  `;
  document.getElementById('printContainer').innerHTML = printContent;
  window.print();
}

function resetCheckoutPanel() {
  document.getElementById('checkoutOrderTitle').textContent = '請由左側點選一筆訂單進行結帳';
  document.getElementById('checkoutTotalAmount').textContent = '$0';
  document.getElementById('checkoutItemsList').innerHTML = `
    <div style="text-align:center; padding:40px 0; color:var(--txt-muted); font-size:0.9rem;">
      請由左側點選一筆訂單進行結帳
    </div>
  `;
  document.getElementById('cashReceived').value = '0';
  document.getElementById('cashChange').textContent = '$0';
  document.getElementById('cashChange').style.color = 'var(--txt-main)';
  const checkoutBtn = document.getElementById('checkoutBtn');
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = '確認結帳 (扣庫存)';
  document.getElementById('cancelOrderBtn').disabled = true;
}

// Walk-in Order Modal Operations
function openWalkinOrderModal() {
  posState.walkinCart = {};
  document.getElementById('walkinCartList').innerHTML = '<div style="color:var(--txt-muted); font-size:0.9rem; text-align:center;">尚未點選任何餐點</div>';
  document.getElementById('walkinOrderModal').classList.add('active');
  
  // Load dishes in modal
  filterWalkinDishes();
}

function closeWalkinOrderModal() {
  document.getElementById('walkinOrderModal').classList.remove('active');
}

function filterWalkinDishes() {
  const catId = document.getElementById('walkinCategoryFilter').value;
  const grid = document.getElementById('walkinDishesGrid');
  grid.innerHTML = '';

  const list = catId === 'all' 
    ? posState.dishes 
    : posState.dishes.filter(d => d.category_id === parseInt(catId));

  list.forEach(dish => {
    const btn = document.createElement('button');
    btn.className = 'modal-pos-item-btn';
    btn.innerHTML = `
      <div style="font-weight:700;">${dish.dish_name}</div>
      <div style="color:var(--primary-dark); font-weight:700; margin-top:4px;">$${parseFloat(dish.price).toFixed(0)}</div>
    `;
    btn.addEventListener('click', () => openWalkinCustomizationModal(dish.dish_id));
    grid.appendChild(btn);
  });
}

// Walkin Customization Modal
let currentWalkinDishId = null;

function openWalkinCustomizationModal(dishId) {
  currentWalkinDishId = dishId;
  const dish = posState.dishes.find(d => d.dish_id === dishId);
  if (!dish) return;

  document.getElementById('walkinCustomizationTitle').textContent = `客製化選項 - ${dish.dish_name}`;
  document.querySelectorAll('.walkin-cust-cb').forEach(cb => cb.checked = false);
  document.getElementById('walkinIce').value = '';
  document.getElementById('walkinSugar').value = '';
  document.getElementById('walkinCustomizationModal').classList.add('active');
}

function closeWalkinCustomizationModal() {
  document.getElementById('walkinCustomizationModal').classList.remove('active');
  currentWalkinDishId = null;
}

function confirmWalkinCustomization() {
  if (!currentWalkinDishId) return;
  const dish = posState.dishes.find(d => d.dish_id === currentWalkinDishId);
  
  const customizations = [];
  document.querySelectorAll('.walkin-cust-cb:checked').forEach(cb => {
    customizations.push({ name: cb.value, price: parseFloat(cb.dataset.price) || 0 });
  });

  const ice = document.getElementById('walkinIce').value;
  if (ice) customizations.push({ name: ice, price: 0 });

  const sugar = document.getElementById('walkinSugar').value;
  if (sugar) customizations.push({ name: sugar, price: 0 });

  const custStr = JSON.stringify(customizations);
  const cartKey = `${dish.dish_id}_${custStr}`;

  if (!posState.walkinCart[cartKey]) {
    let optionsTotal = customizations.reduce((sum, c) => sum + c.price, 0);
    posState.walkinCart[cartKey] = {
      id: dish.dish_id,
      cartKey: cartKey,
      name: dish.dish_name,
      basePrice: parseFloat(dish.price),
      price: parseFloat(dish.price) + optionsTotal,
      quantity: 0,
      customizations: customizations
    };
  }

  posState.walkinCart[cartKey].quantity += 1;

  closeWalkinCustomizationModal();
  renderWalkinCart();
}

function updateWalkinCartQty(cartKey, change) {
  if (posState.walkinCart[cartKey]) {
    posState.walkinCart[cartKey].quantity += change;
    if (posState.walkinCart[cartKey].quantity <= 0) {
      delete posState.walkinCart[cartKey];
    }
  }
  renderWalkinCart();
}

function renderWalkinCart() {
  const container = document.getElementById('walkinCartList');
  container.innerHTML = '';
  
  const items = Object.values(posState.walkinCart);
  if (items.length === 0) {
    container.innerHTML = '<div style="color:var(--txt-muted); font-size:0.9rem; text-align:center;">尚未點選任何餐點</div>';
    return;
  }

  items.forEach(item => {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    div.style.padding = '4px 8px';
    div.style.background = 'var(--bg-main)';
    div.style.borderRadius = 'var(--radius-sm)';

    div.innerHTML = `
      <div style="flex:1;">
        <span style="font-weight:600;">${item.name} ($${item.price.toFixed(0)})</span>
        <div style="font-size:0.75rem; color:var(--txt-muted);">${item.customizations ? item.customizations.map(c => c.name).join(', ') : ''}</div>
      </div>
      <div class="quantity-control" style="padding: 2px;">
        <button class="qty-btn" style="width:24px; height:24px;" onclick="updateWalkinCartQty('${item.cartKey}', -1)">-</button>
        <span class="qty-val" style="font-size:0.85rem;">${item.quantity}</span>
        <button class="qty-btn" style="width:24px; height:24px;" onclick="updateWalkinCartQty('${item.cartKey}', 1)">+</button>
      </div>
    `;
    container.appendChild(div);
  });
}

async function submitWalkinOrder() {
  const items = Object.values(posState.walkinCart).map(item => ({
    dish_id: item.id,
    quantity: item.quantity,
    customizations: item.customizations
  }));

  if (items.length === 0) {
    alert('請先點選餐點');
    return;
  }

  const table = document.getElementById('walkinTable').value;

  try {
    const res = await fetch(API_BASE_URL + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableNumber: table,
        items: items,
        status: 'Pending'
      })
    });
    
    const result = await res.json();
    if (result.success) {
      closeWalkinOrderModal();
      switchOrderTab('pending'); // Auto load newly created walk-in order
      selectOrderForCheckout(result.orderId); 
    } else {
      alert(`送出失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error submitting walkin order:', error);
  }
}

// ----------------------------------------------------
// Panel 2: Inventory Management Methods
// ----------------------------------------------------
async function loadInventoryData() {
  try {
    if (posState.currentInventoryTab === 'stock') {
      const res = await fetch(API_BASE_URL + '/api/ingredients');
      posState.ingredients = await res.json();
      populateDropdowns(); // Update selectors just in case
      renderInventoryTable();
    } else if (posState.currentInventoryTab === 'purchase') {
      const res = await fetch(API_BASE_URL + '/api/purchases');
      const purchases = await res.json();
      renderPurchaseTable(purchases);
    } else if (posState.currentInventoryTab === 'scrap') {
      const res = await fetch(API_BASE_URL + '/api/scraps');
      const scraps = await res.json();
      renderScrapTable(scraps);
    }
  } catch (error) {
    console.error('Error loading inventory data:', error);
  }
}

function renderInventoryTable() {
  const tbody = document.getElementById('inventoryTableBody');
  tbody.innerHTML = '';
  
  posState.ingredients.forEach(ing => {
    const tr = document.createElement('tr');
    
    // Check safety stock levels (arbitrary safety warning threshold defaults to 50 if null)
    const stockQty = parseFloat(ing.stock_quantity);
    const safeStock = parseFloat(ing.safe_stock_level) || 50;
    
    let stockStatus = '<span class="badge badge-success">充足</span>';
    let stockValClass = '';
    
    if (stockQty < safeStock) {
      stockStatus = '<span class="badge badge-danger">低於安全庫存 (建議補貨)</span>';
      stockValClass = 'low-stock-alert';
    }

    tr.innerHTML = `
      <td>${ing.ingredient_id}</td>
      <td style="font-weight:700;">${ing.ingredient_name}</td>
      <td class="${stockValClass}" style="font-weight:700;">${stockQty.toFixed(1)}</td>
      <td>${ing.unit}</td>
      <td>$${parseFloat(ing.cost_per_unit || 0).toFixed(2)}</td>
      <td><input type="number" step="any" min="0" class="form-control" style="width: 80px; padding: 4px; font-size: 0.9rem; text-align: center;" value="${safeStock}" onchange="updateSafeStock(${ing.ingredient_id}, this.value)"></td>
      <td>${stockStatus}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function updateSafeStock(ingredientId, newValue) {
  const safeStockLevel = parseFloat(newValue) || 0;
  try {
    const res = await fetch(API_BASE_URL + '/api/ingredients/' + ingredientId + '/safe-stock', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeStockLevel })
    });
    const data = await res.json();
    if (data.success) {
      // Find and update local state
      const ing = posState.ingredients.find(i => i.ingredient_id === ingredientId);
      if (ing) ing.safe_stock_level = safeStockLevel;
      // Re-render table without fetching to show updated status immediately
      renderInventoryTable();
    } else {
      alert('更新安全存量失敗: ' + data.error);
    }
  } catch (err) {
    console.error(err);
    alert('更新安全存量發生錯誤');
  }
}

function renderPurchaseTable(purchases) {
  const tbody = document.getElementById('purchaseLogsTableBody');
  tbody.innerHTML = '';

  if (purchases.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--txt-muted);">無進貨歷史紀錄</td></tr>';
    return;
  }

  purchases.forEach(po => {
    const tr = document.createElement('tr');
    
    // Format detail list
    const details = po.items.map(item => 
      `${item.ingredient_name}: ${parseFloat(item.quantity).toFixed(0)}${item.unit} ($${parseFloat(item.cost_per_unit).toFixed(1)}/${item.unit})`
    ).join('<br>');

    const dateStr = new Date(po.purchase_date).toLocaleDateString('zh-TW');

    tr.innerHTML = `
      <td style="font-weight:700;">#${po.purchase_id}</td>
      <td>${dateStr}</td>
      <td>${po.supplier || '未知'}</td>
      <td style="font-size:0.85rem; line-height:1.4;">${details}</td>
      <td style="font-weight:800; color:var(--primary-dark);">$${parseFloat(po.total_cost).toFixed(0)}</td>
      <td>
        <button class="btn btn-outline" style="padding: 2px 6px; font-size: 12px; border-color:var(--danger); color:var(--danger);" onclick="deletePurchase(${po.purchase_id})">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderScrapTable(scraps) {
  const tbody = document.getElementById('scrapLogsTableBody');
  tbody.innerHTML = '';

  if (scraps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--txt-muted);">無食材報廢紀錄</td></tr>';
    return;
  }

  scraps.forEach(s => {
    const tr = document.createElement('tr');
    const cost = parseFloat(s.quantity) * parseFloat(s.cost_per_unit);
    const dateStr = new Date(s.scrap_date).toLocaleDateString('zh-TW');

    tr.innerHTML = `
      <td>#${s.scrap_id}</td>
      <td>${dateStr}</td>
      <td style="font-weight:700;">${s.ingredient_name}</td>
      <td>${parseFloat(s.quantity).toFixed(1)}</td>
      <td>${s.unit}</td>
      <td style="color:var(--danger); font-weight:700;">$${cost.toFixed(1)}</td>
      <td style="font-size:0.85rem; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${s.reason}">${s.reason}</td>
      <td>
        <button class="btn btn-outline" style="padding: 2px 6px; font-size: 12px; margin-right:4px;" onclick="editScrap(${s.scrap_id}, ${s.quantity}, '${s.reason || ''}', '${s.ingredient_name}', '${s.scrap_date}', '${s.unit}')">編輯</button>
        <button class="btn btn-outline" style="padding: 2px 6px; font-size: 12px; border-color:var(--danger); color:var(--danger);" onclick="deleteScrap(${s.scrap_id})">刪除</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterInventoryTable() {
  const keyword = document.getElementById('inventorySearch').value.trim().toLowerCase();
  const rows = document.querySelectorAll('#inventoryTableBody tr');
  
  rows.forEach(row => {
    const nameCol = row.querySelector('td:nth-child(2)').textContent.toLowerCase();
    if (nameCol.includes(keyword)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

// Purchase Invoice Input Form modal operations
function openPurchaseModal() {
  posState.purchaseInputItems = [];
  renderPurchaseInputItems();
  document.getElementById('purchaseModal').classList.add('active');
}

function closePurchaseModal() {
  document.getElementById('purchaseModal').classList.remove('active');
}

function addPurchaseRowItem() {
  const select = document.getElementById('purchaseSelectIngredient');
  const qtyInput = document.getElementById('purchaseInputQty');
  const costInput = document.getElementById('purchaseInputCost');

  const ingId = parseInt(select.value);
  const qty = parseFloat(qtyInput.value) || 0;
  const totalCost = parseFloat(costInput.value) || 0;

  if (!ingId || qty <= 0 || totalCost < 0) {
    alert('請輸入正確數量與金額');
    return;
  }

  const costPerUnit = totalCost / qty;

  const ing = posState.ingredients.find(i => i.ingredient_id === ingId);
  
  // Check if item already added in list
  const existing = posState.purchaseInputItems.find(item => item.ingredient_id === ingId);
  if (existing) {
    existing.quantity += qty;
    existing.cost_per_unit = costPerUnit; // Update latest cost
  } else {
    posState.purchaseInputItems.push({
      ingredient_id: ingId,
      name: ing.ingredient_name,
      unit: ing.unit,
      quantity: qty,
      cost_per_unit: costPerUnit
    });
  }

  // Clear inputs
  select.value = '';
  qtyInput.value = '';
  costInput.value = '';

  renderPurchaseInputItems();
}

function removePurchaseRowItem(index) {
  posState.purchaseInputItems.splice(index, 1);
  renderPurchaseInputItems();
}

function renderPurchaseInputItems() {
  const tbody = document.getElementById('purchaseInputItemsBody');
  tbody.innerHTML = '';

  if (posState.purchaseInputItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--txt-muted);">尚未新增任何進貨項目</td></tr>';
    return;
  }

  posState.purchaseInputItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    const subtotal = item.quantity * item.cost_per_unit;
    tr.innerHTML = `
      <td>${item.name}</td>
      <td>${item.quantity.toFixed(1)} ${item.unit}</td>
      <td>$${item.cost_per_unit.toFixed(2)}</td>
      <td>$${subtotal.toFixed(0)}</td>
      <td><button class="btn btn-danger" style="padding:4px 8px; font-size:0.8rem;" onclick="removePurchaseRowItem(${index})">移除</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function submitPurchaseInvoice() {
  if (posState.purchaseInputItems.length === 0) {
    alert('進貨單無任何新增項目');
    return;
  }

  const date = document.getElementById('purchaseDate').value;
  const supplier = document.getElementById('purchaseSupplier').value.trim();

  if (!date) {
    alert('請填寫進貨日期');
    return;
  }

  try {
    const res = await fetch(API_BASE_URL + '/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchaseDate: date,
        supplier: supplier || null,
        items: posState.purchaseInputItems
      })
    });

    const result = await res.json();
    if (result.success) {
      alert('進貨單儲存成功！庫存餘額已自動累加。');
      closePurchaseModal();
      loadInventoryData();
    } else {
      alert(`儲存失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error submitting purchase invoice:', error);
  }
}

// Scrap Modal Operations
function openScrapModal() {
  document.getElementById('scrapSelectIngredient').value = '';
  document.getElementById('scrapQty').value = '';
  document.getElementById('scrapUnitLabel').value = '';
  document.getElementById('scrapReason').value = '';
  document.getElementById('scrapModal').classList.add('active');
}

function closeScrapModal() {
  document.getElementById('scrapModal').classList.remove('active');
}

async function submitScrap() {
  const date = document.getElementById('scrapDate').value;
  const ingId = parseInt(document.getElementById('scrapSelectIngredient').value);
  const qty = parseFloat(document.getElementById('scrapQty').value) || 0;
  const reason = document.getElementById('scrapReason').value.trim();

  if (!date || !ingId || qty <= 0 || !reason) {
    alert('請完整填寫報廢數量');
    return;
  }

  try {
    const res = await fetch(API_BASE_URL + '/api/scraps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: ingId,
        quantity: qty,
        reason: reason,
        scrapDate: date
      })
    });

    const result = await res.json();
    if (result.success) {
      alert('食材報廢儲存成功！庫存已自動扣減。');
      closeScrapModal();
      loadInventoryData();
    } else {
      alert(`報廢失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error submitting scrap record:', error);
  }
}

// ----------------------------------------------------
// Panel 3: Menu & Recipes Panel
// ----------------------------------------------------
function renderMenuTable() {
  const tbody = document.getElementById('menuTableBody');
  tbody.innerHTML = '';

  posState.dishes.forEach(dish => {
    const tr = document.createElement('tr');
    
    // Availability switch checkbox
    const checked = dish.is_available ? 'checked' : '';
    const switchHtml = `
      <label style="display:inline-flex; align-items:center; cursor:pointer;">
        <input type="checkbox" ${checked} onchange="toggleDishAvailability(${dish.dish_id}, this.checked)" style="transform: scale(1.2); margin-right:6px;">
        <span>${dish.is_available ? '上架中' : '已下架'}</span>
      </label>
    `;

    tr.innerHTML = `
      <td>${dish.dish_id}</td>
      <td><span class="badge badge-primary">${dish.category_name}</span></td>
      <td style="font-weight:700;">${dish.dish_name}</td>
      <td style="font-weight:700; color:var(--primary-dark); cursor:pointer;" title="點擊修改價格" onclick="editDishPrice(${dish.dish_id}, ${dish.price})">
        $${parseFloat(dish.price).toFixed(0)}
      </td>
      <td>${switchHtml}</td>
      <td>
        <button class="btn btn-secondary" style="padding:6px 12px; font-size:0.85rem;" onclick="openRecipeModal(${dish.dish_id}, '${dish.dish_name}')">
          設定配方
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleDishAvailability(dishId, isAvailable) {
  try {
    const res = await fetch(API_BASE_URL + '/api/dishes/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dishId, isAvailable })
    });
    const result = await res.json();
    if (result.success) {
      // Update local state
      const dish = posState.dishes.find(d => d.dish_id === dishId);
      if (dish) dish.is_available = isAvailable ? 1 : 0;
      renderMenuTable();
    } else {
      alert(`更新狀態失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error toggling dish availability:', error);
  }
}

// ----------------------------------------------------
// Menu Modal Methods
// ----------------------------------------------------

// Edit Price
async function editDishPrice(dishId, currentPrice) {
  const newPriceStr = prompt(`請輸入新餐點售價 (原售價 $${parseFloat(currentPrice).toFixed(0)}):`, currentPrice);
  if (newPriceStr === null) return; // Cancelled
  const newPrice = parseFloat(newPriceStr);
  if (isNaN(newPrice) || newPrice < 0) {
    alert('請輸入合法的價格');
    return;
  }

  try {
    const res = await fetch(API_BASE_URL + '/api/dishes/update-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dishId, price: newPrice })
    });
    const result = await res.json();
    if (result.success) {
      const dish = posState.dishes.find(d => d.dish_id === dishId);
      if (dish) dish.price = newPrice;
      renderMenuTable();
    } else {
      alert(`修改失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error editing dish price:', error);
  }
}

// Create Dish Modal Operations
function openCreateDishModal() {
  document.getElementById('createDishName').value = '';
  document.getElementById('createDishPrice').value = '';
  document.getElementById('createDishModal').classList.add('active');
}

function closeCreateDishModal() {
  document.getElementById('createDishModal').classList.remove('active');
}

async function submitCreateDish() {
  const catId = parseInt(document.getElementById('createDishCategory').value);
  const name = document.getElementById('createDishName').value.trim();
  const price = parseFloat(document.getElementById('createDishPrice').value) || 0;

  if (!catId || !name || price < 0) {
    alert('請填寫完整的餐點資訊');
    return;
  }

  try {
    const res = await fetch(API_BASE_URL + '/api/dishes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: catId, dishName: name, price: price })
    });

    const result = await res.json();
    if (result.success) {
      alert('新增餐點成功！請在列表中點選「設定配方」以建立耗損關聯。');
      closeCreateDishModal();
      
      // Reload initial data
      const dishRes = await fetch(API_BASE_URL + '/api/dishes');
      posState.dishes = await dishRes.json();
      renderMenuTable();
    } else {
      alert(`更新失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error creating dish:', error);
  }
}

// Recipe Editor Modal Operations
let currentRecipeDishId = null;

async function openRecipeModal(dishId, dishName) {
  currentRecipeDishId = dishId;
  document.getElementById('recipeModalTitle').textContent = `${dishName} 食材配方比例`;
  
  // Clear input elements
  document.getElementById('recipeSelectIngredient').value = '';
  document.getElementById('recipeInputQty').value = '';

  await loadRecipeList();
  document.getElementById('recipeModal').classList.add('active');
}

function closeRecipeModal() {
  document.getElementById('recipeModal').classList.remove('active');
}

async function loadRecipeList() {
  if (!currentRecipeDishId) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/dishes/${currentRecipeDishId}/recipe`);
    const recipeItems = await res.json();

    const tbody = document.getElementById('recipeItemsBody');
    tbody.innerHTML = '';

    if (recipeItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--txt-muted);">此餐點目前無設定配方，結帳時將無法自動扣減庫存。</td></tr>';
      return;
    }

    recipeItems.forEach(item => {
      const tr = document.createElement('tr');
      
      // Calculate unit cost estimation
      const qtyRequired = parseFloat(item.quantity_required);
      const costPerUnit = parseFloat(item.cost_per_unit || 0);
      const estCost = qtyRequired * costPerUnit;

      tr.innerHTML = `
        <td style="font-weight:700;">${item.ingredient_name}</td>
        <td>${qtyRequired.toFixed(2)}</td>
        <td>${item.unit}</td>
        <td style="color:var(--txt-muted); font-size:0.9rem;">$${estCost.toFixed(2)}</td>
        <td>
          <button class="btn btn-danger" style="padding:4px 8px; font-size:0.8rem;" onclick="deleteRecipeRowItem(${item.ingredient_id})">
            移除
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error loading recipe list:', error);
  }
}

async function addRecipeItem() {
  if (!currentRecipeDishId) return;

  const select = document.getElementById('recipeSelectIngredient');
  const qtyInput = document.getElementById('recipeInputQty');

  const ingId = parseInt(select.value);
  const qty = parseFloat(qtyInput.value) || 0;

  if (!ingId || qty <= 0) {
    alert('請選擇食材並輸入大於0的數量');
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/dishes/${currentRecipeDishId}/recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingredientId: ingId,
        quantityRequired: qty
      })
    });

    const result = await res.json();
    if (result.success) {
      // Clear inputs and reload
      select.value = '';
      qtyInput.value = '';
      await loadRecipeList();
    } else {
      alert(`新增失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error adding recipe item:', error);
  }
}

async function deleteRecipeRowItem(ingredientId) {
  if (!currentRecipeDishId) return;
  if (!confirm('確定刪除此配方項目？')) return;

  try {
    const res = await fetch(`${API_BASE_URL}/api/dishes/${currentRecipeDishId}/recipe/${ingredientId}`, {
      method: 'DELETE'
    });
    const result = await res.json();
    if (result.success) {
      await loadRecipeList();
    } else {
      alert(`刪除失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error deleting recipe item:', error);
  }
}

// ----------------------------------------------------
// Panel 4: Reports & Charts Methods
// ----------------------------------------------------

function getLocalISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initDateFilters() {
  const today = new Date();
  const day = today.getDay();
  // Calculate difference to Monday
  const diffToMonday = today.getDate() - day + (day === 0 ? -6 : 1);
  
  const startOfWeek = new Date(today);
  startOfWeek.setDate(diffToMonday);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const startInput = document.getElementById('reportStartDate');
  const endInput = document.getElementById('reportEndDate');
  
  if (startInput && !startInput.value) {
    startInput.value = getLocalISODate(startOfWeek);
  }
  if (endInput && !endInput.value) {
    endInput.value = getLocalISODate(endOfWeek);
  }
}

async function loadReportsData() {
  initDateFilters();
  try {
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const queryStr = (startDate && endDate) ? `?startDate=${startDate}&endDate=${endDate}` : '';

    const reportsPageTitle = document.getElementById('reportsPageTitle');
    const dailyRevenueTitle = document.getElementById('dailyRevenueTitle');
    
    let dateRangeText = '';
    if (startDate && endDate) {
      const sDate = new Date(startDate);
      const eDate = new Date(endDate);
      const sStr = (sDate.getMonth()+1) + '/' + sDate.getDate();
      const eStr = (eDate.getMonth()+1) + '/' + eDate.getDate();
      if (startDate === endDate) {
        dateRangeText = `(${sStr})`;
      } else {
        dateRangeText = `(${sStr}~${eStr})`;
      }
    }

    if (reportsPageTitle) reportsPageTitle.textContent = `營業數據分析 ${dateRangeText}`;
    if (dailyRevenueTitle) dailyRevenueTitle.textContent = `每日營業額趨勢 ${dateRangeText}`;


    // If interval is exactly 1 day, hide daily revenue chart to avoid overlap with hourly trend
    const dailyChartCard = document.getElementById('dailyRevenueChart').closest('.chart-card');
    if (startDate && endDate && startDate === endDate) {
      dailyChartCard.style.display = 'none';
    } else {
      dailyChartCard.style.display = 'block';
    }

    // 1. Load Summary Metrics
    const summaryRes = await fetch(API_BASE_URL + '/api/reports/summary' + queryStr);
    const summaryData = await summaryRes.json();
    document.getElementById('statTotalRevenue').textContent = '$' + summaryData.totalRevenue.toLocaleString();
    document.getElementById('statGrossProfit').textContent = '$' + summaryData.theoreticalProfit.toLocaleString();
    document.getElementById('statMonthlyPurchase').textContent = '$' + summaryData.monthlyPurchase.toLocaleString();
    document.getElementById('statTotalScrap').textContent = '$' + summaryData.totalScrapLoss.toLocaleString();

    // 2. Daily revenue chart
    const dailyRes = await fetch(API_BASE_URL + '/api/reports/daily-revenue' + queryStr);
    const dailyData = await dailyRes.json();
    renderDailyRevenueChart(dailyData);

    // 3. Top selling chart
    const topRes = await fetch(API_BASE_URL + '/api/reports/top-selling' + queryStr);
    const topData = await topRes.json();
    renderTopSellingChart(topData);

    // 4. Hourly trend chart
    const hourlyRes = await fetch(API_BASE_URL + '/api/reports/hourly-trend' + queryStr);
    const hourlyData = await hourlyRes.json();
    renderHourlyTrendChart(hourlyData);

    // 5. Scrap loss chart
    const scrapRes = await fetch(API_BASE_URL + '/api/reports/scrap-loss' + queryStr);
    const scrapData = await scrapRes.json();
    renderScrapLossChart(scrapData);

  } catch (error) {
    console.error('Error loading reports details:', error);
  }
}

// Chart.js render configurations
function renderDailyRevenueChart(data) {
  if (charts.dailyRevenue) charts.dailyRevenue.destroy();
  
  const labels = data.map(item => new Date(item.date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })).reverse();
  const revenues = data.map(item => parseFloat(item.revenue)).reverse();
  const grossProfits = data.map(item => parseFloat(item.gross_profit || 0)).reverse();

  const ctx = document.getElementById('dailyRevenueChart').getContext('2d');
  charts.dailyRevenue = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '營業額($)',
          data: revenues,
          borderColor: '#78350f',
          backgroundColor: 'rgba(245,158,11,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 3,
          pointBackgroundColor: '#f59e0b',
          pointRadius: 4
        },
        {
          label: '毛利($)',
          data: grossProfits,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 3,
          pointBackgroundColor: '#10b981',
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderTopSellingChart(data) {
  if (charts.topSelling) charts.topSelling.destroy();

  const labels = data.map(item => item.dish_name);
  const quantities = data.map(item => parseInt(item.quantity_sold));

  const ctx = document.getElementById('topSellingChart').getContext('2d');
  charts.topSelling = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '銷售數量 (份)',
        data: quantities,
        backgroundColor: 'rgba(245,158,11,0.85)',
        hoverBackgroundColor: '#78350f',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
        y: { grid: { display: false } }
      }
    }
  });
}

function renderHourlyTrendChart(data) {
  if (charts.hourlyTrend) charts.hourlyTrend.destroy();

  const revenues = Array(24).fill(0);
  const orders = Array(24).fill(0);

  data.forEach(item => {
    revenues[parseInt(item.hour)] = parseFloat(item.revenue);
    orders[parseInt(item.hour)] = parseInt(item.orders_count);
  });

  const showHours = [];
  const showRevenues = [];
  const showOrders = [];
  // Focus on 5am to 2pm for breakfast shop
  for (let h = 5; h <= 15; h++) {
    showHours.push(`${h}:00`);
    showRevenues.push(revenues[h]);
    showOrders.push(orders[h]);
  }

  const ctx = document.getElementById('hourlyTrendChart').getContext('2d');
  charts.hourlyTrend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: showHours,
      datasets: [
        {
          type: 'line',
          label: '營收($)',
          data: showRevenues,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          borderWidth: 3,
          tension: 0.3,
          pointBackgroundColor: '#10b981',
          fill: true,
          yAxisID: 'y-revenue'
        },
        {
          type: 'bar',
          label: '訂單數',
          data: showOrders,
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 4,
          yAxisID: 'y-orders'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        'y-revenue': {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: '營收($)' },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        'y-orders': {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: '訂單數' },
          grid: { drawOnChartArea: false }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderScrapLossChart(data) {
  if (charts.scrapLoss) charts.scrapLoss.destroy();

  let labels = [];
  let values = [];

  if (data.length === 0) {
    labels = ['無報廢紀錄'];
    values = [0];
  } else {
    const limit = 10;
    const topItems = data.slice(0, limit);
    labels = topItems.map(item => item.ingredient_name);
    values = topItems.map(item => parseFloat(item.loss_cost));
  }

  const ctx = document.getElementById('scrapLossChart').getContext('2d');
  charts.scrapLoss = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '耗損金額 ($)',
        data: values,
        backgroundColor: 'rgba(239, 68, 68, 0.85)',
        hoverBackgroundColor: '#dc2626',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } },
        y: { grid: { display: false } }
      }
    }
  });
}


function printBusinessReport() {
  document.body.classList.add('print-mode-report');
  window.print();
  document.body.classList.remove('print-mode-report');
}

function editScrap(scrapId, oldQty, oldReason, ingredientName, scrapDateISO, unit) {
  document.getElementById('editScrapId').value = scrapId;
  document.getElementById('editScrapDate').value = scrapDateISO.substring(0, 10);
  document.getElementById('editScrapIngredientName').value = ingredientName;
  document.getElementById('editScrapQty').value = oldQty;
  document.getElementById('editScrapUnitLabel').value = unit;
  document.getElementById('editScrapReason').value = oldReason || '';
  document.getElementById('editScrapModal').classList.add('active');
}

function closeEditScrapModal() {
  document.getElementById('editScrapModal').classList.remove('active');
}

async function submitEditScrap() {
  const scrapId = document.getElementById('editScrapId').value;
  const quantity = parseFloat(document.getElementById('editScrapQty').value);
  const reason = document.getElementById('editScrapReason').value.trim();

  if (isNaN(quantity) || quantity <= 0) {
    alert('無效的數量');
    return;
  }

  try {
    const res = await fetch(API_BASE_URL + '/api/scraps/' + scrapId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity, reason })
    });
    const result = await res.json();
    if (result.success) {
      closeEditScrapModal();
      loadInventoryData(); // reload
    } else {
      alert('更新失敗: ' + result.error);
    }
  } catch (e) {
    console.error(e);
    alert('更新發生錯誤');
  }
}

async function deleteScrap(scrapId) {
  if (!confirm('確定要刪除這筆報廢紀錄嗎？(庫存將會加回)')) return;
  try {
    const res = await fetch(API_BASE_URL + '/api/scraps/' + scrapId, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      loadInventoryData();
    } else {
      alert('刪除失敗: ' + result.error);
    }
  } catch (e) {
    console.error(e);
    alert('刪除發生錯誤');
  }
}

async function deletePurchase(purchaseId) {
  if (!confirm('確定要刪除這筆進貨紀錄嗎？(庫存將會扣除)')) return;
  try {
    const res = await fetch(API_BASE_URL + '/api/purchases/' + purchaseId, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      loadInventoryData();
    } else {
      alert('刪除失敗: ' + result.error);
    }
  } catch (e) {
    console.error(e);
    alert('刪除發生錯誤');
  }
}
