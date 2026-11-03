# English-to-Bangla Hover & Click Translator (Chrome & Microsoft Edge Extension)

A high-performance, privacy-first browser extension for **Google Chrome** and **Microsoft Edge** that provides instant English-to-Bangla (Bengali) translations whenever you double-click or hover over any word on any webpage.

Built exclusively with **vanilla JavaScript**, native Web APIs, and local assets—no external frameworks, no build steps, and zero third-party tracking.

---

## ✨ Features

- **Cross-Browser Native Support (Chrome & Edge)**:
  - 100% Manifest V3 compliant across both **Google Chrome** (v105+) and **Microsoft Edge** (v105+).
  - Native integration with browser extension settings and keyboard shortcut managers (`chrome://extensions/shortcuts` and `edge://extensions/shortcuts`).
- **Double-Click & Hover Translation**:
  - Double-click any English word on any webpage to see its Bangla meaning in an isolated, floating tooltip.
  - Optional mouse hover mode with configurable pause delay (200ms – 2000ms) and optional modifier key gating (`Alt`, `Ctrl`, `Shift`, or `None`).
  - Safe-zone heuristics: automatically ignores password fields, input elements, textareas, and editable documents.
- **CSS Custom Highlight API**:
  - Highlights the translated word on the host webpage in real time using the native `CSS.highlights` API and `::highlight()` pseudo-element.
  - Zero DOM mutation: does not insert `<mark>` tags or alter page HTML structure.
  - Uses your custom configured highlight tint color (`settings.highlightColor`).
  - Automatically cleans up the highlight when the tooltip closes.
  - Safely falls back to skipping highlight if unsupported by older browser engines.
- **Dual-Language Text-to-Speech (TTS)**:
  - English speech button (`🔊`) to hear native English pronunciation.
  - Bangla speech button (`🔊`) to listen to authentic Bengali pronunciation.
  - Smart Bangla voice detection prioritizing `bn-BD` (Bangladesh) followed by `bn-IN` (India), with dedicated support for Microsoft Edge Natural Voices (`Microsoft Bashkar Online (Natural)` / `Microsoft Nabanita Online (Natural)`).
  - Graceful fallback with an informative notice if no Bangla voice is installed on the host operating system.
  - Synchronized speech rate adjustment (`speechRate`) for both languages.
- **Accessible & Motion-Sensitive Tooltip**:
  - Fully accessible dialog semantics with `role="dialog"` and comprehensive `aria-label` tags on all interactive buttons.
  - High-visibility `:focus-visible` styling for seamless keyboard navigation.
  - Full support for `@media (prefers-reduced-motion: reduce)`, disabling all transitions and spinner animations for users with motion sensitivities.
- **Multi-Theme Engine**:
  - Choose between **Dark Theme** (default), **Light Theme**, or **System Auto** (which adapts dynamically via `prefers-color-scheme`).
- **100% Offline Bundled Fonts**:
  - Bundled local `Inter` (400, 600) and `Hind Siliguri` (400, 600) WOFF2 fonts with system-font fallback stacks (`Segoe UI`, `Arial`, `Noto Sans Bengali`, `sans-serif`).
  - Zero external Google Fonts CDN network calls for superior speed and total privacy.
- **Shadow DOM Style Isolation**:
  - Floating tooltips are encapsulated inside an isolated Shadow DOM container with `z-index: 2147483647`, preventing any CSS bleeding into or from the host webpage.
- **Offline Starter Dictionary & Lemmatizer**:
  - Bundled local dictionary (`data/dictionary.json`) covering ~300+ common English words with parts of speech and Bangla definitions (released under the CC0 1.0 Universal Public Domain Dedication).
  - Morphological lemmatizer (`lemmatize.js`) supporting suffixes (`-ing`, `-ed`, `-s`, `-es`, `-ies` → `y`, `-ied` → `y`) and doubled consonants (e.g. `running` → `run`).
  - Automatic fallback to offline dictionary when network connectivity is lost (`navigator.onLine === false`) or online endpoints fail.
  - Visual amber **offline** badge indicator on tooltips and popup results when served from the offline dictionary.
- **Official Google Cloud Translation API v2 Basic**:
  - Optional official API integration with secure local credential storage.
  - In-options **Test Key** verification button with instant feedback.
  - Exponential backoff with up to 2 retries on HTTP 429 and 5xx errors.
  - Bilingual, user-friendly Bangla + English explanations for invalid keys, quota limits, and network errors.
- **Flexible Provider Priority Order**:
  - Reorderable translation provider priority list (`official`, `gtx`, `mymemory`, `offline`).
  - Automatic failover to subsequent providers when one encounters an error or network drop.
- **Two-Tier Caching Architecture**:
  - **Memory Cache**: High-speed LRU-capped in-memory map (300 entries).
  - **Persistent Cache**: `chrome.storage.local` store under key `tcache` (up to 1,000 entries with automatic oldest-entry eviction).
- **Comprehensive Meanings & Parts of Speech**:
  - Displays primary Bengali translation plus part-of-speech breakdowns (nouns, verbs, adjectives, etc.) and alternative synonyms.
- **Full History & Search Dashboard (`history.html`)**:
  - Search history in real-time with instant substring matching across both English and Bengali fields.
  - Filter lookups by English, Bangla, or both languages.
  - Sort entries by most recent, most looked up (frequency count), or alphabetical order (A–Z).
  - Export full history to CSV (with UTF-8 BOM `\uFEFF` for clean Excel/Sheets rendering) or structured JSON.
  - Delete individual lookups or clear entire history with confirmation safeguards.
  - Rich data model storing `{ word, translation, timestamp, count }` with automatic count incrementing and timestamp refreshing on repeat lookups.
- **Keyboard Shortcuts**:
  - `Alt+T`: Translate highlighted text on any webpage.
  - `Alt+Shift+T`: Globally toggle extension translation on or off.

---

## ⌨ Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Alt+T` | `translate-selection` | Translates the currently highlighted word or short phrase (up to 3 words) on the active webpage. |
| `Alt+Shift+T` | `toggle-extension` | Globally toggles the translation functionality on or off. |

> [!TIP]
> You can customize these shortcuts anytime by clicking **Configure Shortcuts** inside the Options page, which automatically opens your browser's native shortcut editor:
> - **Google Chrome**: `chrome://extensions/shortcuts`
> - **Microsoft Edge**: `edge://extensions/shortcuts`

---

## 🚀 Installation & Browser Setup

### Google Chrome
1. Open **Google Chrome**.
2. Navigate to `chrome://extensions/` in the address bar.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the extension directory:
   `d:\antigravity_project\chrome extension\mosuehoberTransalation`
6. Pin the extension icon to your Chrome toolbar.

### Microsoft Edge
1. Open **Microsoft Edge**.
2. Navigate to `edge://extensions/` in the address bar.
3. Enable **Developer mode** using the toggle in the left sidebar (or bottom-left corner).
4. Click the **Load unpacked** button at the top of the page.
5. Select the same extension directory:
   `d:\antigravity_project\chrome extension\mosuehoberTransalation`
6. Click the extension puzzle icon on the Edge toolbar and click the eye icon to keep it visible.

---

## ⚙️ Settings & Customization Guide

Access the extension options by right-clicking the extension toolbar icon and selecting **Options**, or by clicking the ⚙ gear button inside the extension popup.

All settings are automatically saved in real time to `chrome.storage.local`:

| Setting | Default Value | Description |
| :--- | :--- | :--- |
| **Trigger Mode** | `dblclick` | Choose between `Double-Click`, `Mouse Hover`, or `Both`. |
| **Hover Delay** | `600 ms` | Milliseconds the cursor must hover over a word before translating (200ms – 2000ms). |
| **Modifier Key** | `none` | Require holding `Alt`, `Ctrl`, or `Shift` while double-clicking or hovering to trigger translation. |
| **Provider Fallback Order** | `[official, gtx, mymemory, offline]` | Reorder providers using the Move Up / Move Down buttons to set failover priority. |
| **Google Cloud API Key** | `""` (Empty) | Optional official key for Google Cloud Translation API v2 Basic. |
| **Enable Offline Dictionary** | `true` | Allows translating common words using local dictionary data when offline. |
| **Speech Rate** | `0.95x` | Playback speed for native English and Bangla speech synthesis (0.50x – 1.50x). |
| **Color Theme** | `dark` | Visual theme for tooltips: `Dark Theme`, `Light Theme`, or `Auto (System Theme)`. |
| **Selection Highlight Color**| `#fde68a` | CSS Custom Highlight background tint for active words on web pages. |
| **Recent History Limit** | `200` | Maximum number of lookup records preserved in local history (10 – 1000). |

---

## 🔑 Google Cloud Translation API Key Setup

While the extension works out of the box with the default Google GTX web engine and local offline dictionary, you can optionally connect your own official Google Cloud Translation API key:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new Google Cloud project or select an existing one.
3. Navigate to **APIs & Services** → **Library**, search for **Cloud Translation API**, and click **Enable**.
4. Go to **APIs & Services** → **Credentials**, click **Create Credentials**, and select **API key**.
5. (Recommended) Under **API restrictions**, restrict the key to the **Cloud Translation API**.
6. Copy the generated API key (starts with `AIzaSy...`).
7. Open the extension **Options** page.
8. Paste the key into the **Google Cloud API Key** input field.
9. Click **Test Key** to verify connectivity. You will see a green confirmation badge when the key is validated.

> [!NOTE]
> Your API key is stored strictly on your local computer in `chrome.storage.local`. It is never transmitted to external servers other than official Google API endpoints (`https://translation.googleapis.com/*`), never synced via browser cloud sync, and never logged in the console.

---

## 🔒 Permissions & Host Access Explained

The extension requests only minimal permissions necessary for its core features:

| Permission | Reason & Usage |
| :--- | :--- |
| `storage` | Stores user settings (`settings`), toggle status (`enabled`), lookup history (`recentWords`), and persistent translation cache (`tcache`) across browser sessions using `chrome.storage.local`. |
| `activeTab` | Interacts with the active webpage to display the translation tooltip and handle the `Alt+T` shortcut. |
| `web_accessible_resources (fonts/*)` | Allows webpage contexts to load bundled extension fonts (`inter-*.woff2`, `hind-siliguri-*.woff2`) declared via injected `@font-face` rules. |
| `https://translate.googleapis.com/*` | Fetches fast translations, definitions, and part-of-speech breakdowns from Google GTX endpoints. |
| `https://translation.googleapis.com/*` | Executes authorized translations and credential verification using the official Google Cloud Translation API v2 Basic. |
| `https://api.mymemory.translated.net/*` | Serves as a resilient public fallback translation provider if Google endpoints are unreachable. |

---

## 📚 Offline Dictionary Source & License

The starter offline dictionary located at [`data/dictionary.json`](data/dictionary.json) contains foundational English vocabulary terms mapped to parts of speech and Bengali definitions.

- **Source**: Curated from public-domain word frequency corpora and standardized English-Bengali bilingual lexical lists.
- **License**: Released under the [Creative Commons Zero (CC0 1.0 Universal) Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/). You can copy, modify, distribute, and perform the work, even for commercial purposes, all without asking permission.

---

## 📁 File Structure

```text
mosuehoberTransalation/
├── manifest.json       # Manifest V3 configuration (v2.0.0) for Chrome & Edge
├── tts.js              # Speech synthesis module with Bangla voice detection (Chrome & Edge Natural voices)
├── settings.js         # Shared settings helper & default configuration
├── lemmatize.js        # Morphological root extractor (-ing, -ed, plurals, doubled consonants)
├── background.js       # Service worker (caching, official API, offline fallback, commands listener)
├── content.js          # DOM double-click & hover listener, CSS highlight, accessible Shadow DOM tooltip
├── popup.html          # Toolbar extension control panel with settings button, Bangla audio, and history link
├── popup.css           # Modern 320px styling with local font declarations & playing states
├── popup.js            # Toolbar logic, toggle state, quick translator & recent words preview
├── history.html        # Dedicated full-page translation history manager & export interface
├── history.css         # History dashboard styling with responsive grid, dark theme & animations
├── history.js          # History live search, multi-field filtering, sorting, CSV/JSON export & speech
├── options.html        # Full settings & preferences page with API key tester & shortcuts launcher
├── options.css         # Styling for options page with local font declarations
├── options.js          # Options controller with automatic saving & Chrome/Edge shortcuts detection
├── data/
│   └── dictionary.json # Bundled starter offline dictionary (~300+ entries, CC0)
├── fonts/              # Bundled local WOFF2 font files
│   ├── inter-400.woff2
│   ├── inter-600.woff2
│   ├── hind-siliguri-400.woff2
│   └── hind-siliguri-600.woff2
├── icons/              # PNG extension icons
│   ├── icon-16.png     # 16x16px icon
│   ├── icon-48.png     # 48x48px icon
│   └── icon-128.png    # 128x128px icon
├── CHANGELOG.md        # Comprehensive v2.0.0 release changelog
└── README.md           # Documentation, licensing & Chrome/Edge installation guide
```

---

## 🏗️ Architecture & Technical Highlights

- **Universal Chromium Compatibility**: Works without code changes across Google Chrome, Microsoft Edge, Brave, Opera, and Vivaldi.
- **Pure Vanilla JavaScript**: Zero external npm dependencies, zero build steps, and zero transpilation overhead.
- **Isolated Shadow DOM**: The floating tooltip uses `attachShadow({ mode: 'open' })` with an explicit reset (`all: initial !important`) and `z-index: 2147483647`, ensuring that host page stylesheets never interfere with the translation popup.
- **CSS Custom Highlight API**: Word highlighting uses `CSS.highlights` and `::highlight(eng-bn-word-highlight)` for clean, non-destructive highlighting without modifying the host page DOM.
- **Two-Tier Resilient Cache**: High-speed 300-entry in-memory LRU cache backed by a 1,000-entry persistent `chrome.storage.local` store.
- **Accessible Design**: Built with WCAG standards in mind—complete `role="dialog"` semantic encapsulation, comprehensive `aria-label` tags, `:focus-visible` focus rings, and `@media (prefers-reduced-motion: reduce)` animation silencing.
