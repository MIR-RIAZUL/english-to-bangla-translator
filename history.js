/**
 * History Page Controller
 * Manages rendering, live searching, filtering, sorting, single deletion,
 * bulk clearing, audio pronunciation, and CSV / JSON export of translated vocabulary.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const filterFieldSelect = document.getElementById('filterField');
  const sortBySelect = document.getElementById('sortBy');

  const statsSummary = document.getElementById('statsSummary');
  const retentionLimitNotice = document.getElementById('retentionLimitNotice');
  const historyListContainer = document.getElementById('historyListContainer');

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');

  // Internal State
  let rawHistory = [];
  let banglaVoiceAvailable = false;
  let currentSpeechRate = 0.95;
  let historyLimit = 200;

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
   * Formats a Unix timestamp into a human-readable localized date string.
   * @param {number} timestamp
   * @returns {string}
   */
  function formatTimestamp(timestamp) {
    if (!timestamp || isNaN(timestamp)) return '';
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      return '';
    }
  }

  /**
   * Normalizes a history entry to guarantee { word, translation, timestamp, count }.
   * @param {Object} item
   * @returns {{ word: string, translation: string, timestamp: number, count: number }}
   */
  function normalizeItem(item) {
    if (!item || typeof item !== 'object') {
      return { word: '', translation: '', timestamp: Date.now(), count: 1 };
    }
    return {
      word: typeof item.word === 'string' ? item.word : '',
      translation: typeof item.translation === 'string' ? item.translation : '',
      timestamp: typeof item.timestamp === 'number' && !isNaN(item.timestamp) ? item.timestamp : Date.now(),
      count: typeof item.count === 'number' && item.count > 0 ? item.count : 1
    };
  }

  /**
   * Filters and sorts the history list according to current UI selections.
   * @returns {Array<Object>}
   */
  function getFilteredAndSortedHistory() {
    const query = (searchInput?.value || '').trim().toLowerCase();
    const field = filterFieldSelect?.value || 'both';
    const sortBy = sortBySelect?.value || 'recent';

    let result = rawHistory.filter((item) => {
      if (!query) return true;

      const wordLower = (item.word || '').toLowerCase();
      const transLower = (item.translation || '').toLowerCase();

      if (field === 'en') {
        return wordLower.includes(query);
      }
      if (field === 'bn') {
        return transLower.includes(query);
      }
      return wordLower.includes(query) || transLower.includes(query);
    });

    result.sort((a, b) => {
      if (sortBy === 'most') {
        const diff = (b.count || 1) - (a.count || 1);
        if (diff !== 0) return diff;
        return (b.timestamp || 0) - (a.timestamp || 0);
      }
      if (sortBy === 'alpha') {
        return (a.word || '').localeCompare(b.word || '');
      }
      // Default: 'recent'
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    return result;
  }

  /**
   * Updates stats counters and retention limit notice.
   * @param {number} visibleCount
   * @param {number} totalCount
   */
  function updateStats(visibleCount, totalCount) {
    if (statsSummary) {
      if (totalCount === 0) {
        statsSummary.textContent = 'No translations in history yet';
      } else if (visibleCount === totalCount) {
        const totalLookups = rawHistory.reduce((acc, cur) => acc + (cur.count || 1), 0);
        statsSummary.textContent = `Showing all ${totalCount} words (${totalLookups} total lookups)`;
      } else {
        statsSummary.textContent = `Showing ${visibleCount} of ${totalCount} words`;
      }
    }

    if (retentionLimitNotice) {
      retentionLimitNotice.textContent = `Storage limit: ${historyLimit} words`;
    }

    const hasData = totalCount > 0;
    if (exportCsvBtn) exportCsvBtn.disabled = !hasData;
    if (exportJsonBtn) exportJsonBtn.disabled = !hasData;
    if (clearAllBtn) clearAllBtn.disabled = !hasData;
  }

  /**
   * Renders the current view of history items into the container.
   */
  function renderHistory() {
    if (!historyListContainer) return;

    const visibleItems = getFilteredAndSortedHistory();
    updateStats(visibleItems.length, rawHistory.length);

    if (rawHistory.length === 0) {
      historyListContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <div class="empty-title">Your vocabulary history is empty</div>
          <div class="empty-subtitle">Double-click or hover over words on web pages to automatically build your learning history.</div>
        </div>
      `;
      return;
    }

    if (visibleItems.length === 0) {
      historyListContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <div class="empty-title">No matching words found</div>
          <div class="empty-subtitle">Try adjusting your search query or changing the filter options above.</div>
        </div>
      `;
      return;
    }

    const bnBtnDisabled = !banglaVoiceAvailable;
    const bnBtnTitle = bnBtnDisabled
      ? 'No Bangla voice installed on this device.'
      : 'বাংলা উচ্চারণ শুনুন (Bangla)';
    const bnBtnAriaLabel = bnBtnDisabled
      ? 'No Bangla voice installed on this device.'
      : 'Pronounce Bangla translation';

    historyListContainer.innerHTML = visibleItems
      .map((item, index) => {
        const lookupCount = item.count || 1;
        const lookupLabel = lookupCount > 1 ? `${lookupCount} lookups` : '1 lookup';
        const formattedDate = formatTimestamp(item.timestamp);

        return `
          <article class="history-card" data-word="${escapeHtml(item.word)}">
            <div class="history-card-main">
              <div class="word-term-group">
                <span class="word-en">${escapeHtml(item.word)}</span>
                <button type="button" class="action-btn btn-speak-en" data-text="${escapeHtml(item.word)}" title="উচ্চারণ শুনুন (English)" aria-label="Pronounce English word">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </button>
                <span class="arrow-icon">➔</span>
                <span class="word-bn">${escapeHtml(item.translation)}</span>
                <button type="button" class="action-btn btn-speak-bn" data-text="${escapeHtml(item.translation)}" title="${escapeHtml(bnBtnTitle)}" aria-label="${escapeHtml(bnBtnAriaLabel)}" ${bnBtnDisabled ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                </button>
              </div>

              <div class="item-meta-group">
                <span class="count-badge" title="Total times looked up">${escapeHtml(lookupLabel)}</span>
                <span class="time-badge" title="Most recent lookup date">${escapeHtml(formattedDate)}</span>
              </div>
            </div>

            <div class="card-action-buttons">
              <button type="button" class="action-btn btn-copy" data-copy="${escapeHtml(item.translation)}" title="Copy Bangla translation">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <button type="button" class="action-btn action-btn-danger btn-delete" data-word="${escapeHtml(item.word)}" title="Delete item from history">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="svg-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </article>
        `;
      })
      .join('');

    // Attach English speak listeners
    const speakEnBtns = historyListContainer.querySelectorAll('.btn-speak-en');
    speakEnBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-text');
        if (text && typeof speak === 'function') {
          speak(text, 'en-US', currentSpeechRate, btn);
        }
      });
    });

    // Attach Bangla speak listeners
    const speakBnBtns = historyListContainer.querySelectorAll('.btn-speak-bn');
    speakBnBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-text');
        if (text && banglaVoiceAvailable && typeof speak === 'function') {
          speak(text, 'bn-BD', currentSpeechRate, btn);
        }
      });
    });

    // Attach Copy listeners
    const copyBtns = historyListContainer.querySelectorAll('.btn-copy');
    copyBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const text = btn.getAttribute('data-copy');
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="svg-icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            `;
            setTimeout(() => {
              btn.innerHTML = originalHTML;
            }, 1200);
          } catch (err) {
            console.warn('Clipboard copy failed:', err);
          }
        }
      });
    });

    // Attach Delete listeners
    const deleteBtns = historyListContainer.querySelectorAll('.btn-delete');
    deleteBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const word = btn.getAttribute('data-word');
        if (word) {
          await deleteHistoryItem(word);
        }
      });
    });
  }

  /**
   * Deletes a single item from history by word match and persists changes.
   * @param {string} word
   */
  async function deleteHistoryItem(word) {
    try {
      const wordLower = word.toLowerCase();
      rawHistory = rawHistory.filter((item) => (item.word || '').toLowerCase() !== wordLower);
      await chrome.storage.local.set({ recentWords: rawHistory });
      renderHistory();
    } catch (err) {
      console.error('Failed to delete history item:', err);
    }
  }

  /**
   * Clears all items from translation history after user confirmation.
   */
  async function clearAllHistory() {
    if (rawHistory.length === 0) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete all translation history? This action cannot be undone.'
    );
    if (!confirmed) return;

    try {
      rawHistory = [];
      await chrome.storage.local.set({ recentWords: [] });
      renderHistory();
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  }

  /**
   * Exports history records to a downloadable CSV spreadsheet file with UTF-8 BOM.
   */
  function exportCSV() {
    if (rawHistory.length === 0) return;

    try {
      const header = ['Word', 'Translation', 'Lookup Count', 'Timestamp', 'Date'];
      const rows = rawHistory.map((item) => {
        const dateStr = item.timestamp ? new Date(item.timestamp).toISOString() : '';
        const wordClean = String(item.word || '').replace(/"/g, '""');
        const transClean = String(item.translation || '').replace(/"/g, '""');
        return `"${wordClean}","${transClean}",${item.count || 1},${item.timestamp || ''},"${dateStr}"`;
      });

      // Prepend UTF-8 BOM so Excel and spreadsheet tools display Bengali characters properly
      const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translation-history-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  }

  /**
   * Exports history records to a downloadable JSON file.
   */
  function exportJSON() {
    if (rawHistory.length === 0) return;

    try {
      const exportData = rawHistory.map((item) => ({
        word: item.word,
        translation: item.translation,
        count: item.count || 1,
        timestamp: item.timestamp,
        date: item.timestamp ? new Date(item.timestamp).toISOString() : ''
      }));

      const jsonContent = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translation-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export JSON:', err);
    }
  }

  /**
   * Loads initial settings and history records from storage.
   */
  async function initialize() {
    try {
      // 1. Load settings (speechRate, historyLimit)
      if (typeof getSettings === 'function') {
        const settings = await getSettings();
        if (typeof settings.speechRate === 'number') {
          currentSpeechRate = settings.speechRate;
        }
        if (typeof settings.historyLimit === 'number') {
          historyLimit = settings.historyLimit;
        }
      }

      // 2. Check Bangla voice availability
      if (typeof findBanglaVoice === 'function') {
        const voice = await findBanglaVoice();
        banglaVoiceAvailable = !!voice;
      }

      // 3. Load history records
      const data = await chrome.storage.local.get('recentWords');
      const list = Array.isArray(data.recentWords) ? data.recentWords : [];
      rawHistory = list.map(normalizeItem);

      renderHistory();
    } catch (err) {
      console.error('Initialization error in history page:', err);
      rawHistory = [];
      renderHistory();
    }
  }

  // -------------------------------------------------------------
  // Event Listeners
  // -------------------------------------------------------------

  // Live search
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const hasText = searchInput.value.length > 0;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = hasText ? 'inline-flex' : 'none';
      }
      renderHistory();
    });
  }

  // Clear search
  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      searchInput.focus();
      renderHistory();
    });
  }

  // Filter change
  if (filterFieldSelect) {
    filterFieldSelect.addEventListener('change', renderHistory);
  }

  // Sort change
  if (sortBySelect) {
    sortBySelect.addEventListener('change', renderHistory);
  }

  // Actions
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportCSV);
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', exportJSON);
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', clearAllHistory);
  }

  // Real-time synchronization if history or settings change
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.recentWords !== undefined) {
        const list = Array.isArray(changes.recentWords.newValue) ? changes.recentWords.newValue : [];
        rawHistory = list.map(normalizeItem);
        renderHistory();
      }
      if (changes.settings !== undefined && changes.settings.newValue) {
        if (typeof changes.settings.newValue.speechRate === 'number') {
          currentSpeechRate = changes.settings.newValue.speechRate;
        }
        if (typeof changes.settings.newValue.historyLimit === 'number') {
          historyLimit = changes.settings.newValue.historyLimit;
        }
      }
    }
  });

  // Run initial setup
  await initialize();
});

