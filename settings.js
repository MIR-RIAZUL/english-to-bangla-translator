/**
 * Shared Settings Module
 * Defines default settings and handles fetching (merging with defaults)
 * and partial saving into chrome.storage.local.
 */

const DEFAULT_SETTINGS = Object.freeze({
  triggerMode: 'dblclick',
  hoverDelay: 600,
  modifierKey: 'none',
  speechRate: 0.95,
  apiKey: '',
  providerOrder: ['official', 'gtx', 'mymemory', 'offline'],
  historyLimit: 200,
  highlightColor: '#fde68a',
  theme: 'dark',
  offlineEnabled: true,
  sentenceEnabled: true,
  maxChars: 3000,
  showOriginal: false,
  floatingButton: true,
  saveSentences: false
});

/**
 * Retrieves the stored settings merged with defaults.
 * @returns {Promise<Object>} Full settings object.
 */
async function getSettings() {
  try {
    const result = await chrome.storage.local.get('settings');
    const stored = result && typeof result.settings === 'object' && result.settings !== null
      ? result.settings
      : {};

    const validProviders = ['official', 'gtx', 'mymemory', 'offline'];
    let providerOrder = Array.isArray(stored.providerOrder) && stored.providerOrder.length > 0
      ? stored.providerOrder.filter((p) => validProviders.includes(p))
      : [];

    DEFAULT_SETTINGS.providerOrder.forEach((provider) => {
      if (!providerOrder.includes(provider)) {
        providerOrder.push(provider);
      }
    });

    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      providerOrder: providerOrder
    };
  } catch (error) {
    console.error('Failed to get settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Saves partial settings into chrome.storage.local after merging with current settings.
 * @param {Object} partialSettings - Key-value pairs to update.
 * @returns {Promise<Object>} Updated full settings object.
 */
async function saveSettings(partialSettings) {
  try {
    const current = await getSettings();
    const updated = {
      ...current,
      ...(partialSettings || {})
    };
    await chrome.storage.local.set({ settings: updated });
    return updated;
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

// Expose on global scope for ServiceWorker, Window, and script inclusion contexts
if (typeof globalThis !== 'undefined') {
  globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  globalThis.getSettings = getSettings;
  globalThis.saveSettings = saveSettings;
}
