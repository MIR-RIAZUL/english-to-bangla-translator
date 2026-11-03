/**
 * TTS (Text-to-Speech) Module
 * Provides cross-language speech synthesis with Bangla voice detection,
 * voice loading with timeout fallback, and a unified speak() interface.
 */

/** @type {SpeechSynthesisVoice|null} Cached Bangla voice reference */
let _cachedBanglaVoice = null;

/** @type {boolean} Whether voice detection has completed at least once */
let _voicesLoaded = false;

/**
 * Loads the browser's available speech synthesis voices.
 * Waits for the "voiceschanged" event with a 1.5-second timeout fallback,
 * since some browsers populate voices asynchronously.
 * @returns {Promise<SpeechSynthesisVoice[]>} Resolved list of available voices.
 */
function loadVoices() {
  return new Promise((resolve) => {
    try {
      if (!('speechSynthesis' in window)) {
        _voicesLoaded = true;
        resolve([]);
        return;
      }

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        _voicesLoaded = true;
        resolve(voices);
        return;
      }

      let settled = false;

      /**
       * Handler for the voiceschanged event.
       */
      function onVoicesChanged() {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        _voicesLoaded = true;
        resolve(window.speechSynthesis.getVoices() || []);
      }

      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);

      // Timeout fallback: resolve with whatever is available after 1.5s
      setTimeout(() => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        _voicesLoaded = true;
        resolve(window.speechSynthesis.getVoices() || []);
      }, 1500);
    } catch (err) {
      _voicesLoaded = true;
      resolve([]);
    }
  });
}

/**
 * Finds the best available Bangla voice.
 * Preference order: bn-BD (Bangladesh), then bn-IN (India), then any voice
 * whose lang starts with "bn".
 * @returns {Promise<SpeechSynthesisVoice|null>} The best Bangla voice, or null if none found.
 */
async function findBanglaVoice() {
  try {
    if (_cachedBanglaVoice) return _cachedBanglaVoice;

    const voices = await loadVoices();
    if (!voices || voices.length === 0) return null;

    // Prefer bn-BD (Bangladesh Bengali)
    let voice = voices.find((v) => v.lang === 'bn-BD');
    if (voice) {
      _cachedBanglaVoice = voice;
      return voice;
    }

    // Next prefer bn-IN (Indian Bengali)
    voice = voices.find((v) => v.lang === 'bn-IN');
    if (voice) {
      _cachedBanglaVoice = voice;
      return voice;
    }

    // Fallback: any voice whose lang starts with "bn"
    voice = voices.find((v) => v.lang && v.lang.startsWith('bn'));
    if (voice) {
      _cachedBanglaVoice = voice;
      return voice;
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Speaks the given text using the Web Speech API.
 * @param {string} text - The text to speak.
 * @param {string} lang - BCP 47 language tag (e.g. "en-US", "bn-BD").
 * @param {number} rate - Speech playback rate (0.1–10, typically 0.5–2).
 * @param {HTMLElement} [buttonElement] - Optional button to visually indicate playback state.
 */
function speak(text, lang, rate, buttonElement) {
  if (!('speechSynthesis' in window)) return;
  if (!text || typeof text !== 'string') return;

  try {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang || 'en-US';
    utterance.rate = typeof rate === 'number' && rate > 0 ? rate : 0.95;

    // If speaking Bangla, attach the detected voice object
    if (lang && lang.startsWith('bn') && _cachedBanglaVoice) {
      utterance.voice = _cachedBanglaVoice;
    }

    if (buttonElement) {
      buttonElement.classList.add('playing');
      utterance.onend = () => { buttonElement.classList.remove('playing'); };
      utterance.onerror = () => { buttonElement.classList.remove('playing'); };
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    if (buttonElement) {
      buttonElement.classList.remove('playing');
    }
    console.warn('TTS speak error:', err);
  }
}

// Expose on global scope for content script, popup, and options contexts
if (typeof globalThis !== 'undefined') {
  globalThis.loadVoices = loadVoices;
  globalThis.findBanglaVoice = findBanglaVoice;
  globalThis.speak = speak;
}

