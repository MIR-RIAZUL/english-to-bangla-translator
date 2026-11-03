/**
 * Lemmatization Utility
 * Provides lightweight morphological stemming to reduce inflected English words
 * (plurals, past tense, progressive participles) to candidate dictionary roots.
 */

/**
 * Generates an array of candidate base forms for a given English word.
 * Handles -ing, -ed, -s, -es, -ies -> y, -ied -> y, and doubled consonants.
 * @param {string} word - The word to lemmatize.
 * @returns {string[]} Array of candidate root words (including the original word).
 */
function lemmatize(word) {
  try {
    if (!word || typeof word !== 'string') return [];

    const clean = word.trim().toLowerCase();
    if (!clean) return [];

    const candidates = new Set();
    candidates.add(clean);

    const len = clean.length;

    // 1. -ies -> y (e.g., cities -> city, tries -> try, babies -> baby)
    if (clean.endsWith('ies') && len > 3) {
      candidates.add(clean.slice(0, -3) + 'y');
      candidates.add(clean.slice(0, -1)); // ties -> tie, pies -> pie
    }

    // 2. -ied -> y (e.g., studied -> study, tried -> try, carried -> carry)
    if (clean.endsWith('ied') && len > 3) {
      candidates.add(clean.slice(0, -3) + 'y');
      candidates.add(clean.slice(0, -1)); // tied -> tie, died -> die
    }

    // 3. -ing (e.g., running -> run, making -> make, playing -> play)
    if (clean.endsWith('ing') && len > 4) {
      const stem = clean.slice(0, -3);

      // Plain stem (playing -> play, walking -> walk)
      candidates.add(stem);

      // Dropped silent 'e' (making -> make, writing -> write, taking -> take)
      candidates.add(stem + 'e');

      // Doubled consonant reduction (running -> run, swimming -> swim, stopping -> stop)
      if (stem.length >= 3) {
        const lastChar = stem[stem.length - 1];
        const secondLast = stem[stem.length - 2];
        const isConsonant = /[bcdfghjklmnpqrstvwxyz]/.test(lastChar);
        if (lastChar === secondLast && isConsonant) {
          candidates.add(stem.slice(0, -1));
        }
      }
    }

    // 4. -ed (e.g., walked -> walk, liked -> like, stopped -> stop)
    if (clean.endsWith('ed') && len > 3) {
      // Base ending in 'e' where only 'd' was added (liked -> like, moved -> move)
      candidates.add(clean.slice(0, -1));

      // Regular suffix removal (walked -> walk, played -> play)
      const stem = clean.slice(0, -2);
      candidates.add(stem);

      // Doubled consonant reduction (stopped -> stop, planned -> plan)
      if (stem.length >= 3) {
        const lastChar = stem[stem.length - 1];
        const secondLast = stem[stem.length - 2];
        const isConsonant = /[bcdfghjklmnpqrstvwxyz]/.test(lastChar);
        if (lastChar === secondLast && isConsonant) {
          candidates.add(stem.slice(0, -1));
        }
      }
    }

    // 5. -es (e.g., boxes -> box, watches -> watch, goes -> go, places -> place)
    if (clean.endsWith('es') && len > 3) {
      // Base ending in sibilants or o (boxes -> box, watches -> watch, goes -> go)
      candidates.add(clean.slice(0, -2));
      // Base ending in 'e' where only 's' was added (places -> place, games -> game)
      candidates.add(clean.slice(0, -1));
    }

    // 6. -s (e.g., cats -> cat, books -> book, days -> day)
    if (clean.endsWith('s') && !clean.endsWith('ss') && len > 2) {
      candidates.add(clean.slice(0, -1));
    }

    return Array.from(candidates);
  } catch (error) {
    console.error('Error during lemmatization:', error);
    return [word.trim().toLowerCase()];
  }
}

// Attach to global scope for ServiceWorker and Window contexts
if (typeof globalThis !== 'undefined') {
  globalThis.lemmatize = lemmatize;
}

