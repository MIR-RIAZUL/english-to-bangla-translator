const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  'settings.js',
  'lemmatize.js',
  'tts.js',
  'background.js',
  'content.js',
  'popup.js',
  'options.js',
  'history.js'
];

console.log('--- Checking Syntax for all files ---');
files.forEach(file => {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  try {
    new vm.Script(code);
    console.log(`[SYNTAX OK] ${file}`);
  } catch (err) {
    console.error(`[SYNTAX ERROR] ${file}:`, err.message);
  }
});

