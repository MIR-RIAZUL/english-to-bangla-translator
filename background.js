/**
 * Background Service Worker
 * Handles translation API calls (bypassing webpage CORS/CSP restrictions),
 * in-memory and persistent caching, lemmatization, offline dictionary fallbacks,
 * official Google Cloud Translation API v2 integration, keyboard shortcuts (commands),
 * context menu selection translations, sentence/paragraph translation with chunking,
 * and persistence of recent word & sentence lookups.
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
 * Determines whether a piece of text should be treated as a single word/phrase
 * or as a sentence/paragraph to be translated as prose.
 * @param {string} text - Trimmed input text.
 * @returns {"word"|"sentence"} Mode string.
 */
function detectMode(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= 3 ? 'word' : 'sentence';
}

/**
 * Builds the cache key for a given text.
 * Words: lowercase full text.
 * Sentences: first 200 chars (lowercase) + "|" + total length.
 * @param {string} text
 * @param {"word"|"sentence"} mode
 * @returns {string}
 */
function buildCacheKey(text, mode) {
  const trimmed = text.trim().toLowerCase();
  if (mode === 'sentence') {
    return trimmed.slice(0, 200) + '|' + trimmed.length;
  }
  return trimmed;
}

/**
 * Retrieve cached translation if present in memory.
 * @param {string} cacheKey
 * @returns {object|null}
 */
function getCachedTranslation(cacheKey) {
  return translationCache.get(cacheKey) || null;
}

/**
 * Store translation in the in-memory cache.
 * @param {string} cacheKey
 * @param {object} data
 */
function setCachedTranslation(cacheKey, data) {
  if (translationCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
  translationCache.set(cacheKey, data);
}

/**
 * Retrieves cached translation from persistent storage (chrome.storage.local key 'tcache').
 * @param {string} cacheKey
 * @returns {Promise<object|null>}
 */
async function getPersistentCachedTranslation(cacheKey) {
  try {
    const { tcache = {} } = await chrome.storage.local.get('tcache');
    if (tcache && tcache[cacheKey] && tcache[cacheKey].data) {
      return tcache[cacheKey].data;
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
 * @param {string} cacheKey
 * @param {object} data
 * @returns {Promise<void>}
 */
async function setPersistentCachedTranslation(cacheKey, data) {
  try {
    const { tcache = {} } = await chrome.storage.local.get('tcache');

    const keys = Object.keys(tcache);
    if (keys.length >= 1000) {
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

    tcache[cacheKey] = {
      timestamp: Date.now(),
      data: data
    };

    await chrome.storage.local.set({ tcache });
  } catch (err) {
    console.warn('Persistent cache write error:', err);
  }
}

/**
 * Loads bundled starter dictionary from data/dictionary.json.
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
 * Splits text into chunks at sentence boundaries (. ! ? \n) without exceeding maxLen.
 * If a single sentence exceeds maxLen, it is split further in order of preference:
 * 1) at the last comma/semicolon/colon before maxLen,
 * 2) else at the last space before maxLen,
 * 3) else a hard cut at maxLen.
 * Never produces a chunk longer than maxLen and never drops characters.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitAtSentenceBoundaries(text, maxLen) {
  if (!text || typeof text !== 'string') return [];
  if (text.length <= maxLen) return [text.trim()];

  // Split on sentence-ending punctuation followed by whitespace, or newlines
  const sentencePattern = /(?<=[.!?\n])\s+/;
  const rawSentences = text.split(sentencePattern).filter(Boolean);

  // Subdivide any individual sentence that exceeds maxLen
  function splitOversized(str, limit) {
    const parts = [];
    let remaining = str;

    while (remaining.length > limit) {
      const window = remaining.slice(0, limit);

      // 1) at the last comma/semicolon/colon before maxLen
      const lastPunct = Math.max(
        window.lastIndexOf(','),
        window.lastIndexOf(';'),
        window.lastIndexOf(':')
      );

      let cutIndex = -1;
      if (lastPunct !== -1) {
        cutIndex = lastPunct + 1;
      } else {
        // 2) else at the last space before maxLen
        const lastSpace = window.lastIndexOf(' ');
        if (lastSpace !== -1) {
          cutIndex = lastSpace + 1;
        } else {
          // 3) else a hard cut at maxLen
          cutIndex = limit;
        }
      }

      parts.push(remaining.slice(0, cutIndex));
      remaining = remaining.slice(cutIndex);
    }

    if (remaining.length > 0) {
      parts.push(remaining);
    }
    return parts;
  }

  const sentences = [];
  for (const raw of rawSentences) {
    if (raw.length <= maxLen) {
      sentences.push(raw);
    } else {
      sentences.push(...splitOversized(raw, maxLen));
    }
  }

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? current + ' ' + sentence : sentence;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current.trim());
      }
      current = sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Provider 1: Official Google Cloud Translation API v2 Basic.
 * Handles sentences and words.
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
 * Translates a single chunk via GTX endpoint.
 * In sentence mode, only the translation (dt=t) is requested; dictionary (dt=bd) is skipped.
 * @param {string} chunk
 * @param {"word"|"sentence"} mode
 * @returns {Promise<{ primary: string, dictionary: Array }>}
 */
async function translateGTXChunk(chunk, mode) {
  const dtParams = mode === 'sentence' ? '&dt=t' : '&dt=t&dt=bd';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=bn${dtParams}&q=${encodeURIComponent(chunk)}`;
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
  if (mode === 'word' && Array.isArray(data[1])) {
    for (const entry of data[1]) {
      const partOfSpeech = entry[0] || 'meaning';
      const terms = Array.isArray(entry[1]) ? entry[1] : [];
      if (terms.length > 0) {
        dictionaryMeanings.push({ pos: partOfSpeech, terms: terms });
      }
    }
  }

  return { primary: primaryBangla, dictionary: dictionaryMeanings };
}

/**
 * Provider 2: Google GTX Web Translation Endpoint.
 * For sentence mode: splits text into ≤1500-char chunks at sentence boundaries,
 * translates each, and joins results. Skips dictionary (dt=bd) in sentence mode.
 * For word mode: behavior unchanged — full dt=t + dt=bd with dictionary parsing.
 * @param {string} text
 * @param {"word"|"sentence"} mode
 * @returns {Promise<object>} Unified result object.
 */
async function translateGTX(text, mode = 'word') {
  const GTX_CHUNK_MAX = 1500;

  if (mode === 'sentence' && text.length > GTX_CHUNK_MAX) {
    const chunks = splitAtSentenceBoundaries(text, GTX_CHUNK_MAX);
    const parts = [];
    for (const chunk of chunks) {
      const { primary } = await translateGTXChunk(chunk, 'sentence');
      parts.push(primary);
    }
    const joined = parts.join(' ').trim();
    if (!joined) throw new Error('Google GTX returned empty translation');
    return {
      originalText: text,
      primary: joined,
      dictionary: [],
      sourceLang: 'en',
      provider: 'gtx',
      source: 'online'
    };
  }

  // Word mode or short sentence — single request
  const { primary, dictionary } = await translateGTXChunk(text, mode);
  return {
    originalText: text,
    primary: primary,
    dictionary: dictionary,
    sourceLang: 'en',
    provider: 'gtx',
    source: 'online'
  };
}

/**
 * Provider 3: Offline Dictionary with Lemmatization.
 * For word mode: standard single-word lookup.
 * For sentence mode (offline fallback): translates each token individually,
 * keeping unknown words as-is, and marks result as approximate.
 * @param {string} text
 * @param {"word"|"sentence"} [mode="word"]
 * @returns {Promise<object>} Unified result object.
 */
async function translateOffline(text, mode = 'word') {
  const dict = await loadOfflineDictionary();

  if (mode === 'sentence') {
    // Word-by-word translation of each token; unknown tokens kept as-is
    const tokens = text.trim().split(/\s+/);
    const translated = tokens.map((token) => {
      const clean = token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase();
      if (!clean) return token;
      const candidates = typeof lemmatize === 'function' ? lemmatize(clean) : [clean];
      for (const candidate of candidates) {
        if (dict[candidate] && Array.isArray(dict[candidate].bn) && dict[candidate].bn[0]) {
          return dict[candidate].bn[0];
        }
      }
      return token; // Unknown: keep original
    });
    const primary = translated.join(' ').trim();
    if (!primary) {
      throw new Error('Offline sentence translation produced no output');
    }
    return {
      originalText: text,
      primary: primary,
      dictionary: [],
      sourceLang: 'en',
      provider: 'offline',
      source: 'offline',
      approximate: true
    };
  }

  // Word mode: standard single-entry lookup
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
        dictionaryMeanings.push({ pos: p, terms: bnMeanings });
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

  throw new Error(`"${text}" শব্দটি অফলাইন ডিকশনারিতে পাওয়া যায়নি (Word not in offline dictionary)`);
}

/**
 * Provider 4: MyMemory Translation API Fallback.
 * Enforces 450-character chunks (MyMemory limit is ~500 chars).
 * Joins translated chunks with a space for sentence mode.
 * @param {string} text
 * @param {"word"|"sentence"} [mode="word"]
 * @returns {Promise<object>} Unified result object.
 */
async function translateMyMemory(text, mode = 'word') {
  const MM_CHUNK_MAX = 450;

  /**
   * Translates a single chunk against MyMemory API.
   * @param {string} chunk
   * @returns {Promise<string>} Translated text.
   */
  async function translateMMChunk(chunk) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|bn`;
    const response = await fetchWithBackoff(url);
    if (!response.ok) {
      throw new Error(`MyMemory error: HTTP ${response.status}`);
    }
    const data = await response.json();
    const primary = data?.responseData?.translatedText?.trim();
    if (!primary) throw new Error('MyMemory returned empty translation');
    return primary;
  }

  if (text.length > MM_CHUNK_MAX) {
    const chunks = splitAtSentenceBoundaries(text, MM_CHUNK_MAX);
    const parts = [];
    for (const chunk of chunks) {
      const translated = await translateMMChunk(chunk);
      parts.push(translated);
    }
    const joined = parts.join(' ').trim();
    if (!joined) throw new Error('MyMemory returned empty translation');
    return {
      originalText: text,
      primary: joined,
      dictionary: [],
      sourceLang: 'en',
      provider: 'mymemory',
      source: 'online'
    };
  }

  // Short text — single request with optional alternatives
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|bn`;
  const response = await fetchWithBackoff(url);
  if (!response.ok) {
    throw new Error(`MyMemory error: HTTP ${response.status}`);
  }
  const data = await response.json();
  const primary = data?.responseData?.translatedText?.trim();
  if (!primary) throw new Error('MyMemory returned empty translation');

  const alternatives = [];
  if (mode === 'word' && Array.isArray(data.matches)) {
    const rawTerms = data.matches
      .map((m) => (m && m.translation ? m.translation.trim() : ''))
      .filter((t) => t && t.toLowerCase() !== primary.toLowerCase());
    const terms = [...new Set(rawTerms)].slice(0, 4);
    if (terms.length > 0) {
      alternatives.push({ pos: 'alternate', terms: terms });
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
 * Normalizes and migrates a history record to { word, translation, timestamp, count, type }.
 * @param {Object} item - Raw history entry.
 * @returns {{ word: string, translation: string, timestamp: number, count: number, type: string }}
 */
function normalizeHistoryItem(item) {
  if (!item || typeof item !== 'object') {
    return { word: '', translation: '', timestamp: Date.now(), count: 1, type: 'word' };
  }
  return {
    word: typeof item.word === 'string' ? item.word : '',
    translation: typeof item.translation === 'string' ? item.translation : '',
    timestamp: typeof item.timestamp === 'number' && !isNaN(item.timestamp) ? item.timestamp : Date.now(),
    count: typeof item.count === 'number' && item.count > 0 ? item.count : 1,
    type: item.type === 'sentence' ? 'sentence' : 'word'
  };
}

/**
 * Persist a translated word or sentence to recent words history in chrome.storage.local.
 * Sentences are only saved when settings.saveSentences is true, marked with type "sentence".
 * Truncated to 120 characters in storage.
 * @param {string} word
 * @param {string} translation
 * @param {"word"|"sentence"} [mode="word"]
 */
async function saveRecentWord(word, translation, mode = 'word') {
  try {
    const trimmedWord = word.trim();
    const trimmedTranslation = translation.trim();
    if (!trimmedWord || !trimmedTranslation) return;

    const data = await chrome.storage.local.get(['recentWords', 'settings']);
    const settings = (data.settings && typeof data.settings === 'object') ? data.settings : {};

    if (mode === 'sentence') {
      if (!settings.saveSentences) return; // Do not save sentences unless opted in
    } else {
      // Word mode validation
      const wordCount = trimmedWord.split(/\s+/).length;
      if (wordCount > 3 || trimmedWord.length > 40) return;
    }

    const rawList = Array.isArray(data.recentWords) ? data.recentWords : [];
    const historyLimit = typeof settings.historyLimit === 'number' && settings.historyLimit >= 10
      ? settings.historyLimit
      : 200;

    const history = rawList.map(normalizeHistoryItem);

    // For sentences, store truncated to 120 chars
    const storedWord = mode === 'sentence' && trimmedWord.length > 120
      ? trimmedWord.slice(0, 120) + '…'
      : trimmedWord;

    const wordLower = storedWord.toLowerCase();
    const existingIndex = history.findIndex((item) => item.word.toLowerCase() === wordLower);

    let updatedEntry;
    if (existingIndex !== -1) {
      const existing = history[existingIndex];
      updatedEntry = {
        word: storedWord,
        translation: trimmedTranslation,
        timestamp: Date.now(),
        count: (existing.count || 1) + 1,
        type: mode
      };
      history.splice(existingIndex, 1);
    } else {
      updatedEntry = {
        word: storedWord,
        translation: trimmedTranslation,
        timestamp: Date.now(),
        count: 1,
        type: mode
      };
    }

    history.unshift(updatedEntry);
    const trimmedHistory = history.slice(0, historyLimit);
    await chrome.storage.local.set({ recentWords: trimmedHistory });
  } catch (error) {
    console.error('Failed to save recent word/sentence:', error);
  }
}

/**
 * Unified Translation Handler.
 * Determines mode (word vs sentence), enforces maxChars limit, manages caching,
 * runs provider chain, and normalizes response shape.
 *
 * Response shape:
 * {
 *   ok: boolean,
 *   mode: "word"|"sentence",
 *   original: string,
 *   primary: string,          // same as translation
 *   translation: string,
 *   dictionary: Array,
 *   source: "cache"|"online"|"offline",
 *   provider: string,
 *   truncated: boolean,
 *   approximate: boolean,
 *   error: string|null
 * }
 *
 * @param {string} text
 * @param {boolean} isDoubleClick - When true, saves results to recentWords (subject to settings).
 * @returns {Promise<object>}
 */
async function handleTranslation(text, isDoubleClick = false) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('No text provided for translation');
  }

  // Retrieve settings for maxChars, providerOrder, apiKey, offlineEnabled
  const settings = typeof getSettings === 'function' ? await getSettings() : (typeof DEFAULT_SETTINGS !== 'undefined' ? DEFAULT_SETTINGS : {});
  const maxChars = (typeof settings.maxChars === 'number' && settings.maxChars > 0) ? settings.maxChars : 3000;

  // Enforce maxChars limit
  let inputText = trimmed;
  let truncated = false;
  if (inputText.length > maxChars) {
    inputText = inputText.slice(0, maxChars);
    truncated = true;
  }

  const mode = detectMode(inputText);
  const cacheKey = buildCacheKey(inputText, mode);

  // --- Inline helper to build normalized response ---
  function buildResponse(result, fromCache = false) {
    return {
      ok: true,
      mode: mode,
      original: inputText,
      primary: result.primary || '',
      translation: result.primary || '',
      dictionary: Array.isArray(result.dictionary) ? result.dictionary : [],
      source: fromCache ? 'cache' : (result.source || 'online'),
      provider: result.provider || 'unknown',
      truncated: truncated,
      approximate: !!result.approximate,
      error: null
    };
  }

  // 1. Check in-memory cache
  const memCached = getCachedTranslation(cacheKey);
  if (memCached) {
    if (isDoubleClick) {
      await saveRecentWord(inputText, memCached.primary, mode);
    }
    return buildResponse(memCached, true);
  }

  // 2. Check persistent cache
  const persistentCached = await getPersistentCachedTranslation(cacheKey);
  if (persistentCached) {
    setCachedTranslation(cacheKey, persistentCached);
    if (isDoubleClick) {
      await saveRecentWord(inputText, persistentCached.primary, mode);
    }
    return buildResponse(persistentCached, true);
  }

  const isOnline = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
    ? navigator.onLine
    : true;

  // 3. If offline, skip directly to offline handler
  if (!isOnline) {
    const offlineResult = await translateOffline(inputText, mode);
    setCachedTranslation(cacheKey, offlineResult);
    if (isDoubleClick) {
      await saveRecentWord(inputText, offlineResult.primary, mode);
    }
    return buildResponse(offlineResult);
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
        if (!apiKey) continue;
        result = await translateOfficial(inputText, apiKey);
      } else if (provider === 'gtx') {
        result = await translateGTX(inputText, mode);
      } else if (provider === 'mymemory') {
        result = await translateMyMemory(inputText, mode);
      } else if (provider === 'offline') {
        if (settings.offlineEnabled !== false) {
          result = await translateOffline(inputText, mode);
        }
      }

      if (result && result.primary) {
        setCachedTranslation(cacheKey, result);

        // Only persist online results
        if (result.source === 'online') {
          await setPersistentCachedTranslation(cacheKey, result);
        }

        // Save to history conditionally
        if (isDoubleClick) {
          await saveRecentWord(inputText, result.primary, mode);
        }

        return buildResponse(result);
      }
    } catch (err) {
      lastError = err;
      console.warn(`Provider [${provider}] failed, continuing to next fallback:`, err.message);
    }
  }

  // All online providers failed — attempt offline sentence approximation as last resort
  if (mode === 'sentence') {
    try {
      const fallbackResult = await translateOffline(inputText, 'sentence');
      setCachedTranslation(cacheKey, fallbackResult);
      if (isDoubleClick) {
        await saveRecentWord(inputText, fallbackResult.primary, mode);
      }
      return buildResponse(fallbackResult);
    } catch (offlineErr) {
      console.warn('Offline sentence fallback also failed:', offlineErr.message);
    }
  }

  if (lastError) throw lastError;
  throw new Error('অনুবাদ পাওয়া যায়নি। অনুগ্রহ করে আপনার ইন্টারনেট সংযোগ পরীক্ষা করুন (Translation unavailable)');
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
    return true;
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

/**
 * Handles context menu clicks ("Translate to Bangla").
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-to-bangla' && tab && tab.id) {
    try {
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'TRANSLATE_SELECTION',
          text: info.selectionText || ''
        },
        () => {
          if (chrome.runtime.lastError) {
            console.debug('Context menu message delivery note:', chrome.runtime.lastError.message);
          }
        }
      );
    } catch (err) {
      console.error('Error handling context menu translation:', err);
    }
  }
});

// Extension installation initialization, context menu creation, and migration
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // 1. Context Menu Registration
    try {
      chrome.contextMenus.create({
        id: 'translate-to-bangla',
        title: 'Translate to Bangla',
        contexts: ['selection']
      });
    } catch (menuErr) {
      console.debug('Context menu registration note:', menuErr);
    }

    // 2. Storage Initialization
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
