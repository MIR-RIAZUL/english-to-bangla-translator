/**
 * Content Script
 * Listens for double-click, hover, triple-click, mouse selection with floating "অ" action,
 * and keyboard shortcut (TRANSLATE_SELECTION) events.
 * Extracts English words and sentences, renders an isolated accessible Shadow DOM floating tooltip,
 * supports queued dual-language text-to-speech, clipboard copying, theme adaptability (dark/light/auto),
 * collapsible original view, loading skeletons, and word highlighting via CSS Custom Highlight API.
 */

(() => {
  // Global state for enabling/disabling translation
  let isEnabled = true;
  let activeTooltipHost = null;
  let activeFloatingHost = null;
  let currentActiveWord = '';
  let scrollStartY = 0;
  let scrollStartX = 0;

  // Hover state
  let hoverTimer = null;
  let pendingHoverWord = '';

  // Bangla voice availability (resolved once on page load and verified dynamically)
  let banglaVoiceAvailable = false;

  // Speech queue state
  let isSpeakingQueue = false;
  let currentUtteranceQueue = [];
  let activeSpeakingButton = null;

  // Settings state with safe defaults
  let currentSettings = {
    triggerMode: 'dblclick',
    hoverDelay: 600,
    modifierKey: 'none',
    speechRate: 0.95,
    highlightColor: '#fde68a',
    theme: 'dark'
  };

  const HIGHLIGHT_NAME = 'eng-bn-word-highlight';

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

  /**
   * Checks whether the browser supports the CSS Custom Highlight API.
   * @returns {boolean} True if supported.
   */
  function isCustomHighlightSupported() {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
  }

  /**
   * Injects or updates the CSS ::highlight() pseudo-element rule in the document head.
   */
  function ensureHighlightStyleInjected() {
    if (!isCustomHighlightSupported()) return;

    try {
      const styleId = 'eng-bn-translator-highlight-style';
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        const target = document.head || document.documentElement;
        if (target) {
          target.appendChild(style);
        }
      }

      const color = currentSettings.highlightColor || '#fde68a';
      style.textContent = `
        ::highlight(${HIGHLIGHT_NAME}) {
          background-color: ${color};
          color: #0f172a;
        }
      `;
    } catch (err) {
      console.warn('Failed to inject custom highlight stylesheet:', err);
    }
  }

  /**
   * Applies a custom CSS highlight on the translated word Range using CSS.highlights.
   * If unsupported, skips highlighting completely without modifying page DOM.
   * @param {Range|null} range - Target text Range.
   */
  function applyWordHighlight(range) {
    if (!range || !isCustomHighlightSupported()) return;

    try {
      ensureHighlightStyleInjected();
      const highlight = new Highlight(range);
      CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    } catch (err) {
      console.warn('Failed to apply CSS word highlight:', err);
    }
  }

  /**
   * Clears any active CSS word highlight.
   */
  function clearWordHighlight() {
    if (!isCustomHighlightSupported()) return;

    try {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    } catch (err) {
      // Silently ignore if already absent
    }
  }

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
    ensureHighlightStyleInjected();
  });

  // Listen for real-time changes from popup or options
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.enabled !== undefined) {
        isEnabled = changes.enabled.newValue !== false;
        if (!isEnabled) {
          removeTooltip();
          hideFloatingButton();
          cancelHoverTimer();
        }
      }
      if (changes.settings !== undefined && changes.settings.newValue) {
        currentSettings = { ...currentSettings, ...changes.settings.newValue };
        const mode = currentSettings.triggerMode || 'dblclick';
        if (mode !== 'hover' && mode !== 'both') {
          cancelHoverTimer();
        }

        // Live update custom highlight style
        ensureHighlightStyleInjected();

        // Live update active tooltip theme if open
        if (activeTooltipHost && activeTooltipHost.shadowRoot) {
          const card = activeTooltipHost.shadowRoot.querySelector('.tooltip-card');
          if (card) {
            card.setAttribute('data-theme', currentSettings.theme || 'dark');
          }
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
   * Validates that text contains English characters and at least 40% are English letters.
   * Rejects empty or non-English selections silently.
   * @param {string} text
   * @returns {boolean}
   */
  function isValidEnglishText(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const letters = trimmed.match(/[a-zA-Z]/g);
    if (!letters || letters.length === 0) return false;
    return (letters.length / trimmed.length) >= 0.4;
  }

  /**
   * Extracts the word, bounding client rectangle, and text Range under a given viewport point.
   * Uses document.caretRangeFromPoint with fallback to document.caretPositionFromPoint.
   * @param {number} x - Client X coordinate.
   * @param {number} y - Client Y coordinate.
   * @returns {{ word: string, rect: DOMRect, range: Range } | null}
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
        rect: rect,
        range: wordRange
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
   * Stops any active speech synthesis and resets playing indicators.
   */
  function stopSpeech() {
    isSpeakingQueue = false;
    currentUtteranceQueue = [];
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    if (activeSpeakingButton) {
      activeSpeakingButton.classList.remove('playing');
      activeSpeakingButton = null;
    }
  }

  /**
   * Speaks long text by splitting it into sentences and feeding them sequentially through a queue,
   * preventing browser speech timeout bugs (~15 seconds on Chromium).
   * @param {string} text - Full text to speak.
   * @param {string} lang - Language code (e.g. 'en-US', 'bn-BD').
   * @param {number} rate - Speech playback rate.
   * @param {HTMLElement} [buttonElement] - Associated trigger button.
   */
  function speakInQueue(text, lang, rate, buttonElement) {
    if (!('speechSynthesis' in window)) return;
    if (!text || typeof text !== 'string') return;

    // If already playing from this same button, toggle off
    if (isSpeakingQueue && activeSpeakingButton === buttonElement) {
      stopSpeech();
      return;
    }

    stopSpeech();

    // Split text into individual sentences at sentence punctuation boundaries
    const rawSegments = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    const queue = rawSegments.map((s) => s.trim()).filter(Boolean);
    if (queue.length === 0) return;

    isSpeakingQueue = true;
    currentUtteranceQueue = queue;
    activeSpeakingButton = buttonElement || null;
    if (buttonElement) {
      buttonElement.classList.add('playing');
    }

    let index = 0;

    function speakNext() {
      if (!isSpeakingQueue || index >= currentUtteranceQueue.length) {
        stopSpeech();
        return;
      }

      const segment = currentUtteranceQueue[index++];
      const utterance = new SpeechSynthesisUtterance(segment);
      utterance.lang = lang || 'en-US';
      utterance.rate = typeof rate === 'number' && rate > 0 ? rate : 0.95;

      // Attach detected voice if speaking Bangla
      if (lang && lang.toLowerCase().startsWith('bn')) {
        if (!_cachedBanglaVoice && 'speechSynthesis' in window) {
          const voices = window.speechSynthesis.getVoices() || [];
          _cachedBanglaVoice = voices.find((v) => (v.lang === 'bn-BD' || v.lang === 'bn_BD') && /natural|online/i.test(v.name)) ||
                               voices.find((v) => v.lang === 'bn-BD' || v.lang === 'bn_BD') ||
                               voices.find((v) => (v.lang === 'bn-IN' || v.lang === 'bn_IN') && /natural|online/i.test(v.name)) ||
                               voices.find((v) => v.lang === 'bn-IN' || v.lang === 'bn_IN') ||
                               voices.find((v) => (v.lang && (v.lang.toLowerCase().startsWith('bn') || v.lang.toLowerCase().startsWith('ben'))) ||
                                                  (v.name && /bangla|bengali/i.test(v.name))) ||
                               null;
        }
        if (_cachedBanglaVoice) {
          utterance.voice = _cachedBanglaVoice;
        }
      }

      utterance.onend = () => {
        if (isSpeakingQueue) {
          speakNext();
        }
      };

      utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          console.warn('Queued TTS error:', e);
        }
        stopSpeech();
      };

      window.speechSynthesis.speak(utterance);
    }

    speakNext();
  }

  /**
   * Hides and destroys the floating "অ" translation action button.
   */
  function hideFloatingButton() {
    if (activeFloatingHost) {
      try {
        activeFloatingHost.remove();
      } catch (err) {}
      activeFloatingHost = null;
    }
  }

  /**
   * Renders a small floating "অ" button near the end of a multi-word selection.
   * @param {DOMRect} selectionRect
   */
  function showFloatingButton(selectionRect) {
    hideFloatingButton();

    const host = document.createElement('div');
    host.id = 'eng-bn-floating-action-host';
    host.style.cssText = `
      all: initial !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 0 !important;
      pointer-events: none !important;
      z-index: 2147483646 !important;
    `;

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      .floating-btn {
        pointer-events: auto;
        position: absolute;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: #0f172a;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid rgba(56, 189, 248, 0.45);
        color: #38bdf8;
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, sans-serif;
        font-size: 14px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
        transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        user-select: none;
        outline: none;
      }
      .floating-btn:hover {
        transform: scale(1.12);
        border-color: #38bdf8;
        color: #ffffff;
        box-shadow: 0 6px 18px rgba(56, 189, 248, 0.35);
      }
      .floating-btn:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 2px;
      }
    `;

    const btn = document.createElement('button');
    btn.className = 'floating-btn';
    btn.title = 'অনুবাদ করুন (Translate sentence)';
    btn.setAttribute('aria-label', 'Translate selected text');
    btn.textContent = 'অ';

    const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const viewportWidth = document.documentElement.clientWidth;

    let btnLeft = selectionRect.right + scrollX + 6;
    let btnTop = selectionRect.bottom + scrollY + 4;

    if (btnLeft + 32 > scrollX + viewportWidth) {
      btnLeft = selectionRect.right + scrollX - 32;
    }

    btn.style.left = `${Math.round(btnLeft)}px`;
    btn.style.top = `${Math.round(btnTop)}px`;

    // Prevent mousedown from clearing the user's active text selection
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideFloatingButton();
      triggerSelectionTranslation();
    });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    document.documentElement.appendChild(host);
    activeFloatingHost = host;
  }

  /**
   * Remove any active floating tooltip from DOM, clear word highlights, and stop speech.
   */
  function removeTooltip() {
    stopSpeech();
    if (activeTooltipHost) {
      try {
        activeTooltipHost.remove();
      } catch (err) {
        // Element may already be detached
      }
      activeTooltipHost = null;
    }
    currentActiveWord = '';

    // Clear CSS highlight
    clearWordHighlight();

    // Remove transient dismissal listeners
    document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    document.removeEventListener('keydown', handleEscapeKey, true);
    window.removeEventListener('scroll', handleScrollThreshold, { passive: true });
  }

  /**
   * Pointerdown handler to dismiss tooltip when clicking outside.
   * @param {PointerEvent} event
   */
  function handlePointerDownOutside(event) {
    const path = event.composedPath ? event.composedPath() : [];
    if (activeFloatingHost && !path.includes(activeFloatingHost)) {
      hideFloatingButton();
    }
    if (activeTooltipHost && !path.includes(activeTooltipHost)) {
      removeTooltip();
    }
  }

  /**
   * Escape key handler to dismiss tooltip and floating button.
   * @param {KeyboardEvent} event
   */
  function handleEscapeKey(event) {
    if (event.key === 'Escape') {
      removeTooltip();
      hideFloatingButton();
      cancelHoverTimer();
    }
  }

  /**
   * Scroll handler to dismiss tooltip on significant page scroll and cancel pending hover.
   * Does NOT dismiss when scrolling inside the tooltip's own scrollable content area.
   * @param {Event} [event]
   */
  function handleScrollThreshold(event) {
    // If the scroll event originated from within the active tooltip host, ignore
    if (activeTooltipHost && event && event.target) {
      if (event.target === activeTooltipHost || (activeTooltipHost.shadowRoot && activeTooltipHost.shadowRoot.contains(event.target))) {
        return;
      }
    }

    cancelHoverTimer();
    hideFloatingButton();

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
   * Copy text to clipboard with visual feedback and accessibility announcement.
   * @param {string} text
   * @param {HTMLElement} btn
   * @param {string} defaultLabel
   */
  async function copyToClipboard(text, btn, defaultLabel = 'কপি করুন') {
    try {
      await navigator.clipboard.writeText(text);
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="icon-svg">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      `;
      btn.title = 'কপি হয়েছে!';
      btn.setAttribute('aria-label', 'কপি হয়েছে!');

      setTimeout(() => {
        if (btn) {
          btn.innerHTML = originalHTML;
          btn.title = defaultLabel;
          btn.setAttribute('aria-label', defaultLabel);
        }
      }, 1500);
    } catch (err) {
      console.warn('Clipboard copy error:', err);
    }
  }

  /**
   * Reads, validates, and translates the active webpage text selection.
   * Reused by double-click, triple-click, floating button, and keyboard shortcuts (TRANSLATE_SELECTION).
   * @returns {boolean} True if a valid selection was found and rendered.
   */
  function triggerSelectionTranslation() {
    if (!isEnabled) return false;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;

    const rawSelected = selection.toString();
    if (!rawSelected || !rawSelected.trim()) return false;

    // Check if selection focus is within an ignored element
    const anchorElem = selection.anchorNode
      ? (selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement)
      : null;

    if (anchorElem && isIgnoredElement(anchorElem)) return false;

    const cleaned = rawSelected
      .replace(/^[\s.,/#!$%\^&\*;:{}=\-_`~()'"\[\]<>?]+|[\s.,/#!$%\^&\*;:{}=\-_`~()'"\[\]<>?]+$/g, '')
      .trim();

    if (!isValidEnglishText(cleaned)) return false;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;

    hideFloatingButton();
    cancelHoverTimer();
    removeTooltip();

    scrollStartY = window.pageYOffset || document.documentElement.scrollTop || 0;
    scrollStartX = window.pageXOffset || document.documentElement.scrollLeft || 0;

    renderShadowTooltip(cleaned, rect, range);
    return true;
  }

  /**
   * Main double-click event listener.
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
   * Click handler to detect triple-click paragraph translation.
   * @param {MouseEvent} event
   */
  function handleClick(event) {
    if (event.detail === 3) {
      if (!isEnabled) return;
      if (isIgnoredElement(event.target)) return;
      setTimeout(() => {
        triggerSelectionTranslation();
      }, 15);
    }
  }

  /**
   * Mouseup handler to inspect selection and display the floating "অ" button for sentences.
   * @param {MouseEvent} event
   */
  function handleMouseUp(event) {
    setTimeout(() => {
      if (!isEnabled) {
        hideFloatingButton();
        return;
      }

      // Do not trigger floating button if clicking inside active tooltip or existing button
      if (activeTooltipHost) {
        const path = event.composedPath ? event.composedPath() : [];
        if (path.includes(activeTooltipHost)) return;
      }
      if (activeFloatingHost) {
        const path = event.composedPath ? event.composedPath() : [];
        if (path.includes(activeFloatingHost)) return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        hideFloatingButton();
        return;
      }

      const raw = selection.toString().trim();
      if (!raw) {
        hideFloatingButton();
        return;
      }

      const words = raw.split(/\s+/).filter(Boolean);
      // Only show floating button if more than 3 words are selected and valid English
      if (words.length <= 3 || !isValidEnglishText(raw)) {
        hideFloatingButton();
        return;
      }

      const anchorElem = selection.anchorNode
        ? (selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement)
        : null;

      if (anchorElem && isIgnoredElement(anchorElem)) {
        hideFloatingButton();
        return;
      }

      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      const lastRect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (!lastRect || (lastRect.width === 0 && lastRect.height === 0)) {
        hideFloatingButton();
        return;
      }

      showFloatingButton(lastRect);
    }, 20);
  }

  /**
   * Mousemove listener for debounced hover word detection.
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

      renderShadowTooltip(found.word, found.rect, found.range);
    }, delay);
  }

  /**
   * Window mouseleave listener.
   */
  function handleMouseLeave() {
    cancelHoverTimer();
  }

  /**
   * Render and position accessible Shadow DOM Tooltip.
   * Reused by double-click, triple-click, hover, floating button, and shortcut triggers without duplication.
   * @param {string} word
   * @param {DOMRect} selectionRect
   * @param {Range} [wordRange]
   */
  function renderShadowTooltip(word, selectionRect, wordRange) {
    ensureLocalFontsInjected();

    const wordCount = word.split(/\s+/).filter(Boolean).length;
    const isSentenceInitial = wordCount > 3;

    // Set active word
    currentActiveWord = word.toLowerCase();

    // Apply CSS Custom Highlight on the target text Range
    if (wordRange) {
      applyWordHighlight(wordRange);
    }

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

      /* Base Theme Variables - Dark Theme (Default) */
      .tooltip-card {
        --bg-start: #1e293b;
        --bg-end: #0f172a;
        --border-color: rgba(255, 255, 255, 0.14);
        --shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.55), 0 8px 16px -6px rgba(0, 0, 0, 0.45);
        --text-main: #f8fafc;
        --text-original: #e2e8f0;
        --divider: rgba(255, 255, 255, 0.08);
        --btn-bg: rgba(255, 255, 255, 0.06);
        --btn-border: rgba(255, 255, 255, 0.1);
        --btn-color: #94a3b8;
        --btn-hover-bg: rgba(255, 255, 255, 0.15);
        --btn-hover-color: #ffffff;
        --primary-bn: #38bdf8;
        --pos-bg: rgba(99, 102, 241, 0.18);
        --pos-text: #a5b4fc;
        --pos-terms: #cbd5e1;
        --text-muted: #94a3b8;
        --error-text: #f87171;
        --focus-ring: #38bdf8;
        --focus-glow: rgba(56, 189, 248, 0.3);
        --arrow-bg-top: #0f172a;
        --arrow-bg-bottom: #1e293b;
        --offline-bg: rgba(245, 158, 11, 0.18);
        --offline-text: #fbbf24;
        --offline-border: rgba(245, 158, 11, 0.35);
      }

      /* Explicit Light Theme */
      .tooltip-card[data-theme="light"] {
        --bg-start: #f8fafc;
        --bg-end: #ffffff;
        --border-color: rgba(0, 0, 0, 0.12);
        --shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.18), 0 8px 16px -6px rgba(0, 0, 0, 0.12);
        --text-main: #1e293b;
        --text-original: #0f172a;
        --divider: rgba(0, 0, 0, 0.08);
        --btn-bg: rgba(0, 0, 0, 0.04);
        --btn-border: rgba(0, 0, 0, 0.1);
        --btn-color: #64748b;
        --btn-hover-bg: rgba(0, 0, 0, 0.08);
        --btn-hover-color: #0f172a;
        --primary-bn: #0284c7;
        --pos-bg: rgba(99, 102, 241, 0.12);
        --pos-text: #4338ca;
        --pos-terms: #334155;
        --text-muted: #64748b;
        --error-text: #dc2626;
        --focus-ring: #0284c7;
        --focus-glow: rgba(2, 132, 199, 0.25);
        --arrow-bg-top: #ffffff;
        --arrow-bg-bottom: #f8fafc;
        --offline-bg: rgba(217, 119, 6, 0.14);
        --offline-text: #b45309;
        --offline-border: rgba(217, 119, 6, 0.3);
      }

      /* Auto Theme via prefers-color-scheme */
      @media (prefers-color-scheme: light) {
        .tooltip-card[data-theme="auto"] {
          --bg-start: #f8fafc;
          --bg-end: #ffffff;
          --border-color: rgba(0, 0, 0, 0.12);
          --shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.18), 0 8px 16px -6px rgba(0, 0, 0, 0.12);
          --text-main: #1e293b;
          --text-original: #0f172a;
          --divider: rgba(0, 0, 0, 0.08);
          --btn-bg: rgba(0, 0, 0, 0.04);
          --btn-border: rgba(0, 0, 0, 0.1);
          --btn-color: #64748b;
          --btn-hover-bg: rgba(0, 0, 0, 0.08);
          --btn-hover-color: #0f172a;
          --primary-bn: #0284c7;
          --pos-bg: rgba(99, 102, 241, 0.12);
          --pos-text: #4338ca;
          --pos-terms: #334155;
          --text-muted: #64748b;
          --error-text: #dc2626;
          --focus-ring: #0284c7;
          --focus-glow: rgba(2, 132, 199, 0.25);
          --arrow-bg-top: #ffffff;
          --arrow-bg-bottom: #f8fafc;
          --offline-bg: rgba(217, 119, 6, 0.14);
          --offline-text: #b45309;
          --offline-border: rgba(217, 119, 6, 0.3);
        }
      }

      .tooltip-card {
        pointer-events: auto;
        position: absolute;
        width: 290px;
        background: var(--bg-end);
        background: linear-gradient(145deg, var(--bg-start) 0%, var(--bg-end) 100%);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        box-shadow: var(--shadow);
        color: var(--text-main);
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

      /* Sentence mode expansion */
      .tooltip-card[data-mode="sentence"] {
        width: min(420px, calc(100vw - 32px));
        max-height: 60vh;
        display: flex;
        flex-direction: column;
      }

      .tooltip-card[data-mode="sentence"] .card-body {
        overflow-y: auto;
        max-height: calc(60vh - 65px);
        overscroll-behavior: contain;
        padding-right: 4px;
      }

      .tooltip-card[data-mode="sentence"] .card-body::-webkit-scrollbar {
        width: 4px;
      }
      .tooltip-card[data-mode="sentence"] .card-body::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }
      .tooltip-card[data-theme="light"][data-mode="sentence"] .card-body::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.2);
      }

      /* Caret Arrow */
      .tooltip-arrow {
        position: absolute;
        width: 12px;
        height: 12px;
        background: var(--arrow-bg-bottom);
        border: 1px solid var(--border-color);
        transform: rotate(45deg);
        z-index: -1;
      }

      .tooltip-card[data-placement="top"] .tooltip-arrow {
        bottom: -6px;
        border-top: none;
        border-left: none;
        background: var(--arrow-bg-top);
      }

      .tooltip-card[data-placement="bottom"] .tooltip-arrow {
        top: -6px;
        border-bottom: none;
        border-right: none;
        background: var(--arrow-bg-bottom);
      }

      /* Header */
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--divider);
        flex-shrink: 0;
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
        color: var(--text-original);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 130px;
      }

      .badge-mode {
        display: inline-flex;
        align-items: center;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: rgba(56, 189, 248, 0.15);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.3);
        border-radius: 4px;
        padding: 1px 5px;
        line-height: 1.2;
        flex-shrink: 0;
      }

      .offline-badge {
        display: inline-flex;
        align-items: center;
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: var(--offline-bg);
        color: var(--offline-text);
        border: 1px solid var(--offline-border);
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
        background: var(--btn-bg);
        border: 1px solid var(--btn-border);
        border-radius: 6px;
        color: var(--btn-color);
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
        background: var(--btn-hover-bg);
        color: var(--btn-hover-color);
      }

      .icon-btn:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px var(--focus-glow);
      }

      .icon-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .icon-btn.playing {
        color: var(--primary-bn);
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

      /* Loading Skeleton */
      .skeleton-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 6px 0;
      }

      .skeleton-line {
        height: 11px;
        border-radius: 4px;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.06) 25%, rgba(255, 255, 255, 0.14) 50%, rgba(255, 255, 255, 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.4s infinite;
      }

      .tooltip-card[data-theme="light"] .skeleton-line {
        background: linear-gradient(90deg, rgba(0, 0, 0, 0.05) 25%, rgba(0, 0, 0, 0.12) 50%, rgba(0, 0, 0, 0.05) 75%);
        background-size: 200% 100%;
      }

      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .skeleton-line.line-1 { width: 92%; }
      .skeleton-line.line-2 { width: 78%; }
      .skeleton-line.line-3 { width: 55%; }

      /* Collapsible Original Text Section */
      .original-section {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--divider);
        border-radius: 8px;
        padding: 6px 8px;
        margin-bottom: 8px;
      }

      .original-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        user-select: none;
      }

      .original-header:hover {
        color: var(--text-main);
      }

      .original-arrow {
        width: 12px;
        height: 12px;
        transition: transform 0.2s ease;
      }

      .original-arrow.open {
        transform: rotate(180deg);
      }

      .original-content {
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-original);
        margin-top: 4px;
        white-space: pre-wrap;
        word-break: break-word;
        cursor: pointer;
      }

      .original-content.clamped {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Bangla Primary Result (Word Mode) */
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
        color: var(--primary-bn);
        letter-spacing: 0.2px;
        word-break: break-word;
      }

      /* Bangla Sentence Paragraph (Sentence Mode) */
      .bangla-sentence-text {
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, 'SolaimanLipi', 'Vrinda', sans-serif;
        font-size: 14.5px;
        font-weight: 500;
        line-height: 1.6;
        color: var(--primary-bn);
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* Sentence Status Notices */
      .sentence-notice {
        font-size: 11px;
        line-height: 1.35;
        margin-top: 6px;
        padding: 3px 7px;
        border-radius: 4px;
        display: inline-block;
      }

      .truncate-notice {
        background: rgba(245, 158, 11, 0.15);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.3);
      }

      .approximate-notice {
        background: rgba(99, 102, 241, 0.15);
        color: #a5b4fc;
        border: 1px solid rgba(99, 102, 241, 0.3);
      }

      /* Dictionary Meanings */
      .dict-group {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed var(--divider);
      }

      .pos-tag {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: var(--pos-bg);
        color: var(--pos-text);
        border-radius: 4px;
        padding: 1px 5px;
        margin-bottom: 4px;
      }

      .pos-terms {
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, 'SolaimanLipi', 'Vrinda', sans-serif;
        font-size: 13px;
        color: var(--pos-terms);
        line-height: 1.5;
        word-break: break-word;
      }

      /* Error State */
      .error-state {
        color: var(--error-text);
        font-size: 13px;
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, sans-serif;
        padding: 4px 0;
      }

      /* Accessibility: Disable animations and transitions when reduced motion is preferred */
      @media (prefers-reduced-motion: reduce) {
        .tooltip-card,
        .icon-btn,
        .skeleton-line {
          animation: none !important;
          transition: none !important;
        }
      }
    `;

    const card = document.createElement('div');
    card.className = 'tooltip-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', `English to Bangla translation for "${word}"`);

    // Set layout mode attribute (sentence or word)
    card.setAttribute('data-mode', isSentenceInitial ? 'sentence' : 'word');

    // Apply active theme (dark / light / auto)
    const activeTheme = currentSettings.theme || 'dark';
    card.setAttribute('data-theme', activeTheme);

    // Initial header & skeleton setup
    const initialHeaderTitle = isSentenceInitial ? 'Sentence' : escapeHtml(word);
    card.innerHTML = `
      <div class="tooltip-arrow"></div>
      <div class="card-header">
        <div class="word-group">
          ${isSentenceInitial ? '<span class="badge-mode">Sentence</span>' : `<span class="original-word" title="${escapeHtml(word)}">${initialHeaderTitle}</span>`}
        </div>
        <div class="header-actions">
          <button class="icon-btn btn-speak btn-speak-en" title="ইংরেজি উচ্চারণ শুনুন (Speak English)" aria-label="Speak English text">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
          <button class="icon-btn btn-speak btn-speak-bn" style="${isSentenceInitial ? '' : 'display: none;'}" title="বাংলা উচ্চারণ শুনুন (Speak Bangla)" aria-label="Speak Bangla translation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>
          <button class="icon-btn btn-copy btn-copy-translation" title="অনুবাদ কপি করুন (Copy translation)" aria-label="Copy translation" style="display: none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <button class="icon-btn btn-copy-original" style="${isSentenceInitial ? 'display: none;' : 'display: none;'}" title="মূল টেক্সট কপি করুন (Copy original)" aria-label="Copy original text">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button class="icon-btn close-btn" title="বন্ধ করুন (Close)" aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="card-body">
        <div class="skeleton-container">
          <div class="skeleton-line line-1"></div>
          <div class="skeleton-line line-2"></div>
          <div class="skeleton-line line-3"></div>
        </div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(card);

    document.documentElement.appendChild(host);
    activeTooltipHost = host;

    const btnSpeakEn = card.querySelector('.btn-speak-en');
    const btnSpeakBn = card.querySelector('.btn-speak-bn');
    const btnCopyTranslation = card.querySelector('.btn-copy-translation');
    const btnCopyOriginal = card.querySelector('.btn-copy-original');
    const btnClose = card.querySelector('.close-btn');

    btnSpeakEn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakInQueue(word, 'en-US', getSpeechRate(), btnSpeakEn);
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

        // Prevent body scroll event from propagating out
        body.addEventListener('wheel', (e) => {
          e.stopPropagation();
        }, { passive: true });

        if (response && response.success && response.data) {
          const data = response.data;
          const isSentence = data.mode === 'sentence' || isSentenceInitial;
          const primaryBangla = data.primary || data.translation || 'অনুবাদ পাওয়া যায়নি';

          card.setAttribute('data-mode', isSentence ? 'sentence' : 'word');

          // Header badges (Sentence badge and/or Offline badge)
          const wordGroup = card.querySelector('.word-group');
          if (wordGroup) {
            wordGroup.innerHTML = '';
            if (isSentence) {
              const sentenceBadge = document.createElement('span');
              sentenceBadge.className = 'badge-mode';
              sentenceBadge.textContent = 'Sentence';
              wordGroup.appendChild(sentenceBadge);
            } else {
              const origWordSpan = document.createElement('span');
              origWordSpan.className = 'original-word';
              origWordSpan.title = word;
              origWordSpan.textContent = word;
              wordGroup.appendChild(origWordSpan);
            }

            if (data.source === 'offline') {
              const badge = document.createElement('span');
              badge.className = 'offline-badge';
              badge.textContent = 'offline';
              badge.title = 'অফলাইন ডিকশনারি';
              wordGroup.appendChild(badge);
            }
          }

          // Ensure Bangla voice is checked
          if (!banglaVoiceAvailable && typeof findBanglaVoice === 'function') {
            try {
              const voice = await findBanglaVoice();
              banglaVoiceAvailable = !!voice;
            } catch (err) {
              banglaVoiceAvailable = false;
            }
          }

          const bnDisabled = !banglaVoiceAvailable;
          const bnTitle = bnDisabled
            ? 'No Bangla voice installed on this device.'
            : 'বাংলা উচ্চারণ শুনুন (Speak Bangla)';
          const bnAriaLabel = bnDisabled
            ? 'No Bangla voice installed on this device.'
            : 'Speak Bangla translation';

          // Configure buttons
          btnCopyTranslation.style.display = 'inline-flex';
          btnCopyTranslation.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(primaryBangla, btnCopyTranslation, 'অনুবাদ কপি করুন (Copy translation)');
          });

          if (isSentence) {
            // Sentence Mode Buttons
            btnSpeakBn.style.display = 'inline-flex';
            btnSpeakBn.title = bnTitle;
            btnSpeakBn.setAttribute('aria-label', bnAriaLabel);
            btnSpeakBn.disabled = bnDisabled;
            if (!bnDisabled) {
              btnSpeakBn.addEventListener('click', (e) => {
                e.stopPropagation();
                speakInQueue(primaryBangla, 'bn-BD', getSpeechRate(), btnSpeakBn);
              });
            }

            btnCopyOriginal.style.display = 'inline-flex';
            btnCopyOriginal.addEventListener('click', (e) => {
              e.stopPropagation();
              copyToClipboard(word, btnCopyOriginal, 'মূল টেক্সট কপি করুন (Copy original)');
            });

            // Status notices
            let noticesHTML = '';
            if (data.truncated) {
              noticesHTML += `<div class="sentence-notice truncate-notice">Showing the first ${word.length} characters only.</div>`;
            }
            if (data.approximate) {
              noticesHTML += `<div class="sentence-notice approximate-notice">Offline approximate (word-by-word) translation.</div>`;
            }

            body.innerHTML = `
              <div class="original-section">
                <div class="original-header" role="button" tabindex="0" aria-expanded="false">
                  <span>Original</span>
                  <svg class="original-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div class="original-content clamped" title="Click to expand/collapse">${escapeHtml(word)}</div>
              </div>
              <div class="bangla-sentence-text">${escapeHtml(primaryBangla)}</div>
              ${noticesHTML}
            `;

            // Toggle collapsible original section
            const origHeader = body.querySelector('.original-header');
            const origContent = body.querySelector('.original-content');
            const origArrow = body.querySelector('.original-arrow');

            const toggleCollapse = (e) => {
              e.stopPropagation();
              const isClamped = origContent.classList.toggle('clamped');
              origArrow.classList.toggle('open', !isClamped);
              origHeader.setAttribute('aria-expanded', String(!isClamped));
              positionTooltipCard(card, selectionRect);
            };

            if (origHeader && origContent) {
              origHeader.addEventListener('click', toggleCollapse);
              origHeader.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleCollapse(e);
                }
              });
              origContent.addEventListener('click', toggleCollapse);
            }
          } else {
            // Word Mode Body
            btnSpeakBn.style.display = 'none';
            btnCopyOriginal.style.display = 'none';

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

            body.innerHTML = `
              <div class="bangla-result-row">
                <div class="bangla-primary">${escapeHtml(primaryBangla)}</div>
                <button class="icon-btn btn-speak-bn" title="${escapeHtml(bnTitle)}" aria-label="${escapeHtml(bnAriaLabel)}" ${bnDisabled ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </button>
              </div>
              ${dictHTML}
            `;

            const wordBnBtn = body.querySelector('.btn-speak-bn');
            if (wordBnBtn && !bnDisabled) {
              wordBnBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                speakInQueue(primaryBangla, 'bn-BD', getSpeechRate(), wordBnBtn);
              });
            }
          }
        } else {
          const errMsg = response?.error || 'অনুবাদ লোড করা যায়নি।';
          body.innerHTML = `
            <div class="error-state">${escapeHtml(errMsg)}</div>
          `;
        }

        // Recompute position after translation text loads
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
   * Position tooltip card relative to selection with automatic viewport clamping.
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

    // Guard against overflow off top of page
    if (cardTop < scrollY + 10) {
      cardTop = scrollY + 10;
    }

    card.style.left = `${Math.round(cardLeft)}px`;
    card.style.top = `${Math.round(cardTop)}px`;
    card.classList.add('visible');
  }

  /**
   * Helper to escape HTML characters.
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
  document.addEventListener('click', handleClick, true);
  document.addEventListener('mouseup', handleMouseUp, true);
  document.addEventListener('mousemove', handleMouseMove, { passive: true });
  document.addEventListener('mouseleave', handleMouseLeave, { passive: true });
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideFloatingButton();
    }
  });
})();
