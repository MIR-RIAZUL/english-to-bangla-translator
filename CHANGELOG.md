# Changelog

All notable changes to the **English-to-Bangla Hover & Click Translator** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-03

### Added
- **Unified Settings Foundation (`settings.js`, `options.html`, `options.css`, `options.js`)**:
  - Single `settings` configuration object persisted in `chrome.storage.local` with automatic migration for upgrading users.
  - Interactive Options page with live auto-saving, visual save indicator, and one-click "Reset to Defaults".
- **Local Font Bundling**:
  - Fully offline, bundled `Inter` (400, 600) and `Hind Siliguri` (400, 600) WOFF2 font files in `/fonts`.
  - Injected `@font-face` rules using `chrome.runtime.getURL()` with deduplication guard in `content.js`.
  - Comprehensive system font fallback stacks (`Segoe UI`, `Arial`, `Noto Sans Bengali`, `sans-serif`) across all extension views.
  - Complete elimination of Google Fonts CDN `<link>` and `@import` requests for zero-tracking privacy and offline readiness.
- **Offline Starter Dictionary & Persistent Caching**:
  - Bundled starter dictionary (`data/dictionary.json`) with ~300+ high-frequency English vocabulary terms mapped to parts of speech and Bengali definitions (CC0 1.0 Universal Public Domain Dedication).
  - Morphological lemmatizer (`lemmatize.js`) supporting suffixes (`-ing`, `-ed`, `-s`, `-es`, `-ies` → `y`, `-ied` → `y`) and doubled consonants (e.g. `running` → `run`).
  - Two-tier cache hierarchy: 300-entry in-memory LRU cache plus 1,000-entry persistent cache (`tcache`) in `chrome.storage.local` with automatic oldest-entry eviction.
  - Lookup source metadata tagging (`cache` | `online` | `offline`) with an amber **offline** badge rendered on tooltips and popup results.
- **Official Google Cloud Translation API v2 Basic**:
  - Secure integration with official Google Cloud Translation REST endpoint (`https://translation.googleapis.com/language/translate/v2`).
  - API credentials stored strictly in `chrome.storage.local` (never logged, never synced).
  - In-options **Test Key** verification button with live status reporting.
  - Exponential backoff algorithm (up to 2 retries) for HTTP 429 (rate limits) and 5xx (server errors).
  - Bilingual friendly error handling for quota limits, invalid keys, and network disconnects.
- **Configurable Provider Fallback Hierarchy**:
  - User-customizable provider execution sequence (`official` → `gtx` → `mymemory` → `offline`).
  - Automatic seamless failover to subsequent providers upon network drops or upstream API failures.
- **Debounced Mouse Hover Word Detection**:
  - Configurable interaction modes: `dblclick`, `hover`, or `both`.
  - Sub-pixel cursor tracking via `document.caretRangeFromPoint` (with fallback to `document.caretPositionFromPoint`) and automatic word expansion.
  - User-configurable hover debounce delay (200ms – 2000ms).
  - Modifier key gating (`Alt`, `Ctrl`, `Shift`, or `None`).
  - Safe-zone heuristics: ignores `<input>`, `<textarea>`, password fields, and `contentEditable` elements.
- **Keyboard Shortcuts**:
  - `Alt+T` (`translate-selection`): Translates currently selected text across any active webpage.
  - `Alt+Shift+T` (`toggle-extension`): Globally toggles extension translation functionality on or off.
  - Direct shortcut launcher button in Options navigating to `chrome://extensions/shortcuts`.
- **Dual-Language Text-to-Speech (TTS)**:
  - English pronunciation playback via native speech synthesis.
  - Primary Bangla translation pronunciation playback via dedicated `tts.js` module.
  - Intelligent voice resolver prioritizing `bn-BD` (Bangladesh) followed by `bn-IN` (India).
  - Graceful fallback with informative disabled state tooltip when no Bangla voice is installed on the host OS.
  - User-configurable playback rate (`speechRate`) applied synchronously to both languages.
- **Full History & Search Dashboard (`history.html`, `history.css`, `history.js`)**:
  - Dedicated full-page history management console.
  - Live search with instant substring matching across both English and Bengali fields.
  - Language filtering (All, English only, Bangla only).
  - Dynamic sorting by "Most Recent", "Most Looked Up" (frequency count), or "Alphabetical (A–Z)".
  - One-click copy and pronunciation buttons per card.
  - Individual entry deletion and "Clear All" with confirmation safeguard.
  - Data export to CSV (featuring UTF-8 BOM `\uFEFF` for clean rendering in Microsoft Excel and Google Sheets) and JSON backup format.
  - Modernized history schema: `{ word, translation, timestamp, count }` with automatic count incrementing and timestamp refreshing on repeat lookups.
- **CSS Custom Highlight API Integration**:
  - Non-destructive word highlighting using the modern `CSS.highlights` API and `::highlight(eng-bn-word-highlight)` pseudo-element.
  - Custom highlight tint configurable via `settings.highlightColor`.
  - Automatic highlight cleanup upon tooltip dismissal.
  - Safe degradation: if unsupported, highlighting is skipped without any DOM modification.
- **Accessibility & Reduced Motion**:
  - Accessible tooltip container with `role="dialog"` and contextual `aria-label`.
  - Accessible `aria-label` attributes across all interactive buttons (English speech, Bangla speech, copy, close).
  - High-visibility `:focus-visible` outline rings for keyboard navigators.
  - `@media (prefers-reduced-motion: reduce)` rule disabling all CSS transitions and spinner animations.
- **Multi-Theme Engine**:
  - Seamless support for `dark` (default), `light`, and system `auto` (`prefers-color-scheme`) themes.

### Changed
- Refactored history storage from flat arrays to rich `{ word, translation, timestamp, count }` objects.
- Migrated font asset loading from external Google Fonts CDN to local packaged web resources.
- Upgraded extension manifest version to `2.0.0`.

### Security & Privacy
- Zero telemetry, zero analytics, zero external user data tracking.
- All user preferences, history, and cache stored strictly on the local machine via `chrome.storage.local`.
- Zero npm package dependencies; 100% vanilla JavaScript.

