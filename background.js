/**
 * Background Service Worker
 * Handles translation API calls (bypassing webpage CORS/CSP restrictions),
 * in-memory and persistent caching, lemmatization, offline dictionary fallbacks,
 * official Google Cloud Translation API v2 integration, keyboard shortcuts (commands),
 * and persistence of recent lookups.
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
 * Stores translation in persistent storage (max 1000 entries, evicts oldest).
 * @param {string} text
 * @param {object} data
 */
async function setPersistentCachedTranslation(text, data) {
  try {
    const key = text.trim().toLowerCase();
    const { tcache = {} } = await chrome.storage.local.get('tcache');

    tcache[key] = {
      data: data,
      timestamp: Date.now()
    };

    const keys = Object.keys(tcache);
    if (keys.length > 1000) {
      keys.sort((a, b) => (tcache[a].timestamp || 0) - (tcache[b].timestamp || 0));
      const excess = keys.length - 1000;
      for (let i = 0; i < excess; i++) {
        delete tcache[keys[i]];
      }
    }

    await chrome.storage.local.set({ tcache });
  } catch (err) {
    console.warn('Persistent cache write error:', err);
  }
}

/**
 * Executes a fetch request with exponential backoff on HTTP 429 and 5xx responses.
 * @param {string} url - Target URL.
 * @param {RequestInit} [options={}] - Standard fetch options.
 * @param {number} [maxRetries=2] - Maximum retries before throwing.
 * @returns {Promise<Response>}
 */
async function fetchWithBackoff(url, options = {}, maxRetries = 2) {
  let attempt = 0;
  let delay = 500;

  while (true) {
    try {
      const response = await fetch(url, options);

      if ((response.status === 429 || (response.status >= 500 && response.status < 600)) && attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      return response;
    } catch (networkError) {
      if (attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw networkError;
    }
  }
}

/**
 * Lazily loads and parses data/dictionary.json into memory.
 * @returns {Promise<object|null>}
 */
async function getOfflineDictionary() {
  if (offlineDict) return offlineDict;
  try {
    const url = chrome.runtime.getURL('data/dictionary.json');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load dictionary.json: HTTP ${response.status}`);
    }
    offlineDict = await response.json();
    return offlineDict;
  } catch (err) {
    console.error('Offline dictionary load error:', err);
    return null;
  }
}

/**
 * Translates a word using the local offline dictionary and morphological lemmatization.
 * @param {string} text
 * @returns {Promise<object>} Standard translation result object.
 */
async function translateOffline(text) {
  const dict = await getOfflineDictionary();
  if (!dict) {
    throw new Error('অফলাইন ডিকশনারি লোড করা যায়নি (Offline dictionary could not be loaded)');
  }

  const candidates = typeof lemmatize === 'function'
    ? lemmatize(text)
    : [text.toLowerCase().trim()];

  let match = null;
  let matchedWord = '';

  for (const candidate of candidates) {
    if (dict[candidate]) {
      match = dict[candidate];
      matchedWord = candidate;
      break;
    }
  }

  if (!match) {
    throw new Error('অফলাইন ডিকশনারিতে শব্দটি পাওয়া যায়নি (Word not found in offline dictionary)');
  }

  const primary = Array.isArray(match.bn) && match.bn.length > 0 ? match.bn[0] : '';
  if (!primary) {
    throw new Error('অফলাইন অনুবাদ শূন্য (Empty offline translation)');
  }

  const dictionary = [];
  if (Array.isArray(match.pos) && Array.isArray(match.bn) && match.bn.length > 0) {
    dictionary.push({
      pos: match.pos.join(', '),
      terms: match.bn.slice(0, 5)
    });
  }

  return {
    originalText: text,
    primary: primary,
    dictionary: dictionary,
    sourceLang: 'en',
    provider: 'offline',
    source: 'offline',
    matchedWord: matchedWord
  };
}

/**
 * Translates text using the official Google Cloud Translation API v2 Basic.
 * Never logs the API key and handles specific HTTP status codes.
 * @param {string} text - English text to translate.
 * @param {string} apiKey - Google Cloud API key.
 * @returns {Promise<object>} Standard translation result object.
 */
async function translateOfficial(text, apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('এপিআই কী পাওয়া যায়নি (No API key provided)');
  }

  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey.trim())}`;
  const response = await fetchWithBackoff(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: text,
      target: 'bn',
      source: 'en',
      format: 'text'
    })
  });

  if (response.status === 400 || response.status === 403) {
    throw new Error('ভুল বা অননুমোদিত এপিআই কী (Invalid or unauthorized API key)');
  }

  if (response.status === 429) {
    throw new Error('অনুরোধ সীমা অতিক্রম করেছে, পরে চেষ্টা করুন (Rate limit / quota exceeded, please try again later)');
  }

  if (!response.ok) {
    throw new Error(`Google Cloud Translation error: HTTP ${response.status}`);
  }

  const data = await response.json();
  const translations = data?.data?.translations;
  const primary = Array.isArray(translations) && translations[0]?.translatedText
    ? translations[0].translatedText.trim()
    : '';

  if (!primary) {
    throw new Error('Google Cloud Translation returned empty translation');
  }

  return {
    originalText: text,
    primary: primary,
    dictionary: [],
    sourceLang: translations[0]?.detectedSourceLanguage || 'en',
    provider: 'official',
    source: 'online'
  };
}

/**
 * Translate using Primary Google GTX API (free, fast, rich dictionary)
 * @param {string} text
 * @returns {Promise<object>}
 */
async function translateGTX(text) {
  const encoded = encodeURIComponent(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=bn&dt=t&dt=bd&q=${encoded}`;

  const response = await fetchWithBackoff(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*'
    }
  });

  if (response.status === 429) {
    throw new Error('অনুরোধ সীমা অতিক্রম করেছে, পরে চেষ্টা করুন (Rate limit / quota exceeded, please try again later)');
  }

  if (!response.ok) {
    throw new Error(`Google Translate error: HTTP ${response.status}`);
  }

  const data = await response.json();

  // 1. Primary translation from data[0]
  let primary = '';
  if (Array.isArray(data[0])) {
    primary = data[0]
      .map((segment) => (segment && segment[0] ? segment[0] : ''))
      .join('')
      .trim();
  }

  if (!primary) {
    throw new Error('Google Translate returned empty translation');
  }

  // 2. Dictionary meanings and parts of speech from data[1] (if available)
  const dictionary = [];
  if (Array.isArray(data[1])) {
    for (const group of data[1]) {
      if (Array.isArray(group)) {
        const pos = (group[0] || '').trim();
        const rawTerms = Array.isArray(group[1]) ? group[1] : [];
        const terms = [...new Set(rawTerms)].filter(Boolean).slice(0, 5);

        if (terms.length > 0) {
          dictionary.push({
            pos: pos || 'general',
            terms: terms
          });
        }
      }
    }
  }

  return {
    originalText: text,
    primary: primary,
    dictionary: dictionary,
    sourceLang: data[2] || 'en',
    provider: 'gtx',
    source: 'online'
  };
}

/**
 * Fallback Translation using MyMemory API
 * @param {string} text
 * @returns {Promise<object>}
 */
async function translateMyMemory(text) {
  const encoded = encodeURIComponent(text);
  const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|bn`;

  const response = await fetchWithBackoff(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });

  if (response.status === 429) {
    throw new Error('অনুরোধ সীমা অতিক্রম করেছে, পরে চেষ্টা করুন (Rate limit / quota exceeded, please try again later)');
  }

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
 * Persist translated word to recent words history in chrome.storage.local
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

    const { recentWords = [] } = await chrome.storage.local.get('recentWords');

    const filtered = recentWords.filter(
      (item) => item.word.toLowerCase() !== trimmedWord.toLowerCase()
    );

    filtered.unshift({
      word: trimmedWord,
      translation: trimmedTranslation,
      timestamp: Date.now()
    });

    await chrome.storage.local.set({ recentWords: filtered.slice(0, 20) });
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

  // Load configured settings for providerOrder, apiKey, and offlineEnabled
  const settings = typeof getSettings === 'function' ? await getSettings() : DEFAULT_SETTINGS;
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  // 3. If browser is offline, route directly to offline dictionary
  if (!isOnline) {
    const offlineResult = await translateOffline(trimmed);
    if (offlineResult) {
      setCachedTranslation(trimmed, offlineResult);
      if (isDoubleClick) {
        await saveRecentWord(trimmed, offlineResult.primary);
      }
      return offlineResult;
    }
    throw new Error('ইন্টারনেট সংযোগ নেই এবং অফলাইন ডিকশনারিতে শব্দটি পাওয়া যায়নি (No internet connection and word not found offline)');
  }

  // 4. Run providers in user-specified priority order
  const providerOrder = Array.isArray(settings.providerOrder) && settings.providerOrder.length > 0
    ? settings.providerOrder
    : ['official', 'gtx', 'mymemory', 'offline'];

  let lastError = null;

  for (const provider of providerOrder) {
    try {
      let result = null;

      if (provider === 'official') {
        if (!settings.apiKey || !settings.apiKey.trim()) {
          // Skip official provider if no key configured
          continue;
        }
        result = await translateOfficial(trimmed, settings.apiKey.trim());
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

    if (!Array.isArray(data.recentWords)) {
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
