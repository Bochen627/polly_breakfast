const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    const [result] = await pool.query("INSERT INTO scrap_records (ingredient_id, quantity, reason, scrap_date) VALUES (1, 10, 'Test', '2026-06-08')");
    console.log("Inserted ID:", result.insertId);
    
    // Test PUT
    const putRes = await fetch('http://localhost:3000/api/scraps/' + result.insertId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5, reason: 'Test Update' })
    });
    console.log("PUT Response:", putRes.status, await putRes.text());
    
    // Test DELETE
    const delRes = await fetch('http://localhost:3000/api/scraps/' + result.insertId, {
      method: 'DELETE'
    });
    console.log("DELETE Response:", delRes.status, await delRes.text());

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

test();
