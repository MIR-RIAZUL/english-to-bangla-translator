const fs = require('fs');
const path = require('path');

const files = ['content.js', 'history.js', 'popup.js', 'options.js'];

files.forEach(file => {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const lines = content.split('\n');
  
  let inAssignment = false;
  let target = '';
  let buffer = [];
  let startLine = 0;

  lines.forEach((line, idx) => {
    if (line.includes('.innerHTML = `')) {
      inAssignment = true;
      target = line.split('.innerHTML')[0].trim();
      startLine = idx + 1;
      buffer = [line];
    } else if (inAssignment) {
      buffer.push(line);
      if (line.includes('`;')) {
        inAssignment = false;
        const code = buffer.join('\n');
        // Find all ${...}
        const matches = code.match(/\$\{([^}]+)\}/g) || [];
        console.log(`\n--- ${file}:${startLine} (${target}) ---`);
        matches.forEach(m => {
          const isEscaped = m.includes('escapeHtml(') || m.includes('MAX_INPUT_CHARS') || m.includes('noticesHTML') || m.includes('noticesHtml') || m.includes('dictHTML') || m.includes('bnDisabled') || m.includes('isSentenceInitial') || m.includes('isClampedByDefault') || m.includes('isFirst') || m.includes('isLast') || m.includes('index') || m.includes('lookupCount') || m.includes('isSentence') || m.includes('formattedDate');
          console.log(`  ${m} -> ${isEscaped ? 'OK' : 'CHECK'}`);
        });
      }
    }
  });
});

