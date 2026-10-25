# English-to-Bangla Hover & Click Translator (Chrome Extension - Manifest V3)

A high-performance, production-ready Google Chrome extension that provides instant English-to-Bangla (Bengali) translation whenever you double-click any word or short phrase on any webpage.

---

## ✨ Features

- **Double-Click Instant Translation**: Double-click any English word on any webpage to see its Bangla meaning in a floating, non-intrusive tooltip.
- **Shadow DOM Style Isolation**: The floating tooltip is encapsulated within a Shadow DOM container with `z-index: 2147483647`, ensuring host webpage styles never break the translation UI.
- **Audio Pronunciation**: High-clarity native speech pronunciation using the Web Speech API (`window.speechSynthesis`).
- **Comprehensive Meanings & Parts of Speech**: Displays primary Bengali translation plus part-of-speech breakdowns (nouns, verbs, adjectives, etc.) and alternative synonyms.
- **CORS-Free Architecture**: Translation requests execute inside the Background Service Worker (`background.js`) to bypass page-level Content Security Policies (CSP) and CORS restrictions.
- **Dual API Fallback Engine**:
  - **Primary**: Google Translate GTX (fast, free, rich dictionary breakdowns).
  - **Fallback**: MyMemory Translation API.
- **In-Memory Caching**: Recently translated words resolve instantaneously without redundant network requests.
- **Toolbar Control Panel (Popup UI)**:
  - Master **Enable / Disable Toggle Switch** (synced across tabs in real-time).
  - **Quick Translate Box** for translating typed or pasted words/sentences.
  - **Recent Words History** showing the last 5 lookups with pronunciation and copy buttons.
  - One-click translation copying with visual feedback.

---

## 📁 File Structure

```text
mosuehoberTransalation/
├── manifest.json       # Chrome Manifest V3 configuration
├── background.js       # Background service worker (API requests, caching, CORS bypass)
├── content.js          # DOM double-click listener & Shadow DOM tooltip
├── popup.html          # Toolbar extension control panel
├── popup.css           # Modern 320px styling with Bengali typography
├── popup.js            # Toolbar logic, toggle state, quick translator & recent words
├── icons/              # Valid PNG extension icons
│   ├── icon-16.png     # 16x16px icon
│   ├── icon-48.png     # 48x48px icon
│   └── icon-128.png    # 128x128px icon
└── README.md           # Documentation & installation instructions
```

---

## 🚀 How to Install and Run in Chrome

1. Open **Google Chrome**.
2. Navigate to `chrome://extensions/` in the URL address bar.
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the extension directory:
   `d:\antigravity_project\chrome extension\mosuehoberTransalation`
6. Pin the extension icon to your toolbar for quick access.

---

## 🎯 Usage

1. **On Any Webpage**:
   - Double-click any English word (e.g. *knowledge*, *beautiful*, *freedom*).
   - A sleek floating tooltip appears right above (or below) the word with its Bangla meaning and pronunciation button.
   - Click outside, scroll, or press `Escape` to dismiss the tooltip.

2. **From the Extension Toolbar**:
   - Click the extension icon in your Chrome toolbar.
   - Toggle the master switch to enable or disable double-click translation at any time.
   - Type or paste any word or sentence in the **Quick Translate** box and press **Enter** or click **Translate**.
   - Review your **Recent Words** or click any word to reload it in the translator.
