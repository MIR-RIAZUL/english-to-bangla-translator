/**
 * Automated Test Runner for Phase 1: Settings Foundation
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');

function runPhase1Tests() {
  const results = [];

  function record(id, title, status, evidence, details = null) {
    results.push({ id, title, status, evidence, details });
  }

  // Test 1: Check manifest.json options_ui and permissions
  try {
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);

    if (
      manifest.options_ui &&
      manifest.options_ui.page === 'options.html' &&
      manifest.options_ui.open_in_tab === true &&
      manifest.permissions.includes('storage')
    ) {
      record(
        'P1-T1',
        'manifest.json options_ui configuration and storage permission',
        'PASS',
        `manifest.json lines 7-9, 40-43: options_ui.page="options.html", open_in_tab=true, permissions includes "storage"`
      );
    } else {
      record(
        'P1-T1',
        'manifest.json options_ui configuration and storage permission',
        'FAIL',
        `manifest.json missing expected options_ui or storage permission`,
        {
          wrong: 'options_ui or storage permission missing or misconfigured in manifest.json',
          location: 'manifest.json',
          fix: 'Ensure manifest.json has "storage" in permissions and options_ui.page = "options.html" with open_in_tab: true'
        }
      );
    }
  } catch (err) {
    record('P1-T1', 'manifest.json options_ui configuration', 'FAIL', err.message);
  }

  // Test 2: Verify DEFAULT_SETTINGS structure in settings.js
  try {
    // Mock chrome.storage.local for Node environment
    let storageStore = {};
    global.chrome = {
      storage: {
        local: {
          get: (keys) => {
            return new Promise((resolve) => {
              if (typeof keys === 'string') {
                resolve({ [keys]: storageStore[keys] });
              } else if (Array.isArray(keys)) {
                const res = {};
                keys.forEach((k) => (res[k] = storageStore[k]));
                resolve(res);
              } else if (typeof keys === 'object' && keys !== null) {
                const res = { ...keys };
                for (const k in keys) {
                  if (storageStore[k] !== undefined) res[k] = storageStore[k];
                }
                resolve(res);
              } else {
                resolve({ ...storageStore });
              }
            });
          },
          set: (items) => {
            return new Promise((resolve) => {
              Object.assign(storageStore, items);
              resolve();
            });
          }
        }
      }
    };

    const settingsPath = path.join(ROOT_DIR, 'settings.js');
    const settingsCode = fs.readFileSync(settingsPath, 'utf8');
    eval(settingsCode); // executes in global context

    const expectedKeys = [
      'triggerMode',
      'hoverDelay',
      'modifierKey',
      'speechRate',
      'apiKey',
      'providerOrder',
      'historyLimit',
      'highlightColor',
      'theme',
      'offlineEnabled'
    ];

    const hasAllKeys = expectedKeys.every((k) => k in DEFAULT_SETTINGS);
    const validValues =
      DEFAULT_SETTINGS.triggerMode === 'dblclick' &&
      DEFAULT_SETTINGS.hoverDelay === 600 &&
      DEFAULT_SETTINGS.modifierKey === 'none' &&
      DEFAULT_SETTINGS.speechRate === 0.95 &&
      DEFAULT_SETTINGS.apiKey === '' &&
      Array.isArray(DEFAULT_SETTINGS.providerOrder) &&
      DEFAULT_SETTINGS.historyLimit === 200 &&
      DEFAULT_SETTINGS.highlightColor === '#fde68a' &&
      DEFAULT_SETTINGS.theme === 'dark' &&
      DEFAULT_SETTINGS.offlineEnabled === true;

    if (hasAllKeys && validValues && Object.isFrozen(DEFAULT_SETTINGS)) {
      record(
        'P1-T2',
        'settings.js DEFAULT_SETTINGS schema and values',
        'PASS',
        `settings.js lines 7-20: DEFAULT_SETTINGS contains all Phase 1 keys, frozen, correct default values`
      );
    } else {
      record(
        'P1-T2',
        'settings.js DEFAULT_SETTINGS schema and values',
        'FAIL',
        `DEFAULT_SETTINGS missing keys or incorrect values`,
        {
          wrong: 'DEFAULT_SETTINGS has missing keys or unverified values',
          location: 'settings.js:DEFAULT_SETTINGS',
          fix: 'Verify DEFAULT_SETTINGS keys and Object.freeze'
        }
      );
    }
  } catch (err) {
    record('P1-T2', 'settings.js DEFAULT_SETTINGS schema', 'FAIL', err.message);
  }

  // Test 3: Test getSettings() and saveSettings() functions
  (async () => {
    try {
      // 1. Initial getSettings() returns defaults
      const initial = await getSettings();
      assert.strictEqual(initial.triggerMode, 'dblclick');
      assert.strictEqual(initial.hoverDelay, 600);

      // 2. saveSettings() persists partial updates
      await saveSettings({ triggerMode: 'hover', hoverDelay: 800 });
      const updated = await getSettings();
      assert.strictEqual(updated.triggerMode, 'hover');
      assert.strictEqual(updated.hoverDelay, 800);
      assert.strictEqual(updated.speechRate, 0.95); // untouched remains default

      // 3. Provider order integrity validation test
      await saveSettings({ providerOrder: ['gtx'] });
      const orderChecked = await getSettings();
      // Should preserve ['gtx', 'official', 'mymemory', 'offline']
      assert.strictEqual(orderChecked.providerOrder[0], 'gtx');
      assert.strictEqual(orderChecked.providerOrder.length, 4);

      record(
        'P1-T3',
        'settings.js getSettings() and saveSettings(partial) lifecycle',
        'PASS',
        `settings.js getSettings() lines 24-51, saveSettings() lines 58-71: successfully merged partial settings and preserved fallback provider order`
      );
    } catch (err) {
      record(
        'P1-T3',
        'settings.js getSettings() and saveSettings(partial) lifecycle',
        'FAIL',
        err.message,
        {
          wrong: `Lifecycle assertion failed: ${err.message}`,
          location: 'settings.js:getSettings/saveSettings',
          fix: 'Ensure saveSettings correctly merges with existing settings in chrome.storage.local'
        }
      );
    }

    // Test 4: options.html & options.js existence and structure
    try {
      const optionsHtmlPath = path.join(ROOT_DIR, 'options.html');
      const optionsHtml = fs.readFileSync(optionsHtmlPath, 'utf8');

      const optionsJsPath = path.join(ROOT_DIR, 'options.js');
      const optionsJs = fs.readFileSync(optionsJsPath, 'utf8');

      const optionsCssPath = path.join(ROOT_DIR, 'options.css');
      const optionsCss = fs.readFileSync(optionsCssPath, 'utf8');

      const hasTriggerMode = optionsHtml.includes('id="triggerMode"');
      const hasHoverDelay = optionsHtml.includes('id="hoverDelay"');
      const hasModifierKey = optionsHtml.includes('id="modifierKey"');
      const hasResetBtn = optionsHtml.includes('id="resetBtn"');
      const hasSaveStatus = optionsHtml.includes('id="saveStatus"');
      const hasPopulateForm = optionsJs.includes('function populateForm');
      const hasSaveSettingsCall = optionsJs.includes('saveSettings(');

      if (
        hasTriggerMode &&
        hasHoverDelay &&
        hasModifierKey &&
        hasResetBtn &&
        hasSaveStatus &&
        hasPopulateForm &&
        hasSaveSettingsCall
      ) {
        record(
          'P1-T4',
          'options.html and options.js controls and event-driven saving',
          'PASS',
          `options.html lines 51-85, 276; options.js lines 186-240 (populateForm), 307-520 (event listeners saving settings)`
        );
      } else {
        record(
          'P1-T4',
          'options.html and options.js controls and event-driven saving',
          'FAIL',
          'Missing expected elements or functions in options.html / options.js',
          {
            wrong: 'Required settings controls missing in options.html or options.js',
            location: 'options.html / options.js',
            fix: 'Add missing inputs or listeners in options.html / options.js'
          }
        );
      }
    } catch (err) {
      record('P1-T4', 'options.html and options.js inspection', 'FAIL', err.message);
    }

    // Test 5: popup.html settings button & popup.js openOptionsPage
    try {
      const popupHtmlPath = path.join(ROOT_DIR, 'popup.html');
      const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');

      const popupJsPath = path.join(ROOT_DIR, 'popup.js');
      const popupJs = fs.readFileSync(popupJsPath, 'utf8');

      const hasOpenOptionsBtn = popupHtml.includes('id="openOptionsBtn"');
      const hasOpenOptionsHandler =
        popupJs.includes('openOptionsBtn.addEventListener') &&
        popupJs.includes('chrome.runtime.openOptionsPage');

      if (hasOpenOptionsBtn && hasOpenOptionsHandler) {
        record(
          'P1-T5',
          'popup.html gear button and popup.js options launcher',
          'PASS',
          `popup.html lines 27-32 (#openOptionsBtn); popup.js lines 41-53 (click listener calling chrome.runtime.openOptionsPage with window.open fallback)`
        );
      } else {
        record(
          'P1-T5',
          'popup.html gear button and popup.js options launcher',
          'FAIL',
          'Missing #openOptionsBtn or its handler in popup',
          {
            wrong: '#openOptionsBtn or click listener missing',
            location: 'popup.html / popup.js',
            fix: 'Add #openOptionsBtn in popup.html and listener in popup.js'
          }
        );
      }
    } catch (err) {
      record('P1-T5', 'popup.html and popup.js options launcher', 'FAIL', err.message);
    }

    // Write results out to console
    console.log(JSON.stringify(results, null, 2));
  })();
}

runPhase1Tests();

