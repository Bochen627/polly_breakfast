const mysql = require('mysql2/promise');
const pool = mysql.createPool({host: 'localhost', user: 'polly_user', password: 'polly_password', database: 'polly_pos'});
pool.query('SELECT * FROM scrap_records').then(([rows]) => {console.log(rows); pool.end();}).catch(console.error);
