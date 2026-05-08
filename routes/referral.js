// routes/referral.js — Bring a Brother referral system.
// OWNS: /os/refer page, /api/refer/* endpoints, /os/refer/stats admin view.
// Does NOT own: Stripe checkout, fulfillment emails, sequence sends.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  getReferralCodeForEmail, trackReferralVisit, getReferralStats,
  getBuyersNeedingCorrectiveEmail, markCorrectiveEmailSent
} = require('../db/orders');

// Canonical checkout host — deadhidden.org handles Stripe; polsia.app does not.
const APP_BASE = process.env.APP_BASE_URL || 'https://deadhidden.org';
const REFER_STATS_TOKEN = process.env.REFER_STATS_TOKEN || process.env.DASHBOARD_PASSWORD || '';

// ---- GET /os/refer — Bring a Brother landing page ----
router.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bring a Brother — Dead Hidden</title>
  <meta name="robots" content="noindex">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #111;
      --bg2: #1a1a1a;
      --bg3: #222;
      --border: rgba(139,37,0,0.2);
      --border-focus: #8b2500;
      --text: #f5f0e8;
      --text-dim: rgba(245,240,232,0.55);
      --text-faint: rgba(245,240,232,0.25);
      --accent: #8b2500;
      --accent-hover: #a02c00;
      --label: #a0522d;
      --success-bg: rgba(139,37,0,0.08);
      --success-border: rgba(139,37,0,0.3);
    }
    html { background: var(--bg); }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Georgia', serif;
      min-height: 100vh;
    }
    .site-header {
      border-bottom: 1px solid var(--border);
      padding: 18px 24px;
    }
    .brand {
      font-family: 'Arial', sans-serif;
      font-size: 0.68rem;
      letter-spacing: 5px;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
      text-decoration: none;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 72px 24px 96px;
    }
    .eyebrow {
      font-family: 'Arial', sans-serif;
      font-size: 0.68rem;
      letter-spacing: 4px;
      text-transform: uppercase;
      color: var(--label);
      font-weight: 700;
      margin-bottom: 16px;
    }
    h1 {
      font-size: clamp(1.9rem, 4.5vw, 2.8rem);
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.03em;
      color: var(--text);
      margin-bottom: 28px;
    }
    .body-text {
      font-size: 1.05rem;
      line-height: 1.8;
      color: var(--text-dim);
      margin-bottom: 18px;
    }
    .body-text strong {
      color: var(--text);
    }
    .scripture {
      border-left: 3px solid var(--accent);
      padding: 16px 20px;
      margin: 32px 0;
      background: var(--bg2);
    }
    .scripture p {
      font-style: italic;
      color: var(--text-dim);
      font-size: 0.95rem;
      line-height: 1.7;
      margin-bottom: 6px;
    }
    .scripture cite {
      font-family: 'Arial', sans-serif;
      font-size: 0.72rem;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--label);
      font-style: normal;
    }
    .form-section {
      margin-top: 48px;
      padding-top: 40px;
      border-top: 1px solid var(--border);
    }
    .form-label {
      font-family: 'Arial', sans-serif;
      font-size: 0.72rem;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--label);
      font-weight: 700;
      display: block;
      margin-bottom: 10px;
    }
    .form-input {
      width: 100%;
      background: var(--bg2);
      border: 1px solid var(--border);
      color: var(--text);
      font-family: 'Georgia', serif;
      font-size: 1rem;
      padding: 14px 16px;
      outline: none;
      transition: border-color 0.2s;
      margin-bottom: 16px;
    }
    .form-input:focus { border-color: var(--border-focus); }
    .form-input::placeholder { color: var(--text-faint); }
    .btn {
      display: inline-block;
      background: var(--accent);
      color: var(--text);
      font-family: 'Arial', sans-serif;
      font-size: 0.78rem;
      letter-spacing: 3px;
      text-transform: uppercase;
      font-weight: 700;
      padding: 16px 32px;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result-box {
      display: none;
      margin-top: 32px;
      padding: 24px;
      background: var(--success-bg);
      border: 1px solid var(--success-border);
    }
    .result-box.visible { display: block; }
    .result-label {
      font-family: 'Arial', sans-serif;
      font-size: 0.7rem;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--label);
      font-weight: 700;
      margin-bottom: 12px;
    }
    .result-link {
      font-family: 'Arial', sans-serif;
      font-size: 0.88rem;
      color: var(--text);
      word-break: break-all;
      background: var(--bg3);
      padding: 12px 16px;
      display: block;
      margin-bottom: 14px;
    }
    .copy-btn {
      background: transparent;
      border: 1px solid var(--border-focus);
      color: var(--accent);
      font-family: 'Arial', sans-serif;
      font-size: 0.72rem;
      letter-spacing: 3px;
      text-transform: uppercase;
      font-weight: 700;
      padding: 10px 20px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .copy-btn:hover { background: var(--accent); color: var(--text); }
    .copy-btn.copied { background: var(--accent); color: var(--text); }
    .error-msg {
      display: none;
      margin-top: 14px;
      color: #c46030;
      font-family: 'Arial', sans-serif;
      font-size: 0.85rem;
    }
    .error-msg.visible { display: block; }
    .note {
      margin-top: 32px;
      font-family: 'Arial', sans-serif;
      font-size: 0.75rem;
      color: var(--text-faint);
      line-height: 1.6;
    }
  </style>
</head>
<body>
<header class="site-header">
  <a href="/" class="brand">Dead Hidden</a>
</header>
<main class="container">
  <div class="eyebrow">Bring a Brother</div>
  <h1>You know what it did.<br>Pass it on.</h1>

  <p class="body-text">You didn't buy a PDF. You drew a line. The field manual cracked something open — a conviction, a conversation, a decision to stop drifting.</p>

  <p class="body-text">Somewhere in your circle is a man still running the good-man loop. Still going through motions. Still mistaking church attendance for standing on the Word.</p>

  <p class="body-text"><strong>Send him your link. No pitch needed. Just: read this.</strong></p>

  <div class="scripture">
    <p>"Iron sharpeneth iron; so a man sharpeneth the countenance of his friend."</p>
    <cite>Proverbs 27:17</cite>
  </div>

  <p class="body-text">Enter your buyer email below. We'll generate your personal link. No commission — this isn't a program. It's a brotherhood mechanic.</p>

  <div class="form-section">
    <label class="form-label" for="buyer-email">Your buyer email</label>
    <input
      type="email"
      id="buyer-email"
      class="form-input"
      placeholder="the email you bought with"
      autocomplete="email"
    />
    <button class="btn" id="get-link-btn" onclick="getLink()">Get my link</button>

    <div class="error-msg" id="error-msg"></div>

    <div class="result-box" id="result-box">
      <div class="result-label">Your personal link</div>
      <code class="result-link" id="result-link"></code>
      <button class="copy-btn" id="copy-btn" onclick="copyLink()">Copy link</button>
    </div>

    <p class="note">This link is tied to your purchase. When someone clicks it and buys, we know you sent them. That's it.</p>
  </div>
</main>

<script>
async function getLink() {
  const email = document.getElementById('buyer-email').value.trim();
  const btn = document.getElementById('get-link-btn');
  const errEl = document.getElementById('error-msg');
  const resultBox = document.getElementById('result-box');
  const resultLink = document.getElementById('result-link');

  errEl.classList.remove('visible');
  resultBox.classList.remove('visible');

  if (!email) {
    errEl.textContent = 'Enter the email you used to buy the manual.';
    errEl.classList.add('visible');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Looking up...';

  try {
    const res = await fetch('/api/refer/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (!res.ok || !data.ref_code) {
      errEl.textContent = data.error || 'No purchase found for that email. Reply to your fulfillment email if you think this is wrong.';
      errEl.classList.add('visible');
    } else {
      resultLink.textContent = data.referral_url;
      resultBox.classList.add('visible');
    }
  } catch (e) {
    errEl.textContent = 'Something went wrong. Try again.';
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get my link';
  }
}

function copyLink() {
  const link = document.getElementById('result-link').textContent;
  const btn = document.getElementById('copy-btn');
  navigator.clipboard.writeText(link).then(() => {
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy link';
      btn.classList.remove('copied');
    }, 2000);
  });
}

document.getElementById('buyer-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') getLink();
});
</script>
</body>
</html>`);
});

// ---- POST /lookup — validate buyer email and return referral URL ----
// Mounted at /api/refer/lookup via server.js
router.post('/lookup', async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const refCode = await getReferralCodeForEmail(email.trim());
    if (!refCode) {
      return res.status(404).json({ error: 'No purchase found for that email.' });
    }

    const referralUrl = `${APP_BASE}/checkout?slug=biblical-man-field-manual&ref=${refCode}`;
    return res.json({ ref_code: refCode, referral_url: referralUrl });
  } catch (err) {
    console.error('[refer/lookup] error:', err.message);
    return res.status(500).json({ error: 'Server error. Try again.' });
  }
});

// ---- GET /os/refer/stats — admin view, token-gated ----
router.get('/stats', async (req, res) => {
  const token = req.query.token;
  if (!REFER_STATS_TOKEN || token !== REFER_STATS_TOKEN) {
    return res.status(401).type('html').send(`<!DOCTYPE html>
<html><head><title>Stats — Dead Hidden</title>
<style>body{font-family:system-ui;background:#111;color:#f5f0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
.box{text-align:center;max-width:400px;padding:40px;}h1{font-size:1.1rem;margin-bottom:8px;}p{color:rgba(245,240,232,0.45);font-size:0.88rem;}</style>
</head><body><div class="box"><h1>Access denied</h1><p>Add ?token=YOUR_DASHBOARD_PASSWORD to view stats.</p></div></body></html>`);
  }

  try {
    const stats = await getReferralStats();
    const rows = stats.map(r => `
      <tr>
        <td style="padding:10px 16px;font-family:monospace;font-size:0.85rem;color:#c46030;">${r.ref_code}</td>
        <td style="padding:10px 16px;text-align:right;">${r.visits}</td>
        <td style="padding:10px 16px;text-align:right;color:${r.conversions > 0 ? '#4ade80' : 'rgba(245,240,232,0.4)'};">${r.conversions}</td>
        <td style="padding:10px 16px;text-align:right;color:rgba(245,240,232,0.4);font-size:0.82rem;">
          ${r.visits > 0 ? ((r.conversions / r.visits) * 100).toFixed(1) + '%' : '—'}
        </td>
      </tr>`).join('');

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Referral Stats — Dead Hidden</title>
  <style>
    body { font-family: 'Georgia', serif; background: #111; color: #f5f0e8; margin: 0; padding: 48px 24px; }
    .brand { font-family: Arial, sans-serif; font-size: 0.68rem; letter-spacing: 5px; text-transform: uppercase; color: #8b2500; font-weight: 700; margin-bottom: 32px; display: block; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.02em; }
    .subtitle { color: rgba(245,240,232,0.45); font-size: 0.85rem; font-family: Arial, sans-serif; margin-bottom: 40px; }
    table { width: 100%; max-width: 800px; border-collapse: collapse; }
    thead th { font-family: Arial, sans-serif; font-size: 0.68rem; letter-spacing: 3px; text-transform: uppercase; color: rgba(245,240,232,0.4); text-align: left; padding: 0 16px 12px; }
    thead th:not(:first-child) { text-align: right; }
    tbody tr { border-top: 1px solid rgba(139,37,0,0.15); }
    tbody tr:hover { background: rgba(245,240,232,0.03); }
    .empty { color: rgba(245,240,232,0.35); font-size: 0.9rem; padding: 24px 0; font-family: Arial, sans-serif; }
  </style>
</head>
<body>
  <span class="brand">Dead Hidden</span>
  <h1>Bring a Brother — Referral Stats</h1>
  <p class="subtitle">Generated ${new Date().toISOString().slice(0,19).replace('T',' ')} UTC</p>
  <table>
    <thead>
      <tr>
        <th>Ref Code</th>
        <th>Visits</th>
        <th>Conversions</th>
        <th>CVR</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="4" class="empty">No referral visits yet.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`);
  } catch (err) {
    console.error('[refer/stats] error:', err.message);
    res.status(500).type('html').send('<html><body style="background:#111;color:#f5f0e8;padding:40px;font-family:system-ui;">Stats unavailable. Check server logs.</body></html>');
  }
});

// ---- POST /send-corrective — send corrective email to buyers with broken referral links ----
// Token-gated. Sends from adam@deadhidden.org via Resend.
// Idempotent: skips buyers already marked referral_corrective_sent_at.
router.post('/send-corrective', async (req, res) => {
  const token = req.query.token || req.body.token;
  if (!REFER_STATS_TOKEN || token !== REFER_STATS_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(503).json({ error: 'RESEND_API_KEY not configured' });
  }

  try {
    const buyers = await getBuyersNeedingCorrectiveEmail();
    if (buyers.length === 0) {
      return res.json({ success: true, sent: 0, message: 'All corrective emails already sent.' });
    }

    // Respond immediately — sends happen async
    res.json({
      success: true,
      queued: buyers.length,
      message: `Sending corrective email to ${buyers.length} buyers.`
    });

    // Async send loop with 1.2s stagger
    (async () => {
      let sent = 0;
      let errors = 0;

      for (let i = 0; i < buyers.length; i++) {
        const buyer = buyers[i];
        const referralUrl = `${APP_BASE}/checkout?slug=biblical-man-field-manual&ref=${buyer.hash}`;

        const html = buildCorrectiveEmailHtml(referralUrl);
        const text = buildCorrectiveEmailText(referralUrl);

        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${resendKey}`
            },
            body: JSON.stringify({
              from: 'Adam <adam@deadhidden.org>',
              to: [buyer.email],
              reply_to: 'thebiblicalman1611@gmail.com',
              subject: 'Your referral link — fixed.',
              html,
              text
            })
          });

          if (response.ok) {
            await markCorrectiveEmailSent(buyer.id);
            sent++;
            console.log(`[refer/corrective] ✓ ${buyer.email} | hash=${buyer.hash}`);
          } else {
            const errBody = await response.text().catch(() => 'unknown');
            errors++;
            console.error(`[refer/corrective] ✗ ${buyer.email} | HTTP ${response.status}: ${errBody}`);
          }
        } catch (err) {
          errors++;
          console.error(`[refer/corrective] ✗ ${buyer.email} | error: ${err.message}`);
        }

        // 1.2s stagger between sends
        if (i < buyers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
      }

      console.log(`[refer/corrective] Complete: ${sent} sent, ${errors} errors out of ${buyers.length}`);
    })().catch(err => {
      console.error('[refer/corrective] Async send loop error:', err.message);
    });

  } catch (err) {
    console.error('[refer/corrective] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to send corrective emails: ' + err.message });
    }
  }
});

// ---- Corrective email template ----
// Short, direct. Acknowledges the broken link, provides the fixed one.
function buildCorrectiveEmailHtml(referralUrl) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#8b2500; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.3rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:24px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .bold { color:#f5f0e8; font-weight:600; }
  .cta-block { text-align:center; margin:28px 0; }
  .cta-btn { display:inline-block; background:#8b2500; color:#f5f0e8; text-decoration:none; font-weight:700; font-size:0.88rem; padding:14px 28px; letter-spacing:0.02em; font-family:'Arial',sans-serif; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Dead Hidden</div>
  <div class="title">Your referral link — fixed.</div>

  <p>The referral link I sent you earlier was broken. That's on me.</p>

  <p>Here's the one that works. <span class="bold">Same link, same attribution — just pointing to the right place now.</span></p>

  <div class="cta-block">
    <a href="${referralUrl}" class="cta-btn">Your referral link &rarr;</a>
  </div>

  <p style="font-size:0.88rem;color:rgba(245,240,232,0.45);">Send it to a brother who needs the manual. When he buys through your link, we know you sent him.</p>

  <div class="footer">
    Dead Hidden — deadhidden.org<br>
    Reply with questions — adam@deadhidden.org
  </div>
</div>
</body>
</html>`;
}

function buildCorrectiveEmailText(referralUrl) {
  return `DEAD HIDDEN

Your referral link — fixed.

The referral link I sent you earlier was broken. That's on me.

Here's the one that works. Same link, same attribution — just pointing to the right place now.

Your referral link: ${referralUrl}

Send it to a brother who needs the manual. When he buys through your link, we know you sent him.

---
Dead Hidden — deadhidden.org
Reply with questions — adam@deadhidden.org`;
}

module.exports = router;
