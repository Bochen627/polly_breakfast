const fs = require('fs');
let content = fs.readFileSync('docs/admin.html', 'utf8');
content = content.replace(/step="0\.01"/g, 'step="any"');
fs.writeFileSync('docs/admin.html', content);
