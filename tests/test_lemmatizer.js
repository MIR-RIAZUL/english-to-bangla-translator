const fs = require('fs');
const path = require('path');
const assert = require('assert');

eval(fs.readFileSync(path.join(__dirname, '..', 'lemmatize.js'), 'utf8'));

const tests = [
  { word: 'running', expectedRoot: 'run' },
  { word: 'boxes', expectedRoot: 'box' },
  { word: 'studies', expectedRoot: 'study' },
  { word: 'studied', expectedRoot: 'study' },
  { word: 'stopped', expectedRoot: 'stop' }
];

let allPassed = true;
tests.forEach(t => {
  const candidates = lemmatize(t.word);
  const found = candidates.includes(t.expectedRoot);
  console.log(`${t.word} -> [${candidates.join(', ')}] contains "${t.expectedRoot}": ${found}`);
  if (!found) allPassed = false;
});

assert.strictEqual(allPassed, true);
console.log('All 5 lemmatizer tests PASSED');

