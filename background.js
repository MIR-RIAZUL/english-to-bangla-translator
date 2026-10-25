/**
 * Background Service Worker
 * Handles translation API calls (bypassing webpage CORS/CSP restrictions),
 * in-memory caching, fallback provider, and persistence of recent lookups.
 */

// In-memory cache for fast repeated lookups (LRU-like cap)
const translationCache = new Map();
const MAX_CACHE_ENTRIES = 300;

/**
 * Retrieve cached translation if present
 * @param {string} text
 * @returns {object|null}
 */
function getCachedTranslation(text) {
  const key = text.trim().toLowerCase();
  return translationCache.get(key) || null;
}

/**
 * Store translation in the in-memory cache
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
    provider: 'google'
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
    provider: 'mymemory'
  };
}

/**
 * Unified Translation Handler with Caching & Fallback
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
  const cached = getCachedTranslation(trimmed);
  if (cached) {
    if (isDoubleClick) {
      await saveRecentWord(trimmed, cached.primary);
    }
    return { ...cached, fromCache: true };
  }

  let result = null;

  // 2. Try Primary Google API
  try {
    result = await translateWithGoogle(trimmed);
  } catch (primaryError) {
    console.warn('Primary translation API failed, attempting fallback:', primaryError);

    // 3. Fallback to MyMemory
    try {
      result = await translateWithMyMemory(trimmed);
    } catch (fallbackError) {
      console.error('All translation providers failed:', fallbackError);
      throw new Error('অনুবাদ পাওয়া যায়নি। অনুগ্রহ করে আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন।');
    }
  }

  // Store in cache
  setCachedTranslation(trimmed, result);

  // Save to recent words if double-clicked
  if (isDoubleClick) {
    await saveRecentWord(trimmed, result.primary);
  }

  return result;
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

// Extension installation initialization
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const data = await chrome.storage.local.get(['enabled', 'recentWords']);
    if (data.enabled === undefined) {
      await chrome.storage.local.set({ enabled: true });
    }
    if (!Array.isArray(data.recentWords)) {
      await chrome.storage.local.set({ recentWords: [] });
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
});
