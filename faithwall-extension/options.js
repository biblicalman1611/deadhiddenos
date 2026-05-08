// options.js — FaithWall options page

const $ = id => document.getElementById(id);

const CATEGORY_MAP = {
  opt_porn:     'ruleset_porn',
  opt_gambling: 'ruleset_gambling',
  opt_social:   'ruleset_social',
  opt_news:     'ruleset_news',
  opt_occult:   'ruleset_occult'
};

let originalState = null;
let hasChanges = false;

// ─── Passcode helpers ──────────────────────────────────────────────

async function hashPasscode(raw) {
  const enc = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyPasscode(raw) {
  const data = await chrome.storage.local.get(['passcodeHash']);
  if (!data.passcodeHash) return true; // no passcode set
  const hash = await hashPasscode(raw);
  return hash === data.passcodeHash;
}

// ─── Passcode overlay ──────────────────────────────────────────────

async function checkPasscodeGate() {
  const data = await chrome.storage.local.get(['passcodeEnabled', 'passcodeHash']);
  if (!data.passcodeEnabled || !data.passcodeHash) {
    showMainContent();
    return;
  }
  $('passcodeOverlay').classList.add('visible');

  $('overlaySubmit').addEventListener('click', async () => {
    const val = $('overlayPasscode').value;
    const ok = await verifyPasscode(val);
    if (ok) {
      $('passcodeOverlay').classList.remove('visible');
      showMainContent();
    } else {
      showAlert($('overlayError'), 'Incorrect passcode', 'error');
    }
  });

  $('overlayPasscode').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('overlaySubmit').click();
  });
}

function showMainContent() {
  $('mainContent').style.display = 'block';
  loadSettings();
}

// ─── Load & display settings ───────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get([
    'categories', 'customDomains', 'scheduleEnabled',
    'scheduleStart', 'scheduleEnd', 'passcodeEnabled',
    'newTabEnabled'
  ]);

  const cats = data.categories || {
    ruleset_porn: true, ruleset_gambling: true, ruleset_social: true,
    ruleset_news: true, ruleset_occult: true
  };

  // Category toggles
  Object.entries(CATEGORY_MAP).forEach(([inputId, rulesetId]) => {
    const el = $(inputId);
    if (el) el.checked = !!cats[rulesetId];
  });

  // Custom domains
  $('customDomains').value = (data.customDomains || []).join('\n');

  // Schedule
  const schedEnabled = !!data.scheduleEnabled;
  $('opt_schedule').checked = schedEnabled;
  $('scheduleFields').style.display = schedEnabled ? 'block' : 'none';
  $('scheduleStart').value = data.scheduleStart || '06:00';
  $('scheduleEnd').value = data.scheduleEnd || '21:00';

  // Passcode
  const pcEnabled = !!data.passcodeEnabled;
  $('opt_passcode_enabled').checked = pcEnabled;
  $('passcodeSetup').style.display = pcEnabled ? 'block' : 'none';

  // New tab
  $('opt_newtab').checked = data.newTabEnabled !== false; // default on

  // Snapshot for dirty detection
  originalState = captureState();
  hideSaveBar();
}

function captureState() {
  const cats = {};
  Object.entries(CATEGORY_MAP).forEach(([inputId, rulesetId]) => {
    cats[rulesetId] = $(inputId)?.checked ?? false;
  });
  return {
    cats,
    customDomains: $('customDomains').value,
    scheduleEnabled: $('opt_schedule').checked,
    scheduleStart: $('scheduleStart').value,
    scheduleEnd: $('scheduleEnd').value,
    passcodeEnabled: $('opt_passcode_enabled').checked,
    newTabEnabled: $('opt_newtab').checked
  };
}

function statesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function markDirty() {
  const current = captureState();
  if (!statesEqual(current, originalState)) {
    hasChanges = true;
    showSaveBar();
  } else {
    hasChanges = false;
    hideSaveBar();
  }
}

function showSaveBar() {
  $('saveBar').style.display = 'flex';
  $('saveStatus').textContent = 'Unsaved changes';
  $('saveStatus').className = 'save-status';
}

function hideSaveBar() {
  $('saveBar').style.display = 'none';
  hasChanges = false;
}

// ─── Save ──────────────────────────────────────────────────────────

async function saveSettings() {
  const cats = {};
  Object.entries(CATEGORY_MAP).forEach(([inputId, rulesetId]) => {
    cats[rulesetId] = $(inputId)?.checked ?? false;
  });

  // Parse custom domains
  const rawDomains = $('customDomains').value;
  const customDomains = rawDomains
    .split('\n')
    .map(d => d.trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase())
    .filter(d => d.length > 0 && d.includes('.'));

  const schedEnabled = $('opt_schedule').checked;
  const passcodeEnabled = $('opt_passcode_enabled').checked;
  const newTabEnabled = $('opt_newtab').checked;

  await chrome.storage.local.set({
    categories: cats,
    customDomains,
    scheduleEnabled: schedEnabled,
    scheduleStart: $('scheduleStart').value,
    scheduleEnd: $('scheduleEnd').value,
    passcodeEnabled,
    newTabEnabled
  });

  // Apply ruleset toggles (only if main toggle is on)
  const enabledData = await chrome.storage.local.get(['enabled']);
  if (enabledData.enabled !== false) {
    const enableIds = [];
    const disableIds = [];
    Object.values(CATEGORY_MAP).forEach(rulesetId => {
      if (cats[rulesetId]) enableIds.push(rulesetId);
      else disableIds.push(rulesetId);
    });

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enableIds,
      disableRulesetIds: disableIds
    }).catch(() => {});

    // Apply custom domain blocking via dynamic rules
    await applyCustomDomainRules(customDomains);
  }

  // Notify background to re-evaluate schedule
  await chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(() => {});

  originalState = captureState();
  hideSaveBar();

  $('saveStatus').textContent = '✓ Saved';
  $('saveStatus').className = 'save-status saved';
  $('saveBar').style.display = 'flex';
  setTimeout(() => hideSaveBar(), 2000);
}

async function applyCustomDomainRules(domains) {
  // Clear existing dynamic rules
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map(r => r.id);

  const addRules = domains.slice(0, 200).map((domain, i) => ({
    id: 10000 + i,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame', 'sub_frame']
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules
  }).catch(() => {});
}

// ─── Passcode management ───────────────────────────────────────────

$('savePasscodeBtn').addEventListener('click', async () => {
  const pw1 = $('newPasscode').value;
  const pw2 = $('confirmPasscode').value;
  const alert = $('passcodeAlert');

  if (pw1.length < 4) {
    showAlert(alert, 'Passcode must be at least 4 characters', 'error');
    return;
  }
  if (pw1 !== pw2) {
    showAlert(alert, 'Passcodes do not match', 'error');
    return;
  }

  const hash = await hashPasscode(pw1);
  await chrome.storage.local.set({ passcodeHash: hash });
  $('newPasscode').value = '';
  $('confirmPasscode').value = '';
  showAlert(alert, 'Passcode set successfully', 'success');
});

$('clearPasscodeBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['passcodeHash']);
  await chrome.storage.local.set({ passcodeEnabled: false });
  $('opt_passcode_enabled').checked = false;
  $('passcodeSetup').style.display = 'none';
  showAlert($('passcodeAlert'), 'Passcode removed', 'success');
  markDirty();
});

// ─── Schedule toggle ───────────────────────────────────────────────

$('opt_schedule').addEventListener('change', e => {
  $('scheduleFields').style.display = e.target.checked ? 'block' : 'none';
  markDirty();
});

$('opt_passcode_enabled').addEventListener('change', e => {
  $('passcodeSetup').style.display = e.target.checked ? 'block' : 'none';
  markDirty();
});

// ─── Dirty tracking ────────────────────────────────────────────────

const watchedInputs = [
  'opt_porn','opt_gambling','opt_social','opt_news','opt_occult',
  'opt_schedule','scheduleStart','scheduleEnd','opt_newtab','customDomains'
];

watchedInputs.forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('change', markDirty);
  if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'time') {
    el.addEventListener('input', markDirty);
  }
});

// ─── Save / discard buttons ────────────────────────────────────────

$('saveBtn').addEventListener('click', saveSettings);

$('discardBtn').addEventListener('click', () => {
  loadSettings();
});

// ─── Utility ──────────────────────────────────────────────────────

function showAlert(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${type}`;
  setTimeout(() => { el.className = 'alert'; el.textContent = ''; }, 3000);
}

// ─── Init ─────────────────────────────────────────────────────────

checkPasscodeGate();
