const fs = require('fs');
const path = require('path');

const files = ['background.js', 'content.js', 'popup.js', 'options.js', 'history.js', 'settings.js', 'tts.js', 'lemmatize.js'];

const sendMessages = [];
const messageListeners = [];

files.forEach(file => {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('sendMessage(')) {
      sendMessages.push({ file, line: idx + 1, text: line.trim() });
    }
    if (line.includes('.onMessage.addListener(')) {
      messageListeners.push({ file, line: idx + 1, text: line.trim() });
    }
    if (line.includes('action:')) {
      // capture message actions
    }
  });
});

console.log('Senders:');
console.log(sendMessages);
console.log('\nListeners:');
console.log(messageListeners);

