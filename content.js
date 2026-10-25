/**
 * Content Script
 * Listens for double-click events, extracts English words, renders an isolated
 * Shadow DOM floating tooltip, and manages pronunciation & dismissal events.
 */

(() => {
  // Global state for enabling/disabling double click translation
  let isEnabled = true;
  let activeTooltipHost = null;
  let scrollStartY = 0;
  let scrollStartX = 0;

  // Retrieve initial enabled state from chrome.storage.local
  chrome.storage.local.get({ enabled: true }, (result) => {
    if (chrome.runtime.lastError) {
      console.warn('Storage read warning:', chrome.runtime.lastError);
      return;
    }
    isEnabled = result.enabled !== false;
  });

  // Listen for real-time toggle changes from popup or options
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled !== undefined) {
      isEnabled = changes.enabled.newValue !== false;
      if (!isEnabled) {
        removeTooltip();
      }
    }
  });

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
    }
  }

  /**
   * Scroll handler to dismiss tooltip on significant page scroll
   */
  function handleScrollThreshold() {
    if (!activeTooltipHost) return;
    const currentY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const currentX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    if (Math.abs(currentY - scrollStartY) > 25 || Math.abs(currentX - scrollStartX) > 25) {
      removeTooltip();
    }
  }

  /**
   * Pronounce English text using Web Speech API
   * @param {string} text
   * @param {HTMLElement} [buttonElement]
   */
  function speakEnglishWord(text, buttonElement) {
    if (!('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;

      if (buttonElement) {
        buttonElement.classList.add('playing');
        utterance.onend = () => buttonElement.classList.remove('playing');
        utterance.onerror = () => buttonElement.classList.remove('playing');
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis failed:', err);
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
   * Main double-click event listener
   */
  function handleDoubleClick(event) {
    // 1. Guard: feature enabled?
    if (!isEnabled) return;

    // 2. Ignore double clicks in password input fields
    const target = event.target;
    if (target && target.tagName === 'INPUT' && target.type === 'password') {
      return;
    }

    // 3. Extract and sanitize selected text
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const rawSelected = selection.toString().trim();
    if (!rawSelected) return;

    // Clean leading & trailing punctuation, quotes, symbols
    const cleaned = rawSelected
      .replace(/^[\s.,/#!$%\^&\*;:{}=\-_`~()'"\[\]<>?]+|[\s.,/#!$%\^&\*;:{}=\-_`~()'"\[\]<>?]+$/g, '')
      .trim();

    // 4. Must contain at least one English letter and not exceed 3 words
    if (!/[a-zA-Z]/.test(cleaned)) return;

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) return;

    // 5. Calculate selection bounding box
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    // 6. Dismiss any existing tooltip before opening new one
    removeTooltip();

    // 7. Store scroll coordinates for scroll dismissal
    scrollStartY = window.pageYOffset || document.documentElement.scrollTop || 0;
    scrollStartX = window.pageXOffset || document.documentElement.scrollLeft || 0;

    // 8. Render floating tooltip container
    renderShadowTooltip(cleaned, rect);
  }

  /**
   * Render and position Shadow DOM Tooltip
   * @param {string} word
   * @param {DOMRect} selectionRect
   */
  function renderShadowTooltip(word, selectionRect) {
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

    // Attach open shadow DOM
    const shadow = host.attachShadow({ mode: 'open' });

    // Stylesheet inside Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');

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
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
        max-width: 170px;
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

      .icon-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
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
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;
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
      .bangla-primary {
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'SolaimanLipi', 'Vrinda', sans-serif;
        font-size: 20px;
        font-weight: 700;
        color: #38bdf8;
        letter-spacing: 0.2px;
        margin-bottom: 6px;
        word-break: break-word;
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
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'SolaimanLipi', 'Vrinda', sans-serif;
        font-size: 13px;
        color: #cbd5e1;
        line-height: 1.5;
        word-break: break-word;
      }

      /* Error State */
      .error-state {
        color: #f87171;
        font-size: 13px;
        font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;
        padding: 4px 0;
      }
    `;

    // Tooltip Card container
    const card = document.createElement('div');
    card.className = 'tooltip-card';

    // Header HTML
    card.innerHTML = `
      <div class="tooltip-arrow"></div>
      <div class="card-header">
        <div class="word-group">
          <span class="original-word" title="${escapeHtml(word)}">${escapeHtml(word)}</span>
        </div>
        <div class="header-actions">
          <button class="icon-btn btn-speak" title="উচ্চারণ শুনুন">
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

    // Append to documentElement for absolute positioning independent of body styling
    document.documentElement.appendChild(host);
    activeTooltipHost = host;

    // Attach event listeners for header buttons
    const btnSpeak = card.querySelector('.btn-speak');
    const btnCopy = card.querySelector('.btn-copy');
    const btnClose = card.querySelector('.close-btn');

    btnSpeak.addEventListener('click', (e) => {
      e.stopPropagation();
      speakEnglishWord(word, btnSpeak);
    });

    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTooltip();
    });

    // Initial position calculation
    positionTooltipCard(card, selectionRect);

    // Request translation from background service worker
    chrome.runtime.sendMessage(
      {
        action: 'TRANSLATE_TEXT',
        text: word,
        isDoubleClick: true
      },
      (response) => {
        // If tooltip was closed during fetch, do nothing
        if (!activeTooltipHost || activeTooltipHost !== host) return;

        const body = card.querySelector('.card-body');
        if (!body) return;

        if (response && response.success && response.data) {
          const data = response.data;
          const primaryBangla = data.primary || 'অনুবাদ পাওয়া যায়নি';

          // Show copy button
          btnCopy.style.display = 'inline-flex';
          btnCopy.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(primaryBangla, btnCopy);
          });

          // Build dictionary meanings HTML if present
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
            <div class="bangla-primary">${escapeHtml(primaryBangla)}</div>
            ${dictHTML}
          `;
        } else {
          const errMsg = response?.error || 'অনুবাদ লোড করা যায়নি।';
          body.innerHTML = `
            <div class="error-state">${escapeHtml(errMsg)}</div>
          `;
        }

        // Re-adjust position after content update
        positionTooltipCard(card, selectionRect);
      }
    );

    // Register dismissal listeners
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

    // Center tooltip horizontally with respect to selection
    const wordCenterX = selectionRect.left + scrollX + selectionRect.width / 2;
    let cardLeft = wordCenterX - cardWidth / 2;

    // Constrain horizontally within viewport margins (min 10px padding)
    const minLeft = scrollX + 10;
    const maxLeft = scrollX + viewportWidth - cardWidth - 10;
    cardLeft = Math.max(minLeft, Math.min(cardLeft, maxLeft));

    // Calculate position of the caret arrow inside the card
    const arrow = card.querySelector('.tooltip-arrow');
    const relativeArrowX = wordCenterX - cardLeft;
    const clampedArrowX = Math.max(16, Math.min(relativeArrowX, cardWidth - 16));
    if (arrow) {
      arrow.style.left = `${clampedArrowX - 6}px`;
    }

    // Determine vertical placement: above or below
    const spaceAbove = selectionRect.top;
    const margin = 10;
    let cardTop = 0;

    if (spaceAbove > cardHeight + margin + 10) {
      // Position above word
      cardTop = selectionRect.top + scrollY - cardHeight - margin;
      card.setAttribute('data-placement', 'top');
    } else {
      // Position below word
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

  // Register the document double-click listener
  document.addEventListener('dblclick', handleDoubleClick, true);
})();
