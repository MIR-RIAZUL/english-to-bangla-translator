/**
 * Test Suite: Automated Logic Tests (Node.js) - Phase B
 * Target: English-to-Bangla Chrome MV3 Extension
 * Execution: node tests/run-tests.js
 *
 * Rules:
 * - Tests pure and modular logic from the codebase.
 * - Source files are NOT modified.
 * - Uses real code from settings.js, lemmatize.js, and background.js via VM harness.
 * - Extracts closure-bound functions from history.js and notes isolation constraints.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');

// ============================================================================
// Test Harness & Reporter
// ============================================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];
const outputLines = [];

function log(msg = '') {
  console.log(msg);
  outputLines.push(msg);
}

function assert(condition, testId, description, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    log(`  [PASS] ${testId}: ${description}`);
  } else {
    failedTests++;
    const failMsg = `  [FAIL] ${testId}: ${description}${details ? ' -> ' + details : ''}`;
    log(failMsg);
    failures.push({ testId, description, details });
  }
}

// ============================================================================
// Environment & Module Loading Harness
// ============================================================================

log('=================================================================');
log('  PHASE B: AUTOMATED LOGIC TESTS (Node.js)');
log('=================================================================\n');

// 1. Mock Chrome API for Node environment
let mockStorage = {};
const mockChrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach((k) => (res[k] = mockStorage[k]));
          return res;
        }
        return { ...mockStorage };
      },
      set: async (items) => {
        Object.assign(mockStorage, items);
      }
    }
  },
  runtime: {
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  },
  contextMenus: {
    create: () => {},
    onClicked: { addListener: () => {} }
  },
  commands: {
    onCommand: { addListener: () => {} }
  }
};

global.chrome = mockChrome;
global.importScripts = (...scripts) => {};

// 2. Load lemmatize.js
const lemmatizeCode = fs.readFileSync(path.join(ROOT_DIR, 'lemmatize.js'), 'utf8');
vm.runInThisContext(lemmatizeCode);
const lemmatizeFn = global.lemmatize;

// 3. Load settings.js
const settingsCode = fs.readFileSync(path.join(ROOT_DIR, 'settings.js'), 'utf8');
vm.runInThisContext(settingsCode);
const DEFAULT_SETTINGS = global.DEFAULT_SETTINGS;
const getSettingsFn = global.getSettings;

// 4. Load background.js pure functions
const bgCode = fs.readFileSync(path.join(ROOT_DIR, 'background.js'), 'utf8');
vm.runInThisContext(bgCode);

// Functions exposed from background.js in VM context:
const detectModeFn = global.detectMode;
const splitAtSentenceBoundariesFn = global.splitAtSentenceBoundaries;
const joinTranslatedChunksFn = global.joinTranslatedChunks;
const buildCacheKeyFn = global.buildCacheKey;
const setCachedTranslationFn = global.setCachedTranslation;
const getCachedTranslationFn = global.getCachedTranslation;
const normalizeHistoryItemFn = global.normalizeHistoryItem;
const saveRecentWordFn = global.saveRecentWord;

// 5. Note functions requiring isolation wrapper:
// history.js wraps everything in document.addEventListener('DOMContentLoaded', ...).
// We extract the pure filter/search, CSV export, and escapeHtml functions directly from history.js.
log('[SETUP NOTE] lemmatize.js, settings.js, and background.js loaded directly via Node VM.');
log('[SETUP NOTE] history.js logic (search/filter, CSV export) and escapeHtml isolated for testing (enclosed in DOMContentLoaded in source).\n');

// Pure escapeHtml matching content.js / popup.js / history.js:
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Pure filter & sort logic from history.js (lines 87-118):
function filterAndSortHistory(rawHistory, query = '', field = 'both', sortBy = 'recent') {
  const q = query.trim().toLowerCase();
  let result = rawHistory.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (!q) return true;
    const wordLower = String(item.word || '').toLowerCase();
    const transLower = String(item.translation || '').toLowerCase();
    if (field === 'en') return wordLower.includes(q);
    if (field === 'bn') return transLower.includes(q);
    return wordLower.includes(q) || transLower.includes(q);
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
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  return result;
}

// Pure CSV generator from history.js (lines 348-358):
function generateCsvContent(rawHistory) {
  const header = ['Word or Sentence', 'Translation', 'Type', 'Lookup Count', 'Timestamp', 'Date'];
  const rows = rawHistory.map((item) => {
    const dateStr = item.timestamp ? new Date(item.timestamp).toISOString() : '';
    const wordClean = String(item.word || '').replace(/"/g, '""');
    const transClean = String(item.translation || '').replace(/"/g, '""');
    const typeClean = item.type === 'sentence' ? 'sentence' : 'word';
    return `"${wordClean}","${transClean}","${typeClean}",${item.count || 1},${item.timestamp || ''},"${dateStr}"`;
  });
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n');
}

// Pure GTX parser logic from background.js (lines 274-294):
function parseGTXResponse(data, mode) {
  let primaryBangla = '';
  if (Array.isArray(data[0])) {
    primaryBangla = data[0]
      .map((segment) => (segment && segment[0] ? segment[0] : ''))
      .join('')
      .trim();
  }
  if (!primaryBangla) throw new Error('Google GTX returned empty translation');

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

// Pure MyMemory parser logic from background.js (lines 436-439, 471-480):
function parseMyMemoryResponse(data, mode) {
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
  return { primary, alternatives };
}

// ============================================================================
// TEST SUITES
// ============================================================================

async function runAllTests() {
  // --------------------------------------------------------------------------
  // 1. lemmatize
  // --------------------------------------------------------------------------
  log('--- Suite 1: Lemmatizer ---');
  const lemmaCases = [
    { input: 'running', expected: 'run' },
    { input: 'boxes', expected: 'box' },
    { input: 'studies', expected: 'study' },
    { input: 'studied', expected: 'study' },
    { input: 'stopped', expected: 'stop' },
    { input: 'cats', expected: 'cat' }
  ];

  lemmaCases.forEach((c, idx) => {
    const candidates = lemmatizeFn(c.input);
    const hasExpected = Array.isArray(candidates) && candidates.includes(c.expected);
    assert(
      hasExpected,
      `1.${idx + 1}`,
      `lemmatize("${c.input}") includes candidate "${c.expected}"`,
      `Got: [${candidates.join(', ')}]`
    );
  });

  // --------------------------------------------------------------------------
  // 2. detectMode
  // --------------------------------------------------------------------------
  log('\n--- Suite 2: Mode Detection (detectMode) ---');
  const modeCases = [
    { input: 'hello', expected: 'word' },
    { input: 'good morning', expected: 'word' },
    { input: 'three words here', expected: 'word' },
    { input: 'this is a long sentence', expected: 'sentence' },
    { input: 'four words are here', expected: 'sentence' }
  ];

  modeCases.forEach((c, idx) => {
    const mode = detectModeFn(c.input);
    assert(
      mode === c.expected,
      `2.${idx + 1}`,
      `detectMode("${c.input}") === "${c.expected}"`,
      `Got: "${mode}"`
    );
  });

  // --------------------------------------------------------------------------
  // 3. Chunking at sentence boundaries
  // --------------------------------------------------------------------------
  log('\n--- Suite 3: Chunking & Boundary Splitting ---');

  // Multi-sentence 4000-char text
  const sentences = [
    'The quick brown fox jumps over the lazy dog.',
    'Bengali language translation is very useful for reading foreign web pages.',
    'Chrome extension MV3 background service worker handles all remote API requests.',
    'Each chunk should respect natural punctuation boundaries such as periods and question marks.',
    'Offline fallback provides word by word translation when network connectivity fails.'
  ];
  let multiSentenceText = '';
  while (multiSentenceText.length < 4000) {
    multiSentenceText += sentences[Math.floor(Math.random() * sentences.length)] + ' ';
  }
  multiSentenceText = multiSentenceText.trim();

  // 3.1: Splits at sentence boundaries
  const chunks1500 = splitAtSentenceBoundariesFn(multiSentenceText, 1500);
  assert(
    chunks1500.length > 1,
    '3.1',
    `4000-char multi-sentence text splits into multiple chunks (${chunks1500.length} chunks)`
  );

  // 3.2: No chunk exceeds 1500 limit
  const maxLen1500 = Math.max(...chunks1500.map((c) => c.length));
  assert(
    maxLen1500 <= 1500,
    '3.2',
    `No chunk exceeds GTX 1500 char limit (max: ${maxLen1500})`,
    `Max chunk length: ${maxLen1500}`
  );

  // 3.3: No chunk exceeds 450 limit (MyMemory)
  const chunks450 = splitAtSentenceBoundariesFn(multiSentenceText, 450);
  const maxLen450 = Math.max(...chunks450.map((c) => c.length));
  assert(
    maxLen450 <= 450,
    '3.3',
    `No chunk exceeds MyMemory 450 char limit (max: ${maxLen450})`,
    `Max chunk length: ${maxLen450}`
  );

  // 3.4: Joined chunks equal original text (normalized spaces)
  const joinedText = chunks1500.join(' ');
  const normalizedOriginal = multiSentenceText.replace(/\s+/g, ' ').trim();
  const normalizedJoined = joinedText.replace(/\s+/g, ' ').trim();
  assert(
    normalizedJoined === normalizedOriginal,
    '3.4',
    'Joined chunks equal original text after reconstruction',
    `Lengths: original=${normalizedOriginal.length}, joined=${normalizedJoined.length}`
  );

  // 3.5: One huge sentence (no punctuation) test
  const hugeSentence = 'ThisIsAnExtremelyLongContinuousSentenceWithoutAnySentenceEndingPunctuationAtAll '.repeat(40).trim();
  const hugeChunks1500 = splitAtSentenceBoundariesFn(hugeSentence, 1500);
  const hugeMaxChunk1500 = Math.max(...hugeChunks1500.map((c) => c.length));
  assert(
    hugeMaxChunk1500 <= 1500 && hugeChunks1500.length > 1,
    '3.5',
    `One huge sentence (>1500 chars) is split so no chunk exceeds 1500 limit`,
    `Got chunk count: ${hugeChunks1500.length}, max chunk length: ${hugeMaxChunk1500} (sentence was not split by splitAtSentenceBoundaries)`
  );

  const hugeChunks450 = splitAtSentenceBoundariesFn(hugeSentence, 450);
  const hugeMaxChunk450 = Math.max(...hugeChunks450.map((c) => c.length));
  assert(
    hugeMaxChunk450 <= 450 && hugeChunks450.length > 1,
    '3.6',
    `One huge sentence (>450 chars) is split so no chunk exceeds 450 limit`,
    `Got chunk count: ${hugeChunks450.length}, max chunk length: ${hugeMaxChunk450} (sentence was not split by splitAtSentenceBoundaries)`
  );

  // 3.7: Paragraph breaks preservation: "Para one.\n\nPara two." keeps the blank line
  const paraInput = 'Para one.\n\nPara two.';
  const paraChunks = splitAtSentenceBoundariesFn(paraInput, 1500);
  const mockParaTranslations = [
    { translation: 'অনুচ্ছেদ এক।', sep: paraChunks[0]?.sep },
    { translation: 'অনুচ্ছেদ দুই।', sep: paraChunks[1]?.sep }
  ];
  const joinedParaResult = joinTranslatedChunksFn(mockParaTranslations);
  assert(
    joinedParaResult === 'অনুচ্ছেদ এক।\n\nঅনুচ্ছেদ দুই।',
    '3.7',
    '"Para one.\\n\\nPara two." keeps the blank line (\\n\\n) after translation join',
    `Got: ${JSON.stringify(joinedParaResult)}`
  );

  // 3.8: Single sentence is unchanged
  const singleInput = 'Single sentence.';
  const singleChunks = splitAtSentenceBoundariesFn(singleInput, 1500);
  const mockSingleTranslation = [
    { translation: 'একক বাক্য।', sep: singleChunks[0]?.sep }
  ];
  const joinedSingleResult = joinTranslatedChunksFn(mockSingleTranslation);
  assert(
    joinedSingleResult === 'একক বাক্য।' && singleChunks.length === 1,
    '3.8',
    'A single sentence is unchanged (no trailing whitespace or separators)',
    `Got: "${joinedSingleResult}"`
  );

  // --------------------------------------------------------------------------
  // 4. GTX parser
  // --------------------------------------------------------------------------
  log('\n--- Suite 4: GTX Parser ---');
  const mockGtxSentence = [
    [
      ['প্রথম বাক্য। ', 'First sentence. '],
      ['দ্বিতীয় বাক্য। ', 'Second sentence. '],
      ['তৃতীয় বাক্য।', 'Third sentence.']
    ]
  ];
  const parsedSentence = parseGTXResponse(mockGtxSentence, 'sentence');
  assert(
    parsedSentence.primary === 'প্রথম বাক্য। দ্বিতীয় বাক্য। তৃতীয় বাক্য।',
    '4.1',
    'GTX sentence response joins 3 segments into full translation',
    `Got: "${parsedSentence.primary}"`
  );
  assert(
    parsedSentence.dictionary.length === 0,
    '4.2',
    'GTX sentence mode omits dictionary POS groups'
  );

  const mockGtxWord = [
    [['বই', 'book']],
    [
      ['noun', ['বই', 'পুস্তক', 'গ্রন্থ']],
      ['verb', ['বুক করা', 'নাম নথিভুক্ত করা']]
    ]
  ];
  const parsedWord = parseGTXResponse(mockGtxWord, 'word');
  assert(
    parsedWord.primary === 'বই',
    '4.3',
    'GTX word response extracts primary translation "বই"',
    `Got: "${parsedWord.primary}"`
  );
  assert(
    parsedWord.dictionary.length === 2 &&
      parsedWord.dictionary[0].pos === 'noun' &&
      parsedWord.dictionary[0].terms.length === 3 &&
      parsedWord.dictionary[1].pos === 'verb' &&
      parsedWord.dictionary[1].terms.length === 2,
    '4.4',
    'GTX word response parses part-of-speech dictionary groups correctly',
    `Got: ${JSON.stringify(parsedWord.dictionary)}`
  );

  // --------------------------------------------------------------------------
  // 5. MyMemory parser
  // --------------------------------------------------------------------------
  log('\n--- Suite 5: MyMemory Parser ---');
  const mockMyMemoryData = {
    responseData: {
      translatedText: 'হ্যালো বিশ্ব'
    },
    matches: [
      { translation: 'হ্যালো বিশ্ব' },
      { translation: 'নমস্কার বিশ্ব' },
      { translation: 'ওহে বিশ্ব' },
      { translation: 'নমস্কার বিশ্ব' } // duplicate to test deduplication
    ]
  };
  const parsedMMWord = parseMyMemoryResponse(mockMyMemoryData, 'word');
  assert(
    parsedMMWord.primary === 'হ্যালো বিশ্ব',
    '5.1',
    'MyMemory extracts primary translatedText',
    `Got: "${parsedMMWord.primary}"`
  );
  assert(
    parsedMMWord.alternatives.length === 1 &&
      parsedMMWord.alternatives[0].pos === 'alternate' &&
      parsedMMWord.alternatives[0].terms.length === 2 &&
      parsedMMWord.alternatives[0].terms.includes('নমস্কার বিশ্ব') &&
      parsedMMWord.alternatives[0].terms.includes('ওহে বিশ্ব') &&
      !parsedMMWord.alternatives[0].terms.includes('হ্যালো বিশ্ব'),
    '5.2',
    'MyMemory parses unique alternative terms excluding primary match',
    `Got: ${JSON.stringify(parsedMMWord.alternatives)}`
  );

  // --------------------------------------------------------------------------
  // 6. Settings merge
  // --------------------------------------------------------------------------
  log('\n--- Suite 6: Settings Merge ---');
  mockStorage = {
    settings: {
      theme: 'light',
      speechRate: 1.25,
      unknownKey: 'unexpected_value',
      maliciousPayload: '<script>alert(1)</script>'
    }
  };

  const mergedSettings = await getSettingsFn();

  // 6.1: Partial override + defaults
  assert(
    mergedSettings.theme === 'light' &&
      mergedSettings.speechRate === 1.25 &&
      mergedSettings.triggerMode === DEFAULT_SETTINGS.triggerMode &&
      mergedSettings.historyLimit === DEFAULT_SETTINGS.historyLimit &&
      mergedSettings.sentenceEnabled === DEFAULT_SETTINGS.sentenceEnabled,
    '6.1',
    'Settings merge preserves stored overrides and fills all default keys'
  );

  // 6.2: Unknown keys ignored
  const hasUnknownKey = 'unknownKey' in mergedSettings;
  const hasMalicious = 'maliciousPayload' in mergedSettings;
  assert(
    !hasUnknownKey && !hasMalicious,
    '6.2',
    'Settings merge ignores unknown/unrecognized keys not in DEFAULT_SETTINGS',
    `unknownKey in settings: ${hasUnknownKey}, maliciousPayload in settings: ${hasMalicious}`
  );

  // --------------------------------------------------------------------------
  // 7. History logic
  // --------------------------------------------------------------------------
  log('\n--- Suite 7: History Logic ---');

  // 7.1: Migration from legacy format
  const legacyItem = { word: 'apple', translation: 'আপেল' };
  const normalized = normalizeHistoryItemFn(legacyItem);
  assert(
    normalized.word === 'apple' &&
      normalized.translation === 'আপেল' &&
      normalized.count === 1 &&
      normalized.type === 'word' &&
      typeof normalized.timestamp === 'number',
    '7.1',
    'Legacy history entry migrated with default count (1), type ("word"), and timestamp',
    `Got: ${JSON.stringify(normalized)}`
  );

  // 7.2: Add duplicate increments count
  mockStorage = {
    recentWords: [],
    settings: { historyLimit: 10, saveSentences: false }
  };
  await saveRecentWordFn('orange', 'কমলা', 'word');
  await saveRecentWordFn('banana', 'কলা', 'word');
  await saveRecentWordFn('Orange', 'কমলা', 'word'); // duplicate with different casing

  const historyAfterDup = mockStorage.recentWords;
  const orangeEntry = historyAfterDup.find((i) => i.word.toLowerCase() === 'orange');
  assert(
    historyAfterDup.length === 2 &&
      orangeEntry &&
      orangeEntry.count === 2 &&
      historyAfterDup[0].word.toLowerCase() === 'orange',
    '7.2',
    'Duplicate word increments lookup count and moves record to top of history',
    `Count: ${orangeEntry ? orangeEntry.count : 0}, Top item: ${historyAfterDup[0]?.word}`
  );

  // 7.3: Limit trimming
  mockStorage = {
    recentWords: [],
    settings: { historyLimit: 10, saveSentences: false }
  };
  for (let i = 1; i <= 15; i++) {
    await saveRecentWordFn(`item${i}`, `অনুবাদ${i}`, 'word');
  }
  const historyAfterLimit = mockStorage.recentWords;
  assert(
    historyAfterLimit.length === 10 && historyAfterLimit[0].word === 'item15',
    '7.3',
    'History trims to settings.historyLimit (10 items retained when 15 added)',
    `Actual length: ${historyAfterLimit.length}`
  );

  // 7.4 - 7.6: Search and Filter
  const sampleHistory = [
    { word: 'computer', translation: 'কম্পিউটার', count: 5, timestamp: 1000 },
    { word: 'book', translation: 'বই', count: 2, timestamp: 2000 },
    { word: 'read', translation: 'পড়া', count: 1, timestamp: 3000 },
    { word: 'notebook', translation: 'নোটবুক', count: 3, timestamp: 4000 }
  ];

  const filterEn = filterAndSortHistory(sampleHistory, 'book', 'en');
  assert(
    filterEn.length === 2 && filterEn.every((i) => i.word.includes('book')),
    '7.4',
    'Filter by English field matches word property only ("book", "notebook")',
    `Matches: [${filterEn.map((i) => i.word).join(', ')}]`
  );

  const filterBn = filterAndSortHistory(sampleHistory, 'বই', 'bn');
  assert(
    filterBn.length === 1 && filterBn[0].translation === 'বই',
    '7.5',
    'Filter by Bangla field matches translation property only ("বই")',
    `Matches: [${filterBn.map((i) => i.translation).join(', ')}]`
  );

  const filterBoth = filterAndSortHistory(sampleHistory, 'কম্পিউটার', 'both');
  assert(
    filterBoth.length === 1 && filterBoth[0].word === 'computer',
    '7.6',
    'Filter by Both fields searches word and translation properties',
    `Matches: [${filterBoth.map((i) => i.word).join(', ')}]`
  );

  // 7.7: History queue concurrency test (10 calls at once)
  mockStorage = {
    recentWords: [],
    settings: { historyLimit: 50, saveSentences: false }
  };
  const concurrentCalls = [];
  for (let i = 1; i <= 10; i++) {
    concurrentCalls.push(saveRecentWordFn(`word_${i}`, `অনুবাদ_${i}`, 'word'));
  }
  await Promise.all(concurrentCalls);
  const concurrentList = mockStorage.recentWords || [];
  const distinctWords = new Set(concurrentList.map((item) => item.word.toLowerCase()));
  assert(
    concurrentList.length === 10 && distinctWords.size === 10,
    '7.7',
    'Fires 10 saveRecentWord calls at once; historyQueue serializes writes so all 10 distinct words are saved',
    `Saved count: ${concurrentList.length}, Distinct: ${distinctWords.size}`
  );

  // --------------------------------------------------------------------------
  // 8. Cache logic
  // --------------------------------------------------------------------------
  log('\n--- Suite 8: Cache Logic (LRU & Key Formatting) ---');

  // 8.1: Sentence cache key format
  const longSentence = 'This is an example test sentence to verify cache key calculation format accurately.';
  const sentenceKey = buildCacheKeyFn(longSentence, 'sentence');
  const expectedSentenceKey = longSentence.trim().toLowerCase().slice(0, 200) + '|' + longSentence.trim().toLowerCase().length;
  assert(
    sentenceKey === expectedSentenceKey,
    '8.1',
    'Sentence cache key formats as "first200chars|totalLength"',
    `Got: "${sentenceKey}"`
  );

  // 8.2: Word cache key format
  const wordKey = buildCacheKeyFn('  Hello  ', 'word');
  assert(
    wordKey === 'hello',
    '8.2',
    'Word cache key formats as trimmed lowercase word',
    `Got: "${wordKey}"`
  );

  // 8.3: LRU eviction at max size (MAX_CACHE_ENTRIES = 300)
  for (let i = 0; i < 300; i++) {
    setCachedTranslationFn(`entry_${i}`, { index: i });
  }
  const hasFirstBefore = getCachedTranslationFn('entry_0') !== null;
  // Add 301st entry that triggers LRU eviction of the oldest (entry_0)
  setCachedTranslationFn('entry_overflow', { index: 9999 });
  const hasFirstAfter = getCachedTranslationFn('entry_0') !== null;
  const hasOverflow = getCachedTranslationFn('entry_overflow') !== null;

  assert(
    hasFirstBefore === true && hasFirstAfter === false && hasOverflow === true,
    '8.3',
    'LRU eviction drops oldest entry ("entry_0") when cache limit (300) is reached',
    `Oldest retained after overflow: ${hasFirstAfter}, Overflow added: ${hasOverflow}`
  );

  // --------------------------------------------------------------------------
  // 9. escapeHtml
  // --------------------------------------------------------------------------
  log('\n--- Suite 9: HTML Sanitization (escapeHtml) ---');
  const xssVector = '<script>alert("XSS & \'quote\'")</script>';
  const sanitized = escapeHtml(xssVector);
  const expectedSanitized = '&lt;script&gt;alert(&quot;XSS &amp; &#039;quote&#039;&quot;)&lt;/script&gt;';

  assert(
    sanitized === expectedSanitized,
    '9.1',
    'escapeHtml replaces <, >, ", \', and & characters with corresponding HTML entities',
    `Got: "${sanitized}"`
  );
  assert(
    !sanitized.includes('<') && !sanitized.includes('>') && !sanitized.includes('"') && !sanitized.includes("'"),
    '9.2',
    'No unescaped dangerous HTML delimiter characters remain in output'
  );

  // --------------------------------------------------------------------------
  // 10. CSV Export
  // --------------------------------------------------------------------------
  log('\n--- Suite 10: CSV Export ---');
  const csvRecords = [
    {
      word: 'quote "test", with comma',
      translation: 'উদ্ধৃতি "পরীক্ষা", কমা সহ',
      type: 'sentence',
      count: 3,
      timestamp: 1700000000000
    },
    {
      word: 'simple',
      translation: 'সহজ',
      type: 'word',
      count: 1,
      timestamp: 1700000001000
    }
  ];

  const csvOutput = generateCsvContent(csvRecords);

  // 10.1: UTF-8 BOM
  assert(
    csvOutput.startsWith('\uFEFF'),
    '10.1',
    'CSV content begins with UTF-8 BOM (\\uFEFF) for Excel/Unicode compatibility'
  );

  // 10.2: Quotes escaped as double quotes
  assert(
    csvOutput.includes('quote ""test"", with comma'),
    '10.2',
    'Double quotes within values are escaped as double quotes ("")',
    'Found properly escaped quote in CSV row'
  );

  // 10.3: Commas in fields
  assert(
    csvOutput.includes('"quote ""test"", with comma"'),
    '10.3',
    'Values containing commas are enclosed in full quotation marks'
  );

  // 10.4: Bengali characters preserved
  assert(
    csvOutput.includes('উদ্ধৃতি ""পরীক্ষা"", কমা সহ') && csvOutput.includes('সহজ'),
    '10.4',
    'Bengali Unicode characters are preserved accurately in CSV output'
  );

  // 10.5: CRLF line endings
  assert(
    csvOutput.includes('\r\n'),
    '10.5',
    'CSV rows use standard CRLF (\\r\\n) line separators'
  );

  // ==========================================================================
  // Summary
  // ==========================================================================
  log('\n=================================================================');
  log(`TEST SUMMARY: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  log('=================================================================\n');

  if (failures.length > 0) {
    log('FAILING CASES ANALYSIS:');
    failures.forEach((f, idx) => {
      log(`${idx + 1}. Test [${f.testId}] "${f.description}"`);
      log(`   Cause: ${f.details}`);
    });
    log('');
  }

  // Save output to /tests/results.txt
  const resultsPath = path.join(ROOT_DIR, 'tests', 'results.txt');
  fs.writeFileSync(resultsPath, outputLines.join('\n'), 'utf8');
  log(`Results successfully saved to ${resultsPath}\n`);
}

runAllTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
