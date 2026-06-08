// State management for Customer Self-Ordering
let categories = [];
let dishes = [];
let cart = {}; // Key: dishId, Value: { id, name, price, quantity }
let selectedTable = '';
let activeCategoryId = null;

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  fetchData();
});

// Initialize UI events
function initUI() {
  // Select Table Badge Trigger
  document.getElementById('tableBadge').addEventListener('click', () => {
    showModal(true);
  });

  // Table options buttons
  const tableContainer = document.getElementById('tableGrid');
  // Create tables 1 to 8
  for (let i = 1; i <= 8; i++) {
    const btn = document.createElement('button');
    btn.className = 'table-btn';
    btn.textContent = `${i}桌`;
    btn.addEventListener('click', () => selectTableHeader(`${i}桌`));
    tableContainer.appendChild(btn);
  }
  
  // Takeout Button
  const takeoutBtn = document.createElement('button');
  takeoutBtn.className = 'table-btn takeout-option';
  takeoutBtn.textContent = '外帶';
  takeoutBtn.addEventListener('click', () => selectTableHeader('外帶'));
  tableContainer.appendChild(takeoutBtn);

  // Default: Show table selection modal
  showModal(true);

  // Cart bottom sheet triggers
  document.getElementById('cartToggleBtn').addEventListener('click', toggleCartDrawer);
  document.getElementById('cartFloatingBar').addEventListener('click', toggleCartDrawer);
  document.getElementById('drawerClose').addEventListener('click', toggleCartDrawer);
  document.getElementById('drawerOverlay').addEventListener('click', toggleCartDrawer);

  // Submit Order Button
  document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
}

// Fetch categories and available dishes from API
async function fetchData() {
  try {
    const [catRes, dishRes] = await Promise.all([
      fetch(API_BASE_URL + '/api/categories'),
      fetch(API_BASE_URL + '/api/dishes/available')
    ]);
    
    categories = await catRes.json();
    dishes = await dishRes.json();

    renderCategories();
    // Default active category to the first one
    if (categories.length > 0) {
      selectCategory(categories[0].category_id);
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    alert('無法載入菜單，請檢查網路連線或資料庫。');
  }
}

// Table Selection
function showModal(show) {
  const overlay = document.getElementById('tableModalOverlay');
  if (show) {
    overlay.classList.add('active');
  } else {
    overlay.classList.remove('active');
  }
}

function selectTableHeader(tableVal) {
  selectedTable = tableVal;
  document.getElementById('tableNumberText').textContent = selectedTable;
  showModal(false);
}

// Render horizontal category tabs
function renderCategories() {
  const nav = document.getElementById('categoriesNav');
  nav.innerHTML = '';
  
  categories.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = 'category-tab';
    tab.id = `cat-tab-${cat.category_id}`;
    tab.textContent = cat.category_name;
    tab.addEventListener('click', () => selectCategory(cat.category_id));
    nav.appendChild(tab);
  });
}

// Select category and filter dishes
function selectCategory(categoryId) {
  activeCategoryId = categoryId;
  
  // Update active tab styles
  document.querySelectorAll('.category-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  const activeTab = document.getElementById(`cat-tab-${categoryId}`);
  if (activeTab) activeTab.classList.add('active');

  renderDishes();
}

// Render dishes for active category
function renderDishes() {
  const container = document.getElementById('dishesContent');
  container.innerHTML = '';

  const activeCategory = categories.find(c => c.category_id === activeCategoryId);
  if (!activeCategory) return;

  const group = document.createElement('div');
  group.className = 'category-group animate-fade-in';

  const title = document.createElement('h3');
  title.className = 'category-group-title';
  title.textContent = activeCategory.category_name;
  group.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'dishes-grid';

  const filteredDishes = dishes.filter(d => d.category_id === activeCategoryId);
  
  if (filteredDishes.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.padding = '20px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = 'var(--txt-muted)';
    emptyMsg.textContent = '此分類目前無餐點上架';
    grid.appendChild(emptyMsg);
  }

  filteredDishes.forEach(dish => {
    const card = document.createElement('div');
    card.className = 'dish-card';

    // Thumbnail (first character of name or generic)
    const thumb = document.createElement('div');
    thumb.className = 'dish-thumbnail';
    thumb.textContent = dish.dish_name.charAt(0);

    const info = document.createElement('div');
    info.className = 'dish-info';

    const name = document.createElement('span');
    name.className = 'dish-name';
    name.textContent = dish.dish_name;

    const price = document.createElement('span');
    price.className = 'dish-price';
    price.textContent = `$${parseFloat(dish.price).toFixed(0)}`;

    info.appendChild(name);
    info.appendChild(price);

    const actions = document.createElement('div');
    actions.className = 'dish-actions';

    const dishInCartQty = Object.values(cart).filter(item => item.id === dish.dish_id).reduce((sum, item) => sum + item.quantity, 0);

    if (dishInCartQty > 0) {
      // Show qty counter controls but the + button opens modal to add more of same dish with potentially different options
      const control = document.createElement('div');
      control.className = 'quantity-control';

      const minusBtn = document.createElement('button');
      minusBtn.className = 'qty-btn';
      minusBtn.textContent = '-';
      // To keep it simple, minus removes one from the first cart item of this dish
      minusBtn.addEventListener('click', () => {
        const firstCartKey = Object.keys(cart).find(k => cart[k].id === dish.dish_id);
        if (firstCartKey) updateCartQty(firstCartKey, -1);
      });

      const qtyVal = document.createElement('span');
      qtyVal.className = 'qty-val';
      qtyVal.textContent = dishInCartQty;

      const plusBtn = document.createElement('button');
      plusBtn.className = 'qty-btn';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => openCustomizationModal(dish.dish_id));

      control.appendChild(minusBtn);
      control.appendChild(qtyVal);
      control.appendChild(plusBtn);
      actions.appendChild(control);
    } else {
      // Show add plus button
      const addBtn = document.createElement('button');
      addBtn.className = 'add-btn-circle';
      addBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--primary-dark)" stroke-width="3" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      `;
      addBtn.addEventListener('click', () => openCustomizationModal(dish.dish_id));
      actions.appendChild(addBtn);
    }

    card.appendChild(thumb);
    card.appendChild(info);
    card.appendChild(actions);
    grid.appendChild(card);
  });

  group.appendChild(grid);
  container.appendChild(group);
}

// --- Customization Modal Logic ---
let currentCustDishId = null;

function openCustomizationModal(dishId) {
  currentCustDishId = dishId;
  const dish = dishes.find(d => d.dish_id === dishId);
  if (!dish) return;

  document.getElementById('customizationModalTitle').textContent = `客製化選項 - ${dish.dish_name}`;
  
  // Reset fields
  document.querySelectorAll('.cust-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('custIce').value = '';
  document.getElementById('custSugar').value = '';

  document.getElementById('customizationModalOverlay').classList.add('active');
}

function closeCustomizationModal() {
  document.getElementById('customizationModalOverlay').classList.remove('active');
  currentCustDishId = null;
}

function confirmCustomization() {
  if (!currentCustDishId) return;
  const dish = dishes.find(d => d.dish_id === currentCustDishId);
  
  const customizations = [];
  document.querySelectorAll('.cust-checkbox:checked').forEach(cb => {
    customizations.push({ name: cb.value, price: parseFloat(cb.dataset.price) || 0 });
  });

  const ice = document.getElementById('custIce').value;
  if (ice) customizations.push({ name: ice, price: 0 });

  const sugar = document.getElementById('custSugar').value;
  if (sugar) customizations.push({ name: sugar, price: 0 });

  // Generate unique cart key based on dish id and sorted customizations
  const custStr = JSON.stringify(customizations);
  const cartKey = `${dish.dish_id}_${custStr}`;

  if (!cart[cartKey]) {
    let optionsTotal = customizations.reduce((sum, c) => sum + c.price, 0);
    cart[cartKey] = {
      id: dish.dish_id,
      cartKey: cartKey,
      name: dish.dish_name,
      basePrice: parseFloat(dish.price),
      price: parseFloat(dish.price) + optionsTotal,
      quantity: 0,
      customizations: customizations
    };
  }

  cart[cartKey].quantity += 1;

  closeCustomizationModal();
  updateCartSummary();
  renderDishes();
  renderCartDrawer();
}

// Modify cart quantities by cartKey
function updateCartQty(cartKey, change) {
  if (!cart[cartKey]) return;

  cart[cartKey].quantity += change;

  if (cart[cartKey].quantity <= 0) {
    delete cart[cartKey];
  }

  updateCartSummary();
  renderDishes();
  renderCartDrawer();
}

// Update cart counter badges and bottom floating bar
function updateCartSummary() {
  let totalQty = 0;
  let totalPrice = 0;

  Object.values(cart).forEach(item => {
    totalQty += item.quantity;
    totalPrice += item.price * item.quantity;
  });

  // Header Cart Badge count
  const badge = document.getElementById('cartBadgeCount');
  if (totalQty > 0) {
    badge.textContent = totalQty;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  // Floating summary bar
  const bar = document.getElementById('cartFloatingBar');
  const barPrice = document.getElementById('cartBarPrice');
  if (totalQty > 0) {
    barPrice.textContent = `$${totalPrice.toFixed(0)}`;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

// Open / Close Cart Bottom Sheet
function toggleCartDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('cartDrawer');
  overlay.classList.toggle('active');
  drawer.classList.toggle('active');
}

// Render Cart items in sliding drawer
function renderCartDrawer() {
  const container = document.getElementById('drawerItems');
  container.innerHTML = '';

  const items = Object.values(cart);
  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color:var(--txt-muted)">
        購物車目前是空的喔！
      </div>
    `;
    document.getElementById('submitOrderBtn').disabled = true;
    document.getElementById('drawerSummaryTotal').textContent = '$0';
    return;
  }

  document.getElementById('submitOrderBtn').disabled = false;
  let grandTotal = 0;

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'drawer-item';

    const nameContainer = document.createElement('div');
    nameContainer.className = 'drawer-item-name-container';
    nameContainer.style.flex = '1';

    const name = document.createElement('div');
    name.className = 'drawer-item-name';
    name.textContent = item.name;
    nameContainer.appendChild(name);

    if (item.customizations && item.customizations.length > 0) {
      const custText = document.createElement('div');
      custText.style.fontSize = '0.75rem';
      custText.style.color = 'var(--txt-muted)';
      custText.textContent = item.customizations.map(c => c.name).join(', ');
      nameContainer.appendChild(custText);
    }

    const price = document.createElement('span');
    price.className = 'drawer-item-price';
    price.textContent = `$${(item.price * item.quantity).toFixed(0)}`;
    price.style.width = '60px';
    price.style.textAlign = 'right';

    const control = document.createElement('div');
    control.className = 'quantity-control';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'qty-btn';
    minusBtn.textContent = '-';
    minusBtn.addEventListener('click', () => updateCartQty(item.cartKey, -1));

    const qtyVal = document.createElement('span');
    qtyVal.className = 'qty-val';
    qtyVal.textContent = item.quantity;

    const plusBtn = document.createElement('button');
    plusBtn.className = 'qty-btn';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => updateCartQty(item.cartKey, 1));

    control.appendChild(minusBtn);
    control.appendChild(qtyVal);
    control.appendChild(plusBtn);

    row.appendChild(nameContainer);
    row.appendChild(price);
    row.appendChild(control);
    container.appendChild(row);

    grandTotal += item.price * item.quantity;
  });

  document.getElementById('drawerSummaryTotal').textContent = `$${grandTotal.toFixed(0)}`;
}

// Submit Order API call
async function submitOrder() {
  if (!selectedTable) {
    alert('請先選擇桌號或外帶！');
    showModal(true);
    return;
  }

  const items = Object.values(cart).map(item => ({
    dish_id: item.id,
    quantity: item.quantity,
    customizations: item.customizations
  }));

  if (items.length === 0) return;

  const submitBtn = document.getElementById('submitOrderBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '送出訂單中...';

  try {
    const response = await fetch(API_BASE_URL + '/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tableNumber: selectedTable,
        items: items,
        status: 'Pending'
      })
    });

    const result = await response.json();
    if (result.success) {
      alert(`訂單送出成功！請至櫃檯確認並付款。您的單號為: #${result.orderId}`);
      // Clear cart
      cart = {};
      updateCartSummary();
      renderDishes();
      renderCartDrawer();
      toggleCartDrawer();
    } else {
      alert(`訂單送出失敗: ${result.error}`);
    }
  } catch (error) {
    console.error('Error submitting order:', error);
    alert('網路異常，請稍後再試。');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '確認送出訂單';
  }
}
