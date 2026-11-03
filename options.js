/**
 * Options Page Controller
 * Manages reading, displaying, modifying, testing API credentials,
 * configuring keyboard shortcuts, sentence translation preferences,
 * and resetting extension settings.
 * Fully compatible with both Google Chrome and Microsoft Edge.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Settings Inputs (Section 1: Trigger & Interaction)
  const triggerModeSelect = document.getElementById('triggerMode');
  const hoverDelayInput = document.getElementById('hoverDelay');
  const hoverDelayValue = document.getElementById('hoverDelayValue');
  const hoverDelayRow = document.getElementById('hoverDelayRow');
  const modifierKeySelect = document.getElementById('modifierKey');
  const sentenceEnabledCheckbox = document.getElementById('sentenceEnabled');
  const floatingButtonCheckbox = document.getElementById('floatingButton');
  const openShortcutsBtn = document.getElementById('openShortcutsBtn');

  // DOM Elements - Settings Inputs (Section 2: Providers & API)
  const providerOrderList = document.getElementById('providerOrderList');
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKeyVisibility');
  const testApiKeyBtn = document.getElementById('testApiKeyBtn');
  const apiKeyTestResult = document.getElementById('apiKeyTestResult');
  const offlineEnabledCheckbox = document.getElementById('offlineEnabled');

  // DOM Elements - Settings Inputs (Section 3: Audio & Pronunciation)
  const speechRateInput = document.getElementById('speechRate');
  const speechRateValue = document.getElementById('speechRateValue');
  const testSpeechBtn = document.getElementById('testSpeechBtn');

  // DOM Elements - Settings Inputs (Section 4: Appearance & Highlighting)
  const themeSelect = document.getElementById('theme');
  const highlightColorInput = document.getElementById('highlightColor');
  const highlightColorValue = document.getElementById('highlightColorValue');
  const showOriginalCheckbox = document.getElementById('showOriginal');

  // DOM Elements - Settings Inputs (Section 5: History & Storage)
  const historyLimitInput = document.getElementById('historyLimit');
  const maxCharsInput = document.getElementById('maxChars');
  const saveSentencesCheckbox = document.getElementById('saveSentences');
  const resetBtn = document.getElementById('resetBtn');

  // Status feedback elements
  const saveStatus = document.getElementById('saveStatus');
  const saveStatusText = document.getElementById('saveStatusText');

  let currentSettings = { ...DEFAULT_SETTINGS };
  let saveTimeout = null;

  const PROVIDER_METADATA = {
    official: { name: 'Official Google Translate', desc: 'Google Cloud Translation API v2 Basic (Requires API key)' },
    gtx: { name: 'Google GTX Endpoint', desc: 'Direct web translation engine with full dictionary breakdowns' },
    mymemory: { name: 'MyMemory API', desc: 'Public translation memory with alternative suggestions' },
    offline: { name: 'Offline Dictionary', desc: 'Fast local dictionary lookup when network is unavailable' }
  };

  /**
   * Escape HTML utility to prevent XSS injection.
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

  /**
   * Updates visibility of the hover delay slider based on the active trigger mode.
   * @param {string} mode
   */
  function updateHoverDelayVisibility(mode) {
    if (!hoverDelayRow) return;
    const isHoverActive = mode === 'hover' || mode === 'both';
    hoverDelayRow.style.opacity = isHoverActive ? '1' : '0.45';
    hoverDelayRow.style.pointerEvents = isHoverActive ? 'auto' : 'none';
  }

  /**
   * Displays an animated save confirmation badge in the header.
   * @param {string} [message='Settings saved']
   */
  function showSaveConfirmation(message = 'Settings saved') {
    if (!saveStatus || !saveStatusText) return;

    saveStatusText.textContent = message;
    saveStatus.style.opacity = '1';
    saveStatus.style.transform = 'translateY(0)';

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      saveStatus.style.opacity = '0';
      saveStatus.style.transform = 'translateY(-4px)';
    }, 1800);
  }

  /**
   * Renders the provider priority order list with Move Up / Move Down buttons.
   * @param {string[]} order
   */
  function renderProviderOrder(order) {
    if (!providerOrderList) return;

    providerOrderList.innerHTML = '';
    order.forEach((providerKey, index) => {
      const meta = PROVIDER_METADATA[providerKey] || { name: providerKey, desc: '' };
      const row = document.createElement('div');
      row.className = 'provider-row';

      const isFirst = index === 0;
      const isLast = index === order.length - 1;

      row.innerHTML = `
        <div class="provider-left">
          <span class="provider-rank">${index + 1}</span>
          <div>
            <span class="provider-name">${escapeHtml(meta.name)}</span>
            <span class="provider-desc">${escapeHtml(meta.desc)}</span>
          </div>
        </div>
        <div class="provider-actions">
          <button type="button" class="btn-move btn-move-up" data-index="${index}" title="Move Up" ${isFirst ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button type="button" class="btn-move btn-move-down" data-index="${index}" title="Move Down" ${isLast ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      `;

      providerOrderList.appendChild(row);
    });

    const upButtons = providerOrderList.querySelectorAll('.btn-move-up');
    const downButtons = providerOrderList.querySelectorAll('.btn-move-down');

    upButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (idx > 0) {
          await moveProvider(idx, -1);
        }
      });
    });

    downButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (idx < currentSettings.providerOrder.length - 1) {
          await moveProvider(idx, 1);
        }
      });
    });
  }

  /**
   * Reorders a provider in providerOrder and persists the update.
   * @param {number} index - Current position.
   * @param {number} direction - -1 for up, +1 for down.
   */
  async function moveProvider(index, direction) {
    try {
      const order = [...currentSettings.providerOrder];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= order.length) return;

      const temp = order[index];
      order[index] = order[targetIndex];
      order[targetIndex] = temp;

      currentSettings.providerOrder = order;
      renderProviderOrder(order);
      await saveSettings({ providerOrder: order });
      showSaveConfirmation();
    } catch (err) {
      console.error('Failed to update provider order:', err);
    }
  }

  /**
   * Updates UI form inputs to reflect the provided settings object.
   * @param {Object} settings
   */
  function populateForm(settings) {
    currentSettings = { ...settings };

    // Section 1: Trigger & Interaction
    if (triggerModeSelect) {
      triggerModeSelect.value = settings.triggerMode || 'dblclick';
      updateHoverDelayVisibility(settings.triggerMode || 'dblclick');
    }

    if (hoverDelayInput && hoverDelayValue) {
      hoverDelayInput.value = settings.hoverDelay || 600;
      hoverDelayValue.textContent = `${settings.hoverDelay || 600} ms`;
    }

    if (modifierKeySelect) {
      modifierKeySelect.value = settings.modifierKey || 'none';
    }

    if (sentenceEnabledCheckbox) {
      sentenceEnabledCheckbox.checked = settings.sentenceEnabled !== false;
    }

    if (floatingButtonCheckbox) {
      floatingButtonCheckbox.checked = settings.floatingButton !== false;
    }

    // Section 2: Providers & Priority
    renderProviderOrder(settings.providerOrder || DEFAULT_SETTINGS.providerOrder);

    if (apiKeyInput) {
      apiKeyInput.value = settings.apiKey || '';
    }

    if (offlineEnabledCheckbox) {
      offlineEnabledCheckbox.checked = settings.offlineEnabled !== false;
    }

    // Section 3: Audio & Pronunciation
    if (speechRateInput && speechRateValue) {
      speechRateInput.value = settings.speechRate || 0.95;
      speechRateValue.textContent = `${parseFloat(settings.speechRate || 0.95).toFixed(2)}x`;
    }

    // Section 4: Appearance & Highlighting
    if (themeSelect) {
      themeSelect.value = settings.theme || 'dark';
    }

    if (highlightColorInput && highlightColorValue) {
      highlightColorInput.value = settings.highlightColor || '#fde68a';
      highlightColorValue.textContent = settings.highlightColor || '#fde68a';
    }

    if (showOriginalCheckbox) {
      showOriginalCheckbox.checked = !!settings.showOriginal;
    }

    // Section 5: History & Storage
    if (historyLimitInput) {
      historyLimitInput.value = settings.historyLimit || 200;
    }

    if (maxCharsInput) {
      maxCharsInput.value = settings.maxChars || 3000;
    }

    if (saveSentencesCheckbox) {
      saveSentencesCheckbox.checked = !!settings.saveSentences;
    }
  }

  /**
   * Tests the entered API key against the background service worker.
   */
  function testApiKey() {
    if (!apiKeyInput || !testApiKeyBtn || !apiKeyTestResult) return;

    const key = apiKeyInput.value.trim();
    if (!key) {
      apiKeyTestResult.className = 'api-key-feedback error';
      apiKeyTestResult.textContent = 'অনুগ্রহ করে প্রথমে একটি এপিআই কী লিখুন (Please enter an API key first)';
      apiKeyTestResult.style.display = 'block';
      return;
    }

    testApiKeyBtn.disabled = true;
    testApiKeyBtn.textContent = 'Testing...';
    apiKeyTestResult.className = 'api-key-feedback loading';
    apiKeyTestResult.textContent = 'এপিআই কী যাচাই করা হচ্ছে (Verifying API key...)...';
    apiKeyTestResult.style.display = 'block';

    try {
      chrome.runtime.sendMessage(
        {
          action: 'TEST_API_KEY',
          apiKey: key
        },
        (response) => {
          testApiKeyBtn.disabled = false;
          testApiKeyBtn.textContent = 'Test Key';

          if (response && response.success) {
            apiKeyTestResult.className = 'api-key-feedback success';
            apiKeyTestResult.textContent = `✓ বৈধ এপিআই কী! পরীক্ষা সফল: "hello" ➔ "${escapeHtml(response.translated)}" (Valid API key)`;
          } else {
            const err = response?.error || 'যাচাই ব্যর্থ হয়েছে (Verification failed)';
            apiKeyTestResult.className = 'api-key-feedback error';
            apiKeyTestResult.textContent = `✗ ত্রুটি: ${escapeHtml(err)}`;
          }
        }
      );
    } catch (err) {
      testApiKeyBtn.disabled = false;
      testApiKeyBtn.textContent = 'Test Key';
      apiKeyTestResult.className = 'api-key-feedback error';
      apiKeyTestResult.textContent = `✗ ত্রুটি: ${escapeHtml(err.message)}`;
    }
  }

  /**
   * Initializes settings on page load.
   */
  async function initialize() {
    try {
      const loaded = await getSettings();
      populateForm(loaded);
    } catch (err) {
      console.error('Failed to load settings in options page:', err);
      populateForm(DEFAULT_SETTINGS);
    }
  }

  // -------------------------------------------------------------
  // Input Event Listeners (Save on Change)
  // -------------------------------------------------------------

  // Trigger Mode
  if (triggerModeSelect) {
    triggerModeSelect.addEventListener('change', async () => {
      try {
        const val = triggerModeSelect.value;
        currentSettings.triggerMode = val;
        updateHoverDelayVisibility(val);
        await saveSettings({ triggerMode: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Hover Delay
  if (hoverDelayInput && hoverDelayValue) {
    hoverDelayInput.addEventListener('input', () => {
      hoverDelayValue.textContent = `${hoverDelayInput.value} ms`;
    });

    hoverDelayInput.addEventListener('change', async () => {
      try {
        const val = parseInt(hoverDelayInput.value, 10) || 600;
        currentSettings.hoverDelay = val;
        await saveSettings({ hoverDelay: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Modifier Key
  if (modifierKeySelect) {
    modifierKeySelect.addEventListener('change', async () => {
      try {
        const val = modifierKeySelect.value;
        currentSettings.modifierKey = val;
        await saveSettings({ modifierKey: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Sentence Translation Toggle
  if (sentenceEnabledCheckbox) {
    sentenceEnabledCheckbox.addEventListener('change', async () => {
      try {
        const val = sentenceEnabledCheckbox.checked;
        currentSettings.sentenceEnabled = val;
        await saveSettings({ sentenceEnabled: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Floating Button Toggle
  if (floatingButtonCheckbox) {
    floatingButtonCheckbox.addEventListener('change', async () => {
      try {
        const val = floatingButtonCheckbox.checked;
        currentSettings.floatingButton = val;
        await saveSettings({ floatingButton: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Open Shortcuts Configuration (Chrome & Edge dual-support)
  if (openShortcutsBtn) {
    openShortcutsBtn.addEventListener('click', () => {
      try {
        const isEdge = typeof navigator !== 'undefined' && /Edg\//i.test(navigator.userAgent);
        const shortcutsUrl = isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
        chrome.tabs.create({ url: shortcutsUrl }, () => {
          if (chrome.runtime.lastError) {
            const fallbackUrl = isEdge ? 'edge://extensions' : 'chrome://extensions';
            chrome.tabs.create({ url: fallbackUrl });
          }
        });
      } catch (err) {
        console.error('Failed to open shortcuts settings:', err);
      }
    });
  }

  // API Key
  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', async () => {
      try {
        const val = apiKeyInput.value.trim();
        currentSettings.apiKey = val;
        await saveSettings({ apiKey: val });
        showSaveConfirmation();
        if (apiKeyTestResult) {
          apiKeyTestResult.style.display = 'none';
        }
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Test API Key Button
  if (testApiKeyBtn) {
    testApiKeyBtn.addEventListener('click', testApiKey);
  }

  // Toggle API Key Masking
  if (toggleApiKeyBtn && apiKeyInput) {
    toggleApiKeyBtn.addEventListener('click', () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
    });
  }

  // Offline Mode Toggle
  if (offlineEnabledCheckbox) {
    offlineEnabledCheckbox.addEventListener('change', async () => {
      try {
        const val = offlineEnabledCheckbox.checked;
        currentSettings.offlineEnabled = val;
        await saveSettings({ offlineEnabled: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Speech Rate
  if (speechRateInput && speechRateValue) {
    speechRateInput.addEventListener('input', () => {
      speechRateValue.textContent = `${parseFloat(speechRateInput.value).toFixed(2)}x`;
    });

    speechRateInput.addEventListener('change', async () => {
      try {
        const val = parseFloat(speechRateInput.value) || 0.95;
        currentSettings.speechRate = val;
        await saveSettings({ speechRate: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Test Speech Button
  if (testSpeechBtn) {
    testSpeechBtn.addEventListener('click', () => {
      try {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance('Translation test pronunciation');
        utterance.lang = 'en-US';
        utterance.rate = parseFloat(currentSettings.speechRate || 0.95);
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.error('Speech test failed:', err);
      }
    });
  }

  // Theme
  if (themeSelect) {
    themeSelect.addEventListener('change', async () => {
      try {
        const val = themeSelect.value;
        currentSettings.theme = val;
        await saveSettings({ theme: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Highlight Color
  if (highlightColorInput && highlightColorValue) {
    highlightColorInput.addEventListener('input', () => {
      highlightColorValue.textContent = highlightColorInput.value;
    });

    highlightColorInput.addEventListener('change', async () => {
      try {
        const val = highlightColorInput.value;
        currentSettings.highlightColor = val;
        await saveSettings({ highlightColor: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Show Original Expanded Toggle
  if (showOriginalCheckbox) {
    showOriginalCheckbox.addEventListener('change', async () => {
      try {
        const val = showOriginalCheckbox.checked;
        currentSettings.showOriginal = val;
        await saveSettings({ showOriginal: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // History Limit
  if (historyLimitInput) {
    historyLimitInput.addEventListener('change', async () => {
      try {
        let val = parseInt(historyLimitInput.value, 10);
        if (isNaN(val) || val < 10) val = 10;
        if (val > 1000) val = 1000;
        historyLimitInput.value = val;
        currentSettings.historyLimit = val;
        await saveSettings({ historyLimit: val });

        // Enforce limit on current stored recentWords
        const { recentWords = [] } = await chrome.storage.local.get('recentWords');
        if (Array.isArray(recentWords) && recentWords.length > val) {
          await chrome.storage.local.set({ recentWords: recentWords.slice(0, val) });
        }

        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Max Characters Per Request
  if (maxCharsInput) {
    maxCharsInput.addEventListener('change', async () => {
      try {
        let val = parseInt(maxCharsInput.value, 10);
        if (isNaN(val) || val < 500) val = 500;
        if (val > 10000) val = 10000;
        maxCharsInput.value = val;
        currentSettings.maxChars = val;
        await saveSettings({ maxChars: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Save Sentences Toggle
  if (saveSentencesCheckbox) {
    saveSentencesCheckbox.addEventListener('change', async () => {
      try {
        const val = saveSentencesCheckbox.checked;
        currentSettings.saveSentences = val;
        await saveSettings({ saveSentences: val });
        showSaveConfirmation();
      } catch (err) {
        console.error('Save error:', err);
      }
    });
  }

  // Reset to Defaults
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        await saveSettings(DEFAULT_SETTINGS);
        populateForm(DEFAULT_SETTINGS);
        if (apiKeyTestResult) {
          apiKeyTestResult.style.display = 'none';
        }
        showSaveConfirmation('Defaults restored');
      } catch (err) {
        console.error('Reset error:', err);
      }
    });
  }

  // Initialize
  await initialize();
});
