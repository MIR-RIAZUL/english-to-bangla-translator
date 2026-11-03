# English-to-Bangla Hover, Click & Sentence Translator (Chrome & Microsoft Edge Extension)

A high-performance, privacy-first browser extension for **Google Chrome** and **Microsoft Edge** that provides instant English-to-Bangla (Bengali) translations for single words, phrases, full sentences, and multi-line paragraphs whenever you double-click, hover, triple-click, select text, or use the context menu on any webpage.

Built exclusively with **vanilla JavaScript**, native Web APIs, and local assets—no external frameworks, no build steps, and zero third-party tracking.

---

## ✨ Features

- **Cross-Browser Native Support (Chrome & Edge)**:
  - 100% Manifest V3 compliant across both **Google Chrome** (v105+) and **Microsoft Edge** (v105+).
  - Native integration with browser extension settings and keyboard shortcut managers (`chrome://extensions/shortcuts` and `edge://extensions/shortcuts`).
- **Word & Sentence Translation Engine**:
  - **Single Words**: Double-click or hover to view large Bengali translations, pronunciation, and comprehensive part-of-speech dictionary breakdowns.
  - **Full Sentences & Paragraphs**: Seamless prose translation with natural Bengali phrasing, sentence boundary chunking, and paragraph-style formatting.
  - **Smart Mode Auto-Detection**: Text with 3 words or fewer is handled as a concise dictionary lookup; text with more than 3 words activates rich sentence translation mode.
  - **POST-Safe Chunking**: Long passages up to 3,000 characters (configurable via `maxChars`) are automatically split at sentence boundaries (`.`, `!`, `?`, `\n`) and joined seamlessly.
- **Multiple In-Page Trigger Options**:
  - **Double-Click**: Instant translation tooltip for words and phrases.
  - **Mouse Hover**: Debounced hover mode (200ms – 2000ms delay) with optional modifier key gating (`Alt`, `Ctrl`, `Shift`, or `None`).
  - **Triple-Click**: Instantly select and translate an entire sentence or paragraph.
  - **Floating "অ" Quick Action Button**: Selecting 4 or more words displays a sleek 28×28px floating button at the end of the selection for one-click translation.
  - **Context Menu Integration**: Right-click any selected text and choose **Translate to Bangla**.
  - **Keyboard Shortcut**: Press `Alt+T` on any active selection.
  - **Safe-Zone Heuristics**: Automatically ignores password fields, `<input>`, `<textarea>`, and `contentEditable` elements.
- **Adaptive Sentence Tooltip Layout**:
  - Expandable up to 420px width and 60vh height with smooth internal scroll containment (scrolling inside the tooltip does not dismiss it).
  - **Collapsible "Original" Section**: Displays source English text (clamped to 3 lines with click-to-expand, or expanded by default via `showOriginal`).
  - **Paragraph Formatting**: Retains sentence line breaks in clean Hind Siliguri typography without redundant dictionary cards.
  - **Copy Buttons**: Independent one-click copy buttons for both the Bangla translation and the original English text.
  - **Status Badges**: Informative alerts for character truncation (`truncated: true`) or offline approximation (`approximate: true`).
- **CSS Custom Highlight API**:
  - Highlights translated text on the host webpage in real time using the native `CSS.highlights` API and `::highlight()` pseudo-element.
  - Zero DOM mutation: does not insert `<mark>` tags or alter page HTML structure.
  - Uses your custom configured highlight tint color (`settings.highlightColor`).
  - Automatically cleans up the highlight when the tooltip closes.
- **Queued Dual-Language Text-to-Speech (TTS)**:
  - English speech button (`🔊`) to hear native English pronunciation.
  - Bangla speech button (`🔊`) to listen to authentic Bengali pronunciation.
  - **Utterance Queueing**: Long sentences and paragraphs are split into segments and spoken sequentially, overcoming Chromium's 15-second speech synthesis timeout bug.
  - Smart Bangla voice detection prioritizing `bn-BD` (Bangladesh) followed by `bn-IN` (India), with dedicated support for Microsoft Edge Natural Voices (`Microsoft Bashkar Online (Natural)` / `Microsoft Nabanita Online (Natural)`).
  - Synchronized speech rate adjustment (`speechRate`) for both languages.
- **Multi-Line Quick Translator Popup**:
  - 5-row multi-line textarea with 3,000-character limit and real-time counter (`123 / 3000`).
  - **Enter** triggers immediate translation; **Shift+Enter** inserts new lines.
  - Auto-switches layout dynamically between word mode (large font + POS dictionary breakdowns) and sentence mode (paragraph view + Listen & Copy controls).
- **Accessible & Motion-Sensitive Design**:
  - Fully accessible dialog semantics with `role="dialog"` and comprehensive `aria-label` tags on all interactive buttons.
  - High-visibility `:focus-visible` styling for seamless keyboard navigation.
  - Full support for `@media (prefers-reduced-motion: reduce)`, disabling all transitions and animations.
- **Multi-Theme Engine**:
  - Choose between **Dark Theme** (default), **Light Theme**, or **System Auto** (which adapts dynamically via `prefers-color-scheme`).
- **100% Offline Bundled Fonts**:
  - Bundled local `Inter` (400, 600) and `Hind Siliguri` (400, 600) WOFF2 fonts with system fallback stacks (`Segoe UI`, `Arial`, `Noto Sans Bengali`, `sans-serif`).
  - Zero external Google Fonts CDN network calls for superior speed and total privacy.
- **Offline Starter Dictionary & Lemmatizer**:
  - Bundled local dictionary (`data/dictionary.json`) covering ~300+ common English words with parts of speech and Bangla definitions (released under the CC0 1.0 Universal Public Domain Dedication).
  - Morphological lemmatizer (`lemmatize.js`) supporting suffixes (`-ing`, `-ed`, `-s`, `-es`, `-ies` → `y`, `-ied` → `y`) and doubled consonants.
  - Offline sentence fallback: approximates long prose word-by-word with unknown words preserved when internet is unavailable.
  - Visual amber **offline** badge indicator on tooltips and popup results.
- **Official Google Cloud Translation API v2 Basic**:
  - Optional official API integration with secure local credential storage and in-options **Test Key** verification.
  - Exponential backoff with up to 2 retries on HTTP 429 and 5xx errors.
- **Flexible Provider Priority Order**:
  - Reorderable translation provider priority list (`official`, `gtx`, `mymemory`, `offline`).
- **Two-Tier Caching Architecture**:
  - **Memory Cache**: High-speed LRU-capped in-memory map (300 entries).
  - **Persistent Cache**: `chrome.storage.local` store under key `tcache` (up to 1,000 entries with automatic oldest-entry eviction).
- **Full History & Search Dashboard (`history.html`)**:
  - Search history in real-time with instant substring matching across both English and Bengali fields.
  - Filter lookups by English, Bangla, or both languages.
  - Sort entries by most recent, most looked up (frequency count), or alphabetical order (A–Z).
  - Supports sentence history logging (optional via `saveSentences` setting), showing truncated previews (up to 120 chars) with sentence tags.
  - Export full history to CSV (with UTF-8 BOM `\uFEFF`) or structured JSON.
  - Delete individual lookups or clear entire history with confirmation safeguards.
- **Keyboard Shortcuts**:
  - `Alt+T`: Translate highlighted text on any webpage.
  - `Alt+Shift+T`: Globally toggle extension translation on or off.

---

## ⌨ Keyboard Shortcuts & Quick Triggers

| Trigger | Action | Description |
| :--- | :--- | :--- |
| `Double-Click` | Word Translation | Opens tooltip for the clicked word. |
| `Hover` | Hover Translation | Triggers tooltip after hovering for configured delay (optional modifier key). |
| `Triple-Click` | Paragraph Translation | Selects and translates the entire sentence or paragraph. |
| `Floating "অ" Button` | Sentence Action | Clicking the floating button translates any 4+ word text selection. |
| `Right-Click Context Menu` | Context Menu Translation | Select text, right-click, and choose **Translate to Bangla**. |
| `Alt+T` | `translate-selection` | Translates the currently highlighted text on the active webpage. |
| `Alt+Shift+T` | `toggle-extension` | Globally toggles extension translation functionality on or off. |

> [!TIP]
> You can customize keyboard shortcuts anytime by clicking **Configure Shortcuts** inside the Options page:
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
3. Enable **Developer mode** using the toggle in the left sidebar.
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
| **Modifier Key** | `none` | Require holding `Alt`, `Ctrl`, or `Shift` while triggering translation. |
| **Sentence Translation** | `true` | Enable multi-word sentence and paragraph translation on web pages. |
| **Floating "অ" Quick Button** | `true` | Display small floating button when selecting 4 or more words. |
| **Expand Original Text** | `false` | Automatically expand the original English section in sentence tooltips without clicking. |
| **Max Translation Characters** | `3000` | Maximum length per sentence translation request (500 – 10,000 characters). |
| **Save Sentences to History** | `false` | Optionally record sentence translations in local vocabulary history. |
| **Provider Fallback Order** | `[official, gtx, mymemory, offline]` | Reorder providers using Move Up / Move Down buttons. |
| **Google Cloud API Key** | `""` (Empty) | Optional official key for Google Cloud Translation API v2 Basic. |
| **Enable Offline Dictionary** | `true` | Allows translating words when internet connection is lost. |
| **Speech Rate** | `0.95x` | Playback speed for native English and Bangla speech synthesis (0.50x – 1.50x). |
| **Color Theme** | `dark` | Visual theme for tooltips: `Dark Theme`, `Light Theme`, or `Auto (System Theme)`. |
| **Selection Highlight Color**| `#fde68a` | CSS Custom Highlight background tint for active words on web pages. |
| **Recent History Limit** | `200` | Maximum number of lookup records preserved in local history (10 – 1000). |

---

## 🔒 Permissions & Host Access Explained

The extension requests only minimal permissions strictly necessary for its features:

| Permission | Reason & Usage |
| :--- | :--- |
| `storage` | Stores user settings (`settings`), toggle status (`enabled`), lookup history (`recentWords`), and persistent translation cache (`tcache`) across browser sessions using `chrome.storage.local`. |
| `activeTab` | Interacts with the active webpage to display the translation tooltip and handle the `Alt+T` shortcut. |
| `contextMenus` | Adds the **"Translate to Bangla"** entry to the browser right-click context menu for selected text. |
| `web_accessible_resources (fonts/*)` | Allows webpage contexts to load bundled extension fonts (`inter-*.woff2`, `hind-siliguri-*.woff2`) declared via injected `@font-face` rules. |
| `https://translate.googleapis.com/*` | Fetches fast translations, definitions, and part-of-speech breakdowns from Google GTX endpoints. |
| `https://translation.googleapis.com/*` | Executes authorized translations and credential verification using the official Google Cloud Translation API v2 Basic. |
| `https://api.mymemory.translated.net/*` | Serves as a resilient public fallback translation provider if Google endpoints are unreachable. |

---

## 📚 Offline Dictionary Source & License

The starter offline dictionary located at [`data/dictionary.json`](data/dictionary.json) contains foundational English vocabulary terms mapped to parts of speech and Bengali definitions.

- **Source**: Curated from public-domain word frequency corpora and standardized English-Bengali bilingual lexical lists.
- **License**: Released under the [Creative Commons Zero (CC0 1.0 Universal) Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/).

---

## 📁 File Structure

```text
mosuehoberTransalation/
├── manifest.json       # Manifest V3 configuration (v2.0.0) with contextMenus, storage, activeTab
├── tts.js              # Speech synthesis module with Bangla voice detection (Chrome & Edge Natural voices)
├── settings.js         # Shared settings helper & default configuration (sentenceEnabled, maxChars, etc.)
├── lemmatize.js        # Morphological root extractor (-ing, -ed, plurals, doubled consonants)
├── background.js       # Service worker (contextMenus, chunking, caching, official API, offline fallback)
├── content.js          # DOM triggers, floating "অ" button, CSS highlight, accessible Shadow DOM tooltip
├── popup.html          # Multi-line 3000-char textarea, dual-mode layout (word vs sentence)
├── popup.css           # Modern 320px styling with local font declarations & sentence formatting
├── popup.js            # Toolbar logic, Enter/Shift+Enter key handling, dual-mode auto-switching
├── history.html        # Dedicated full-page translation history manager & export interface
├── history.css         # History dashboard styling with sentence badges, responsive grid, dark theme
├── history.js          # History live search, multi-field filtering, sorting, CSV/JSON export & sentence preview
├── options.html        # Settings page with sentence controls, API key tester & shortcuts launcher
├── options.css         # Styling for options page with local font declarations
├── options.js          # Options controller with automatic saving & Chrome/Edge shortcuts detection
├── data/
│   └── dictionary.json # Bundled starter offline dictionary (~300+ entries, CC0)
├── fonts/              # Bundled local WOFF2 font files
│   ├── inter-400.woff2
│   ├── inter-600.woff2
│   ├── hind-siliguri-400.woff2
│   └── hind-siliguri-600.woff2
├── icons/              # PNG extension icons (16x16, 48x48, 128x128)
├── CHANGELOG.md        # Comprehensive version changelog
└── README.md           # Documentation, licensing & Chrome/Edge installation guide
```

---

## 🏗️ Architecture & Technical Highlights

- **Universal Chromium Compatibility**: Works without code changes across Google Chrome, Microsoft Edge, Brave, Opera, and Vivaldi.
- **Pure Vanilla JavaScript**: Zero external npm dependencies, zero build steps, and zero transpilation overhead.
- **Isolated Shadow DOM**: The floating tooltip and floating button use `attachShadow({ mode: 'open' })` with an explicit reset (`all: initial !important`) and `z-index: 2147483647`, preventing any CSS conflicts with the host webpage.
- **CSS Custom Highlight API**: Word highlighting uses `CSS.highlights` and `::highlight(eng-bn-word-highlight)` for clean, non-destructive highlighting without modifying the host page DOM.
- **Two-Tier Resilient Cache**: High-speed 300-entry in-memory LRU cache backed by a 1,000-entry persistent `chrome.storage.local` store.
- **Queued Audio Playback**: Bypasses the browser 15-second speech synthesis ceiling by breaking long prose into discrete sentence utterances played sequentially.
- **Accessible Design**: Built with WCAG standards in mind—complete `role="dialog"` semantic encapsulation, comprehensive `aria-label` tags, `:focus-visible` focus rings, and `@media (prefers-reduced-motion: reduce)` animation silencing.
