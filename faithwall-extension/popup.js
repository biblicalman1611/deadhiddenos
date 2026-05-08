// popup.js — FaithWall popup controller

const RULESETS = ['ruleset_porn', 'ruleset_gambling', 'ruleset_social', 'ruleset_news', 'ruleset_occult'];

const $ = id => document.getElementById(id);

async function loadState() {
  const data = await chrome.storage.local.get(['enabled', 'categories', 'blockedToday']);
  const enabled = data.enabled !== false; // default on
  const categories = data.categories || {
    ruleset_porn: true,
    ruleset_gambling: true,
    ruleset_social: true,
    ruleset_news: true,
    ruleset_occult: true
  };
  const blockedToday = data.blockedToday || 0;

  // Main toggle
  $('mainToggle').checked = enabled;
  updateStatusBadge(enabled);

  // Category toggles
  RULESETS.forEach(id => {
    const el = document.querySelector(`[data-ruleset="${id}"]`);
    if (el) el.checked = !!categories[id];
  });

  // Blocked count
  $('blockedCount').textContent = blockedToday;
}

function updateStatusBadge(enabled) {
  const badge = $('statusBadge');
  const text = $('statusText');
  if (enabled) {
    badge.className = 'status-badge active';
    text.textContent = 'Active — Guarding';
  } else {
    badge.className = 'status-badge inactive';
    text.textContent = 'Inactive';
  }
}

async function setMainToggle(enabled) {
  await chrome.storage.local.set({ enabled });
  updateStatusBadge(enabled);

  // Enable/disable all currently-on rulesets
  const data = await chrome.storage.local.get(['categories']);
  const categories = data.categories || {};

  const enableIds = [];
  const disableIds = [];

  RULESETS.forEach(id => {
    if (categories[id] !== false) {
      if (enabled) enableIds.push(id);
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

async function setCategoryToggle(rulesetId, on) {
  const data = await chrome.storage.local.get(['enabled', 'categories']);
  const enabled = data.enabled !== false;
  const categories = data.categories || {};
  categories[rulesetId] = on;
  await chrome.storage.local.set({ categories });

  // Only actually toggle the ruleset if main switch is on
  if (enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: on ? [rulesetId] : [],
      disableRulesetIds: on ? [] : [rulesetId]
    }).catch(() => {});
  }
}

// Wire events
$('mainToggle').addEventListener('change', e => {
  setMainToggle(e.target.checked);
});

RULESETS.forEach(id => {
  const el = document.querySelector(`[data-ruleset="${id}"]`);
  if (el) {
    el.addEventListener('change', e => setCategoryToggle(id, e.target.checked));
  }
});

$('optionsLink').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Init
loadState();
