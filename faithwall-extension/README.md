# FaithWall Chrome Extension

**Guard your eyes. Renew your mind. — Philippians 4:8**

FaithWall is a Manifest V3 Chrome extension that blocks harmful and distracting content categories using Chrome's built-in `declarativeNetRequest` API. No remote code. No server calls. No telemetry. Your data stays on your device.

---

## Features

- **Static content blocking** — `declarativeNetRequest` with bundled JSON rulesets. No dynamic code loading, no network calls for rules. Chrome Web Store reviewer-friendly.
- **5 toggleable categories**: Adult Content, Gambling, Social Media, News Doomscroll, Occult/Horoscope
- **Custom block list** — add any domain you want blocked
- **Schedule** — block only during set hours (e.g., social media 6am–9pm)
- **Passcode protection** — lock settings behind a PIN so children or spouses can't disable without the parent
- **Daily KJV verse** on every new tab — black background, quiet design, scripture rotating daily from a bundled list of 50 verses (no internet required)
- **Zero telemetry** — no analytics, no tracking, no remote config. State stored entirely in `chrome.storage.local`

---

## Install (Sideload for Testing)

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `faithwall-extension/` folder
6. FaithWall will appear in your extensions bar

For production use, install from the [Chrome Web Store](https://chromewebstore.google.com) once published.

---

## Dev Workflow

```bash
# Clone
git clone https://github.com/deadhidden/faithwall-extension.git
cd faithwall-extension

# Regenerate icons (requires sharp)
npm install sharp
node gen-icons.js

# Build zip for Chrome Web Store upload
zip -r faithwall-v0.1.0.zip . \
  --exclude "*.git*" \
  --exclude "gen-icons.js" \
  --exclude "node_modules/*" \
  --exclude "*.zip" \
  --exclude "README.md"
```

No build step required. The extension is pure HTML/CSS/JS — Chrome loads it directly.

---

## File Structure

```
faithwall-extension/
├── manifest.json          # Manifest V3
├── background.js          # Service worker — schedule enforcement, install defaults
├── popup.html / popup.js  # Toolbar popup — main on/off toggle + category status
├── options.html / options.js  # Full settings page
├── newtab.html            # New tab override with daily KJV verse
├── verses.json            # 50 KJV verses (bundled, no network)
├── rulesets/
│   ├── porn.json          # Adult content ruleset (25 domains)
│   ├── gambling.json      # Gambling ruleset (20 domains)
│   ├── social.json        # Social media ruleset (15 domains)
│   ├── news.json          # News doomscroll ruleset (20 domains)
│   └── occult.json        # Occult/horoscope ruleset (20 domains)
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── gen-icons.js           # Node script to regenerate icons (requires sharp)
```

---

## Privacy Policy

**FaithWall collects no data. Period.**

- No analytics
- No crash reporting
- No remote configuration
- No data sent to any server, ever
- All settings stored locally in `chrome.storage.local` on your device
- Browsing history is never accessed, read, or stored

The extension uses `declarativeNetRequest` for blocking — Chrome evaluates the rules locally, inside the browser engine. The extension code never sees what URLs you visit.

The full privacy policy is available at: `https://faithwall.deadhidden.org/privacy`

---

## Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | Block URLs using static rulesets without the extension seeing your traffic |
| `declarativeNetRequestWithHostAccess` | Required to block `<all_urls>` with static rulesets |
| `storage` | Save your settings (on/off state, category preferences, passcode hash) locally |
| `<all_urls>` | Needed for `declarativeNetRequest` to match against any URL |

No `tabs`, no `webNavigation`, no `history`, no `cookies`.

---

## Scripture Focus

The bundled verse list covers the guard-your-eyes theme directly:

- 1 Corinthians 10:13 — God provides a way of escape
- Philippians 4:8 — think on pure things
- Psalm 101:3 — I will set no wicked thing before mine eyes
- Job 31:1 — covenant with my eyes
- Romans 12:2 — be transformed by renewing your mind
- Matthew 5:8 — blessed are the pure in heart
- 2 Timothy 2:22 — flee youthful lusts
- …and 43 more

---

## License

MIT License — see LICENSE file.

---

*FaithWall is part of the [Dead Hidden](https://deadhidden.org) product family.*
