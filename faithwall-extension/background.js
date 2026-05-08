// background.js — FaithWall service worker (Manifest V3)
// No remote code, no network calls for rules. All state in chrome.storage.local.

const RULESETS = ['ruleset_porn', 'ruleset_gambling', 'ruleset_social', 'ruleset_news', 'ruleset_occult'];

// ─── Install / upgrade ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // First install — set sensible defaults
    await chrome.storage.local.set({
      enabled: true,
      categories: {
        ruleset_porn: true,
        ruleset_gambling: true,
        ruleset_social: true,
        ruleset_news: true,
        ruleset_occult: true
      },
      customDomains: [],
      scheduleEnabled: false,
      scheduleStart: '06:00',
      scheduleEnd: '21:00',
      passcodeEnabled: false,
      newTabEnabled: true,
      blockedToday: 0,
      blockedDate: null
    });

    // Enable all rulesets
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: RULESETS,
      disableRulesetIds: []
    }).catch(() => {});

    console.log('[FaithWall] Installed. Guarding enabled.');
  }

  if (details.reason === 'update') {
    // Re-apply ruleset state on update in case manifest reset them
    await applyRulesetState();
  }
});

// ─── Blocked request counter ───────────────────────────────────────

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  incrementBlockedCount();
});

async function incrementBlockedCount() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(['blockedToday', 'blockedDate']);

  if (data.blockedDate !== today) {
    // New day — reset
    await chrome.storage.local.set({ blockedToday: 1, blockedDate: today });
  } else {
    await chrome.storage.local.set({ blockedToday: (data.blockedToday || 0) + 1 });
  }
}

// ─── Schedule enforcement ──────────────────────────────────────────
// Check every minute whether we're in/out of the scheduled window
// and apply/remove blocking accordingly.

const ALARM_NAME = 'faithwall_schedule_check';

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await enforceSchedule();
  }
});

async function enforceSchedule() {
  const data = await chrome.storage.local.get([
    'scheduleEnabled', 'scheduleStart', 'scheduleEnd', 'enabled', 'categories'
  ]);

  if (!data.scheduleEnabled) return;

  const now = new Date();
  const [startH, startM] = (data.scheduleStart || '06:00').split(':').map(Number);
  const [endH, endM]   = (data.scheduleEnd   || '21:00').split(':').map(Number);

  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const startMins = startH * 60 + startM;
  const endMins   = endH * 60 + endM;

  const inWindow = startMins <= endMins
    ? (nowMins >= startMins && nowMins < endMins)   // same-day window
    : (nowMins >= startMins || nowMins < endMins);  // overnight window

  // Only auto-toggle if main switch is on
  if (!data.enabled) return;

  const cats = data.categories || {};
  const enableIds = [];
  const disableIds = [];

  RULESETS.forEach(id => {
    if (cats[id] !== false) {
      if (inWindow) enableIds.push(id);
      else disableIds.push(id);
    }
  });

  if (enableIds.length || disableIds.length) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enableIds,
      disableRulesetIds: disableIds
    }).catch(() => {});
  }
}

// ─── Message handler ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_UPDATED') {
    // Re-evaluate schedule immediately when settings change
    enforceSchedule().then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async
  }
});

// ─── Apply ruleset state from storage ─────────────────────────────

async function applyRulesetState() {
  const data = await chrome.storage.local.get(['enabled', 'categories']);
  const enabled = data.enabled !== false;
  const cats = data.categories || {};

  const enableIds = [];
  const disableIds = [];

  RULESETS.forEach(id => {
    if (!enabled || cats[id] === false) disableIds.push(id);
    else enableIds.push(id);
  });

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enableIds,
    disableRulesetIds: disableIds
  }).catch(() => {});
}

// Apply on every service worker startup (MV3 worker can be killed/restarted)
applyRulesetState();
