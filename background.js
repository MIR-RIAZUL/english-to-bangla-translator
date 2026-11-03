/**
 * Background Service Worker
 * Handles translation API calls (bypassing webpage CORS/CSP restrictions),
 * in-memory and persistent caching, lemmatization, offline dictionary fallbacks,
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
 * Looks up a word or short phrase in the offline dictionary with lemmatization fallbacks.
 * @param {string} text
 * @returns {Promise<object|null>}
 */
async function lookupOfflineDictionary(text) {
  try {
    const dict = await getOfflineDictionary();
    if (!dict) return null;

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

    if (!match) return null;

    const primary = Array.isArray(match.bn) && match.bn.length > 0 ? match.bn[0] : '';
    if (!primary) return null;

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
  } catch (err) {
    console.error('Offline lookup error:', err);
    return null;
  }
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

    // Remove existing entry for the same word to push it to the top
    const filtered = recentWords.filter(
      item => item.word.toLowerCase() !== trimmedWord.toLowerCase()
    );

    filtered.unshift({
      word: trimmedWord,
      translation: trimmedTranslation,
      timestamp: Date.now()
    });

    // Keep the most recent 20 in storage
    await chrome.storage.local.set({ recentWords: filtered.slice(0, 20) });
  } catch (error) {
    console.error('Failed to save recent word:', error);
  }
}

/**
 * Translate using Primary Google GTX API (free, fast, rich dictionary)
 * @param {string} text
 * @returns {Promise<object>}
 */
async function translateWithGoogle(text) {
  const encoded = encodeURIComponent(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=bn&dt=t&dt=bd&q=${encoded}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*'
    }
  });

  if (!response.ok) {
    throw new Error(`Google Translate error: HTTP ${response.status}`);
  }

  const data = await response.json();

  // 1. Primary translation from data[0]
  let primary = '';
  if (Array.isArray(data[0])) {
    primary = data[0]
      .map(segment => (segment && segment[0] ? segment[0] : ''))
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
    provider: 'google',
    source: 'online'
  };
}

/**
 * Fallback Translation using MyMemory API
 * @param {string} text
 * @returns {Promise<object>}
 */
async function translateWithMyMemory(text) {
  const encoded = encodeURIComponent(text);
  const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=en|bn`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });

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
      .map(m => (m && m.translation ? m.translation.trim() : ''))
      .filter(t => t && t.toLowerCase() !== primary.toLowerCase());

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
 * Unified Translation Handler with Lookup Order:
 * 1. Memory cache
 * 2. Persistent storage cache ('tcache', max 1000)
 * 3. Online API (if navigator.onLine)
 * 4. Offline dictionary (fallback or immediate if offline)
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

  // Check network connectivity
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  // 3. If offline, skip straight to offline dictionary
  if (!isOnline) {
    const offlineResult = await lookupOfflineDictionary(trimmed);
    if (offlineResult) {
      setCachedTranslation(trimmed, offlineResult);
      if (isDoubleClick) {
        await saveRecentWord(trimmed, offlineResult.primary);
      }
      return offlineResult;
    }
    throw new Error('অফলাইন ডিকশনারিতে শব্দটি পাওয়া যায়নি এবং ইন্টারনেট সংযোগ নেই।');
  }

  // 4. Online API execution (Google GTX -> MyMemory)
  let result = null;
  try {
    result = await translateWithGoogle(trimmed);
  } catch (primaryError) {
    console.warn('Primary translation API failed, attempting fallback:', primaryError);
    try {
      result = await translateWithMyMemory(trimmed);
    } catch (fallbackError) {
      console.warn('Online translation providers failed, attempting offline dictionary:', fallbackError);
    }
  }

  // 5. If online succeeded, persist and return
  if (result) {
    result.source = 'online';
    setCachedTranslation(trimmed, result);
    await setPersistentCachedTranslation(trimmed, result);

    if (isDoubleClick) {
      await saveRecentWord(trimmed, result.primary);
    }
    return result;
  }

  // 6. Online failed: fallback to offline dictionary
  const offlineFallback = await lookupOfflineDictionary(trimmed);
  if (offlineFallback) {
    setCachedTranslation(trimmed, offlineFallback);
    if (isDoubleClick) {
      await saveRecentWord(trimmed, offlineFallback.primary);
    }
    return offlineFallback;
  }

  throw new Error('অনুবাদ পাওয়া যায়নি। অনুগ্রহ করে আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন।');
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
});

// Extension installation initialization and migration
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const data = await chrome.storage.local.get(['enabled', 'recentWords', 'settings', 'tcache']);

    // Preserve existing enabled state or set default
    if (data.enabled === undefined) {
      await chrome.storage.local.set({ enabled: true });
    }

    // Preserve existing recentWords or initialize empty array
    if (!Array.isArray(data.recentWords)) {
      await chrome.storage.local.set({ recentWords: [] });
    }

    // Preserve existing tcache or initialize empty object
    if (!data.tcache || typeof data.tcache !== 'object') {
      await chrome.storage.local.set({ tcache: {} });
    }

    // Migration / initialization for settings
    if (typeof getSettings === 'function') {
      const initializedSettings = await getSettings();
      await chrome.storage.local.set({ settings: initializedSettings });
    }
  } catch (error) {
    console.error('Initialization and migration error in onInstalled:', error);
  }
});
