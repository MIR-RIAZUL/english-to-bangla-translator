# Changelog

All notable changes to the **English-to-Bangla Hover & Click Translator** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-04

### Added
- **Sentence and Paragraph Translation**:
  - Full sentence and paragraph translation engine supporting up to 3,000 characters per request (configurable via `settings.maxChars`).
  - Automatic sentence boundary splitting on `.`, `!`, `?`, and `\n` to prevent truncation and respect upstream API request limits.
  - Smart automatic mode detection (`detectMode`): text ≤ 3 words treated as dictionary lookup, > 3 words treated as prose sentence.
  - Multi-trigger support: triple-click on paragraphs, mouse selection of 4+ words, `Alt+T` shortcut, and right-click context menu.
  - Floating "অ" action button (Shadow DOM, 28×28px) appearing near the end of 4+ word selections.
  - Context menu item: **"Translate to Bangla"** for selection context via new `contextMenus` permission.
  - Adaptive sentence tooltip layout: up to 420px wide, max 60vh tall, scrollable content area with scroll containment.
  - Collapsible "Original" section in sentence tooltips (collapsed to 3 lines by default or expanded via `showOriginal` setting).
  - Queued text-to-speech (`speakInQueue`): splits long passages into discrete sentence utterances, preventing Chromium's 15-second speech synthesis cutoff bug.
  - Offline sentence fallback: word-by-word local translation with unknown tokens preserved, tagged with `approximate: true`.
  - Sentence history logging: optional storage of sentence translations when `saveSentences` is enabled, truncated to 120 characters in list view with `type: "sentence"` tag.
- **Multi-Line Quick Translator Popup**:
  - 5-row multi-line textarea with 3,000-character capacity and live counter (`X / 3000`).
  - **Enter** key triggers translation; **Shift+Enter** inserts new lines.
  - Dynamic result layout auto-switching between concise word view (large font + POS cards) and paragraph sentence view (line breaks + Listen & Copy controls).
- **New Settings Options (`settings.js`, `options.html`, `options.js`)**:
  - `sentenceEnabled`: master toggle for sentence translation.
  - `floatingButton`: controls display of the floating "অ" selection button.
  - `showOriginal`: option to automatically expand original English text in sentence tooltips.
  - `maxChars`: configurable limit between 500 and 10,000 characters (default: 3000).
  - `saveSentences`: optional inclusion of sentence lookups in local vocabulary history.
- **Cross-Browser Native Support (Chrome & Edge)**:
  - 100% Manifest V3 compliant across both Google Chrome and Microsoft Edge.
  - Smart browser detection navigating to `edge://extensions/shortcuts` or `chrome://extensions/shortcuts`.
  - Dedicated support for Edge Online Natural voices (`Microsoft Bashkar Online (Natural)` / `Microsoft Nabanita Online (Natural)`).
- **Unified Settings Foundation (`settings.js`, `options.html`, `options.css`, `options.js`)**:
  - Single `settings` configuration object persisted in `chrome.storage.local`.
  - Interactive Options page with live auto-saving, visual save indicator, and "Reset to Defaults".
- **Local Font Bundling**:
  - Offline bundled `Inter` (400, 600) and `Hind Siliguri` (400, 600) WOFF2 font files in `/fonts`.
  - Injected `@font-face` rules using `chrome.runtime.getURL()` with deduplication guard in `content.js`.
  - Complete elimination of external Google Fonts CDN network calls.
- **Offline Starter Dictionary & Persistent Caching**:
  - Bundled starter dictionary (`data/dictionary.json`) with ~300+ English vocabulary terms (CC0 1.0 Universal).
  - Morphological lemmatizer (`lemmatize.js`) supporting suffixes and doubled consonants.
  - Two-tier cache hierarchy: 300-entry in-memory LRU cache + 1,000-entry persistent cache (`tcache`).
  - Amber **offline** badge rendered on tooltips and popup results when served offline.
- **Official Google Cloud Translation API v2 Basic**:
  - Integration with official Google Cloud Translation REST endpoint (`translation.googleapis.com`).
  - In-options **Test Key** verification button with live status reporting.
  - Exponential backoff with up to 2 retries for HTTP 429 and 5xx errors.
- **Debounced Mouse Hover Word Detection**:
  - Configurable interaction modes: `dblclick`, `hover`, or `both`.
  - Sub-pixel cursor tracking via `document.caretRangeFromPoint` / `document.caretPositionFromPoint`.
  - Configurable hover debounce delay (200ms – 2000ms) and modifier key gating (`Alt`, `Ctrl`, `Shift`).
- **CSS Custom Highlight API Integration**:
  - Non-destructive word highlighting using native `CSS.highlights` and `::highlight(eng-bn-word-highlight)`.
  - Custom highlight tint configurable via `settings.highlightColor`.
- **Full History & Search Dashboard (`history.html`, `history.css`, `history.js`)**:
  - Dedicated full-page history management console with live search, filtering, and sorting.
  - Data export to CSV (featuring UTF-8 BOM `\uFEFF`) and JSON backup format.
  - History schema supporting both words and sentences with frequency counts and timestamps.
- **Accessibility & Multi-Theme Engine**:
  - `role="dialog"` semantic encapsulation, comprehensive `aria-label` tags, `:focus-visible` focus rings.
  - `@media (prefers-reduced-motion: reduce)` animation silencing.
  - Support for `dark` (default), `light`, and system `auto` (`prefers-color-scheme`) themes.

### Changed
- Refactored popup input from single-line field to 5-row multi-line textarea with 3000-character limit.
- Updated extension permissions to include `contextMenus`.
- Refactored history storage to support `type: "sentence"` records with 120-character preview truncation.

### Security & Privacy
- Zero telemetry, zero analytics, zero external user data tracking.
- All user preferences, history, and cache stored strictly on the local machine via `chrome.storage.local`.
- Zero npm package dependencies; 100% vanilla JavaScript.
