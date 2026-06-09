import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 載入環境變數 (讀取 .env 檔案)
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 允許跨域請求 (很重要！這樣 GitHub Pages 上的網頁才能呼叫這個 API)
app.use(cors());
// 允許解析 JSON 格式的請求資料
app.use(express.json());
// 提供靜態檔案資料夾 (本地測試用，改名為 docs 以配合 GitHub Pages)
app.use(express.static(path.join(__dirname, 'docs')));

// 加入全域未處理錯誤捕捉，避免資料庫斷線時整個 Node.js 崩潰
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ==========================================
// 資料庫連線設定 (建立連線池提高效能)
// 這裡會讀取 .env 裡面的設定，如果之後要換成雲端資料庫，只要改 .env 就好
// ==========================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '0000',
  database: process.env.DB_NAME || 'restaurant_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ==========================================
// 1. 餐點分類 API
// ==========================================
// 取得所有分類
app.get('/api/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories ORDER BY category_id ASC');
  res.json(rows);
});

// ==========================================
// 2. 菜單餐點 API
// ==========================================
// 取得所有餐點 (包含分類名稱)
app.get('/api/dishes', async (req, res) => {
  const [rows] = await pool.query('SELECT d.*, c.category_name FROM dishes d JOIN categories c ON d.category_id = c.category_id ORDER BY d.category_id ASC, d.dish_id ASC');
  res.json(rows);
});

// 取得「有上架」的餐點 (POS 前台點餐用)
app.get('/api/dishes/available', async (req, res) => {
  const [rows] = await pool.query('SELECT d.*, c.category_name FROM dishes d JOIN categories c ON d.category_id = c.category_id WHERE d.is_available = 1 ORDER BY d.category_id ASC, d.dish_id ASC');
  res.json(rows);
});

// 切換餐點上下架狀態
app.post('/api/dishes/toggle', async (req, res) => {
  await pool.query('UPDATE dishes SET is_available = ? WHERE dish_id = ?', [req.body.isAvailable ? 1 : 0, req.body.dishId]);
  res.json({ success: true });
});

// 更新餐點價格
app.post('/api/dishes/update-price', async (req, res) => {
  await pool.query('UPDATE dishes SET price = ? WHERE dish_id = ?', [req.body.price, req.body.dishId]);
  res.json({ success: true });
});

// 新增餐點
app.post('/api/dishes/create', async (req, res) => {
  const [result] = await pool.query('INSERT INTO dishes (category_id, dish_name, price) VALUES (?, ?, ?)', [req.body.categoryId, req.body.dishName, req.body.price]);
  res.json({ success: true, dishId: result.insertId });
});

// ==========================================
// 3. 配方 API (餐點與原物料的關聯)
// ==========================================
// 取得某個餐點的配方
app.get('/api/dishes/:id/recipe', async (req, res) => {
  const [rows] = await pool.query('SELECT ri.*, i.ingredient_name, i.unit, i.cost_per_unit FROM recipe_items ri JOIN ingredients i ON ri.ingredient_id = i.ingredient_id WHERE ri.dish_id = ?', [req.params.id]);
  res.json(rows);
});

// 新增或更新配方原料
app.post('/api/dishes/:id/recipe', async (req, res) => {
  await pool.query('INSERT INTO recipe_items (dish_id, ingredient_id, quantity_required) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity_required = VALUES(quantity_required)', [req.params.id, req.body.ingredientId, req.body.quantityRequired || req.body.quantity]);
  res.json({ success: true });
});

// 刪除配方原料
app.delete('/api/dishes/:id/recipe/:ingredientId', async (req, res) => {
  await pool.query('DELETE FROM recipe_items WHERE dish_id = ? AND ingredient_id = ?', [req.params.id, req.params.ingredientId]);
  res.json({ success: true });
});

// ==========================================
// 4. 原物料與庫存 API
// ==========================================
// 取得所有原物料
app.get('/api/ingredients', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ingredients ORDER BY ingredient_id ASC');
  res.json(rows);
});

app.put('/api/ingredients/:id/safe-stock', async (req, res) => {
  try {
    const { safeStockLevel } = req.body;
    await pool.query('UPDATE ingredients SET safe_stock_level = ? WHERE ingredient_id = ?', [safeStockLevel, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取得庫存狀態 (其實跟取得原物料一樣)
app.get('/api/inventory', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ingredients ORDER BY ingredient_id ASC');
  res.json(rows);
});

app.get('/api/purchases', async (req, res) => {
  const [pOrders] = await pool.query('SELECT * FROM purchase_orders ORDER BY purchase_date DESC, purchase_id DESC');
  for (const po of pOrders) {
    const [items] = await pool.query('SELECT poi.*, i.ingredient_name, i.unit FROM purchase_order_items poi JOIN ingredients i ON poi.ingredient_id = i.ingredient_id WHERE poi.purchase_id = ?', [po.purchase_id]);
    po.items = items;
  }
  res.json(pOrders);
});

// 登錄進貨單 (使用 Transaction 確保資料庫一致性)
app.post('/api/purchases', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction(); // 開啟事務
    const { purchaseDate, supplier, items } = req.body;
    let totalCost = items.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.cost_per_unit)), 0);

    // 寫入進貨總單
    const [poRes] = await conn.query('INSERT INTO purchase_orders (purchase_date, supplier, total_cost) VALUES (?, ?, ?)', [purchaseDate, supplier, totalCost]);

    // 寫入進貨明細並更新庫存與成本
    for (const item of items) {
      await conn.query('INSERT INTO purchase_order_items (purchase_id, ingredient_id, quantity, cost_per_unit) VALUES (?, ?, ?, ?)', [poRes.insertId, item.ingredient_id, item.quantity, item.cost_per_unit]);
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity + ?, cost_per_unit = ? WHERE ingredient_id = ?', [item.quantity, item.cost_per_unit, item.ingredient_id]);
    }
    await conn.commit(); // 提交事務
    res.json({ success: true, purchaseId: poRes.insertId });
  } catch (err) {
    await conn.rollback(); // 發生錯誤則還原
    res.status(500).json({ error: err.message });
  } finally {
    conn.release(); // 釋放連線
  }
});

// 刪除進貨單
app.delete('/api/purchases/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const purchaseId = req.params.id;

    // 取得進貨明細以扣除庫存
    const [items] = await conn.query('SELECT * FROM purchase_order_items WHERE purchase_id = ?', [purchaseId]);
    for (const item of items) {
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity - ? WHERE ingredient_id = ?', [item.quantity, item.ingredient_id]);
    }

    // 刪除明細與總單
    await conn.query('DELETE FROM purchase_order_items WHERE purchase_id = ?', [purchaseId]);
    await conn.query('DELETE FROM purchase_orders WHERE purchase_id = ?', [purchaseId]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 取得報廢紀錄
app.get('/api/scraps', async (req, res) => {
  const [rows] = await pool.query('SELECT sr.*, i.ingredient_name, i.unit, i.cost_per_unit FROM scrap_records sr JOIN ingredients i ON sr.ingredient_id = i.ingredient_id ORDER BY sr.scrap_date DESC, sr.scrap_id DESC');
  res.json(rows);
});

// 登記報廢 (同時扣除庫存)
app.post('/api/scraps', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO scrap_records (ingredient_id, quantity, reason, scrap_date) VALUES (?, ?, ?, ?)', [req.body.ingredientId, req.body.quantity, req.body.reason, req.body.scrapDate]);
    await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity - ? WHERE ingredient_id = ?', [req.body.quantity, req.body.ingredientId]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Edit Scrap
app.put('/api/scraps/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const scrapId = req.params.id;
    const { quantity, reason } = req.body;

    // Get old scrap
    const [oldRows] = await conn.query('SELECT * FROM scrap_records WHERE scrap_id = ?', [scrapId]);
    if (oldRows.length === 0) throw new Error('Scrap not found');
    const oldScrap = oldRows[0];

    const diff = oldScrap.quantity - parseFloat(quantity);

    await conn.query('UPDATE scrap_records SET quantity = ?, reason = ? WHERE scrap_id = ?', [quantity, reason, scrapId]);
    await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity + ? WHERE ingredient_id = ?', [diff, oldScrap.ingredient_id]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Delete Scrap
app.delete('/api/scraps/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const scrapId = req.params.id;
    const [oldRows] = await conn.query('SELECT * FROM scrap_records WHERE scrap_id = ?', [scrapId]);
    if (oldRows.length > 0) {
      const oldScrap = oldRows[0];
      await conn.query('DELETE FROM scrap_records WHERE scrap_id = ?', [scrapId]);
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity + ? WHERE ingredient_id = ?', [oldScrap.quantity, oldScrap.ingredient_id]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ==========================================
// --- 盤點紀錄 API ---
app.get('/api/inventory-checks', async (req, res) => {
  const [rows] = await pool.query('SELECT ic.*, i.ingredient_name, i.unit FROM inventory_checks ic JOIN ingredients i ON ic.ingredient_id = i.ingredient_id ORDER BY ic.check_date DESC, ic.check_id DESC');
  res.json(rows);
});

app.post('/api/inventory-checks', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { ingredientId, actualQuantity, notes } = req.body;
    
    const [ings] = await conn.query('SELECT stock_quantity FROM ingredients WHERE ingredient_id = ? FOR UPDATE', [ingredientId]);
    if (ings.length === 0) throw new Error('找不到該食材');
    const oldQuantity = ings[0].stock_quantity;

    await conn.query('INSERT INTO inventory_checks (ingredient_id, old_quantity, new_quantity, notes) VALUES (?, ?, ?, ?)', [ingredientId, oldQuantity, actualQuantity, notes || null]);
    await conn.query('UPDATE ingredients SET stock_quantity = ? WHERE ingredient_id = ?', [actualQuantity, ingredientId]);

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/inventory-checks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM inventory_checks WHERE check_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. 訂單結帳 API
// ==========================================
// 取得訂單列表
app.get('/api/orders', async (req, res) => {
  const status = req.query.status;
  const dateStr = req.query.date;

  let query = 'SELECT * FROM orders';
  let queryParams = [];
  const conditions = [];

  if (status) {
    conditions.push('status = ?');
    queryParams.push(status);
  }
  if (dateStr) {
    conditions.push('DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) = ?');
    queryParams.push(dateStr);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  const [orders] = await pool.query(query, queryParams);

  for (const order of orders) {
    const [items] = await pool.query('SELECT oi.*, d.dish_name FROM order_items oi JOIN dishes d ON oi.dish_id = d.dish_id WHERE oi.order_id = ?', [order.order_id]);
    order.items = items;
  }
  res.json(orders);
});

// 取得單一訂單詳細資料
app.get('/api/orders/:id', async (req, res) => {
  const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [req.params.id]);
  if (!orders.length) return res.status(404).json({ error: 'Not found' });
  const order = orders[0];
  const [items] = await pool.query('SELECT oi.*, d.dish_name FROM order_items oi JOIN dishes d ON oi.dish_id = d.dish_id WHERE oi.order_id = ?', [order.order_id]);
  order.items = items;
  res.json(order);
});

// [內部函數] 扣除庫存：結帳時呼叫，會依照配方表自動扣除對應原物料
async function deductStock(conn, orderId) {
  const [items] = await conn.query('SELECT dish_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of items) {
    const [recipes] = await conn.query('SELECT ingredient_id, quantity_required FROM recipe_items WHERE dish_id = ?', [item.dish_id]);
    for (const r of recipes) {
      const deduct = parseFloat(r.quantity_required) * parseFloat(item.quantity);
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity - ? WHERE ingredient_id = ?', [deduct, r.ingredient_id]);
    }
  }
}

// [內部函數] 加回庫存：作廢訂單時呼叫
async function reverseStock(conn, orderId) {
  const [items] = await conn.query('SELECT dish_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of items) {
    const [recipes] = await conn.query('SELECT ingredient_id, quantity_required FROM recipe_items WHERE dish_id = ?', [item.dish_id]);
    for (const r of recipes) {
      const add = parseFloat(r.quantity_required) * parseFloat(item.quantity);
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity + ? WHERE ingredient_id = ?', [add, r.ingredient_id]);
    }
  }
}

// 新增訂單
app.post('/api/orders', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { tableNumber, items, status = 'Pending' } = req.body;

    let totalAmount = 0;
    // 計算總金額 (包含客製化選項加價)
    for (const item of items) {
      let optPrice = 0;
      let custStr = null;
      if (item.customizations) {
        const custArr = typeof item.customizations === 'string' ? JSON.parse(item.customizations) : item.customizations;
        custArr.forEach(c => optPrice += parseFloat(c.price || 0));
        custStr = typeof item.customizations === 'string' ? item.customizations : JSON.stringify(item.customizations);
      }
      const [dish] = await conn.query('SELECT price FROM dishes WHERE dish_id = ?', [item.dish_id]);
      const price = parseFloat(dish[0].price) + optPrice;
      totalAmount += price * item.quantity;
      item.price_at_order = price;
      item.customizations_str = custStr;
    }

    // 寫入訂單主表
    const [orderRes] = await conn.query('INSERT INTO orders (table_number, total_amount, status) VALUES (?, ?, ?)', [tableNumber, totalAmount, status]);
    // 寫入訂單明細
    for (const item of items) {
      await conn.query('INSERT INTO order_items (order_id, dish_id, quantity, price_at_order, customizations) VALUES (?, ?, ?, ?, ?)', [orderRes.insertId, item.dish_id, item.quantity, item.price_at_order, item.customizations_str]);
    }

    // 如果一開始狀態就是 Paid (已付款)，就直接扣庫存
    if (status === 'Paid') await deductStock(conn, orderRes.insertId);

    await conn.commit();
    res.json({ success: true, orderId: orderRes.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 修改訂單 (僅限 Pending 狀態)
app.put('/api/orders/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const orderId = req.params.id;
    const { items } = req.body;

    const [order] = await conn.query('SELECT status FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
    if (order.length === 0) throw new Error('找不到該訂單');
    if (order[0].status === 'Paid') throw new Error('已結帳訂單無法修改');

    let totalAmount = 0;
    // 計算總金額並準備明細資料
    for (const item of items) {
      let optPrice = 0;
      let custStr = null;
      if (item.customizations) {
        const custArr = typeof item.customizations === 'string' ? JSON.parse(item.customizations) : item.customizations;
        custArr.forEach(c => optPrice += parseFloat(c.price || 0));
        custStr = typeof item.customizations === 'string' ? item.customizations : JSON.stringify(item.customizations);
      }
      const [dish] = await conn.query('SELECT price FROM dishes WHERE dish_id = ?', [item.dish_id]);
      if (dish.length === 0) throw new Error(`找不到餐點 ID: ${item.dish_id}`);
      const price = parseFloat(dish[0].price) + optPrice;
      totalAmount += price * item.quantity;
      item.price_at_order = price;
      item.customizations_str = custStr;
    }

    // 更新訂單總額
    await conn.query('UPDATE orders SET total_amount = ? WHERE order_id = ?', [totalAmount, orderId]);

    // 刪除舊明細
    await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);

    // 寫入新明細
    for (const item of items) {
      await conn.query('INSERT INTO order_items (order_id, dish_id, quantity, price_at_order, customizations) VALUES (?, ?, ?, ?, ?)', [orderId, item.dish_id, item.quantity, item.price_at_order, item.customizations_str]);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 訂單結帳 (將狀態改為已付款並扣庫存)
app.post('/api/orders/:id/checkout', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [order] = await conn.query('SELECT status FROM orders WHERE order_id = ? FOR UPDATE', [req.params.id]);
    if (order[0].status === 'Paid') throw new Error('已經結帳過了');
    await conn.query("UPDATE orders SET status = 'Paid' WHERE order_id = ?", [req.params.id]);
    await deductStock(conn, req.params.id); // 扣除庫存
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 取消未結帳訂單
app.post('/api/orders/:id/cancel', async (req, res) => {
  await pool.query("UPDATE orders SET status = 'Cancelled' WHERE order_id = ?", [req.params.id]);
  res.json({ success: true });
});

// 訂單作廢退款 (將狀態改為已退款並加回庫存)
app.post('/api/orders/:id/refund', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [order] = await conn.query('SELECT status FROM orders WHERE order_id = ? FOR UPDATE', [req.params.id]);
    if (order[0].status !== 'Paid') throw new Error('這筆訂單尚未結帳，無法退款');
    await conn.query("UPDATE orders SET status = 'Refunded' WHERE order_id = ?", [req.params.id]);
    await reverseStock(conn, req.params.id); // 加回庫存
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ==========================================
// 6. 報表統計 API
// ==========================================

function getDateParams(req) {
  const { startDate, endDate } = req.query;
  const hasDates = startDate && endDate;
  return {
    hasDates,
    startDate,
    endDate,
    oFilter: hasDates ? " AND DATE(DATE_ADD(o.created_at, INTERVAL 8 HOUR)) >= ? AND DATE(DATE_ADD(o.created_at, INTERVAL 8 HOUR)) <= ? " : "",
    oFilterNoAlias: hasDates ? " AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) >= ? AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) <= ? " : "",
    purFilter: hasDates ? " WHERE purchase_date >= ? AND purchase_date <= ? " : "",
    scrFilter: hasDates ? " WHERE scrap_date >= ? AND scrap_date <= ? " : "",
    params: hasDates ? [startDate, endDate] : []
  };
}

// 取得營業總結算 (營收、成本、毛利)
app.get('/api/reports/summary', async (req, res) => {
  const d = getDateParams(req);
  const [rev] = await pool.query("SELECT SUM(total_amount) AS total FROM orders WHERE status = 'Paid'" + d.oFilterNoAlias, d.params);
  const [pur] = await pool.query("SELECT SUM(total_cost) AS total FROM purchase_orders" + d.purFilter, d.params);
  const [scr] = await pool.query("SELECT SUM(sr.quantity * i.cost_per_unit) AS total FROM scrap_records sr JOIN ingredients i ON sr.ingredient_id = i.ingredient_id" + d.scrFilter, d.params);
  const [cogs] = await pool.query("SELECT SUM(oi.quantity * ri.quantity_required * i.cost_per_unit) AS total FROM order_items oi JOIN recipe_items ri ON oi.dish_id = ri.dish_id JOIN ingredients i ON ri.ingredient_id = i.ingredient_id JOIN orders o ON oi.order_id = o.order_id WHERE o.status = 'Paid'" + d.oFilter, d.params);
  const targetDateStr = req.query.endDate || new Date().toISOString().split('T')[0];
  const [mPur] = await pool.query("SELECT SUM(total_cost) AS total FROM purchase_orders WHERE YEAR(purchase_date) = YEAR(?) AND MONTH(purchase_date) = MONTH(?)", [targetDateStr, targetDateStr]);

  const tr = parseFloat(rev[0].total || 0);
  const tcogs = parseFloat(cogs[0].total || 0);
  const tscr = parseFloat(scr[0].total || 0);
  res.json({
    totalRevenue: tr,
    totalPurchase: parseFloat(pur[0].total || 0),
    monthlyPurchase: parseFloat(mPur[0].total || 0),
    totalScrapLoss: tscr,
    cogs: tcogs,
    theoreticalProfit: tr - tcogs
  });
});

// 每日營業額統計 (圖表用)
app.get('/api/reports/daily-revenue', async (req, res) => {
  const d = getDateParams(req);
  const [rows] = await pool.query("SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, SUM(total_amount) AS revenue, COUNT(order_id) AS orders_count FROM orders WHERE status = 'Paid'" + d.oFilterNoAlias + " GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) ORDER BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) DESC LIMIT 14", d.params);
  const [cogsRows] = await pool.query("SELECT DATE(DATE_ADD(o.created_at, INTERVAL 8 HOUR)) AS date, SUM(oi.quantity * ri.quantity_required * i.cost_per_unit) AS cogs FROM order_items oi JOIN recipe_items ri ON oi.dish_id = ri.dish_id JOIN ingredients i ON ri.ingredient_id = i.ingredient_id JOIN orders o ON oi.order_id = o.order_id WHERE o.status = 'Paid'" + d.oFilter + " GROUP BY DATE(DATE_ADD(o.created_at, INTERVAL 8 HOUR))", d.params);

  const cogsMap = {};
  cogsRows.forEach(r => {
    // MySQL DATE() might return a string or Date object depending on driver, format to YYYY-MM-DD
    let dStr = r.date;
    if (r.date instanceof Date) {
      // Create local JS date to avoid UTC conversion issues
      const dt = new Date(r.date.getTime() - r.date.getTimezoneOffset() * 60000);
      dStr = dt.toISOString().split('T')[0];
    }
    cogsMap[dStr] = parseFloat(r.cogs || 0);
  });

  rows.forEach(r => {
    let dStr = r.date;
    if (r.date instanceof Date) {
      const dt = new Date(r.date.getTime() - r.date.getTimezoneOffset() * 60000);
      dStr = dt.toISOString().split('T')[0];
    }
    r.cogs = cogsMap[dStr] || 0;
    r.gross_profit = parseFloat(r.revenue) - r.cogs;
  });
  res.json(rows);
});

// 熱門商品排行 (圖表用)
app.get('/api/reports/top-selling', async (req, res) => {
  const d = getDateParams(req);
  const [rows] = await pool.query("SELECT d.dish_name, SUM(oi.quantity) AS quantity_sold, SUM(oi.quantity * oi.price_at_order) AS total_revenue FROM order_items oi JOIN dishes d ON oi.dish_id = d.dish_id JOIN orders o ON oi.order_id = o.order_id WHERE o.status = 'Paid'" + d.oFilter + " GROUP BY d.dish_id, d.dish_name ORDER BY quantity_sold DESC LIMIT 10", d.params);
  res.json(rows);
});

// 營業尖峰時段分析 (圖表用)
app.get('/api/reports/hourly-trend', async (req, res) => {
  const d = getDateParams(req);
  const [rows] = await pool.query("SELECT HOUR(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS hour, SUM(total_amount) AS revenue, COUNT(order_id) AS orders_count FROM orders WHERE status = 'Paid'" + d.oFilterNoAlias + " GROUP BY HOUR(DATE_ADD(created_at, INTERVAL 8 HOUR)) ORDER BY HOUR(DATE_ADD(created_at, INTERVAL 8 HOUR)) ASC", d.params);
  
  const [cogsRows] = await pool.query("SELECT HOUR(DATE_ADD(o.created_at, INTERVAL 8 HOUR)) AS hour, SUM(oi.quantity * ri.quantity_required * i.cost_per_unit) AS cogs FROM order_items oi JOIN recipe_items ri ON oi.dish_id = ri.dish_id JOIN ingredients i ON ri.ingredient_id = i.ingredient_id JOIN orders o ON oi.order_id = o.order_id WHERE o.status = 'Paid'" + d.oFilter + " GROUP BY HOUR(DATE_ADD(o.created_at, INTERVAL 8 HOUR))", d.params);
  
  const cogsMap = {};
  cogsRows.forEach(r => cogsMap[r.hour] = parseFloat(r.cogs || 0));

  const result = rows.map(r => {
    const rev = parseFloat(r.revenue);
    const cogs = cogsMap[r.hour] || 0;
    return {
      hour: r.hour,
      revenue: rev,
      orders_count: r.orders_count,
      gross_profit: rev - cogs
    };
  });
  
  res.json(result);
});

// 食材報廢耗損分析 (圖表用)
app.get('/api/reports/ingredient-consumption', async (req, res) => {
  const d = getDateParams(req);
  const sql = `
    SELECT 
      i.ingredient_name, 
      SUM(oi.quantity * ri.quantity_required) AS consumed_quantity, 
      i.unit, 
      SUM(oi.quantity * ri.quantity_required * i.cost_per_unit) AS loss_cost 
    FROM order_items oi 
    JOIN recipe_items ri ON oi.dish_id = ri.dish_id 
    JOIN ingredients i ON ri.ingredient_id = i.ingredient_id 
    JOIN orders o ON oi.order_id = o.order_id 
    WHERE o.status = 'Paid' ${d.oFilter} 
    GROUP BY i.ingredient_id, i.ingredient_name, i.unit 
    ORDER BY consumed_quantity DESC 
    LIMIT 10
  `;
  const [rows] = await pool.query(sql, d.params);
  res.json(rows);
});

// 編輯指定配方項目
app.put('/api/dishes/:dishId/recipe/:ingredientId', async (req, res) => {
  try {
    const { quantityRequired } = req.body;
    await pool.query('UPDATE recipe_items SET quantity_required = ? WHERE dish_id = ? AND ingredient_id = ?', [quantityRequired, req.params.dishId, req.params.ingredientId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 編輯進貨單
app.put('/api/purchases/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const purchaseId = req.params.id;
    const { supplier, purchaseDate, items } = req.body;
    
    const [oldItems] = await conn.query('SELECT ingredient_id, quantity FROM purchase_order_items WHERE purchase_id = ?', [purchaseId]);
    for (const item of oldItems) {
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity - ? WHERE ingredient_id = ?', [item.quantity, item.ingredient_id]);
    }
    
    await conn.query('DELETE FROM purchase_order_items WHERE purchase_id = ?', [purchaseId]);
    
    let totalCost = 0;
    items.forEach(i => totalCost += (i.quantity * i.cost_per_unit));
    await conn.query('UPDATE purchase_orders SET supplier = ?, purchase_date = ?, total_cost = ? WHERE purchase_id = ?', [supplier || null, purchaseDate, totalCost, purchaseId]);
    
    for (const item of items) {
      await conn.query('INSERT INTO purchase_order_items (purchase_id, ingredient_id, quantity, cost_per_unit) VALUES (?, ?, ?, ?)', [purchaseId, item.ingredient_id, item.quantity, item.cost_per_unit]);
      await conn.query('UPDATE ingredients SET stock_quantity = stock_quantity + ? WHERE ingredient_id = ?', [item.quantity, item.ingredient_id]);
    }
    
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


// 啟動伺服器，監聽 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`後端伺服器已啟動！正在監聽 Port ${PORT}`));
