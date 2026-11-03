/**
 * Popup Script
 * Handles toggle state persistence, quick manual translation (word & sentence mode),
 * multi-line input with 3000-char counter, Enter to translate, Shift+Enter for newlines,
 * dual-mode layout auto-switching, speech synthesis pronunciation (English and Bangla),
 * options navigation, and recent word history rendering with view-all navigation.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Navigation & Master Toggle
  const enableToggle = document.getElementById('enableToggle');
  const statusPill = document.getElementById('statusPill');
  const statusLabel = document.getElementById('statusLabel');
  const openOptionsBtn = document.getElementById('openOptionsBtn');

  // Quick Translator Elements
  const quickInput = document.getElementById('quickInput');
  const clearInputBtn = document.getElementById('clearInputBtn');
  const charCount = document.getElementById('charCount');
  const speakInputBtn = document.getElementById('speakInputBtn');
  const translateBtn = document.getElementById('translateBtn');

  // Result Area Elements
  const resultBox = document.getElementById('resultBox');
  const resultTitle = document.getElementById('resultTitle');
  const copyResultBtn = document.getElementById('copyResultBtn');
  const popupOfflineBadge = document.getElementById('popupOfflineBadge');

  // Word Mode Result Elements
  const wordResultLayout = document.getElementById('wordResultLayout');
  const primaryResult = document.getElementById('primaryResult');
  const speakResultBtn = document.getElementById('speakResultBtn');
  const dictMeanings = document.getElementById('dictMeanings');

  // Sentence Mode Result Elements
  const sentenceResultLayout = document.getElementById('sentenceResultLayout');
  const sentenceResultText = document.getElementById('sentenceResultText');
  const speakSentenceBnBtn = document.getElementById('speakSentenceBnBtn');
  const copySentenceBtn = document.getElementById('copySentenceBtn');
  const sentenceNotices = document.getElementById('sentenceNotices');

  // Recent History Elements
  const recentList = document.getElementById('recentList');
  const clearRecentBtn = document.getElementById('clearRecentBtn');
  const viewAllHistoryBtn = document.getElementById('viewAllHistoryBtn');

  // State
  let currentTranslatedText = '';
  let banglaVoiceAvailable = false;
  let currentSpeechRate = 0.95;
  const MAX_INPUT_CHARS = 3000;

  // -------------------------------------------------------------
  // 1. Navigation & Master Toggle
  // -------------------------------------------------------------

  // Open Options page
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => {
      try {
        if (chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open(chrome.runtime.getURL('options.html'));
        }
      } catch (err) {
        console.error('Failed to open options page:', err);
      }
    });
  }

  // Open History page
  if (viewAllHistoryBtn) {
    viewAllHistoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
      } catch (err) {
        window.open(chrome.runtime.getURL('history.html'));
      }
    });
  }

  /**
   * Updates toggle switch visual status badge.
   * @param {boolean} isEnabled
   */
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

  /**
   * Updates the Bangla speech button state based on voice availability and translated text.
   */
  function updateBanglaSpeakButtonState() {
    const isAvailable = banglaVoiceAvailable && !!currentTranslatedText;
    const titleText = banglaVoiceAvailable
      ? 'বাংলা উচ্চারণ শুনুন'
      : 'No Bangla voice installed on this device.';
    const ariaText = banglaVoiceAvailable
      ? 'Pronounce Bangla translation'
      : 'No Bangla voice installed on this device.';

    if (speakResultBtn) {
      speakResultBtn.disabled = !isAvailable;
      speakResultBtn.title = titleText;
      speakResultBtn.setAttribute('aria-label', ariaText);
    }

    if (speakSentenceBnBtn) {
      speakSentenceBnBtn.disabled = !isAvailable;
      speakSentenceBnBtn.title = titleText;
      speakSentenceBnBtn.setAttribute('aria-label', ariaText);
    }
  }

  // Load initial settings and state
  try {
    const items = await chrome.storage.local.get({ enabled: true, recentWords: [], settings: {} });
    updateStatusUI(items.enabled !== false);
    renderRecentWords(items.recentWords || []);

    if (items.settings && typeof items.settings.speechRate === 'number') {
      currentSpeechRate = items.settings.speechRate;
    } else if (typeof getSettings === 'function') {
      const settings = await getSettings();
      if (typeof settings.speechRate === 'number') {
        currentSpeechRate = settings.speechRate;
      }
    }
  } catch (err) {
    console.warn('Failed to load initial settings in popup:', err);
  }

  // Initialize Bangla voice detection
  try {
    if (typeof findBanglaVoice === 'function') {
      const voice = await findBanglaVoice();
      banglaVoiceAvailable = !!voice;
    }
  } catch (err) {
    banglaVoiceAvailable = false;
  }
  updateBanglaSpeakButtonState();

  // Toggle switch listener
  enableToggle.addEventListener('change', async () => {
    try {
      const isChecked = enableToggle.checked;
      await chrome.storage.local.set({ enabled: isChecked });
      updateStatusUI(isChecked);
    } catch (err) {
      console.error('Failed to save toggle state:', err);
    }
  });

  // Listen for storage changes from background or options
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.enabled !== undefined) {
        updateStatusUI(changes.enabled.newValue !== false);
      }
      if (changes.recentWords !== undefined) {
        renderRecentWords(changes.recentWords.newValue || []);
      }
      if (changes.settings !== undefined && changes.settings.newValue) {
        if (typeof changes.settings.newValue.speechRate === 'number') {
          currentSpeechRate = changes.settings.newValue.speechRate;
        }
      }
    }
  });

  // -------------------------------------------------------------
  // 2. Quick Translate Logic (Word & Sentence Modes)
  // -------------------------------------------------------------

  /**
   * Syncs character count and button availability with input textarea.
   */
  function updateInputControls() {
    const text = quickInput.value;
    const trimmed = text.trim();
    charCount.textContent = `${text.length} / ${MAX_INPUT_CHARS}`;

    clearInputBtn.style.display = text.length > 0 ? 'inline-flex' : 'none';
    speakInputBtn.disabled = trimmed.length === 0;
  }

  quickInput.addEventListener('input', updateInputControls);

  // Trigger translation on Enter (Shift+Enter inserts new line)
  quickInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      executeQuickTranslate();
    }
  });

  // Clear input
  clearInputBtn.addEventListener('click', () => {
    quickInput.value = '';
    currentTranslatedText = '';
    updateInputControls();
    resultBox.style.display = 'none';
    if (popupOfflineBadge) popupOfflineBadge.style.display = 'none';
    updateBanglaSpeakButtonState();
    quickInput.focus();
  });

  // Translate button click
  translateBtn.addEventListener('click', () => {
    executeQuickTranslate();
  });

  /**
   * Sends text to background service worker for translation and renders the result
   * dynamically switching between Word and Sentence layouts.
   */
  async function executeQuickTranslate() {
    const text = quickInput.value.trim();
    if (!text) {
      quickInput.focus();
      return;
    }

    // Show loading state
    resultBox.style.display = 'block';
    if (popupOfflineBadge) popupOfflineBadge.style.display = 'none';
    if (resultTitle) resultTitle.textContent = 'Bangla Translation';

    // Show loading placeholder in word layout while waiting
    wordResultLayout.style.display = 'block';
    sentenceResultLayout.style.display = 'none';
    primaryResult.innerHTML = '<span class="loading-text">অনুবাদ করা হচ্ছে...</span>';
    dictMeanings.innerHTML = '';
    sentenceResultText.textContent = '';
    sentenceNotices.innerHTML = '';
    currentTranslatedText = '';
    updateBanglaSpeakButtonState();
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
            currentTranslatedText = data.primary || data.translation || '';
            const isSentence = data.mode === 'sentence';

            // Show or hide offline badge
            if (popupOfflineBadge) {
              popupOfflineBadge.style.display = data.source === 'offline' ? 'inline-flex' : 'none';
            }

            if (isSentence) {
              // ---------------- Sentence Mode Rendering ----------------
              if (resultTitle) resultTitle.textContent = 'Bangla Translation';
              wordResultLayout.style.display = 'none';
              sentenceResultLayout.style.display = 'flex';

              sentenceResultText.textContent = currentTranslatedText;

              // Sentence notices
              let noticesHtml = '';
              if (data.truncated) {
                noticesHtml += `<div class="popup-notice notice-warning">Showing first ${MAX_INPUT_CHARS} characters only.</div>`;
              }
              if (data.approximate) {
                noticesHtml += `<div class="popup-notice notice-info">Offline approximate (word-by-word) translation.</div>`;
              }
              sentenceNotices.innerHTML = noticesHtml;
            } else {
              // ---------------- Word Mode Rendering ----------------
              if (resultTitle) resultTitle.textContent = 'Bangla Meaning';
              wordResultLayout.style.display = 'block';
              sentenceResultLayout.style.display = 'none';

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
            }

            updateBanglaSpeakButtonState();
          } else {
            const errorMsg = response?.error || 'অনুবাদ সম্পন্ন করা যায়নি।';
            wordResultLayout.style.display = 'block';
            sentenceResultLayout.style.display = 'none';
            primaryResult.innerHTML = `<span style="color: #f87171; font-size: 13px;">${escapeHtml(errorMsg)}</span>`;
            dictMeanings.innerHTML = '';
            currentTranslatedText = '';
            updateBanglaSpeakButtonState();
            if (popupOfflineBadge) popupOfflineBadge.style.display = 'none';
          }
        }
      );
    } catch (err) {
      translateBtn.disabled = false;
      wordResultLayout.style.display = 'block';
      sentenceResultLayout.style.display = 'none';
      primaryResult.innerHTML = `<span style="color: #f87171; font-size: 13px;">অনুবাদ ত্রুটি: ${escapeHtml(err.message)}</span>`;
      currentTranslatedText = '';
      updateBanglaSpeakButtonState();
      if (popupOfflineBadge) popupOfflineBadge.style.display = 'none';
    }
  }

  // Copy result button in header
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

  // Copy button in sentence action bar
  if (copySentenceBtn) {
    copySentenceBtn.addEventListener('click', async () => {
      if (!currentTranslatedText) return;
      try {
        await navigator.clipboard.writeText(currentTranslatedText);
        const originalHTML = copySentenceBtn.innerHTML;
        copySentenceBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="icon-svg">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied!</span>
        `;
        setTimeout(() => {
          copySentenceBtn.innerHTML = originalHTML;
        }, 1500);
      } catch (err) {
        console.warn('Clipboard write error:', err);
      }
    });
  }

  // Speech pronunciation for English input
  speakInputBtn.addEventListener('click', () => {
    const text = quickInput.value.trim();
    if (text) {
      try {
        if (typeof speak === 'function') {
          speak(text, 'en-US', currentSpeechRate, speakInputBtn);
        }
      } catch (err) {
        console.warn('English speech error:', err);
      }
    }
  });

  // Speech pronunciation for Bangla translation result (Word mode)
  if (speakResultBtn) {
    speakResultBtn.addEventListener('click', () => {
      if (currentTranslatedText && banglaVoiceAvailable) {
        try {
          if (typeof speak === 'function') {
            speak(currentTranslatedText, 'bn-BD', currentSpeechRate, speakResultBtn);
          }
        } catch (err) {
          console.warn('Bangla speech error:', err);
        }
      }
    });
  }

  // Speech pronunciation for Bangla translation result (Sentence mode)
  if (speakSentenceBnBtn) {
    speakSentenceBnBtn.addEventListener('click', () => {
      if (currentTranslatedText && banglaVoiceAvailable) {
        try {
          if (typeof speak === 'function') {
            speak(currentTranslatedText, 'bn-BD', currentSpeechRate, speakSentenceBnBtn);
          }
        } catch (err) {
          console.warn('Bangla sentence speech error:', err);
        }
      }
    });
  }

  // -------------------------------------------------------------
  // 3. Recent Words History
  // -------------------------------------------------------------

  /**
   * Renders the recent translated words in the popup card.
   * Keeps the top 5 lookups.
   * @param {Array<Object>} list
   */
  function renderRecentWords(list) {
    if (!Array.isArray(list) || list.length === 0) {
      recentList.innerHTML = `
        <div class="empty-state">
          <span>এখনও কোনো সাম্প্রতিক শব্দ নেই</span>
          <small>যেকোনো ওয়েবপেজের শব্দ বা বাক্যে ডাবল-ক্লিক করুন</small>
        </div>
      `;
      clearRecentBtn.style.display = 'none';
      if (viewAllHistoryBtn) viewAllHistoryBtn.style.display = 'none';
      return;
    }

    clearRecentBtn.style.display = 'inline-block';
    if (viewAllHistoryBtn) viewAllHistoryBtn.style.display = 'inline-block';

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
        if (word) {
          try {
            if (typeof speak === 'function') {
              speak(word, 'en-US', currentSpeechRate, btn);
            }
          } catch (err) {
            console.warn('Recent word speak error:', err);
          }
        }
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
    const confirmed = window.confirm('Are you sure you want to clear your recent translation history?');
    if (!confirmed) return;

    try {
      await chrome.storage.local.set({ recentWords: [] });
      renderRecentWords([]);
    } catch (err) {
      console.error('Failed to clear recent words:', err);
    }
  });

  // -------------------------------------------------------------
  // 4. Utility
  // -------------------------------------------------------------

  /**
   * Sanitizes text to prevent HTML injection.
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
});
