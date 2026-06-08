const fs = require('fs');
let c = fs.readFileSync('docs/admin.html', 'utf8');
console.log('step="any" count: ', (c.match(/step="any"/g)||[]).length);
console.log('step="0.01" count: ', (c.match(/step="0\.01"/g)||[]).length);
