# English-to-Bangla Hover & Click Translator (Chrome Extension - Manifest V3)

A high-performance, production-ready Google Chrome extension that provides instant English-to-Bangla (Bengali) translation whenever you double-click any word or short phrase on any webpage.

---

## ✨ Features

- **Double-Click Instant Translation**: Double-click any English word on any webpage to see its Bangla meaning in a floating, non-intrusive tooltip.
- **Shadow DOM Style Isolation**: The floating tooltip is encapsulated within a Shadow DOM container with `z-index: 2147483647`, ensuring host webpage styles never break the translation UI.
- **100% Offline Bundled Fonts**: Bundled `Inter` and `Hind Siliguri` (400, 600) WOFF2 fonts with robust system-font fallbacks (`Segoe UI`, `Arial`, `Noto Sans Bengali`, `sans-serif`) and zero external Google Font CDN dependencies.
- **Flexible Provider Priority Order**:
  - Run translation providers according to customizable user order (`official` → `gtx` → `mymemory` → `offline`).
  - Automatic seamless failover to subsequent providers when one encounters an error or network drop.
- **Official Google Cloud Translation API v2 Basic**:
  - Direct integration via `https://translation.googleapis.com/language/translate/v2`.
  - Secure credential management (stored in `chrome.storage.local`, never logged, never synced).
  - In-options **Test Key** verification tool.
- **Resilient Network Handling**:
  - Exponential backoff with up to 2 retries on HTTP 429 (rate limits) and 5xx (server errors).
  - Bilingual, user-friendly Bangla + English explanations for invalid API keys, quota exhaustion, and connectivity drops.
- **Offline Starter Dictionary & Lemmatization**:
  - Bundled local dictionary (`data/dictionary.json`) covering ~300+ common English words with parts of speech and Bangla definitions.
  - Smart morphological lemmatizer (`lemmatize.js`) supporting suffixes (`-ing`, `-ed`, `-s`, `-es`, `-ies` → `y`, `-ied` → `y`) and doubled consonants (e.g., `running` → `run`).
  - Automatic fallback to offline dictionary when network connectivity is lost (`navigator.onLine === false`) or online endpoints fail.
  - Visual **offline** badge indicator on tooltips and popup results when served from the offline dictionary.
- **Two-Tier Caching Architecture**:
  - **Memory Cache**: High-speed LRU-capped in-memory map (300 entries).
  - **Persistent Cache**: `chrome.storage.local` store under key `tcache` (up to 1,000 entries with automatic oldest-entry eviction).
- **Audio Pronunciation**: High-clarity native speech pronunciation using the Web Speech API (`window.speechSynthesis`).
- **Comprehensive Meanings & Parts of Speech**: Displays primary Bengali translation plus part-of-speech breakdowns (nouns, verbs, adjectives, etc.) and alternative synonyms.
- **CORS-Free Architecture**: Translation requests execute inside the Background Service Worker (`background.js`) to bypass page-level Content Security Policies (CSP) and CORS restrictions.
- **Toolbar Control Panel (Popup UI)**:
  - Master **Enable / Disable Toggle Switch** (synced across tabs in real-time).
  - **Quick Translate Box** for translating typed or pasted words/sentences.
  - **Recent Words History** showing the last 5 lookups with pronunciation and copy buttons.
  - Settings (⚙) button linking directly to the full Options page.
  - One-click translation copying with visual feedback.
- **Full Options & Settings Panel (v2.0.0)**:
  - Customizable trigger modes (`dblclick`, `hover`, `select`), hover delay, and modifier keys.
  - Reorderable translation provider priority list (`official`, `gtx`, `mymemory`, `offline`).
  - Speech synthesis rate customization with audio test button.
  - Theme switching and custom highlight color selection.
  - History retention limit configuration and one-click default reset.

---

## 📚 Offline Dictionary Source & Licensing

The starter dictionary file located at [`data/dictionary.json`](data/dictionary.json) contains a curated list of foundational English vocabulary terms mapped to parts of speech and Bengali definitions.
- **Source**: Curated from public-domain word frequency corpora and standardized English-Bengali bilingual lexical lists.
- **License**: Released under the [Creative Commons Zero (CC0 1.0 Universal) Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/). Free to use, adapt, and expand without restriction.

---

## 🔒 Permissions & Resources Explanation

The extension requests only minimal permissions necessary for its core operation:

- `storage`: Required to save user preferences (`settings` object), toggle status (`enabled`), persistent lookup history (`recentWords`), and persistent translation cache (`tcache`) across browser sessions using `chrome.storage.local`.
- `activeTab`: Required to interact with the current webpage context when triggered and open extension options cleanly.
- `web_accessible_resources (fonts/*)`: Required to permit web pages to load bundled local extension fonts (`inter-*.woff2`, `hind-siliguri-*.woff2`) declared via injected `@font-face` rules.
- `https://translate.googleapis.com/*`: Required to fetch fast translations and comprehensive parts of speech from Google GTX endpoints.
- `https://translation.googleapis.com/*`: Required to perform authorized translations and credential verification using the official Google Cloud Translation API v2 Basic.
- `https://api.mymemory.translated.net/*`: Required to provide resilient fallback translations when Google's endpoints are unreachable.

---

## 📁 File Structure

```text
mosuehoberTransalation/
├── manifest.json       # Chrome Manifest V3 configuration (v2.0.0)
├── settings.js         # Shared settings helper & default configuration
├── lemmatize.js        # Morphological root extractor (-ing, -ed, plurals, doubled consonants)
├── background.js       # Background service worker (caching, official API, offline fallback, CORS bypass)
├── content.js          # DOM double-click listener, Shadow DOM tooltip & offline badge
├── popup.html          # Toolbar extension control panel with settings button
├── popup.css           # Modern 320px styling with local font declarations
├── popup.js            # Toolbar logic, toggle state, quick translator & recent words
├── options.html        # Full settings & preferences page with API key tester
├── options.css         # Styling for options page with local font declarations
├── options.js          # Options controller with automatic saving & key tester
├── data/
│   └── dictionary.json # Bundled starter offline dictionary (~300+ entries, CC0)
├── fonts/              # Bundled local WOFF2 font files
│   ├── inter-400.woff2
│   ├── inter-600.woff2
│   ├── hind-siliguri-400.woff2
│   └── hind-siliguri-600.woff2
├── icons/              # Valid PNG extension icons
│   ├── icon-16.png     # 16x16px icon
│   ├── icon-48.png     # 48x48px icon
│   └── icon-128.png    # 128x128px icon
└── README.md           # Documentation, licensing & installation guide
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
   - If offline or disconnected from the internet, the translation is retrieved instantly from the local dictionary and displays a yellow **OFFLINE** badge.
   - Click outside, scroll, or press `Escape` to dismiss the tooltip.

2. **From the Extension Toolbar**:
   - Click the extension icon in your Chrome toolbar.
   - Toggle the master switch to enable or disable double-click translation at any time.
   - Click the ⚙ (gear) icon in the header to open the Options page.
   - Type or paste any word or sentence in the **Quick Translate** box and press **Enter** or click **Translate**.
   - Review your **Recent Words** or click any word to reload it in the translator.

3. **In the Options Page**:
   - Open options by right-clicking the extension icon and choosing **Options**, or via the gear icon in the popup.
   - Adjust interaction triggers, provider priorities, speech rate, colors, and limits.
   - Add your Google Cloud Translation API key and test it with the **Test Key** button.
   - Changes are saved automatically in real-time. Use **Reset to Defaults** to restore factory settings.
