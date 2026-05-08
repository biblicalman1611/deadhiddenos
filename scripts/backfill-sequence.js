/**
 * One-time backfill script: sends T+0 welcome email to all existing buyers
 * who haven't received step 0 yet.
 *
 * Usage: node scripts/backfill-sequence.js
 *
 * Reads DATABASE_URL and POLSIA_API_KEY from env.
 * Idempotent — safe to run multiple times.
 */

'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}
if (!process.env.POLSIA_API_KEY) {
  console.error('ERROR: POLSIA_API_KEY not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ---- Product category guesser (mirrors server.js) ----
function guessProductCategory(amount, productName) {
  if (productName) {
    const n = productName.toLowerCase();
    if (n.includes('woman') || n.includes('women')) return 'woman';
    if (n.includes('man') || n.includes('men')) return 'man';
    if (n.includes('bundle') || n.includes('household')) return 'bundle';
    if (n.includes('pro')) return 'pro';
    if (n.includes('battle') || n.includes('soldier')) return 'warfare';
    if (n.includes('map') || n.includes('dead')) return 'warfare';
  }
  const amt = parseFloat(amount);
  if (amt >= 100) return 'bundle';
  if (amt >= 60) return 'manual';
  if (amt >= 25) return 'pro';
  return 'warfare';
}

// ---- Step 0 email builder (mirrors server.js) ----
function buildStep0Email(amount, productName) {
  const category = guessProductCategory(amount, productName);
  const resourceLibraryUrl = 'https://deadhidden.org/library';

  let adjacentResource, adjacentLabel;
  if (category === 'man' || category === 'bundle') {
    adjacentResource = 'https://deadhidden.org/library#spiritual-warfare';
    adjacentLabel = 'Spiritual Warfare in the New Testament — free deep-cut in the library';
  } else if (category === 'woman') {
    adjacentResource = 'https://deadhidden.org/library#biblical-womanhood';
    adjacentLabel = 'Biblical Womanhood: What the Text Actually Says — library archive';
  } else {
    adjacentResource = 'https://deadhidden.org/library#masculinity';
    adjacentLabel = "The Masculinity Crisis Is a Theology Crisis — start here if you haven't";
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#1a1a1a; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#8b2500; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.55rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:32px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .em { color:#f5f0e8; font-style:italic; }
  .bold { color:#f5f0e8; font-weight:600; font-style:normal; }
  .divider { border:none; border-top:1px solid rgba(139,37,0,0.18); margin:30px 0; }
  .resource-block { background:#252525; border-left:3px solid #8b2500; padding:16px 20px; margin:24px 0; }
  .resource-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a0522d; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .resource-link { color:#c46030; text-decoration:none; font-size:0.92rem; line-height:1.5; }
  .next-up { background:rgba(139,37,0,0.08); border:1px solid rgba(139,37,0,0.15); padding:16px 20px; margin:28px 0; border-radius:2px; }
  .next-up p { font-size:0.87rem; color:rgba(245,240,232,0.55); margin:0; }
  .verse { font-style:italic; color:rgba(245,240,232,0.28); font-size:0.84rem; margin-top:32px; padding-top:24px; border-top:1px solid rgba(245,240,232,0.05); }
  .footer { margin-top:24px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Dead Hidden</div>
  <div class="title">You didn't buy a PDF.<br>You joined a stand.</div>

  <p>Most people who buy resources like this read them once, file them, and move on. They got what they came for — content. That's fine. That's not who this is for.</p>

  <p>Dead Hidden exists for the ones who are <span class="em">tired of Christianity that sounds right but doesn't cost anything.</span> The ones who've watched the men around them go soft, the women around them go untethered, and the church around them pretend it's all fine. You know something is off. You bought this because you want to actually do something about it.</p>

  <p><span class="bold">That's not a transaction. That's a posture.</span> Hold it.</p>

  <hr class="divider">

  <p>Your purchase is in your inbox. But don't stop there.</p>

  <div class="resource-block">
    <div class="resource-label">Start here next</div>
    <a href="${adjacentResource}" class="resource-link">${adjacentLabel}</a>
  </div>

  <div class="resource-block">
    <div class="resource-label">The full library</div>
    <a href="${resourceLibraryUrl}" class="resource-link">deadhidden.org/library — everything, uncut, archived</a>
  </div>

  <div class="next-up">
    <p>Two more emails are coming. In two days — a specific piece from the library that cuts deeper than what you just bought. In seven days — I'm going to ask you something directly.</p>
  </div>

  <div class="verse">"Therefore take up the whole armor of God, that you may be able to withstand in the evil day." — Ephesians 6:13</div>

  <div class="footer">
    Dead Hidden — deadhidden.org<br>
    You received this because you made a purchase. Reply with questions.
  </div>
</div>
</body>
</html>`;

  const text = `Dead Hidden

You didn't buy a PDF. You joined a stand.

Most people who buy resources like this read them once, file them, and move on. They got what they came for — content. That's fine. That's not who this is for.

Dead Hidden exists for the ones who are tired of Christianity that sounds right but doesn't cost anything. The ones who've watched the men around them go soft, the women around them go untethered, and the church around them pretend it's all fine. You know something is off. You bought this because you want to actually do something about it.

That's not a transaction. That's a posture. Hold it.

---

Your purchase is in your inbox. But don't stop there.

Start here next:
${adjacentLabel}
${adjacentResource}

The full library:
deadhidden.org/library — everything, uncut, archived

Two more emails are coming. In two days — a specific piece from the library that cuts deeper than what you just bought. In seven days — I'm going to ask you something directly.

"Therefore take up the whole armor of God, that you may be able to withstand in the evil day." — Ephesians 6:13

Dead Hidden — deadhidden.org
Reply with questions.`;

  return { html, text };
}

async function sendEmail(to, htmlBody, textBody) {
  const apiKey = process.env.POLSIA_API_KEY;
  const response = await fetch('https://polsia.com/api/proxy/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      to,
      subject: "You didn't buy a PDF. You joined a stand.",
      html: htmlBody,
      body: textBody
    })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }
  return true;
}

async function run() {
  const client = await pool.connect();
  try {
    // Ensure the sequence table exists (migration may not have run yet)
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_sequence_sends (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        step INTEGER NOT NULL CHECK (step IN (0, 1, 2)),
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_backfill BOOLEAN NOT NULL DEFAULT FALSE,
        error TEXT,
        UNIQUE(order_id, step)
      )
    `);

    // Find all orders without step 0
    const { rows: eligible } = await client.query(`
      SELECT o.id, o.email, o.amount, o.product_name, o.created_at
      FROM orders o
      WHERE o.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM email_sequence_sends s
          WHERE s.order_id = o.id AND s.step = 0
        )
      ORDER BY o.created_at ASC
    `);

    console.log(`Found ${eligible.length} orders eligible for backfill.`);
    if (eligible.length === 0) {
      console.log('Nothing to do — backfill already complete.');
      return;
    }

    let sent = 0;
    let failed = 0;

    for (const order of eligible) {
      const { html, text } = buildStep0Email(order.amount, order.product_name);
      let errorMsg = null;
      let ok = false;

      try {
        await sendEmail(order.email, html, text);
        ok = true;
        sent++;
        console.log(`  ✓ [${order.id}] ${order.email}`);
      } catch (err) {
        ok = false;
        failed++;
        errorMsg = err.message;
        console.error(`  ✗ [${order.id}] ${order.email} — ${err.message}`);
      }

      // Record attempt (success or failure) — idempotent
      await client.query(
        `INSERT INTO email_sequence_sends (order_id, step, sent_at, is_backfill, error)
         VALUES ($1, 0, NOW(), TRUE, $2)
         ON CONFLICT (order_id, step) DO NOTHING`,
        [order.id, errorMsg]
      );

      // 1.5s between sends — respect rate limits
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`\nBackfill complete — sent: ${sent}, failed: ${failed}, total: ${eligible.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
