const fs = require('fs');

// 1. Update server.js
let serverCode = fs.readFileSync('server.js', 'utf8');

const newServerBlock = `// 6. 報表統計 API
// ==========================================

function getDateParams(req) {
  const { startDate, endDate } = req.query;
  const hasDates = startDate && endDate;
  return {
    hasDates,
    startDate,
    endDate,
    oFilter: hasDates ? " AND DATE(o.created_at) >= ? AND DATE(o.created_at) <= ? " : "",
    oFilterNoAlias: hasDates ? " AND DATE(created_at) >= ? AND DATE(created_at) <= ? " : "",
    purFilter: hasDates ? " WHERE DATE(purchase_date) >= ? AND DATE(purchase_date) <= ? " : "",
    scrFilter: hasDates ? " WHERE DATE(sr.created_at) >= ? AND DATE(sr.created_at) <= ? " : "",
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
  
  const tr = parseFloat(rev[0].total || 0);
  const tcogs = parseFloat(cogs[0].total || 0);
  const tscr = parseFloat(scr[0].total || 0);
  res.json({ totalRevenue: tr, totalPurchase: parseFloat(pur[0].total || 0), totalScrapLoss: tscr, cogs: tcogs, theoreticalProfit: tr - tcogs - tscr });
});

// 每日營業額統計 (圖表用)
app.get('/api/reports/daily-revenue', async (req, res) => {
  const d = getDateParams(req);
  const [rows] = await pool.query("SELECT DATE(created_at) AS date, SUM(total_amount) AS revenue, COUNT(order_id) AS orders_count FROM orders WHERE status = 'Paid'" + d.oFilterNoAlias + " GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 14", d.params);
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
  const [rows] = await pool.query("SELECT HOUR(created_at) AS hour, SUM(total_amount) AS revenue, COUNT(order_id) AS orders_count FROM orders WHERE status = 'Paid'" + d.oFilterNoAlias + " GROUP BY HOUR(created_at) ORDER BY HOUR(created_at) ASC", d.params);
  res.json(rows);
});

// 食材報廢耗損分析 (圖表用)
app.get('/api/reports/scrap-loss', async (req, res) => {
  const d = getDateParams(req);
  const [rows] = await pool.query("SELECT i.ingredient_name, SUM(sr.quantity) AS scrapped_quantity, i.unit, SUM(sr.quantity * i.cost_per_unit) AS loss_cost FROM scrap_records sr JOIN ingredients i ON sr.ingredient_id = i.ingredient_id" + d.scrFilter + " GROUP BY i.ingredient_id, i.ingredient_name, i.unit ORDER BY loss_cost DESC", d.params);
  res.json(rows);
});
`;

const startIdx = serverCode.indexOf('// 6. 報表統計 API');
const endIdx = serverCode.indexOf('// 啟動伺服器');
if (startIdx > -1 && endIdx > -1) {
  serverCode = serverCode.substring(0, startIdx) + newServerBlock + "\n" + serverCode.substring(endIdx);
  fs.writeFileSync('server.js', serverCode);
  console.log('server.js updated');
}

// 2. Update admin.html
let adminHtml = fs.readFileSync('docs/admin.html', 'utf8');
if (!adminHtml.includes('reportStartDate')) {
  adminHtml = adminHtml.replace(
    /<h2 class="content-title">營業數據分析<\/h2>/,
    `<h2 class="content-title">營業數據分析</h2>
          <div class="report-filters" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <input type="date" id="reportStartDate" class="form-control" style="width: 150px; padding: 4px 8px;">
            <span>~</span>
            <input type="date" id="reportEndDate" class="form-control" style="width: 150px; padding: 4px 8px;">
            <button class="btn btn-secondary" onclick="loadReportsData()">查詢區間</button>
          </div>`
  );
  fs.writeFileSync('docs/admin.html', adminHtml);
  console.log('docs/admin.html updated');
}

// 3. Update pos.js
let posJs = fs.readFileSync('docs/js/pos.js', 'utf8');

if (!posJs.includes('startDate=${startDate}')) {
  posJs = posJs.replace(
    /async function loadReportsData\(\) \{[\s\S]*?const summaryRes = await fetch\(API_BASE_URL \+ '\/api\/reports\/summary'\);/,
    `async function loadReportsData() {
  try {
    const startDate = document.getElementById('reportStartDate')?.value || '';
    const endDate = document.getElementById('reportEndDate')?.value || '';
    const queryStr = (startDate && endDate) ? \`?startDate=\${startDate}&endDate=\${endDate}\` : '';

    // If interval is exactly 1 day, hide daily revenue chart to avoid overlap with hourly trend
    const dailyChartCard = document.getElementById('dailyRevenueChart').closest('.chart-card');
    if (startDate && endDate && startDate === endDate) {
      dailyChartCard.style.display = 'none';
    } else {
      dailyChartCard.style.display = 'block';
    }

    // 1. Load Summary Metrics
    const summaryRes = await fetch(API_BASE_URL + '/api/reports/summary' + queryStr);`
  );

  posJs = posJs.replace(
    /const dailyRes = await fetch\(API_BASE_URL \+ '\/api\/reports\/daily-revenue'\);/,
    "const dailyRes = await fetch(API_BASE_URL + '/api/reports/daily-revenue' + queryStr);"
  );
  posJs = posJs.replace(
    /const topRes = await fetch\(API_BASE_URL \+ '\/api\/reports\/top-selling'\);/,
    "const topRes = await fetch(API_BASE_URL + '/api/reports/top-selling' + queryStr);"
  );
  posJs = posJs.replace(
    /const hourlyRes = await fetch\(API_BASE_URL \+ '\/api\/reports\/hourly-trend'\);/,
    "const hourlyRes = await fetch(API_BASE_URL + '/api/reports/hourly-trend' + queryStr);"
  );
  posJs = posJs.replace(
    /const scrapRes = await fetch\(API_BASE_URL \+ '\/api\/reports\/scrap-loss'\);/,
    "const scrapRes = await fetch(API_BASE_URL + '/api/reports/scrap-loss' + queryStr);"
  );
  fs.writeFileSync('docs/js/pos.js', posJs);
  console.log('docs/js/pos.js updated');
}
