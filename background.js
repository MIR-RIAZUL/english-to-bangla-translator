/**
 * Background Service Worker
 * Handles translation API calls (bypassing webpage CORS/CSP restrictions),
 * in-memory and persistent caching, lemmatization, offline dictionary fallbacks,
 * official Google Cloud Translation API v2 integration, keyboard shortcuts (commands),
 * and persistence of recent lookups with lookup counts and timestamps.
 */

try {
  importScripts('settings.js', 'lemmatize.js');
} catch (e) {
  console.warn('Failed to load dependency scripts in Service Worker:', e);
}

// In-memory cache for fast repeated lookups (LRU-like cap)
const translationCache = new Map();
const MAX_CACHE_ENTRIES = 300;

// Cached offline dictionary in memory
let offlineDict = null;

/**
 * Retrieve cached translation if present in memory.
 * @param {string} text
 * @returns {object|null}
 */
function getCachedTranslation(text) {
  const key = text.trim().toLowerCase();
  return translationCache.get(key) || null;
}

/**
 * Store translation in the in-memory cache.
 * @param {string} text
 * @param {object} data
 */
function setCachedTranslation(text, data) {
  const key = text.trim().toLowerCase();
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
  translationCache.set(key, data);
}

/**
 * Retrieves cached translation from persistent storage (chrome.storage.local key 'tcache').
 * @param {string} text
 * @returns {Promise<object|null>}
 */
async function getPersistentCachedTranslation(text) {
  try {
    const key = text.trim().toLowerCase();
    const { tcache = {} } = await chrome.storage.local.get('tcache');
    if (tcache && tcache[key] && tcache[key].data) {
      return tcache[key].data;
    }
    return null;
  } catch (err) {
    console.warn('Persistent cache read error:', err);
    return null;
  }
}

/**
 * Saves translation into persistent storage cache (chrome.storage.local key 'tcache').
 * Enforces maximum 1,000 entries by evicting oldest records.
 * @param {string} text
 * @param {object} data
 * @returns {Promise<void>}
 */
async function setPersistentCachedTranslation(text, data) {
  try {
    const key = text.trim().toLowerCase();
    const { tcache = {} } = await chrome.storage.local.get('tcache');

    const keys = Object.keys(tcache);
    if (keys.length >= 1000) {
      // Find oldest entry by timestamp and delete
      let oldestKey = keys[0];
      let oldestTime = tcache[oldestKey]?.timestamp || 0;
      for (let i = 1; i < keys.length; i++) {
        const k = keys[i];
        const t = tcache[k]?.timestamp || 0;
        if (t < oldestTime) {
          oldestTime = t;
          oldestKey = k;
        }
      }
      delete tcache[oldestKey];
    }

    tcache[key] = {
      timestamp: Date.now(),
      data: data
    };

    await chrome.storage.local.set({ tcache });
  } catch (err) {
    console.warn('Persistent cache write error:', err);
  }
}

/**
 * Loads bundled starter dictionary from data/dictionary.json
 * @returns {Promise<object>}
 */
async function loadOfflineDictionary() {
  if (offlineDict) return offlineDict;
  try {
    const response = await fetch(chrome.runtime.getURL('data/dictionary.json'));
    if (!response.ok) {
      throw new Error(`Failed to load dictionary: HTTP ${response.status}`);
    }
    offlineDict = await response.json();
    return offlineDict;
  } catch (error) {
    console.warn('Could not load offline dictionary:', error);
    return {};
  }
}

/**
 * Fetch wrapper with exponential backoff for HTTP 429 and 5xx errors.
 * Max 2 retries (total 3 attempts).
 * @param {string} url
 * @param {RequestInit} [options={}]
 * @param {number} [retries=2]
 * @param {number} [delay=600]
 * @returns {Promise<Response>}
 */
async function fetchWithBackoff(url, options = {}, retries = 2, delay = 600) {
  try {
    const response = await fetch(url, options);
    if ((response.status === 429 || (response.status >= 500 && response.status < 600)) && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithBackoff(url, options, retries - 1, delay * 2);
    }
    return response;
  } catch (networkErr) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithBackoff(url, options, retries - 1, delay * 2);
    }
    throw networkErr;
  }
}

/**
 * Provider 1: Official Google Cloud Translation API v2 Basic
 * Endpoint: https://translation.googleapis.com/language/translate/v2
 * @param {string} text
 * @param {string} apiKey
 * @returns {Promise<object>} Unified result object.
 */
async function translateOfficial(text, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Official Google Translation requires an API key.');
  }

  const endpoint = new URL('https://translation.googleapis.com/language/translate/v2');
  endpoint.searchParams.set('key', apiKey.trim());
  endpoint.searchParams.set('q', text);
  endpoint.searchParams.set('source', 'en');
  endpoint.searchParams.set('target', 'bn');
  endpoint.searchParams.set('format', 'text');

  const response = await fetchWithBackoff(endpoint.toString(), { method: 'POST' });

  if (!response.ok) {
    if (response.status === 400 || response.status === 403) {
      throw new Error('অবৈধ এপিআই কী। অনুগ্রহ করে আপনার এপিআই কী যাচাই করুন (Invalid Google API Key: HTTP ' + response.status + ')');
    }
    if (response.status === 429) {
      throw new Error('এপিআই কোটা শেষ বা রেট লিমিট অতিক্রম করেছে (Google Cloud Translation quota exceeded: HTTP 429)');
    }
    throw new Error(`Google Cloud Translation error: HTTP ${response.status}`);
  }

  const json = await response.json();
  const translations = json?.data?.translations;
  if (!Array.isArray(translations) || translations.length === 0 || !translations[0].translatedText) {
    throw new Error('Google Cloud Translation returned empty response.');
  }

  const primary = translations[0].translatedText.trim();
  return {
    originalText: text,
    primary: primary,
    dictionary: [],
    sourceLang: 'en',
    provider: 'official',
    source: 'online'
  };
}

/**
 * Provider 2: Google GTX Web Translation Endpoint
 * Comprehensive parts-of-speech & definitions
 * @param {string} text
 * @returns {Promise<object>} Unified result object.
 */
async function translateGTX(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=bn&dt=t&dt=bd&q=${encodeURIComponent(text)}`;
  const response = await fetchWithBackoff(url);

  if (!response.ok) {
    throw new Error(`Google GTX error: HTTP ${response.status}`);
  }

  const data = await response.json();
  let primaryBangla = '';

  if (Array.isArray(data[0])) {
    primaryBangla = data[0]
      .map((segment) => (segment && segment[0] ? segment[0] : ''))
      .join('')
      .trim();
  }

  if (!primaryBangla) {
    throw new Error('Google GTX returned empty translation');
  }

  const dictionaryMeanings = [];
  if (Array.isArray(data[1])) {
    for (const entry of data[1]) {
      const partOfSpeech = entry[0] || 'meaning';
      const terms = Array.isArray(entry[1]) ? entry[1] : [];
      if (terms.length > 0) {
        dictionaryMeanings.push({
          pos: partOfSpeech,
          terms: terms
        });
      }
    }
  }

  return {
    originalText: text,
    primary: primaryBangla,
    dictionary: dictionaryMeanings,
    sourceLang: 'en',
    provider: 'gtx',
    source: 'online'
  };
}

/**
 * Provider 3: Offline Dictionary with Lemmatization
 * Resolves candidate roots via lemmatize.js and looks up definitions in data/dictionary.json
 * @param {string} text
 * @returns {Promise<object>} Unified result object.
 */
async function translateOffline(text) {
  const dict = await loadOfflineDictionary();
  const lower = text.trim().toLowerCase();

  const candidates = typeof lemmatize === 'function' ? lemmatize(lower) : [lower];

  for (const candidate of candidates) {
    if (dict[candidate]) {
      const entry = dict[candidate];
      const bnMeanings = Array.isArray(entry.bn) ? entry.bn : [];
      const primary = bnMeanings[0] || '';
      if (!primary) continue;

      const dictionaryMeanings = [];
      const poses = Array.isArray(entry.pos) ? entry.pos : ['meaning'];
      poses.forEach((p) => {
        dictionaryMeanings.push({
          pos: p,
          terms: bnMeanings
        });
      });

      return {
        originalText: text,
        primary: primary,
        dictionary: dictionaryMeanings,
        sourceLang: 'en',
        provider: 'offline',
        source: 'offline'
      };
    }
  }

  throw new Error(`"${text}" শব্দটি অফলাইন ডিকশনারিতে পাওয়া যায়নি (Word not in offline dictionary)`);
}

/**
 * Provider 4: MyMemory Translation API Fallback
 * @param {string} text
 * @returns {Promise<object>} Unified result object.
 */
async function translateMyMemory(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|bn`;
  const response = await fetchWithBackoff(url);

  if (!response.ok) {
    throw new Error(`MyMemory error: HTTP ${response.status}`);
  }

  const data = await response.json();
  const primary = data?.responseData?.translatedText?.trim();

  if (!primary) {
    throw new Error('MyMemory returned empty translation');
  }

  // Extract alternative translations if available
  const alternatives = [];
  if (Array.isArray(data.matches)) {
    const rawTerms = data.matches
      .map((m) => (m && m.translation ? m.translation.trim() : ''))
      .filter((t) => t && t.toLowerCase() !== primary.toLowerCase());

    const terms = [...new Set(rawTerms)].slice(0, 4);
    if (terms.length > 0) {
      alternatives.push({
        pos: 'alternate',
        terms: terms
      });
    }
  }

  return {
    originalText: text,
    primary: primary,
    dictionary: alternatives,
    sourceLang: 'en',
    provider: 'mymemory',
    source: 'online'
  };
}

/**
 * Normalizes and migrates a history record to { word, translation, timestamp, count }.
 * @param {Object} item - Raw history entry.
 * @returns {{ word: string, translation: string, timestamp: number, count: number }}
 */
function normalizeHistoryItem(item) {
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
 * Persist translated word to recent words history in chrome.storage.local.
 * Maintains { word, translation, timestamp, count } structure.
 * Increments count and updates timestamp if existing; trims to settings.historyLimit.
 * @param {string} word
 * @param {string} translation
 */
async function saveRecentWord(word, translation) {
  try {
    const trimmedWord = word.trim();
    const trimmedTranslation = translation.trim();
    if (!trimmedWord || !trimmedTranslation) return;

    // Only record single words or short phrases up to 3 words
    const wordCount = trimmedWord.split(/\s+/).length;
    if (wordCount > 3 || trimmedWord.length > 40) return;

    const data = await chrome.storage.local.get(['recentWords', 'settings']);
    const rawList = Array.isArray(data.recentWords) ? data.recentWords : [];
    const settings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
    const historyLimit = typeof settings.historyLimit === 'number' && settings.historyLimit >= 10
      ? settings.historyLimit
      : 200;

    // Migrate any legacy items to ensure uniform shape
    const history = rawList.map(normalizeHistoryItem);

    const wordLower = trimmedWord.toLowerCase();
    const existingIndex = history.findIndex((item) => item.word.toLowerCase() === wordLower);

    let updatedEntry;
    if (existingIndex !== -1) {
      const existing = history[existingIndex];
      updatedEntry = {
        word: trimmedWord,
        translation: trimmedTranslation,
        timestamp: Date.now(),
        count: (existing.count || 1) + 1
      };
      history.splice(existingIndex, 1);
    } else {
      updatedEntry = {
        word: trimmedWord,
        translation: trimmedTranslation,
        timestamp: Date.now(),
        count: 1
      };
    }

    history.unshift(updatedEntry);

    const trimmedHistory = history.slice(0, historyLimit);
    await chrome.storage.local.set({ recentWords: trimmedHistory });
  } catch (error) {
    console.error('Failed to save recent word:', error);
  }
}

/**
 * Unified Translation Handler executing according to providerOrder:
 * 1. Memory cache
 * 2. Persistent storage cache ('tcache', max 1000)
 * 3. Provider Order execution (official -> gtx -> mymemory -> offline)
 *
 * @param {string} text
 * @param {boolean} isDoubleClick
 * @returns {Promise<object>}
 */
async function handleTranslation(text, isDoubleClick = false) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('No text provided for translation');
  }

  // 1. Check in-memory cache
  const memCached = getCachedTranslation(trimmed);
  if (memCached) {
    if (isDoubleClick) {
      await saveRecentWord(trimmed, memCached.primary);
    }
    return { ...memCached, source: 'cache', fromCache: true };
  }

  // 2. Check persistent cache (chrome.storage.local key 'tcache')
  const persistentCached = await getPersistentCachedTranslation(trimmed);
  if (persistentCached) {
    setCachedTranslation(trimmed, persistentCached);
    if (isDoubleClick) {
      await saveRecentWord(trimmed, persistentCached.primary);
    }
    return { ...persistentCached, source: 'cache', fromCache: true };
  }

  // Retrieve current settings
  const settings = typeof getSettings === 'function' ? await getSettings() : DEFAULT_SETTINGS;
  const isOnline = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;

  // If user is offline, skip directly to offline dictionary
  if (!isOnline) {
    const offlineResult = await translateOffline(trimmed);
    setCachedTranslation(trimmed, offlineResult);
    if (isDoubleClick) {
      await saveRecentWord(trimmed, offlineResult.primary);
    }
    return offlineResult;
  }

  const providerOrder = Array.isArray(settings.providerOrder) && settings.providerOrder.length > 0
    ? settings.providerOrder
    : ['official', 'gtx', 'mymemory', 'offline'];

  let lastError = null;

  for (const provider of providerOrder) {
    try {
      let result = null;

      if (provider === 'official') {
        const apiKey = (settings.apiKey || '').trim();
        if (!apiKey) continue; // Skip if no API key configured
        result = await translateOfficial(trimmed, apiKey);
      } else if (provider === 'gtx') {
        result = await translateGTX(trimmed);
      } else if (provider === 'mymemory') {
        result = await translateMyMemory(trimmed);
      } else if (provider === 'offline') {
        if (settings.offlineEnabled !== false) {
          result = await translateOffline(trimmed);
        }
      }

      if (result && result.primary) {
        setCachedTranslation(trimmed, result);

        // Store in persistent cache if from an online provider
        if (result.source === 'online') {
          await setPersistentCachedTranslation(trimmed, result);
        }

        if (isDoubleClick) {
          await saveRecentWord(trimmed, result.primary);
        }
        return result;
      }
    } catch (err) {
      lastError = err;
      console.warn(`Provider [${provider}] failed, continuing to next fallback:`, err.message);
    }
  }

  // If all providers failed, throw friendly error
  if (lastError) {
    throw lastError;
  }

  throw new Error('অনুবাদ পাওয়া যায়নি। অনুগ্রহ করে আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন (Translation unavailable)');
}

// Runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRANSLATE_TEXT') {
    (async () => {
      try {
        const data = await handleTranslation(message.text, !!message.isDoubleClick);
        sendResponse({ success: true, data });
      } catch (error) {
        sendResponse({ success: false, error: error.message || 'Translation failed' });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (message.action === 'CLEAR_RECENT_WORDS') {
    (async () => {
      try {
        await chrome.storage.local.set({ recentWords: [] });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'TEST_API_KEY') {
    (async () => {
      try {
        const testKey = (message.apiKey || '').trim();
        if (!testKey) {
          sendResponse({ success: false, error: 'এপিআই কী খালি (API key is empty)' });
          return;
        }
        const result = await translateOfficial('hello', testKey);
        sendResponse({ success: true, translated: result.primary });
      } catch (error) {
        sendResponse({ success: false, error: error.message || 'API key test failed' });
      }
    })();
    return true;
  }
});

/**
 * Handles extension keyboard shortcuts configured in manifest.json.
 */
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'translate-selection') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'TRANSLATE_SELECTION' }, () => {
          if (chrome.runtime.lastError) {
            // Suppress error if active tab is internal or lacks content script
            console.debug('Active tab does not support TRANSLATE_SELECTION:', chrome.runtime.lastError.message);
          }
        });
      }
    } else if (command === 'toggle-extension') {
      const { enabled = true } = await chrome.storage.local.get('enabled');
      const newState = !enabled;
      await chrome.storage.local.set({ enabled: newState });
    }
  } catch (err) {
    console.error('Error handling extension command:', err);
  }
});

// Extension installation initialization and migration
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const data = await chrome.storage.local.get(['enabled', 'recentWords', 'settings', 'tcache']);

    if (data.enabled === undefined) {
      await chrome.storage.local.set({ enabled: true });
    }

    if (Array.isArray(data.recentWords)) {
      const migrated = data.recentWords.map(normalizeHistoryItem);
      await chrome.storage.local.set({ recentWords: migrated });
    } else {
      await chrome.storage.local.set({ recentWords: [] });
    }

    if (!data.tcache || typeof data.tcache !== 'object') {
      await chrome.storage.local.set({ tcache: {} });
    }

    if (typeof getSettings === 'function') {
      const initializedSettings = await getSettings();
      await chrome.storage.local.set({ settings: initializedSettings });
    }
  } catch (error) {
    console.error('Initialization and migration error in onInstalled:', error);
  }
});
