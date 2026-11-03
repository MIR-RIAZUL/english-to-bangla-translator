const fs = require('fs');
const path = require('path');

const files = ['background.js', 'content.js', 'popup.js', 'options.js', 'history.js', 'settings.js'];

const settingsKeys = [
  'triggerMode',
  'hoverDelay',
  'modifierKey',
  'speechRate',
  'apiKey',
  'providerOrder',
  'historyLimit',
  'highlightColor',
  'theme',
  'offlineEnabled',
  'sentenceEnabled',
  'maxChars',
  'showOriginal',
  'floatingButton',
  'saveSentences'
];

const usages = {};
settingsKeys.forEach(k => usages[k] = []);

files.forEach(file => {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  settingsKeys.forEach(k => {
    const regex = new RegExp(`\\b${k}\\b`, 'g');
    const matches = content.match(regex);
    if (matches) {
      usages[k].push({ file, count: matches.length });
    }
  });
});

console.log(JSON.stringify(usages, null, 2));

