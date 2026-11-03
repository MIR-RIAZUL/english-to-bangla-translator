const fs = require('fs');
const path = require('path');

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

let duplicatesFound = false;

files.forEach(file => {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const lines = code.split('\n');
  const functions = {};

  lines.forEach((line, idx) => {
    const match = line.match(/^\s*(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/);
    if (match) {
      const name = match[1];
      if (!functions[name]) {
        functions[name] = [];
      }
      functions[name].push(idx + 1);
    }
  });

  for (const name in functions) {
    if (functions[name].length > 1) {
      console.warn(`[DUPLICATE FUNCTION] ${file}: function "${name}" declared at lines ${functions[name].join(', ')}`);
      duplicatesFound = true;
    }
  }
});

if (!duplicatesFound) {
  console.log('No duplicate function declarations found in any file.');
}

