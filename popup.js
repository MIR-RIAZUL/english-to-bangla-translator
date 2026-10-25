/**
 * Popup Script
 * Handles toggle state persistence, quick manual translation,
 * speech synthesis pronunciation, and recent word history rendering.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const enableToggle = document.getElementById('enableToggle');
  const statusPill = document.getElementById('statusPill');
  const statusLabel = document.getElementById('statusLabel');

  const quickInput = document.getElementById('quickInput');
  const clearInputBtn = document.getElementById('clearInputBtn');
  const charCount = document.getElementById('charCount');
  const speakInputBtn = document.getElementById('speakInputBtn');
  const translateBtn = document.getElementById('translateBtn');

  const resultBox = document.getElementById('resultBox');
  const primaryResult = document.getElementById('primaryResult');
  const dictMeanings = document.getElementById('dictMeanings');
  const copyResultBtn = document.getElementById('copyResultBtn');

  const recentList = document.getElementById('recentList');
  const clearRecentBtn = document.getElementById('clearRecentBtn');

  let currentTranslatedText = '';

  // -------------------------------------------------------------
  // 1. Master Toggle & Storage Sync
  // -------------------------------------------------------------

  function updateStatusUI(isEnabled) {
    enableToggle.checked = isEnabled;
    if (isEnabled) {
      statusPill.className = 'status-pill status-active';
      statusLabel.textContent = 'Active';
    } else {
      statusPill.className = 'status-pill status-paused';
      statusLabel.textContent = 'Paused';
    }
  }

  // Load initial settings
  chrome.storage.local.get({ enabled: true, recentWords: [] }, (items) => {
    updateStatusUI(items.enabled !== false);
    renderRecentWords(items.recentWords || []);
  });

  // Toggle switch listener
  enableToggle.addEventListener('change', async () => {
    const isChecked = enableToggle.checked;
    await chrome.storage.local.set({ enabled: isChecked });
    updateStatusUI(isChecked);
  });

  // Listen for storage changes from background or other tabs
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.enabled !== undefined) {
        updateStatusUI(changes.enabled.newValue !== false);
      }
      if (changes.recentWords !== undefined) {
        renderRecentWords(changes.recentWords.newValue || []);
      }
    }
  });

  // -------------------------------------------------------------
  // 2. Quick Translate Logic
  // -------------------------------------------------------------

  function updateInputControls() {
    const text = quickInput.value;
    const trimmed = text.trim();
    charCount.textContent = `${text.length} chars`;

    clearInputBtn.style.display = text.length > 0 ? 'inline-flex' : 'none';
    speakInputBtn.disabled = trimmed.length === 0;
  }

  quickInput.addEventListener('input', updateInputControls);

  // Trigger translation on Enter (without Shift)
  quickInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      executeQuickTranslate();
    }
  });

  // Clear input
  clearInputBtn.addEventListener('click', () => {
    quickInput.value = '';
    updateInputControls();
    resultBox.style.display = 'none';
    quickInput.focus();
  });

  // Translate button click
  translateBtn.addEventListener('click', () => {
    executeQuickTranslate();
  });

  async function executeQuickTranslate() {
    const text = quickInput.value.trim();
    if (!text) {
      quickInput.focus();
      return;
    }

    // Show loading state
    resultBox.style.display = 'block';
    primaryResult.innerHTML = '<span class="loading-text">অনুবাদ করা হচ্ছে...</span>';
    dictMeanings.innerHTML = '';
    translateBtn.disabled = true;

    try {
      chrome.runtime.sendMessage(
        {
          action: 'TRANSLATE_TEXT',
          text: text,
          isDoubleClick: false
        },
        (response) => {
          translateBtn.disabled = false;

          if (response && response.success && response.data) {
            const data = response.data;
            currentTranslatedText = data.primary || '';
            primaryResult.textContent = currentTranslatedText;

            // Render dictionary meanings if available
            if (Array.isArray(data.dictionary) && data.dictionary.length > 0) {
              const html = data.dictionary
                .slice(0, 3)
                .map((item) => {
                  return `
                    <div class="dict-item-row">
                      <span class="pos-badge">${escapeHtml(item.pos)}</span>
                      <span class="pos-terms-text">${escapeHtml(item.terms.join(', '))}</span>
                    </div>
                  `;
                })
                .join('');
              dictMeanings.innerHTML = html;
            } else {
              dictMeanings.innerHTML = '';
            }
          } else {
            const errorMsg = response?.error || 'অনুবাদ সম্পন্ন করা যায়নি।';
            primaryResult.innerHTML = `<span style="color: #f87171; font-size: 13px;">${escapeHtml(errorMsg)}</span>`;
            dictMeanings.innerHTML = '';
          }
        }
      );
    } catch (err) {
      translateBtn.disabled = false;
      primaryResult.innerHTML = `<span style="color: #f87171; font-size: 13px;">অনুবাদ ত্রুটি: ${escapeHtml(err.message)}</span>`;
    }
  }

  // Copy result button
  copyResultBtn.addEventListener('click', async () => {
    if (!currentTranslatedText) return;
    try {
      await navigator.clipboard.writeText(currentTranslatedText);
      const originalHTML = copyResultBtn.innerHTML;
      copyResultBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="icon-svg">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      `;
      copyResultBtn.title = 'কপি হয়েছে!';
      setTimeout(() => {
        copyResultBtn.innerHTML = originalHTML;
        copyResultBtn.title = 'Copy translation';
      }, 1500);
    } catch (err) {
      console.warn('Clipboard write error:', err);
    }
  });

  // Speech pronunciation for English input
  speakInputBtn.addEventListener('click', () => {
    const text = quickInput.value.trim();
    if (text) {
      pronounceText(text, speakInputBtn);
    }
  });

  // -------------------------------------------------------------
  // 3. Pronunciation Helper
  // -------------------------------------------------------------

  function pronounceText(text, btnElement) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.95;

      if (btnElement) {
        btnElement.style.opacity = '0.7';
        utterance.onend = () => { btnElement.style.opacity = '1'; };
        utterance.onerror = () => { btnElement.style.opacity = '1'; };
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err);
    }
  }

  // -------------------------------------------------------------
  // 4. Recent Words History
  // -------------------------------------------------------------

  function renderRecentWords(list) {
    if (!Array.isArray(list) || list.length === 0) {
      recentList.innerHTML = `
        <div class="empty-state">
          <span>এখনও কোনো সাম্প্রতিক শব্দ নেই</span>
          <small>যেকোনো ওয়েবপেজের শব্দে ডাবল-ক্লিক করুন</small>
        </div>
      `;
      clearRecentBtn.style.display = 'none';
      return;
    }

    clearRecentBtn.style.display = 'inline-block';
    const recentFive = list.slice(0, 5);

    recentList.innerHTML = recentFive
      .map((item, index) => {
        return `
          <div class="recent-item" data-index="${index}" title="ক্লিক করে অনুবাদ বক্সে আনুন">
            <div class="recent-words-pair">
              <span class="recent-word-en">${escapeHtml(item.word)}</span>
              <span class="recent-arrow">➔</span>
              <span class="recent-word-bn">${escapeHtml(item.translation)}</span>
            </div>
            <div class="recent-actions">
              <button class="action-icon-btn btn-recent-speak" data-word="${escapeHtml(item.word)}" title="উচ্চারণ শুনুন">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
              <button class="action-icon-btn btn-recent-copy" data-translation="${escapeHtml(item.translation)}" title="কপি করুন">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-svg">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    // Attach click events on recent items
    const itemElements = recentList.querySelectorAll('.recent-item');
    itemElements.forEach((el, idx) => {
      el.addEventListener('click', (e) => {
        // If clicking one of the action buttons inside, don't trigger item selection
        if (e.target.closest('.action-icon-btn')) return;

        const item = recentFive[idx];
        if (item) {
          quickInput.value = item.word;
          updateInputControls();
          executeQuickTranslate();
        }
      });
    });

    // Attach speak button events
    const speakBtns = recentList.querySelectorAll('.btn-recent-speak');
    speakBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const word = btn.getAttribute('data-word');
        if (word) pronounceText(word, btn);
      });
    });

    // Attach copy button events
    const copyBtns = recentList.querySelectorAll('.btn-recent-copy');
    copyBtns.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const translation = btn.getAttribute('data-translation');
        if (translation) {
          try {
            await navigator.clipboard.writeText(translation);
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="icon-svg">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            `;
            setTimeout(() => {
              btn.innerHTML = originalHTML;
            }, 1200);
          } catch (err) {
            console.warn('Copy failed:', err);
          }
        }
      });
    });
  }

  // Clear Recent History
  clearRecentBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ recentWords: [] });
    renderRecentWords([]);
  });

  // -------------------------------------------------------------
  // 5. Utility
  // -------------------------------------------------------------

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
