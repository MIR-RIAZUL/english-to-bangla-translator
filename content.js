/**
 * Content Script
 * Listens for double-click, hover, and keyboard shortcut (TRANSLATE_SELECTION) events,
 * extracts English words, renders an isolated Shadow DOM floating tooltip,
 * and manages English & Bangla pronunciation, clipboard copy, and dismissal events.
 */

(() => {
  // Global state for enabling/disabling translation
  let isEnabled = true;
  let activeTooltipHost = null;
  let currentActiveWord = '';
  let scrollStartY = 0;
  let scrollStartX = 0;

  // Hover state
  let hoverTimer = null;
  let pendingHoverWord = '';

  // Bangla voice availability (resolved once on page load and verified dynamically)
  let banglaVoiceAvailable = false;

  // Settings state with safe defaults
  let currentSettings = {
    triggerMode: 'dblclick',
    hoverDelay: 600,
    modifierKey: 'none',
    speechRate: 0.95
  };

  /**
   * Injects local extension @font-face definitions into document.head once per page.
   */
  function ensureLocalFontsInjected() {
    const fontStyleId = 'eng-bn-translator-fonts';
    if (document.getElementById(fontStyleId)) return;

    try {
      const inter400Url = chrome.runtime.getURL('fonts/inter-400.woff2');
      const inter600Url = chrome.runtime.getURL('fonts/inter-600.woff2');
      const hind400Url = chrome.runtime.getURL('fonts/hind-siliguri-400.woff2');
      const hind600Url = chrome.runtime.getURL('fonts/hind-siliguri-600.woff2');

      const style = document.createElement('style');
      style.id = fontStyleId;
      style.textContent = `
        @font-face {
          font-family: 'Inter';
          font-style: normal;
          font-weight: 400;
          font-display: swap;
          src: url('${inter400Url}') format('woff2');
        }
        @font-face {
          font-family: 'Inter';
          font-style: normal;
          font-weight: 600;
          font-display: swap;
          src: url('${inter600Url}') format('woff2');
        }
        @font-face {
          font-family: 'Hind Siliguri';
          font-style: normal;
          font-weight: 400;
          font-display: swap;
          src: url('${hind400Url}') format('woff2');
        }
        @font-face {
          font-family: 'Hind Siliguri';
          font-style: normal;
          font-weight: 600;
          font-display: swap;
          src: url('${hind600Url}') format('woff2');
        }
      `;

      const target = document.head || document.documentElement;
      if (target) {
        target.appendChild(style);
      }
    } catch (err) {
      console.warn('Failed to inject local fonts stylesheet:', err);
    }
  }

  // Attempt initial font registration
  ensureLocalFontsInjected();

  // Detect Bangla voice availability using tts.js (loaded before content.js)
  try {
    if (typeof findBanglaVoice === 'function') {
      findBanglaVoice().then((voice) => {
        banglaVoiceAvailable = !!voice;
      }).catch(() => {
        banglaVoiceAvailable = false;
      });
    }
  } catch (err) {
    banglaVoiceAvailable = false;
  }

  // Retrieve initial enabled state and settings from chrome.storage.local
  chrome.storage.local.get({ enabled: true, settings: {} }, (result) => {
    if (chrome.runtime.lastError) {
      console.warn('Storage read warning:', chrome.runtime.lastError);
      return;
    }
    isEnabled = result.enabled !== false;
    if (result.settings && typeof result.settings === 'object') {
      currentSettings = { ...currentSettings, ...result.settings };
    }
  });

  // Listen for real-time changes from popup or options
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.enabled !== undefined) {
        isEnabled = changes.enabled.newValue !== false;
        if (!isEnabled) {
          removeTooltip();
          cancelHoverTimer();
        }
      }
      if (changes.settings !== undefined && changes.settings.newValue) {
        currentSettings = { ...currentSettings, ...changes.settings.newValue };
        const mode = currentSettings.triggerMode || 'dblclick';
        if (mode !== 'hover' && mode !== 'both') {
          cancelHoverTimer();
        }
      }
    }
  });

  /**
   * Checks whether the configured modifier key is pressed.
   * @param {MouseEvent} event
   * @returns {boolean} True if required modifier key is active or 'none' is configured.
   */
  function isModifierKeyActive(event) {
    const mod = currentSettings.modifierKey || 'none';
    if (mod === 'none') return true;
    if (mod === 'alt') return !!event.altKey;
    if (mod === 'ctrl') return !!event.ctrlKey || !!event.metaKey;
    if (mod === 'shift') return !!event.shiftKey;
    return true;
  }

  /**
   * Determines whether an element should be ignored for translation triggers.
   * Ignores input, textarea, password fields, and contentEditable elements.
   * @param {Element|null} target
   * @returns {boolean}
   */
  function isIgnoredElement(target) {
    if (!target || !(target instanceof Element)) return false;

    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      return true;
    }

    if (target.isContentEditable || (target.closest && target.closest('[contenteditable="true"]'))) {
      return true;
    }

    return false;
  }

  /**
   * Extracts the word and bounding client rectangle under a given viewport point.
   * Uses document.caretRangeFromPoint with fallback to document.caretPositionFromPoint.
   * @param {number} x - Client X coordinate.
   * @param {number} y - Client Y coordinate.
   * @returns {{ word: string, rect: DOMRect } | null}
   */
  function getWordAtPoint(x, y) {
    let textNode = null;
    let offset = 0;

    try {
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(x, y);
        if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
          textNode = range.startContainer;
          offset = range.startOffset;
        }
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
          textNode = pos.offsetNode;
          offset = pos.offset;
        }
      }

      if (!textNode || !textNode.textContent) return null;

      const text = textNode.textContent;
      if (!text) return null;

      let charIdx = offset;
      if (charIdx >= text.length || !/[a-zA-Z]/.test(text[charIdx])) {
        if (charIdx > 0 && /[a-zA-Z]/.test(text[charIdx - 1])) {
          charIdx = charIdx - 1;
        } else {
          return null;
        }
      }

      // Expand backward to find word start
      let start = charIdx;
      while (start > 0 && /[a-zA-Z0-9'-]/.test(text[start - 1])) {
        start--;
      }

      // Expand forward to find word end
      let end = charIdx;
      while (end < text.length && /[a-zA-Z0-9'-]/.test(text[end])) {
        end++;
      }

      const rawWord = text.slice(start, end);
      const cleaned = rawWord.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').trim();

      if (!cleaned || !/[a-zA-Z]/.test(cleaned) || cleaned.length < 2) {
        return null;
      }

      const actualStart = text.indexOf(cleaned, start);
      if (actualStart === -1) return null;
      const actualEnd = actualStart + cleaned.length;

      const wordRange = document.createRange();
      wordRange.setStart(textNode, actualStart);
      wordRange.setEnd(textNode, actualEnd);

      const rect = wordRange.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;

      return {
        word: cleaned,
        rect: rect
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Clears any active hover trigger timer.
   */
  function cancelHoverTimer() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    pendingHoverWord = '';
  }

  /**
   * Remove any active floating tooltip from DOM
   */
  function removeTooltip() {
    if (activeTooltipHost) {
      try {
        activeTooltipHost.remove();
      } catch (err) {
        // Element may already be detached
      }
      activeTooltipHost = null;
    }
    currentActiveWord = '';
    // Remove transient dismissal listeners
    document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    document.removeEventListener('keydown', handleEscapeKey, true);
    window.removeEventListener('scroll', handleScrollThreshold, { passive: true });
  }

  /**
   * Pointerdown handler to dismiss tooltip when clicking outside
   */
  function handlePointerDownOutside(event) {
    if (!activeTooltipHost) return;
    const path = event.composedPath ? event.composedPath() : [];
    if (!path.includes(activeTooltipHost)) {
      removeTooltip();
    }
  }

  /**
   * Escape key handler to dismiss tooltip
   */
  function handleEscapeKey(event) {
    if (event.key === 'Escape') {
      removeTooltip();
      cancelHoverTimer();
    }
  }

  /**
   * Scroll handler to dismiss tooltip on significant page scroll and cancel pending hover
   */
  function handleScrollThreshold() {
    cancelHoverTimer();
    if (!activeTooltipHost) return;
    const currentY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const currentX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    if (Math.abs(currentY - scrollStartY) > 25 || Math.abs(currentX - scrollStartX) > 25) {
      removeTooltip();
    }
  }

  /**
   * Gets the current speech rate from settings.
   * @returns {number} Speech rate value.
   */
  function getSpeechRate() {
    return typeof currentSettings.speechRate === 'number' ? currentSettings.speechRate : 0.95;
  }

  /**
   * Pronounce English text using the tts.js speak() function.
   * @param {string} text
   * @param {HTMLElement} [buttonElement]
   */
  function speakEnglishWord(text, buttonElement) {
    try {
      if (typeof speak === 'function') {
        speak(text, 'en-US', getSpeechRate(), buttonElement);
      }
    } catch (err) {
      console.warn('English speech synthesis failed:', err);
    }
  }

  /**
   * Pronounce Bangla text using the tts.js speak() function.
   * @param {string} text
   * @param {HTMLElement} [buttonElement]
   */
  function speakBanglaWord(text, buttonElement) {
    try {
      if (typeof speak === 'function') {
        speak(text, 'bn-BD', getSpeechRate(), buttonElement);
      }
    } catch (err) {
      console.warn('Bangla speech synthesis failed:', err);
    }
  }

  /**
   * Copy translation to clipboard with visual feedback
   * @param {string} text
   * @param {HTMLElement} btn
   */
  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="icon-svg">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      `;
      btn.title = 'কপি হয়েছে!';
      setTimeout(() => {
        if (btn) {
          btn.innerHTML = originalHTML;
          btn.title = 'কপি করুন';
        }
      }, 1500);
    } catch (err) {
      console.warn('Clipboard copy error:', err);
    }
  }

  /**
   * Reads, validates, and translates the active webpage text selection.
   * Reused by double-click and keyboard shortcuts (TRANSLATE_SELECTION).
   * @returns {boolean} True if a valid selection was found and rendered.
   */
  function triggerSelectionTranslation() {
    if (!isEnabled) return false;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;

    const rawSelected = selection.toString().trim();
    if (!rawSelected) return false;

    // Check if selection focus is within an ignored element
    const anchorElem = selection.anchorNode
      ? (selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement)
      : null;

    if (anchorElem && isIgnoredElement(anchorElem)) return false;

    const cleaned = rawSelected
      .replace(/^[\s.,/#!$%\^&\*;:{}=\-_`~()'"\[\]<>?]+|[\s.,/#!$%\^&\*;:{}=\-_`~()'"\[\]<>?]+$/g, '')
      .trim();

    if (!/[a-zA-Z]/.test(cleaned)) return false;

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) return false;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;

    cancelHoverTimer();
    removeTooltip();

    scrollStartY = window.pageYOffset || document.documentElement.scrollTop || 0;
    scrollStartX = window.pageXOffset || document.documentElement.scrollLeft || 0;

    renderShadowTooltip(cleaned, rect);
    return true;
  }

  /**
   * Main double-click event listener
   * @param {MouseEvent} event
   */
  function handleDoubleClick(event) {
    if (!isEnabled) return;

    const mode = currentSettings.triggerMode || 'dblclick';
    if (mode !== 'dblclick' && mode !== 'both') return;

    if (!isModifierKeyActive(event)) return;

    if (isIgnoredElement(event.target)) return;

    triggerSelectionTranslation();
  }

  /**
   * Mousemove listener for debounced hover word detection
   * @param {MouseEvent} event
   */
  function handleMouseMove(event) {
    if (!isEnabled) {
      cancelHoverTimer();
      return;
    }

    const mode = currentSettings.triggerMode || 'dblclick';
    if (mode !== 'hover' && mode !== 'both') {
      cancelHoverTimer();
      return;
    }

    // Do not interfere if user is hovering inside active tooltip
    if (activeTooltipHost) {
      const path = event.composedPath ? event.composedPath() : [];
      if (path.includes(activeTooltipHost)) {
        cancelHoverTimer();
        return;
      }
    }

    if (!isModifierKeyActive(event)) {
      cancelHoverTimer();
      return;
    }

    if (isIgnoredElement(event.target)) {
      cancelHoverTimer();
      return;
    }

    const found = getWordAtPoint(event.clientX, event.clientY);
    if (!found) {
      cancelHoverTimer();
      return;
    }

    const wordLower = found.word.toLowerCase();

    // Do not re-trigger for the same word while its tooltip is already open
    if (activeTooltipHost && currentActiveWord === wordLower) {
      cancelHoverTimer();
      return;
    }

    // If still hovering over the pending word, leave existing timer running
    if (pendingHoverWord === wordLower && hoverTimer) {
      return;
    }

    // New word hovered: reset previous timer and schedule new one
    cancelHoverTimer();
    pendingHoverWord = wordLower;

    const delay = typeof currentSettings.hoverDelay === 'number' && currentSettings.hoverDelay >= 200
      ? currentSettings.hoverDelay
      : 600;

    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      pendingHoverWord = '';

      if (!isEnabled) return;
      if (!isModifierKeyActive(event)) return;

      removeTooltip();

      scrollStartY = window.pageYOffset || document.documentElement.scrollTop || 0;
      scrollStartX = window.pageXOffset || document.documentElement.scrollLeft || 0;

      renderShadowTooltip(found.word, found.rect);
    }, delay);
  }

  /**
   * Window mouseleave listener
   */
  function handleMouseLeave() {
    cancelHoverTimer();
  }

  /**
   * Render and position Shadow DOM Tooltip
   * Reused by double-click, hover, and shortcut triggers without duplication.
   * @param {string} word
   * @param {DOMRect} selectionRect
   */
  function renderShadowTooltip(word, selectionRect) {
    ensureLocalFontsInjected();

    // Set active word
    currentActiveWord = word.toLowerCase();

    // Create isolation host element
    const host = document.createElement('div');
    host.id = 'eng-bn-translator-host';
    host.style.cssText = `
      all: initial !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 0 !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    `;

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .tooltip-card {
        pointer-events: auto;
        position: absolute;
        width: 290px;
        background: #0f172a;
        background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.55), 0 8px 16px -6px rgba(0, 0, 0, 0.45);
        color: #f8fafc;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        padding: 12px 14px;
        opacity: 0;
        transform: scale(0.96);
        transition: opacity 0.16s ease, transform 0.16s ease;
        user-select: text;
      }

      .tooltip-card.visible {
        opacity: 1;
        transform: scale(1);
      }

      /* Caret Arrow */
      .tooltip-arrow {
        position: absolute;
        width: 12px;
        height: 12px;
        background: #1e293b;
        border: 1px solid rgba(255, 255, 255, 0.14);
        transform: rotate(45deg);
        z-index: -1;
      }

      .tooltip-card[data-placement="top"] .tooltip-arrow {
        bottom: -6px;
        border-top: none;
        border-left: none;
        background: #0f172a;
      }

      .tooltip-card[data-placement="bottom"] .tooltip-arrow {
        top: -6px;
        border-bottom: none;
        border-right: none;
        background: #1e293b;
      }

      /* Header */
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .word-group {
        display: flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
      }

      .original-word {
        font-weight: 600;
        font-size: 14px;
        color: #e2e8f0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }

      .offline-badge {
        display: inline-flex;
        align-items: center;
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: rgba(245, 158, 11, 0.18);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.35);
        border-radius: 4px;
        padding: 1px 5px;
        line-height: 1.2;
        flex-shrink: 0;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .icon-btn {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        color: #94a3b8;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        transition: all 0.15s ease;
      }

      .icon-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }

      .icon-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .icon-btn.playing {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.18);
        border-color: rgba(56, 189, 248, 0.4);
      }

      .icon-svg {
        width: 14px;
        height: 14px;
      }

      .close-btn:hover {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.3);
      }

      /* Body & Translation */
      .card-body {
        padding-top: 10px;
      }

      /* Loading State */
      .loading-state {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #94a3b8;
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, sans-serif;
        font-size: 14px;
        padding: 6px 0;
      }

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(99, 102, 241, 0.2);
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: spin 0.75s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* Bangla Primary Result */
      .bangla-result-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
      }

      .bangla-primary {
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, 'SolaimanLipi', 'Vrinda', sans-serif;
        font-size: 20px;
        font-weight: 700;
        color: #38bdf8;
        letter-spacing: 0.2px;
        word-break: break-word;
      }

      .btn-speak-bn {
        flex-shrink: 0;
      }

      /* Dictionary Meanings */
      .dict-group {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed rgba(255, 255, 255, 0.08);
      }

      .pos-tag {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: rgba(99, 102, 241, 0.18);
        color: #a5b4fc;
        border-radius: 4px;
        padding: 1px 5px;
        margin-bottom: 4px;
      }

      .pos-terms {
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, 'SolaimanLipi', 'Vrinda', sans-serif;
        font-size: 13px;
        color: #cbd5e1;
        line-height: 1.5;
        word-break: break-word;
      }

      /* Error State */
      .error-state {
        color: #f87171;
        font-size: 13px;
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, sans-serif;
        padding: 4px 0;
      }
    `;

    const card = document.createElement('div');
    card.className = 'tooltip-card';

    card.innerHTML = `
      <div class="tooltip-arrow"></div>
      <div class="card-header">
        <div class="word-group">
          <span class="original-word" title="${escapeHtml(word)}">${escapeHtml(word)}</span>
        </div>
        <div class="header-actions">
          <button class="icon-btn btn-speak btn-speak-en" title="উচ্চারণ শুনুন (English)" aria-label="Pronounce English word">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
          <button class="icon-btn btn-copy" title="কপি করুন" style="display: none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button class="icon-btn close-btn" title="বন্ধ করুন">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="card-body">
        <div class="loading-state">
          <div class="spinner"></div>
          <span>অনুবাদ করা হচ্ছে...</span>
        </div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(card);

    document.documentElement.appendChild(host);
    activeTooltipHost = host;

    const btnSpeakEn = card.querySelector('.btn-speak-en');
    const btnCopy = card.querySelector('.btn-copy');
    const btnClose = card.querySelector('.close-btn');

    btnSpeakEn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakEnglishWord(word, btnSpeakEn);
    });

    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTooltip();
    });

    positionTooltipCard(card, selectionRect);

    // Request translation from service worker
    chrome.runtime.sendMessage(
      {
        action: 'TRANSLATE_TEXT',
        text: word,
        isDoubleClick: true
      },
      async (response) => {
        if (!activeTooltipHost || activeTooltipHost !== host) return;

        const body = card.querySelector('.card-body');
        if (!body) return;

        if (response && response.success && response.data) {
          const data = response.data;
          const primaryBangla = data.primary || 'অনুবাদ পাওয়া যায়নি';

          if (data.source === 'offline') {
            const wordGroup = card.querySelector('.word-group');
            if (wordGroup && !wordGroup.querySelector('.offline-badge')) {
              const badge = document.createElement('span');
              badge.className = 'offline-badge';
              badge.textContent = 'offline';
              badge.title = 'অফলাইন ডিকশনারি';
              wordGroup.appendChild(badge);
            }
          }

          btnCopy.style.display = 'inline-flex';
          btnCopy.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(primaryBangla, btnCopy);
          });

          let dictHTML = '';
          if (Array.isArray(data.dictionary) && data.dictionary.length > 0) {
            dictHTML = data.dictionary
              .slice(0, 2)
              .map((item) => {
                const terms = item.terms.join(', ');
                return `
                  <div class="dict-group">
                    <span class="pos-tag">${escapeHtml(item.pos)}</span>
                    <div class="pos-terms">${escapeHtml(terms)}</div>
                  </div>
                `;
              })
              .join('');
          }

          // Dynamically check if Bangla voice is available if not detected initially
          if (!banglaVoiceAvailable && typeof findBanglaVoice === 'function') {
            try {
              const voice = await findBanglaVoice();
              banglaVoiceAvailable = !!voice;
            } catch (err) {
              banglaVoiceAvailable = false;
            }
          }

          // Build Bangla speak button HTML
          const bnBtnDisabled = !banglaVoiceAvailable;
          const bnBtnTitle = bnBtnDisabled
            ? 'No Bangla voice installed on this device.'
            : 'বাংলা উচ্চারণ শুনুন';
          const bnBtnAriaLabel = bnBtnDisabled
            ? 'No Bangla voice installed on this device.'
            : 'Pronounce Bangla translation';

          body.innerHTML = `
            <div class="bangla-result-row">
              <div class="bangla-primary">${escapeHtml(primaryBangla)}</div>
              <button class="icon-btn btn-speak-bn" title="${escapeHtml(bnBtnTitle)}" aria-label="${escapeHtml(bnBtnAriaLabel)}" ${bnBtnDisabled ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>
            ${dictHTML}
          `;

          // Attach Bangla speak event
          const btnSpeakBn = body.querySelector('.btn-speak-bn');
          if (btnSpeakBn && !bnBtnDisabled) {
            btnSpeakBn.addEventListener('click', (e) => {
              e.stopPropagation();
              speakBanglaWord(primaryBangla, btnSpeakBn);
            });
          }
        } else {
          const errMsg = response?.error || 'অনুবাদ লোড করা যায়নি।';
          body.innerHTML = `
            <div class="error-state">${escapeHtml(errMsg)}</div>
          `;
        }

        positionTooltipCard(card, selectionRect);
      }
    );

    setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDownOutside, true);
      document.addEventListener('keydown', handleEscapeKey, true);
      window.addEventListener('scroll', handleScrollThreshold, { passive: true });
    }, 100);
  }

  /**
   * Position tooltip card relative to selection
   * @param {HTMLElement} card
   * @param {DOMRect} selectionRect
   */
  function positionTooltipCard(card, selectionRect) {
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const viewportWidth = document.documentElement.clientWidth;

    const cardWidth = card.offsetWidth || 290;
    const cardHeight = card.offsetHeight || 110;

    const wordCenterX = selectionRect.left + scrollX + selectionRect.width / 2;
    let cardLeft = wordCenterX - cardWidth / 2;

    const minLeft = scrollX + 10;
    const maxLeft = scrollX + viewportWidth - cardWidth - 10;
    cardLeft = Math.max(minLeft, Math.min(cardLeft, maxLeft));

    const arrow = card.querySelector('.tooltip-arrow');
    const relativeArrowX = wordCenterX - cardLeft;
    const clampedArrowX = Math.max(16, Math.min(relativeArrowX, cardWidth - 16));
    if (arrow) {
      arrow.style.left = `${clampedArrowX - 6}px`;
    }

    const spaceAbove = selectionRect.top;
    const margin = 10;
    let cardTop = 0;

    if (spaceAbove > cardHeight + margin + 10) {
      cardTop = selectionRect.top + scrollY - cardHeight - margin;
      card.setAttribute('data-placement', 'top');
    } else {
      cardTop = selectionRect.bottom + scrollY + margin;
      card.setAttribute('data-placement', 'bottom');
    }

    card.style.left = `${Math.round(cardLeft)}px`;
    card.style.top = `${Math.round(cardTop)}px`;
    card.classList.add('visible');
  }

  /**
   * Helper to escape HTML characters
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Handle messages from background service worker (keyboard shortcuts)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TRANSLATE_SELECTION') {
      const translated = triggerSelectionTranslation();
      sendResponse({ success: translated });
      return false;
    }
  });

  // Register document listeners
  document.addEventListener('dblclick', handleDoubleClick, true);
  document.addEventListener('mousemove', handleMouseMove, { passive: true });
  document.addEventListener('mouseleave', handleMouseLeave, { passive: true });
})();
