const mysql = require('mysql2/promise');
require('dotenv').config();

async function createTable() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'polly_db'
  });

  try {
    const query = `
      CREATE TABLE IF NOT EXISTS inventory_checks (
        check_id INT AUTO_INCREMENT PRIMARY KEY,
        ingredient_id INT NOT NULL,
        old_quantity DECIMAL(10,2) NOT NULL,
        new_quantity DECIMAL(10,2) NOT NULL,
        check_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes VARCHAR(255),
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
      )
    `;
    await pool.query(query);
    console.log('inventory_checks table created or already exists.');
  } catch (err) {
    console.error('Error creating table:', err);
  } finally {
    await pool.end();
  }
}

createTable();
