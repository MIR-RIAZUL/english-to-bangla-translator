const fs = require('fs');
const path = require('path');

const files = ['content.js', 'history.js', 'popup.js', 'options.js'];

files.forEach(file => {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('.innerHTML')) {
      console.log(`${file}:${idx + 1}: ${line.trim()}`);
    }
  });
});

