const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

// ============================================================
// PRODUCT SLUG MAP — keyed by Stripe metadata.productSlug
// Real secure delivery URLs from deadhidden.org/api/serve.
// The sessionId is appended at send time: ?session_id={id}
// deadhidden.org verifies the session is a valid purchase before serving.
// NOTE: If the Polsia Stripe account differs from the deadhidden.org Stripe
// account, the serve API will reject the session — buyers are then redirected
// to the fallback URL instead and a warning is logged.
// ============================================================
const PRODUCT_SLUG_MAP = {
  'christian-soldiers-battle-notes': {
    label: "Christian Soldier's Battle Notes",
    type: 'download',
    files: [
      { label: "Christian Soldier's Battle Notes", fileSlug: 'christian-soldiers-battle-notes' }
    ]
  },
  'map-of-the-dead': {
    label: 'The Map of the Dead',
    type: 'download',
    files: [
      { label: 'The Map of the Dead', fileSlug: 'map-of-the-dead' }
    ]
  },
  'biblical-man-field-manual': {
    label: 'Biblical Man Field Manual',
    type: 'multi-download',
    files: [
      { label: 'Biblical Man Field Manual', fileSlug: 'biblical-man-field-manual' },
      { label: 'Bonus #1', fileSlug: 'biblical-man-field-manual-bonus-01' },
      { label: 'Bonus #2', fileSlug: 'biblical-man-field-manual-bonus-02' },
      { label: 'Bonus #3', fileSlug: 'biblical-man-field-manual-bonus-03' }
    ]
  },
  'biblical-woman-field-manual': {
    label: 'Biblical Woman Field Manual',
    type: 'multi-download',
    files: [
      { label: 'Biblical Woman Field Manual', fileSlug: 'biblical-woman-field-manual' },
      { label: 'Bonus #1 — Quiet Inventory', fileSlug: 'womens-bonus-01-quiet-inventory' },
      { label: 'Bonus #2 — Field Card', fileSlug: 'womens-bonus-02-field-card' },
      { label: 'Bonus #3 — The Sigh That Rises', fileSlug: 'womens-bonus-03-sigh-rises' }
    ]
  },
  'household-order-bundle': {
    label: 'Household Order Bundle',
    type: 'bundle',
    sections: [
      {
        title: 'Biblical Man Field Manual',
        files: [
          { label: 'Biblical Man Field Manual', fileSlug: 'biblical-man-field-manual' },
          { label: 'Bonus #1', fileSlug: 'biblical-man-field-manual-bonus-01' },
          { label: 'Bonus #2', fileSlug: 'biblical-man-field-manual-bonus-02' },
          { label: 'Bonus #3', fileSlug: 'biblical-man-field-manual-bonus-03' }
        ]
      },
      {
        title: 'Biblical Woman Field Manual',
        files: [
          { label: 'Biblical Woman Field Manual', fileSlug: 'biblical-woman-field-manual' },
          { label: 'Bonus #1 — Quiet Inventory', fileSlug: 'womens-bonus-01-quiet-inventory' },
          { label: 'Bonus #2 — Field Card', fileSlug: 'womens-bonus-02-field-card' },
          { label: 'Bonus #3 — The Sigh That Rises', fileSlug: 'womens-bonus-03-sigh-rises' }
        ]
      }
    ]
  },
  'dead-hidden-pro': {
    label: 'Dead Hidden Pro',
    type: 'membership'
  },
  'faithwall-individual': {
    label: 'FaithWall Individual',
    type: 'faithwall',
    cohort: 'faithwall_individual'
  },
  'faithwall-household': {
    label: 'FaithWall Household',
    type: 'faithwall',
    cohort: 'faithwall_household'
  }
};

// Build a secure serve URL for a file slug + session ID
function buildServeUrl(fileSlug, sessionId) {
  return `https://deadhidden.org/api/serve/${fileSlug}?session_id=${sessionId}`;
}

// Fallback URL when Stripe accounts differ (deadhidden.org handles gracefully)
function buildFallbackUrl(sessionId) {
  return `https://deadhidden.org/success?session_id=${sessionId}`;
}

// Reverse-lookup productSlug from a product label (for resend flows where only product_name is stored)
function lookupProductSlugByName(productName) {
  if (!productName) return null;
  const norm = productName.toLowerCase().trim().replace(/['']/g, "'");
  for (const [slug, product] of Object.entries(PRODUCT_SLUG_MAP)) {
    if (product.label.toLowerCase() === norm) return slug;
  }
  // Partial/fuzzy match
  for (const [slug, product] of Object.entries(PRODUCT_SLUG_MAP)) {
    const lbl = product.label.toLowerCase();
    if (norm.includes(lbl) || lbl.includes(norm)) return slug;
  }
  return null;
}

// ============================================================
// FULFILLMENT EMAIL HELPER
// Sends the post-purchase email with download/access instructions.
// Uses the Polsia email proxy (POLSIA_API_KEY + POLSIA_R2_BASE_URL).
// Supports single-file, multi-file, bundle, and membership products.
// productSlug (from Stripe metadata) is preferred for URL generation.
// ============================================================
async function sendFulfillmentEmail({ email, productName, amount, productSlug, sessionId }) {
  const apiKey = process.env.POLSIA_API_KEY;
  const baseUrl = process.env.POLSIA_R2_BASE_URL || 'https://polsia.com';
  const fromEmail = 'deadhiddenos@polsia.app';
  const fromName = 'Dead Hidden';

  const amountDisplay = amount ? `$${parseFloat(amount).toFixed(2)}` : '';

  // Resolve product config — prefer slug-based lookup, fall back to name
  const slugProduct = productSlug ? PRODUCT_SLUG_MAP[productSlug] : null;
  if (productSlug && !slugProduct) {
    console.warn(`[fulfillment] Unknown productSlug "${productSlug}" — falling back to name-based lookup`);
  }

  const productDisplay = slugProduct ? slugProduct.label : (productName || 'your order');

  // ---- Build the download/access content block ----
  let contentHtml = '';
  let contentText = '';

  if (slugProduct) {
    const { type } = slugProduct;

    if (type === 'membership') {
      // Dead Hidden Pro — no download links, membership instructions only
      contentHtml = `
    <p><span class="highlight">Membership access:</span> Your Dead Hidden Pro membership is being activated.</p>
    <p>You will receive a separate email with your community access link within a few minutes. Once active, you'll have full access to exclusive theology, monthly Q&amp;A calls, and the accountability community.</p>`;
      contentText = `Membership access: Your Dead Hidden Pro membership is being activated.\nYou will receive a separate email with your community access link within a few minutes.`;

    } else if (type === 'download') {
      // Single-file product — one CTA button
      if (!sessionId) {
        console.warn(`[fulfillment] No sessionId for slug "${productSlug}" — using fallback URL`);
      }
      const url = sessionId ? buildServeUrl(slugProduct.files[0].fileSlug, sessionId) : buildFallbackUrl(sessionId || 'unknown');
      contentHtml = `
    <p><span class="highlight">Your download is ready.</span> Click the button below to access your resource.</p>
    <a href="${url}" class="cta">Download Now &rarr;</a>`;
      contentText = `Your download is ready:\n${url}`;

    } else if (type === 'multi-download') {
      // Multi-file product — list all files
      if (!sessionId) {
        console.warn(`[fulfillment] No sessionId for slug "${productSlug}" — using fallback URL`);
      }
      const fileLinks = slugProduct.files.map(f => {
        const url = sessionId ? buildServeUrl(f.fileSlug, sessionId) : buildFallbackUrl(sessionId || 'unknown');
        return { label: f.label, url };
      });
      contentHtml = `
    <p><span class="highlight">Your downloads are ready.</span> All files are included below.</p>
    <div class="file-list">
      ${fileLinks.map(f => `<div class="file-item"><span class="file-label">${f.label}</span><a href="${f.url}" class="file-link">Download &rarr;</a></div>`).join('\n      ')}
    </div>`;
      contentText = `Your downloads are ready:\n${fileLinks.map(f => `  ${f.label}: ${f.url}`).join('\n')}`;

    } else if (type === 'bundle') {
      // Bundle — sections for each manual
      if (!sessionId) {
        console.warn(`[fulfillment] No sessionId for slug "${productSlug}" — using fallback URL`);
      }
      const sectionHtml = slugProduct.sections.map(section => {
        const fileLinks = section.files.map(f => {
          const url = sessionId ? buildServeUrl(f.fileSlug, sessionId) : buildFallbackUrl(sessionId || 'unknown');
          return { label: f.label, url };
        });
        return `<div class="bundle-section">
        <div class="section-title">${section.title}</div>
        <div class="file-list">
          ${fileLinks.map(f => `<div class="file-item"><span class="file-label">${f.label}</span><a href="${f.url}" class="file-link">Download &rarr;</a></div>`).join('\n          ')}
        </div>
      </div>`;
      }).join('\n      ');

      const sectionText = slugProduct.sections.map(section => {
        const fileLinks = section.files.map(f => {
          const url = sessionId ? buildServeUrl(f.fileSlug, sessionId) : buildFallbackUrl(sessionId || 'unknown');
          return `    ${f.label}: ${url}`;
        });
        return `${section.title}:\n${fileLinks.join('\n')}`;
      }).join('\n\n');

      contentHtml = `
    <p><span class="highlight">Your Household Order Bundle is ready.</span> All files for both manuals are included below.</p>
    ${sectionHtml}`;
      contentText = `Your Household Order Bundle is ready:\n\n${sectionText}`;
    }
  } else {
    // Legacy fallback — no slug, generic messaging (same as before)
    const isMembership = productName && productName.toLowerCase().includes('pro');
    if (isMembership) {
      contentHtml = `
    <p><span class="highlight">Membership access:</span> Your Dead Hidden Pro membership is being activated. You will receive a separate email with your community access link within a few minutes.</p>`;
      contentText = `Membership access: Your Dead Hidden Pro membership is being activated. Check your email for the community access link.`;
    } else {
      contentHtml = `
    <p><span class="highlight">Download instructions:</span> Your resource is ready. Reply to this email if you need assistance and we'll get it to you within a few hours.</p>`;
      contentText = `Download instructions: Your resource is ready. Reply to this email if you need assistance.`;
    }
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; background: #1a1a1a; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .wrapper { max-width: 580px; margin: 0 auto; padding: 48px 24px; }
  .header { border-bottom: 1px solid rgba(139,37,0,0.2); padding-bottom: 24px; margin-bottom: 32px; }
  .brand { font-size: 0.7rem; letter-spacing: 5px; text-transform: uppercase; color: #a0522d; font-weight: 600; margin-bottom: 6px; }
  .title { font-size: 1.6rem; font-weight: 700; color: #f5f0e8; letter-spacing: -0.02em; line-height: 1.2; }
  .body { color: rgba(245,240,232,0.7); font-size: 0.97rem; line-height: 1.75; }
  .body p { margin: 0 0 16px; }
  .highlight { color: #f5f0e8; font-weight: 500; }
  .order-box { background: #2d2d2d; border: 1px solid rgba(139,37,0,0.12); border-radius: 4px; padding: 20px 24px; margin: 28px 0; }
  .order-row { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 8px; color: rgba(245,240,232,0.6); }
  .order-row:last-child { margin-bottom: 0; }
  .order-label { color: rgba(245,240,232,0.4); }
  .cta { display: inline-block; background: #8b2500; color: #f5f0e8; text-decoration: none; padding: 14px 32px; border-radius: 3px; font-size: 0.8rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin: 16px 0 24px; }
  .bundle-section { margin: 20px 0; }
  .section-title { font-size: 0.75rem; letter-spacing: 3px; text-transform: uppercase; color: #a0522d; font-weight: 700; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(139,37,0,0.15); }
  .file-list { margin: 0 0 8px; }
  .file-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(245,240,232,0.05); font-size: 0.9rem; }
  .file-item:last-child { border-bottom: none; }
  .file-label { color: rgba(245,240,232,0.75); flex: 1; }
  .file-link { display: inline-block; background: rgba(139,37,0,0.15); color: #c46030; text-decoration: none; padding: 6px 14px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; margin-left: 12px; border: 1px solid rgba(139,37,0,0.25); }
  .verse { font-style: italic; color: rgba(245,240,232,0.3); font-size: 0.85rem; margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(245,240,232,0.05); }
  .footer { margin-top: 32px; font-size: 0.8rem; color: rgba(245,240,232,0.25); line-height: 1.6; }
  .footer a { color: rgba(245,240,232,0.35); }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="brand">Dead Hidden</div>
    <div class="title">Your order is confirmed.</div>
  </div>
  <div class="body">
    <p>Thank you for your purchase. <span class="highlight">${productDisplay}</span>${amountDisplay ? ` (${amountDisplay})` : ''} is yours.</p>
    ${contentHtml}
    <div class="order-box">
      <div class="order-row">
        <span class="order-label">Product</span>
        <span>${productDisplay}</span>
      </div>
      ${amountDisplay ? `
      <div class="order-row">
        <span class="order-label">Amount paid</span>
        <span>${amountDisplay}</span>
      </div>` : ''}
      <div class="order-row">
        <span class="order-label">Support</span>
        <span>support@deadhidden.org</span>
      </div>
    </div>
    <p>Questions or issues with your download? Email <span class="highlight">support@deadhidden.org</span> and we'll make it right.</p>
  </div>
  <div class="verse">"Buy truth, and do not sell it." — Proverbs 23:23</div>
  <div class="footer">
    You received this email because you made a purchase at deadhidden.org.<br>
    <a href="https://deadhidden.org">deadhidden.org</a>
  </div>
</div>
</body>
</html>
  `.trim();

  const textBody = `Dead Hidden — Order Confirmed

Thank you for your purchase. ${productDisplay}${amountDisplay ? ` (${amountDisplay})` : ''} is yours.

${contentText}

Questions? Email support@deadhidden.org and we'll make it right.

"Buy truth, and do not sell it." — Proverbs 23:23

deadhidden.org`;

  try {
    const response = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        to: email,
        subject: `Your Dead Hidden order is confirmed — ${productDisplay}`,
        html: htmlBody,
        body: textBody
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown error');
      throw new Error(`Email API returned ${response.status}: ${errText}`);
    }

    console.log(`[fulfillment] Email sent to ${email} for product: ${productDisplay}`);
    return { success: true };
  } catch (err) {
    console.error('Fulfillment email error:', err.message);
    return { success: false, error: err.message };
  }
}

const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// PRODUCT FULFILLMENT MAP
// Keys are product_name values from Stripe metadata (case-insensitive match)
// Also keyed by amount for fallback matching when metadata is absent.
// Update FULFILLMENT_URLS in env to override links without redeploying.
// ============================================================
const PRODUCT_MAP = {
  // --- Digital products ---
  "christian soldier's battle notes": {
    label: "Christian Soldier's Battle Notes",
    price: 17,
    type: 'download',
    urlEnvKey: 'FULFILLMENT_URL_BATTLE_NOTES',
    defaultUrl: 'https://deadhidden.org/battle-notes',
    description: 'Your field guide for spiritual warfare'
  },
  "the map of the dead": {
    label: 'The Map of the Dead',
    price: 17,
    type: 'download',
    urlEnvKey: 'FULFILLMENT_URL_MAP_OF_DEAD',
    defaultUrl: 'https://deadhidden.org/map-of-the-dead',
    description: 'Navigate the battlefield of the soul'
  },
  "the biblical man field manual": {
    label: 'The Biblical Man Field Manual',
    price: 77,
    type: 'download',
    urlEnvKey: 'FULFILLMENT_URL_BIBLICAL_MAN',
    defaultUrl: 'https://deadhidden.org/biblical-man-field-manual',
    description: 'The comprehensive guide for the Biblical man'
  },
  "the biblical woman field manual": {
    label: 'The Biblical Woman Field Manual',
    price: 77,
    type: 'download',
    urlEnvKey: 'FULFILLMENT_URL_BIBLICAL_WOMAN',
    defaultUrl: 'https://deadhidden.org/biblical-woman-field-manual',
    description: 'The comprehensive guide for the Biblical woman'
  },
  "household order bundle": {
    label: 'Household Order Bundle',
    price: 127,
    type: 'bundle',
    urlEnvKey: 'FULFILLMENT_URL_BUNDLE',
    defaultUrl: 'https://deadhidden.org/household-bundle',
    description: 'Everything your household needs to stand firm',
    bundleItems: [
      { label: "Christian Soldier's Battle Notes", urlEnvKey: 'FULFILLMENT_URL_BATTLE_NOTES', defaultUrl: 'https://deadhidden.org/battle-notes' },
      { label: 'The Map of the Dead', urlEnvKey: 'FULFILLMENT_URL_MAP_OF_DEAD', defaultUrl: 'https://deadhidden.org/map-of-the-dead' },
      { label: 'The Biblical Man Field Manual', urlEnvKey: 'FULFILLMENT_URL_BIBLICAL_MAN', defaultUrl: 'https://deadhidden.org/biblical-man-field-manual' },
      { label: 'The Biblical Woman Field Manual', urlEnvKey: 'FULFILLMENT_URL_BIBLICAL_WOMAN', defaultUrl: 'https://deadhidden.org/biblical-woman-field-manual' }
    ]
  },
  "dead hidden pro": {
    label: 'Dead Hidden Pro',
    price: 29,
    type: 'membership',
    urlEnvKey: 'FULFILLMENT_URL_PRO_MEMBERSHIP',
    defaultUrl: 'https://deadhidden.substack.com/subscribe',
    description: 'Welcome to the community of the hidden army',
    instructions: [
      'Click the link below to activate your paid Substack subscription',
      'Once active, you\'ll have full access to exclusive theology, monthly Q&A calls, and the accountability community',
      'Check your email for the community access invite within 24 hours'
    ]
  }
};

// Resolve a product fulfillment URL (uses env override if set)
function getFulfillmentUrl(urlEnvKey, defaultUrl) {
  return (process.env[urlEnvKey] && process.env[urlEnvKey].trim()) || defaultUrl;
}

// Normalize product name for map lookup
function normalizeProductName(name) {
  if (!name) return null;
  return name.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'");
}

// Look up product by name, then by amount fallback
function lookupProduct(productName, amount) {
  if (productName) {
    const key = normalizeProductName(productName);
    if (PRODUCT_MAP[key]) return PRODUCT_MAP[key];
    // Partial match fallback (e.g. "Battle Notes" → "christian soldier's battle notes")
    for (const [k, v] of Object.entries(PRODUCT_MAP)) {
      if (k.includes(key) || key.includes(k.split(' ')[0])) return v;
    }
  }
  // Amount-only fallback (ambiguous for $17 and $77 products)
  if (amount === 127) return PRODUCT_MAP['household order bundle'];
  if (amount === 29) return PRODUCT_MAP['dead hidden pro'];
  return null; // Ambiguous — can't determine product from amount alone
}

// ============================================================
// EMAIL HELPER
// Uses Polsia email proxy (https://polsia.com/email/send)
// Falls back gracefully — never throws, returns { ok, error }
// ============================================================
async function sendEmail({ to, subject, htmlBody, textBody }) {
  const apiKey = process.env.POLSIA_API_KEY;

  if (!apiKey) {
    console.error('[email] POLSIA_API_KEY not set — cannot send email');
    return { ok: false, error: 'POLSIA_API_KEY not configured' };
  }

  try {
    const response = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        to,
        subject,
        html: htmlBody,
        body: textBody || ''
      })
    });

    if (response.ok) {
      console.log(`[email] Sent to ${to} — subject: "${subject}"`);
      return { ok: true };
    } else {
      const errBody = await response.text().catch(() => 'unknown error');
      console.error(`[email] Failed to ${to}: HTTP ${response.status} — ${errBody}`);
      return { ok: false, error: `HTTP ${response.status}: ${errBody}` };
    }
  } catch (err) {
    console.error(`[email] Request error to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// RESEND EMAIL SENDER — post-purchase sequence only
// Sequence emails (T+0, T+2, T+7) route through Resend directly
// from sequence@deadhidden.org to bypass the Polsia 50/day cap.
// Fulfillment emails and admin notifications stay on Polsia proxy.
//
// Sender: sequence@deadhidden.org (Resend domain: deadhidden.org)
// The Resend account must have deadhidden.org verified as a sending domain.
// RESEND_API_KEY must be set in env.
// ============================================================
async function sendSequenceEmail({ to, subject, htmlBody, textBody, replyTo, from: fromOverride }) {
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.error('[resend] RESEND_API_KEY not set — falling back to Polsia proxy for sequence email');
    // Graceful fallback: use Polsia proxy so sends don't silently fail if key is absent
    return sendEmail({ to, subject, htmlBody, textBody });
  }

  try {
    const payload = {
      from: fromOverride || 'Dead Hidden <sequence@deadhidden.org>',
      to: [to],
      subject,
      html: htmlBody,
      text: textBody || ''
    };
    if (replyTo) {
      payload.reply_to = replyTo;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendKey}`
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      console.log(`[resend] Sent to ${to} — subject: "${subject}" id: ${data.id || 'unknown'}`);
      return { ok: true, id: data.id };
    } else {
      const errBody = await response.text().catch(() => 'unknown error');
      console.error(`[resend] Failed to ${to}: HTTP ${response.status} — ${errBody}`);
      return { ok: false, error: `HTTP ${response.status}: ${errBody}` };
    }
  } catch (err) {
    console.error(`[resend] Request error to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// EMAIL TEMPLATES
// ============================================================
function buildBuyerEmail(product, buyerEmail, amount) {
  const year = new Date().getFullYear();

  let deliverySection = '';

  if (product.type === 'bundle') {
    const links = product.bundleItems.map(item => {
      const url = getFulfillmentUrl(item.urlEnvKey, item.defaultUrl);
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #2a2a2a;">
            <span style="color:#e8e0d5;font-size:15px;">⬝ ${item.label}</span><br>
            <a href="${url}" style="color:#c0392b;font-size:14px;text-decoration:none;">${url}</a>
          </td>
        </tr>`;
    }).join('');
    deliverySection = `
      <p style="color:#a09080;margin:0 0 16px;">Your bundle includes all four resources. Access each below:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #2a2a2a;">
        ${links}
      </table>`;
  } else if (product.type === 'membership') {
    const url = getFulfillmentUrl(product.urlEnvKey, product.defaultUrl);
    const steps = (product.instructions || []).map((step, i) =>
      `<li style="color:#a09080;margin-bottom:8px;">${step}</li>`
    ).join('');
    deliverySection = `
      <p style="color:#a09080;margin:0 0 16px;">${product.description}</p>
      <ol style="padding-left:20px;margin:0 0 24px;">${steps}</ol>
      <a href="${url}" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">ACTIVATE MEMBERSHIP &rarr;</a>`;
  } else {
    const url = getFulfillmentUrl(product.urlEnvKey, product.defaultUrl);
    deliverySection = `
      <p style="color:#a09080;margin:0 0 24px;">${product.description}</p>
      <a href="${url}" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">ACCESS YOUR PURCHASE &rarr;</a>
      <p style="color:#6a5a4a;font-size:12px;margin:16px 0 0;">Or copy this link: <a href="${url}" style="color:#c0392b;">${url}</a></p>`;
  }

  const amountDisplay = amount != null ? `$${parseFloat(amount).toFixed(2)}` : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Georgia',serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#1a1a1a;border:1px solid #2a2a2a;">
        <!-- Header -->
        <tr>
          <td style="padding:32px 40px;border-bottom:1px solid #2a2a2a;text-align:center;">
            <p style="margin:0 0 4px;color:#8b0000;font-size:11px;letter-spacing:4px;text-transform:uppercase;font-family:'Arial',sans-serif;">DEAD HIDDEN</p>
            <h1 style="margin:0;color:#e8e0d5;font-size:22px;font-weight:normal;letter-spacing:1px;">Order Confirmed</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#e8e0d5;font-size:16px;margin:0 0 8px;">You purchased: <strong style="color:#fff;">${product.label}</strong></p>
            ${amountDisplay ? `<p style="color:#a09080;font-size:14px;margin:0 0 28px;">Amount: ${amountDisplay}</p>` : '<p style="margin:0 0 28px;"></p>'}
            <hr style="border:none;border-top:1px solid #2a2a2a;margin:0 0 28px;">
            ${deliverySection}
          </td>
        </tr>
        <!-- Support -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #2a2a2a;background:#141414;">
            <p style="color:#6a5a4a;font-size:12px;margin:0;">Questions? Reply to this email or contact <a href="mailto:support@deadhidden.org" style="color:#c0392b;">support@deadhidden.org</a></p>
            <p style="color:#4a3a2a;font-size:11px;margin:8px 0 0;">&copy; ${year} Dead Hidden. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Dead Hidden — Order Confirmed

Product: ${product.label}
${amountDisplay ? `Amount: ${amountDisplay}` : ''}

${product.type === 'bundle'
    ? 'Your bundle includes:\n' + product.bundleItems.map(i => `- ${i.label}: ${getFulfillmentUrl(i.urlEnvKey, i.defaultUrl)}`).join('\n')
    : `Access your purchase: ${getFulfillmentUrl(product.urlEnvKey, product.defaultUrl)}`
  }

Questions? Contact support@deadhidden.org`;

  return { html, text };
}

function buildAdminEmail(buyerEmail, product, amount, sessionId, fulfillmentStatus) {
  const now = new Date().toISOString();
  const amountDisplay = amount != null ? `$${parseFloat(amount).toFixed(2)}` : 'N/A';
  const productLabel = product ? product.label : 'Unknown product';

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f9f9f9;padding:20px;">
  <div style="max-width:500px;background:#fff;border:1px solid #ddd;padding:24px;border-radius:4px;">
    <h2 style="margin:0 0 16px;color:#333;font-size:18px;">&#128722; New Order — Dead Hidden</h2>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Buyer:</strong></td><td style="padding:8px 0;font-size:14px;">${buyerEmail || 'N/A'}</td></tr>
      <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Product:</strong></td><td style="padding:8px 0;font-size:14px;">${productLabel}</td></tr>
      <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Amount:</strong></td><td style="padding:8px 0;font-size:14px;">${amountDisplay}</td></tr>
      <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Fulfillment:</strong></td><td style="padding:8px 0;font-size:14px;color:${fulfillmentStatus === 'fulfilled' ? '#16a34a' : '#dc2626'};">${fulfillmentStatus}</td></tr>
      <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Session ID:</strong></td><td style="padding:8px 0;font-size:12px;color:#888;">${sessionId}</td></tr>
      <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Time:</strong></td><td style="padding:8px 0;font-size:14px;">${now}</td></tr>
    </table>
  </div>
</body>
</html>`;

  const text = `New Order — Dead Hidden\n\nBuyer: ${buyerEmail || 'N/A'}\nProduct: ${productLabel}\nAmount: ${amountDisplay}\nFulfillment: ${fulfillmentStatus}\nSession ID: ${sessionId}\nTime: ${now}`;

  return { html, text };
}

// Fail fast if DATABASE_URL is missing
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ============================================================
// STARTUP SCHEMA MIGRATION
// Belt-and-suspenders: ensures fulfillment columns exist regardless of
// whether the migration runner was invoked on deploy.
// All statements use IF NOT EXISTS / IF EXISTS — fully idempotent.
// ============================================================
(async () => {
  let client;
  try {
    client = await pool.connect();
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(50) NOT NULL DEFAULT 'pending'`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_sent_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_error TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status)`);
    console.log('[startup] Schema ready: fulfillment columns verified');
  } catch (err) {
    // Non-fatal — orders table may not exist yet (first boot before migrate.js ran)
    console.warn('[startup] Schema migration skipped:', err.message);
  } finally {
    if (client) client.release();
  }
})();

// ============================================================
// STRIPE WEBHOOK — registered BEFORE express.json() to preserve raw body
// ============================================================
app.post('/api/orders', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let rawBody;
  try {
    rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body);
  } catch (err) {
    return res.status(400).send('Cannot read body');
  }

  // Verify Stripe signature if secret is configured
  if (webhookSecret && sig) {
    try {
      const sigParts = sig.split(',').reduce((acc, part) => {
        const [k, v] = part.split('=');
        if (k && v) acc[k] = v;
        return acc;
      }, {});

      const timestamp = sigParts.t;
      const receivedSig = sigParts.v1;

      if (!timestamp || !receivedSig) {
        console.warn('Stripe webhook: missing signature parts');
        return res.status(400).json({ error: 'Invalid signature header' });
      }

      const payload = `${timestamp}.${rawBody}`;
      const expectedSig = crypto.createHmac('sha256', webhookSecret)
        .update(payload, 'utf8')
        .digest('hex');

      // Use length-safe comparison to prevent timing attacks
      if (expectedSig.length !== receivedSig.length ||
          !crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(receivedSig, 'hex'))) {
        console.warn('Stripe webhook: signature mismatch');
        return res.status(400).json({ error: 'Invalid signature' });
      }

      // Reject stale events (>5 min old)
      const drift = Math.abs(Date.now() / 1000 - parseInt(timestamp));
      if (drift > 300) {
        return res.status(400).json({ error: 'Webhook timestamp too old' });
      }
    } catch (verifyErr) {
      console.error('Stripe signature verification error:', verifyErr.message);
      return res.status(400).json({ error: 'Signature verification failed' });
    }
  } else {
    console.warn('Stripe webhook: STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Handle successful checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = (session.customer_details && session.customer_details.email) || session.customer_email || null;
    const amount = session.amount_total != null ? (session.amount_total / 100) : null;
    const sessionId = session.id;

    // Extract product name — priority order:
    // 1. session.metadata.product_name (explicit, set at checkout session creation)
    // 2. subscription mode → Dead Hidden Pro (reliable signal)
    // 3. Other metadata keys as fallback
    // 4. productSlug → look up from CHECKOUT_PRODUCTS or PRODUCT_SLUG_MAP
    let productName = null;
    if (session.metadata && session.metadata.product_name) {
      productName = session.metadata.product_name;
    } else if (session.mode === 'subscription') {
      productName = 'Dead Hidden Pro';
    } else if (session.metadata && session.metadata.name) {
      productName = session.metadata.name;
    } else if (session.metadata && session.metadata.productSlug) {
      // Derive product name from productSlug using checkout product catalog or slug map
      const slug = session.metadata.productSlug;
      if (CHECKOUT_PRODUCTS[slug]) {
        productName = CHECKOUT_PRODUCTS[slug].name;
      } else if (PRODUCT_SLUG_MAP[slug]) {
        productName = PRODUCT_SLUG_MAP[slug].label;
      }
      if (productName) {
        console.log(`[fulfillment] Derived productName="${productName}" from productSlug="${slug}"`);
      }
    }

    // Extract productSlug from metadata — used for secure serve URL generation
    // Must match keys in PRODUCT_SLUG_MAP (e.g. "biblical-man-field-manual")
    let productSlug = null;
    if (session.metadata && session.metadata.productSlug) {
      productSlug = session.metadata.productSlug;
    } else if (session.mode === 'subscription') {
      productSlug = 'dead-hidden-pro';
    }
    if (productSlug) {
      console.log(`[fulfillment] productSlug from metadata: ${productSlug}`);
    } else {
      console.warn(`[fulfillment] No productSlug in metadata for session ${sessionId} — fulfillment email will use legacy fallback`);
    }

    // Extract attribution hash — set when buyer came via a share link
    // utm_content stored in Stripe session metadata as attributed_to_buyer_hash
    const attributedToBuyerHash = (session.metadata && session.metadata.attributed_to_buyer_hash) || null;

    let orderId = null;
    try {
      const insertResult = await pool.query(
        `INSERT INTO orders (email, product_name, amount, stripe_session_id, fulfillment_status)
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (stripe_session_id) DO NOTHING
         RETURNING id`,
        [email, productName, amount, sessionId]
      );
      orderId = insertResult.rows[0]?.id;
      console.log(`Order recorded: session=${sessionId} email=${email} amount=$${amount} id=${orderId}`);

      // Write attribution hash if present and this is a new order
      if (orderId && attributedToBuyerHash) {
        pool.query(
          `UPDATE orders SET attributed_to_buyer_hash = $1 WHERE id = $2`,
          [attributedToBuyerHash, orderId]
        ).catch(err => console.error('[attribution] Update error:', err.message));
        console.log(`[attribution] Order #${orderId} attributed to buyer hash ${attributedToBuyerHash}`);
      }
    } catch (dbErr) {
      console.error('Order insert error:', dbErr.message);
    }

    // Register buyer as a known email contact so fulfillment emails are never rate-limited
    if (email && orderId) {
      const polsiaKey = process.env.POLSIA_API_KEY;
      if (polsiaKey) {
        fetch('https://polsia.com/api/proxy/email/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${polsiaKey}` },
          body: JSON.stringify({ email, source: 'purchase' })
        }).catch(err => console.error('[order] Contact registration error:', err.message));
      }
    }

    // Send fulfillment email if we have an email address and a new order was recorded
    if (email && orderId) {
      const emailResult = await sendFulfillmentEmail({ email, productName, amount, productSlug, sessionId });
      const newStatus = emailResult.success ? 'fulfilled' : 'failed';
      try {
        await pool.query(
          `UPDATE orders
           SET fulfillment_status = $1,
               fulfillment_sent_at = $2,
               fulfillment_error = $3
           WHERE id = $4`,
          [
            newStatus,
            emailResult.success ? new Date() : null,
            emailResult.success ? null : emailResult.error,
            orderId
          ]
        );
        console.log(`Fulfillment ${newStatus}: order=${orderId} email=${email}`);
      } catch (updateErr) {
        console.error('Fulfillment status update error:', updateErr.message);
      }

      // Admin notification — fires regardless of buyer email success
      const adminEmail = process.env.ADMIN_EMAIL || 'deadhiddenos@polsia.app';
      const amountDisplay = amount != null ? `$${parseFloat(amount).toFixed(2)}` : 'N/A';
      const adminContent = buildAdminEmail(email, lookupProduct(productName, amount), amount, sessionId, newStatus);
      sendEmail({
        to: adminEmail,
        subject: `New order: ${productName || `${amountDisplay} purchase`} — ${email}`,
        htmlBody: adminContent.html,
        textBody: adminContent.text
      }).catch(err => console.error('[admin-notify] error:', err.message));

      // Detect FaithWall cohort from productSlug or productName
      const faithwallCohort = detectFaithWallCohort(productSlug, productName, amount);

      if (faithwallCohort) {
        // FaithWall buyer — update cohort tag and fire FaithWall sequence
        pool.query(
          `UPDATE orders SET product_cohort = $1 WHERE id = $2`,
          [faithwallCohort, orderId]
        ).catch(err => console.error('[faithwall-cohort] Update error:', err.message));

        sendFaithWallSequenceStep(orderId, email, 0, faithwallCohort)
          .catch(err => console.error('[fw-sequence] step=0 error:', err.message));
      } else {
        // Field Manual / other product — fire existing sequence
        sendSequenceStep(orderId, email, 0, amount, productName)
          .catch(err => console.error('[sequence] step=0 error:', err.message));
      }
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Bring a Brother referral routes ----
// /os/refer → page + /stats admin view (GET /, GET /stats)
// /api/refer → API endpoints (POST /lookup)
const referralRouter = require('./routes/referral');
app.use('/os/refer', referralRouter);
app.use('/api/refer', referralRouter);

// ============================================================
// PAGE VIEW TRACKING MIDDLEWARE
// Async insert — never blocks the response.
// Excludes: /health, /api/*, static assets (js/css/images/fonts).
// IPs are hashed (SHA-256 + server-side salt) for privacy.
// ============================================================
const STATIC_ASSET_RE = /\.(js|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map|webp|txt)$/i;
app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    req.path !== '/health' &&
    !req.path.startsWith('/api/') &&
    !STATIC_ASSET_RE.test(req.path)
  ) {
    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
    const ipHash = crypto.createHash('sha256')
      .update(rawIp + (process.env.IP_HASH_SALT || 'dhos-pv-salt'))
      .digest('hex')
      .slice(0, 16);
    const referrer = req.headers.referer || req.headers.referrer || null;
    const userAgent = req.headers['user-agent'] || null;

    pool.query(
      'INSERT INTO page_views (path, referrer, user_agent, ip_hash) VALUES ($1, $2, $3, $4)',
      [req.path, referrer, userAgent, ipHash]
    ).catch(err => {
      // Non-fatal — page_views table may not exist yet on first boot
      if (!err.message.includes('page_views')) {
        console.error('[pv] tracking error:', err.message);
      }
    });
  }
  next();
});

// Dashboard password from env (defaults to a random value if not set — dashboard locked by default)
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

// Simple token-based auth for dashboard
// Tokens are stored in memory (fine for single instance)
const validTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach(c => {
    const [key, ...rest] = c.trim().split('=');
    cookies[key] = rest.join('=');
  });
  return cookies;
}

function requireDashboardAuth(req, res, next) {
  // If no password is configured, dashboard is completely locked
  if (!DASHBOARD_PASSWORD) {
    return res.status(403).json({ error: 'Dashboard access is disabled. Set DASHBOARD_PASSWORD to enable.' });
  }

  const cookies = parseCookies(req);
  const token = cookies['dhos_token'];

  if (token && validTokens.has(token)) {
    return next();
  }

  // For API requests, return 401 JSON
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // For page requests, redirect to login
  return res.redirect('/dashboard/login');
}

// Health check endpoint (required for Render)
// Note: Does NOT query database to allow Neon auto-suspend
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ============================================================
// CHECKOUT PRODUCTS — keyed by productSlug
// Used by GET /checkout?slug=... to create Stripe Sessions.
// Amounts are in cents. Mode is 'payment' or 'subscription'.
// Dead Hidden Pro uses recurring monthly billing.
// ============================================================
const CHECKOUT_PRODUCTS = {
  'christian-soldiers-battle-notes': {
    name: "Christian Soldier's Battle Notes",
    unitAmount: 1700,
    mode: 'payment',
    description: '362 pages of doctrinal reference for spiritual warfare'
  },
  'map-of-the-dead': {
    name: 'The Map of the Dead',
    unitAmount: 1700,
    mode: 'payment',
    description: 'A complete geography of afterlife concepts in Scripture'
  },
  'biblical-man-field-manual': {
    name: 'The Biblical Man Field Manual',
    unitAmount: 7700,
    mode: 'payment',
    description: 'The definitive guide to masculine identity rooted in Scripture'
  },
  'biblical-woman-field-manual': {
    name: 'The Biblical Woman Field Manual',
    unitAmount: 7700,
    mode: 'payment',
    description: 'Complementarian Christian womanhood grounded in the Word'
  },
  'household-order-bundle': {
    name: 'Household Order Bundle',
    unitAmount: 12700,
    mode: 'payment',
    description: 'Both Field Manuals — Biblical Man and Biblical Woman — together'
  },
  'dead-hidden-pro': {
    name: 'Dead Hidden Pro Membership',
    unitAmount: 2900,
    mode: 'subscription',
    description: 'Monthly membership: exclusive theology, Q&A calls, full archive'
  },
  'faithwall-individual': {
    name: 'FaithWall Individual',
    unitAmount: 2999,
    mode: 'payment',
    description: 'FaithWall — the covenant in software. Individual license.'
  },
  'faithwall-household': {
    name: 'FaithWall Household',
    unitAmount: 3999,
    mode: 'payment',
    description: 'FaithWall — the covenant in software. Household license.'
  }
};

// ============================================================
// 301 REDIRECT: polsia.app/checkout → deadhidden.org/checkout
// Catches the 44 already-sent referral emails with broken URLs.
// Only fires on the polsia.app subdomain; deadhidden.org passes through.
// ============================================================
app.get('/checkout', (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('polsia.app')) {
    const qs = req.url.slice(req.path.length); // preserves ?slug=...&ref=...
    return res.redirect(301, 'https://deadhidden.org/checkout' + qs);
  }
  next();
});

// ============================================================
// GET /checkout — creates a Stripe Checkout Session and redirects
// Query params:
//   slug  — productSlug from CHECKOUT_PRODUCTS (required)
// Example: /checkout?slug=biblical-man-field-manual
// Session includes metadata.productSlug so the /api/orders webhook
// can route fulfillment emails correctly.
// ============================================================
app.get('/checkout', async (req, res) => {
  const { slug, ref } = req.query;
  // ref = utm_content from share link — passed through checkout to attribute the conversion

  if (!slug || !CHECKOUT_PRODUCTS[slug]) {
    return res.status(400).type('html').send(`
      <!DOCTYPE html><html><head><title>Invalid Product</title>
      <style>body{font-family:system-ui;background:#1a1a1a;color:#f5f0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:400px;padding:40px;}h1{font-size:1.2rem;margin-bottom:8px;}p{color:rgba(245,240,232,0.5);font-size:0.9rem;}
      a{color:#8b0000;}</style></head>
      <body><div class="box"><h1>Product not found.</h1><p>The product you're looking for doesn't exist.</p><p><a href="/">Back to Dead Hidden &rarr;</a></p></div></body></html>
    `);
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.startsWith('REPLACE_') || stripeKey.startsWith('sk_test_PLACEHOLDER')) {
    console.error('[checkout] STRIPE_SECRET_KEY not configured');
    return res.status(503).type('html').send(`
      <!DOCTYPE html><html><head><title>Checkout Unavailable</title>
      <style>body{font-family:system-ui;background:#1a1a1a;color:#f5f0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:400px;padding:40px;}h1{font-size:1.2rem;margin-bottom:8px;}p{color:rgba(245,240,232,0.5);font-size:0.9rem;}
      a{color:#8b0000;}</style></head>
      <body><div class="box"><h1>Checkout temporarily unavailable.</h1><p>Please email <a href="mailto:support@deadhidden.org">support@deadhidden.org</a> to complete your purchase.</p></div></body></html>
    `);
  }

  const product = CHECKOUT_PRODUCTS[slug];

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const priceData = {
      currency: 'usd',
      unit_amount: product.unitAmount,
      product_data: {
        name: product.name,
        description: product.description
      }
    };

    // Subscriptions require a recurring interval
    if (product.mode === 'subscription') {
      priceData.recurring = { interval: 'month' };
    }

    const host = req.headers.host || 'deadhiddenos.polsia.app';
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const appBase = `${proto}://${host}`;

    const sessionMeta = { productSlug: slug, product_name: product.name };
    if (ref && /^[a-f0-9]{8,16}$/.test(ref)) {
      sessionMeta.attributed_to_buyer_hash = ref;
      // Track referral visit (fire-and-forget)
      const { trackReferralVisit } = require('./db/orders');
      trackReferralVisit(ref, '/checkout').catch(err => console.error('[refer/track] error:', err.message));
    }

    const session = await stripe.checkout.sessions.create({
      mode: product.mode,
      line_items: [{ price_data: priceData, quantity: 1 }],
      metadata: sessionMeta,
      success_url: `${appBase}/checkout/success?session_id={CHECKOUT_SESSION_ID}&amount=${(product.unitAmount / 100).toFixed(2)}&currency=USD&slug=${encodeURIComponent(slug)}`,
      cancel_url: `${appBase}/`,
      allow_promotion_codes: true
    });

    console.log(`[checkout] Session created: slug=${slug} product="${product.name}" session=${session.id}${ref ? ` ref=${ref}` : ''}`);
    res.redirect(303, session.url);
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    res.status(500).type('html').send(`
      <!DOCTYPE html><html><head><title>Checkout Error</title>
      <style>body{font-family:system-ui;background:#1a1a1a;color:#f5f0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:400px;padding:40px;}h1{font-size:1.2rem;margin-bottom:8px;}p{color:rgba(245,240,232,0.5);font-size:0.9rem;}
      a{color:#8b0000;}</style></head>
      <body><div class="box"><h1>Unable to start checkout.</h1><p>Please try again or email <a href="mailto:support@deadhidden.org">support@deadhidden.org</a>.</p></div></body></html>
    `);
  }
});

// POST /api/checkout — JSON API version of checkout session creation
// Body: { slug: "biblical-man-field-manual", ref: "utm_content_hash" }
// Returns: { url: "https://checkout.stripe.com/..." }
app.post('/api/checkout', async (req, res) => {
  const { slug, ref } = req.body;

  if (!slug || !CHECKOUT_PRODUCTS[slug]) {
    return res.status(400).json({ error: 'invalid_slug', message: 'Unknown product slug' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.startsWith('REPLACE_') || stripeKey.startsWith('sk_test_PLACEHOLDER')) {
    return res.status(503).json({ error: 'checkout_unavailable', message: 'Checkout temporarily unavailable' });
  }

  const product = CHECKOUT_PRODUCTS[slug];

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const priceData = {
      currency: 'usd',
      unit_amount: product.unitAmount,
      product_data: {
        name: product.name,
        description: product.description
      }
    };

    if (product.mode === 'subscription') {
      priceData.recurring = { interval: 'month' };
    }

    const apiHost = req.headers.host || 'deadhiddenos.polsia.app';
    const apiProto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const apiBase = `${apiProto}://${apiHost}`;

    const apiSessionMeta = { productSlug: slug, product_name: product.name };
    if (ref && /^[a-f0-9]{8,16}$/.test(ref)) {
      apiSessionMeta.attributed_to_buyer_hash = ref;
    }

    const session = await stripe.checkout.sessions.create({
      mode: product.mode,
      line_items: [{ price_data: priceData, quantity: 1 }],
      metadata: apiSessionMeta,
      success_url: `${apiBase}/checkout/success?session_id={CHECKOUT_SESSION_ID}&amount=${(product.unitAmount / 100).toFixed(2)}&currency=USD&slug=${encodeURIComponent(slug)}`,
      cancel_url: `${apiBase}/`,
      allow_promotion_codes: true
    });

    console.log(`[checkout] API session created: slug=${slug} product="${product.name}" session=${session.id}${ref ? ` ref=${ref}` : ''}`);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout] API Stripe error:', err.message);
    res.status(500).json({ error: 'stripe_error', message: 'Unable to create checkout session' });
  }
});

// ============================================================
// PUBLIC ROUTES (no auth required)
// ============================================================

// Landing page
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.json({ message: 'Hello from Polsia Instance!' });
  }
});

// Public email signup endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { email, source } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const leadSource = source || 'landing_page';

    // Check for duplicate before inserting
    const existing = await pool.query(
      'SELECT id FROM email_subscribers WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'already_subscribed', message: "You're already on the list." });
    }

    await pool.query(
      'INSERT INTO email_subscribers (email, source) VALUES ($1, $2)',
      [normalizedEmail, leadSource]
    );

    console.log(`[signup] New subscriber: ${normalizedEmail} (source: ${leadSource})`);

    // Register contact with email proxy so future emails are never rate-limited
    const polsiaKey = process.env.POLSIA_API_KEY;
    if (polsiaKey) {
      fetch('https://polsia.com/api/proxy/email/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${polsiaKey}` },
        body: JSON.stringify({ email: normalizedEmail, source: 'signup' })
      }).catch(err => console.error('[signup] Contact registration error:', err.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'signup_failed', message: 'Something went wrong. Please try again.' });
  }
});

// ============================================================
// TESTIMONY CAPTURE — /os/stand
// Landing page + API for post-purchase testimonial collection.
// Stores rows in `testimonies` table. Fires Meta Pixel Lead on submit.
// Admin list endpoint: GET /api/admin/testimonies (auth required).
// ============================================================

// Landing page
app.get('/os/stand', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'os-stand.html'));
});

// ============================================================
// DISCERNMENT GRID — /os/discernment
// Narrative landing page with Scripture grid, email capture,
// Field Manual CTA, Meta Pixel ViewContent, and UTM passthrough.
// ============================================================
app.get('/os/discernment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'os-discernment.html'));
});

// ============================================================
// HOUSEHOLD GRID — /os/household
// Evergreen narrative landing page. Culture vs. Scripture
// household contrast grid (Eph 5, 1 Pet 3, Deut 6, Prov 31,
// Col 3). Pull-quote, Christie pointer, email capture (UTM-ready),
// Household Order Bundle CTA. Meta Pixel ViewContent on load.
// ============================================================
app.get('/os/household', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'os-household.html'));
});

// ============================================================
// WIFE GRID — /os/wife
// Biblical womanhood narrative landing page. 7-verse KJV scripture
// grid (Prov 31:10-12, Titus 2:3-5, 1 Pet 3:1-4, Eph 5:22-24,
// 1 Tim 2:9-10, Prov 14:1, Ruth 3:11). Hero verse block, email
// capture (UTM-ready, source=os_wife), Field Manual CTA ($77,
// utm_content=wife&utm_campaign=womanhood), secondary FaithWall
// household link ($39.99), Meta Pixel ViewContent on load.
// ============================================================
app.get('/os/wife', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'os-wife.html'));
});

// ============================================================
// FAITHWALL NARRATIVE LANDING — /os/faithwall
// Scripture-first habit wall landing page. 6-block what-it-blocks
// grid (KJV anchors), 3-step how-it-works, email capture (UTM-ready,
// source=faithwall_landing), two buy CTAs (Individual $29.99 /
// Household $39.99), Meta Pixel ViewContent + Lead + InitiateCheckout.
// ============================================================
app.get('/os/faithwall', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'os-faithwall.html'));
});

// ============================================================
// FAITHWALL BETA FUNNEL — /os/faithwall-beta
// PWYW beta-access landing for the full FaithWall iOS app + radio.
// Single primary CTA points to the live Dead Hidden Stripe Payment
// Link (prod_Ucodqxydycv3ew, $10 minimum PWYW). The Stripe hosted
// confirmation hands the buyer the TestFlight link instantly.
// Meta Pixel ViewContent + InitiateCheckout on CTA click.
// ============================================================
app.get('/os/faithwall-beta', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'os-faithwall-beta.html'));
});

// ============================================================
// FAITHWALL WAITLIST — /faithwall
// Pre-launch waitlist page capturing email while iOS App Store
// review is in progress. Posts to /api/signup with source=faithwall.
// Fires Meta Pixel Lead + GTM faithwall_waitlist_signup on submit.
// Chrome extension CTA for users who can't wait for iOS.
// ============================================================
app.get('/faithwall', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faithwall-waitlist.html'));
});

// ============================================================
// FAITHWALL — /privacy, /support, /privacy.txt
// Required for Chrome Web Store and Apple App Store submissions.
// Served for faithwall.deadhidden.org subdomain and any host.
// ============================================================
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faithwall-privacy.html'));
});

app.get('/privacy.txt', (req, res) => {
  res.type('text/plain').sendFile(path.join(__dirname, 'public', 'faithwall-privacy.txt'));
});

app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'faithwall-support.html'));
});

// POST /api/testimony — public, no auth
app.post('/api/testimony', async (req, res) => {
  try {
    const { name, running_since, what_hit, publish_allowed } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name_required', message: 'Name or initials required.' });
    }
    if (!what_hit || !what_hit.trim()) {
      return res.status(400).json({ error: 'content_required', message: 'The one thing that hit is required.' });
    }

    const cleanName = name.trim().slice(0, 120);
    const cleanRunningSince = running_since ? running_since.trim().slice(0, 120) : null;
    const cleanWhatHit = what_hit.trim().slice(0, 2000);
    const canPublish = publish_allowed === true || publish_allowed === 'true';

    const result = await pool.query(
      `INSERT INTO testimonies (name, running_since, what_hit, publish_allowed, source)
       VALUES ($1, $2, $3, $4, 'os_stand')
       RETURNING id`,
      [cleanName, cleanRunningSince, cleanWhatHit, canPublish]
    );

    const testimonyId = result.rows[0].id;
    console.log(`[testimony] New submission id=${testimonyId} name="${cleanName}" publish=${canPublish}`);

    // Notify operator immediately
    const adminEmail = process.env.ADMIN_EMAIL || 'deadhiddenos@polsia.app';
    const publishNote = canPublish ? 'YES — permission to publish' : 'No — private';
    const adminHtml = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9f9f9;padding:20px;">
<div style="max-width:540px;background:#fff;border:1px solid #ddd;padding:24px;border-radius:4px;">
  <h2 style="margin:0 0 16px;color:#333;font-size:18px;">&#9654; New Testimony — Dead Hidden</h2>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:8px 0;color:#555;font-size:14px;width:140px;"><strong>Name:</strong></td><td style="padding:8px 0;font-size:14px;">${cleanName}</td></tr>
    <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Running since:</strong></td><td style="padding:8px 0;font-size:14px;">${cleanRunningSince || '—'}</td></tr>
    <tr><td style="padding:8px 0;color:#555;font-size:14px;vertical-align:top;"><strong>What hit:</strong></td><td style="padding:8px 0;font-size:14px;line-height:1.6;">${cleanWhatHit.replace(/\n/g, '<br>')}</td></tr>
    <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>Publish:</strong></td><td style="padding:8px 0;font-size:14px;color:${canPublish ? '#16a34a' : '#6b7280'};">${publishNote}</td></tr>
    <tr><td style="padding:8px 0;color:#555;font-size:14px;"><strong>ID:</strong></td><td style="padding:8px 0;font-size:12px;color:#888;">#${testimonyId}</td></tr>
  </table>
  <p style="margin:20px 0 0;font-size:13px;color:#888;">Via deadhiddenos.polsia.app/os/stand</p>
</div>
</body></html>`;
    const adminText = `New Testimony — Dead Hidden\n\nName: ${cleanName}\nRunning since: ${cleanRunningSince || '—'}\nWhat hit:\n${cleanWhatHit}\nPublish: ${publishNote}\nID: #${testimonyId}`;

    sendEmail({
      to: adminEmail,
      subject: `New testimony: "${cleanName}" — Dead Hidden`,
      htmlBody: adminHtml,
      textBody: adminText
    }).catch(err => console.error('[testimony] Admin notify error:', err.message));

    res.json({ success: true, id: testimonyId });
  } catch (err) {
    console.error('[testimony] Error:', err);
    res.status(500).json({ error: 'submission_failed', message: 'Something went wrong. Please try again.' });
  }
});

// GET /api/admin/testimonies — operator list, auth required
app.get('/api/admin/testimonies', requireDashboardAuth, async (req, res) => {
  try {
    const all = await pool.query(`
      SELECT id, name, running_since, what_hit, publish_allowed, submitted_at, source
      FROM testimonies
      ORDER BY submitted_at DESC
    `);

    const publishable = all.rows.filter(r => r.publish_allowed);

    res.json({
      total: all.rows.length,
      publishable_count: publishable.length,
      testimonies: all.rows.map(r => ({
        id: r.id,
        name: r.name,
        running_since: r.running_since,
        what_hit: r.what_hit,
        publish_allowed: r.publish_allowed,
        submitted_at: r.submitted_at,
        source: r.source
      }))
    });
  } catch (err) {
    console.error('[testimony] Admin list error:', err);
    res.status(500).json({ error: 'Failed to load testimonies' });
  }
});

// ============================================================
// TESTIMONY PUBLIC + ADMIN APPROVAL ENDPOINTS
// GET /api/testimonies/public — display-safe, approved only, limit 6
// POST /api/admin/testimonies/:id/approve — sets approved_at = now()
// POST /api/admin/testimonies/:id/unapprove — clears approved_at
// ============================================================

// GET /api/testimonies/public — no auth, display-safe fields only
app.get('/api/testimonies/public', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name AS name_or_initials,
             running_since AS duration_running_it,
             what_hit AS hit_text
      FROM testimonies
      WHERE publish_allowed = TRUE
        AND approved_at IS NOT NULL
      ORDER BY approved_at DESC
      LIMIT 6
    `);
    res.json({ testimonies: result.rows });
  } catch (err) {
    console.error('[testimony] Public list error:', err);
    res.status(500).json({ error: 'Failed to load testimonies' });
  }
});

// POST /api/admin/testimonies/:id/approve — auth required
app.post('/api/admin/testimonies/:id/approve', requireDashboardAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE testimonies SET approved_at = NOW() WHERE id = $1 RETURNING id, name, approved_at`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'testimony_not_found' });
    }
    const row = result.rows[0];
    console.log(`[testimony] Approved id=${row.id} name="${row.name}"`);
    res.json({ success: true, id: row.id, name: row.name, approved_at: row.approved_at });
  } catch (err) {
    console.error('[testimony] Approve error:', err);
    res.status(500).json({ error: 'Failed to approve testimony' });
  }
});

// POST /api/admin/testimonies/:id/unapprove — auth required
app.post('/api/admin/testimonies/:id/unapprove', requireDashboardAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE testimonies SET approved_at = NULL WHERE id = $1 RETURNING id, name`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'testimony_not_found' });
    }
    const row = result.rows[0];
    console.log(`[testimony] Unapproved id=${row.id} name="${row.name}"`);
    res.json({ success: true, id: row.id, name: row.name, approved_at: null });
  } catch (err) {
    console.error('[testimony] Unapprove error:', err);
    res.status(500).json({ error: 'Failed to unapprove testimony' });
  }
});

// Meta Pixel conversion pages (clean URLs)
app.get('/signup-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup-success.html'));
});

app.get('/payment-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-success.html'));
});

// Checkout success page — Stripe redirects here after payment
// URL includes ?session_id={CHECKOUT_SESSION_ID} automatically
app.get('/checkout/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout-success.html'));
});

// Serve static files from public folder (but NOT dashboard.html directly)
// We handle /dashboard route explicitly with auth
app.use(express.static(path.join(__dirname, 'public'), {
  index: false  // Don't auto-serve index.html (we handle / explicitly)
}));

// ============================================================
// DASHBOARD AUTH ROUTES
// ============================================================

// Login page
app.get('/dashboard/login', (req, res) => {
  // If no password configured, show locked message
  if (!DASHBOARD_PASSWORD) {
    return res.type('html').send(`
      <!DOCTYPE html>
      <html><head><title>Dashboard Locked</title>
      <style>body{font-family:system-ui;background:#1a1a1a;color:#f5f0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;}
      .box{text-align:center;max-width:400px;padding:40px;}.lock{font-size:3rem;margin-bottom:16px;}h1{font-size:1.2rem;margin-bottom:8px;}p{color:rgba(245,240,232,0.5);font-size:0.9rem;}</style>
      </head><body><div class="box"><div class="lock">&#128274;</div><h1>Dashboard Locked</h1><p>Contact the administrator to enable dashboard access.</p></div></body></html>
    `);
  }

  const error = parseCookies(req)['dhos_login_error'] ? '<p class="error">Incorrect password</p>' : '';

  res.type('html').send(`
    <!DOCTYPE html>
    <html lang="en"><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Dashboard Login — DeadHiddenOS</title>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'DM Sans',sans-serif; background:#1a1a1a; color:#f5f0e8; display:flex; justify-content:center; align-items:center; min-height:100vh; }
        .login-box { width:100%; max-width:380px; padding:48px 40px; background:#2d2d2d; border:1px solid rgba(139,0,0,0.15); border-radius:8px; }
        .login-box .label { font-family:'Space Grotesk',sans-serif; font-size:0.7rem; letter-spacing:4px; text-transform:uppercase; color:#a0522d; margin-bottom:8px; font-weight:600; }
        .login-box h1 { font-family:'Space Grotesk',sans-serif; font-size:1.4rem; font-weight:700; margin-bottom:32px; }
        .login-box input { width:100%; padding:14px 16px; background:rgba(26,26,26,0.8); border:1px solid rgba(139,0,0,0.2); border-radius:4px; color:#f5f0e8; font-family:'DM Sans',sans-serif; font-size:0.95rem; outline:none; margin-bottom:16px; transition:border-color 0.2s; }
        .login-box input:focus { border-color:#8b0000; }
        .login-box button { width:100%; padding:14px; background:#8b0000; color:#f5f0e8; border:1px solid transparent; border-radius:4px; font-family:'Space Grotesk',sans-serif; font-size:0.82rem; font-weight:600; letter-spacing:2px; text-transform:uppercase; cursor:pointer; transition:all 0.3s; }
        .login-box button:hover { background:transparent; border-color:#8b0000; color:#8b0000; }
        .error { color:#f87171; font-size:0.85rem; margin-bottom:16px; }
        .back { display:block; text-align:center; margin-top:20px; font-size:0.82rem; color:rgba(245,240,232,0.4); text-decoration:none; }
        .back:hover { color:#f5f0e8; }
      </style>
    </head>
    <body>
      <form class="login-box" method="POST" action="/dashboard/login">
        <div class="label">Command Center</div>
        <h1>Dashboard Login</h1>
        ${error}
        <input type="password" name="password" placeholder="Enter password" autofocus required>
        <button type="submit">Access Dashboard &rarr;</button>
        <a href="/" class="back">&larr; Back to site</a>
      </form>
    </body></html>
  `);
});

// Login POST handler
app.post('/dashboard/login', (req, res) => {
  const { password } = req.body;

  if (!DASHBOARD_PASSWORD || password !== DASHBOARD_PASSWORD) {
    // Set a brief error cookie then redirect back
    res.setHeader('Set-Cookie', 'dhos_login_error=1; Path=/; Max-Age=5; HttpOnly');
    return res.redirect('/dashboard/login');
  }

  // Generate a session token
  const token = generateToken();
  validTokens.add(token);

  // Set auth cookie (httpOnly, secure in production, 24h expiry)
  const isProduction = process.env.NODE_ENV === 'production' || (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost'));
  const cookieFlags = `Path=/; Max-Age=86400; HttpOnly${isProduction ? '; Secure; SameSite=Lax' : ''}`;
  res.setHeader('Set-Cookie', `dhos_token=${token}; ${cookieFlags}`);

  // Clean up old tokens if set gets too large (simple memory management)
  if (validTokens.size > 100) {
    const arr = Array.from(validTokens);
    arr.slice(0, arr.length - 50).forEach(t => validTokens.delete(t));
  }

  res.redirect('/dashboard');
});

// Logout
app.get('/dashboard/logout', (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies['dhos_token'];
  if (token) validTokens.delete(token);
  res.setHeader('Set-Cookie', 'dhos_token=; Path=/; Max-Age=0; HttpOnly');
  res.redirect('/');
});

// ============================================================
// PROTECTED ROUTES (require auth)
// ============================================================

// Dashboard page — FaithWall subdomain → buyer dashboard; other hosts → admin dashboard
// faithwall.deadhidden.org/dashboard is the buyer-facing covenant + share page.
// Admin dashboard at /dashboard is only for the operator (DASHBOARD_PASSWORD protected).
function isFaithWallHost(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  return host === 'faithwall.deadhidden.org' || host.startsWith('faithwall.');
}

app.get('/dashboard', (req, res) => {
  if (isFaithWallHost(req)) {
    // Buyer dashboard — served as static HTML; auth/state handled client-side via API
    return res.sendFile(path.join(__dirname, 'public', 'faithwall-dashboard.html'));
  }
  // Admin dashboard (operator only)
  requireDashboardAuth(req, res, () => {
    const htmlPath = path.join(__dirname, 'private', 'dashboard.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.status(404).send('Dashboard not found');
    }
  });
});

// All dashboard API routes (auth required)
app.use('/api/dashboard', requireDashboardAuth);

// GET /api/dashboard/overview - Top-level metrics summary
app.get('/api/dashboard/overview', async (req, res) => {
  try {
    // Latest subscriber counts across all substacks
    const subscribers = await pool.query(`
      SELECT s.name, s.slug, sm.subscriber_count, sm.free_subscribers, sm.paid_subscribers, sm.recorded_at
      FROM substacks s
      JOIN LATERAL (
        SELECT subscriber_count, free_subscribers, paid_subscribers, recorded_at
        FROM substack_metrics
        WHERE substack_id = s.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) sm ON true
      ORDER BY sm.subscriber_count DESC
    `);

    // Previous month subscriber counts for growth calculation
    const prevSubscribers = await pool.query(`
      SELECT s.slug, sm.subscriber_count
      FROM substacks s
      JOIN LATERAL (
        SELECT subscriber_count
        FROM substack_metrics
        WHERE substack_id = s.id
        ORDER BY recorded_at DESC
        OFFSET 1
        LIMIT 1
      ) sm ON true
    `);

    // Total social followers (latest for each account)
    const social = await pool.query(`
      SELECT sa.platform, sa.handle, sm.follower_count, sm.recorded_at
      FROM social_accounts sa
      JOIN LATERAL (
        SELECT follower_count, recorded_at
        FROM social_metrics
        WHERE social_account_id = sa.id
        ORDER BY recorded_at DESC
        LIMIT 1
      ) sm ON true
      ORDER BY sm.follower_count DESC
    `);

    // Previous month social for growth
    const prevSocial = await pool.query(`
      SELECT sa.platform, sm.follower_count
      FROM social_accounts sa
      JOIN LATERAL (
        SELECT follower_count
        FROM social_metrics
        WHERE social_account_id = sa.id
        ORDER BY recorded_at DESC
        OFFSET 1
        LIMIT 1
      ) sm ON true
    `);

    // Product counts by category
    const products = await pool.query(`
      SELECT category, COUNT(*) as count,
             MIN(price) as min_price, MAX(price) as max_price,
             ROUND(AVG(price), 2) as avg_price
      FROM products
      WHERE status = 'active'
      GROUP BY category
      ORDER BY count DESC
    `);

    // Total products
    const totalProducts = await pool.query(`
      SELECT COUNT(*) as count FROM products WHERE status = 'active'
    `);

    // Revenue - current month and last 6 months
    const revenue = await pool.query(`
      SELECT
        source,
        SUM(amount) as total,
        recorded_at
      FROM revenue_entries
      GROUP BY source, recorded_at
      ORDER BY recorded_at ASC
    `);

    // Current month revenue
    const currentRevenue = await pool.query(`
      SELECT SUM(amount) as total
      FROM revenue_entries
      WHERE recorded_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    // Previous month revenue
    const prevRevenue = await pool.query(`
      SELECT SUM(amount) as total
      FROM revenue_entries
      WHERE recorded_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
        AND recorded_at < DATE_TRUNC('month', CURRENT_DATE)
    `);

    // Build previous month lookup
    const prevSubMap = {};
    prevSubscribers.rows.forEach(r => { prevSubMap[r.slug] = parseInt(r.subscriber_count); });

    const prevSocialMap = {};
    prevSocial.rows.forEach(r => { prevSocialMap[r.platform] = parseInt(r.follower_count); });

    // Calculate totals
    const totalSubscribers = subscribers.rows.reduce((sum, r) => sum + parseInt(r.subscriber_count), 0);
    const totalPrevSubscribers = Object.values(prevSubMap).reduce((sum, v) => sum + v, 0);
    const totalFollowers = social.rows.reduce((sum, r) => sum + parseInt(r.follower_count), 0);
    const totalPrevFollowers = Object.values(prevSocialMap).reduce((sum, v) => sum + v, 0);

    res.json({
      subscribers: {
        total: totalSubscribers,
        growth: totalPrevSubscribers > 0 ? ((totalSubscribers - totalPrevSubscribers) / totalPrevSubscribers * 100).toFixed(1) : 0,
        breakdown: subscribers.rows.map(r => ({
          name: r.name,
          slug: r.slug,
          total: parseInt(r.subscriber_count),
          free: parseInt(r.free_subscribers),
          paid: parseInt(r.paid_subscribers),
          growth: prevSubMap[r.slug]
            ? ((parseInt(r.subscriber_count) - prevSubMap[r.slug]) / prevSubMap[r.slug] * 100).toFixed(1)
            : 0
        }))
      },
      social: {
        total: totalFollowers,
        growth: totalPrevFollowers > 0 ? ((totalFollowers - totalPrevFollowers) / totalPrevFollowers * 100).toFixed(1) : 0,
        breakdown: social.rows.map(r => ({
          platform: r.platform,
          handle: r.handle,
          followers: parseInt(r.follower_count),
          growth: prevSocialMap[r.platform]
            ? ((parseInt(r.follower_count) - prevSocialMap[r.platform]) / prevSocialMap[r.platform] * 100).toFixed(1)
            : 0
        }))
      },
      products: {
        total: parseInt(totalProducts.rows[0].count),
        categories: products.rows.map(r => ({
          category: r.category,
          count: parseInt(r.count),
          priceRange: `$${parseFloat(r.min_price)}-$${parseFloat(r.max_price)}`,
          avgPrice: parseFloat(r.avg_price)
        }))
      },
      revenue: {
        currentMonth: parseFloat(currentRevenue.rows[0].total || 0),
        previousMonth: parseFloat(prevRevenue.rows[0].total || 0),
        growth: prevRevenue.rows[0].total > 0
          ? ((parseFloat(currentRevenue.rows[0].total || 0) - parseFloat(prevRevenue.rows[0].total)) / parseFloat(prevRevenue.rows[0].total) * 100).toFixed(1)
          : 0,
        bySource: revenue.rows
      }
    });
  } catch (err) {
    console.error('Dashboard overview error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// GET /api/dashboard/subscribers - Detailed subscriber data with trends
app.get('/api/dashboard/subscribers', async (req, res) => {
  try {
    const trends = await pool.query(`
      SELECT s.name, s.slug, sm.subscriber_count, sm.free_subscribers, sm.paid_subscribers,
             TO_CHAR(sm.recorded_at, 'YYYY-MM') as month
      FROM substacks s
      JOIN substack_metrics sm ON sm.substack_id = s.id
      ORDER BY s.name, sm.recorded_at ASC
    `);

    // Group by substack
    const grouped = {};
    trends.rows.forEach(r => {
      if (!grouped[r.slug]) {
        grouped[r.slug] = { name: r.name, slug: r.slug, data: [] };
      }
      grouped[r.slug].data.push({
        month: r.month,
        total: parseInt(r.subscriber_count),
        free: parseInt(r.free_subscribers),
        paid: parseInt(r.paid_subscribers)
      });
    });

    res.json({ substacks: Object.values(grouped) });
  } catch (err) {
    console.error('Subscribers error:', err);
    res.status(500).json({ error: 'Failed to load subscriber data' });
  }
});

// GET /api/dashboard/products - Full product catalog
app.get('/api/dashboard/products', async (req, res) => {
  try {
    const products = await pool.query(`
      SELECT id, name, category, price, description, status, created_at
      FROM products
      WHERE status = 'active'
      ORDER BY category, price DESC
    `);

    const summary = await pool.query(`
      SELECT category, COUNT(*) as count,
             SUM(price) as total_value,
             ROUND(AVG(price), 2) as avg_price,
             MIN(price) as min_price,
             MAX(price) as max_price
      FROM products
      WHERE status = 'active'
      GROUP BY category
      ORDER BY count DESC
    `);

    res.json({
      products: products.rows.map(r => ({
        ...r,
        price: parseFloat(r.price)
      })),
      summary: summary.rows.map(r => ({
        category: r.category,
        count: parseInt(r.count),
        totalValue: parseFloat(r.total_value),
        avgPrice: parseFloat(r.avg_price),
        minPrice: parseFloat(r.min_price),
        maxPrice: parseFloat(r.max_price)
      }))
    });
  } catch (err) {
    console.error('Products error:', err);
    res.status(500).json({ error: 'Failed to load product data' });
  }
});

// GET /api/dashboard/social - Social media metrics with trends
app.get('/api/dashboard/social', async (req, res) => {
  try {
    const trends = await pool.query(`
      SELECT sa.platform, sa.handle, sa.url, sm.follower_count,
             TO_CHAR(sm.recorded_at, 'YYYY-MM') as month
      FROM social_accounts sa
      JOIN social_metrics sm ON sm.social_account_id = sa.id
      ORDER BY sa.platform, sm.recorded_at ASC
    `);

    const grouped = {};
    trends.rows.forEach(r => {
      if (!grouped[r.platform]) {
        grouped[r.platform] = { platform: r.platform, handle: r.handle, url: r.url, data: [] };
      }
      grouped[r.platform].data.push({
        month: r.month,
        followers: parseInt(r.follower_count)
      });
    });

    res.json({ accounts: Object.values(grouped) });
  } catch (err) {
    console.error('Social error:', err);
    res.status(500).json({ error: 'Failed to load social data' });
  }
});

// GET /api/dashboard/subscribers/email - Email subscribers list
app.get('/api/dashboard/subscribers/email', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, source, subscribed_at
      FROM email_subscribers
      ORDER BY subscribed_at DESC
      LIMIT 500
    `);

    const total = await pool.query('SELECT COUNT(*) as count FROM email_subscribers');

    res.json({
      total: parseInt(total.rows[0].count),
      subscribers: result.rows
    });
  } catch (err) {
    console.error('Email subscribers error:', err);
    res.status(500).json({ error: 'Failed to load email subscribers' });
  }
});

// GET /api/dashboard/orders - Recent orders with fulfillment status
app.get('/api/dashboard/orders', async (req, res) => {
  try {
    const statusFilter = req.query.status; // optional: fulfilled, failed, pending, legacy
    let query = `
      SELECT id, email, product_name, amount, stripe_session_id,
             fulfillment_status, fulfillment_sent_at, fulfillment_error,
             created_at
      FROM orders
    `;
    const params = [];

    if (statusFilter && ['fulfilled', 'failed', 'pending', 'legacy'].includes(statusFilter)) {
      query += ` WHERE fulfillment_status = $1`;
      params.push(statusFilter);
    }

    query += ` ORDER BY created_at DESC LIMIT 50`;

    const result = await pool.query(query, params);

    // Summary counts
    const summary = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE fulfillment_status = 'fulfilled') as fulfilled,
        COUNT(*) FILTER (WHERE fulfillment_status = 'failed') as failed,
        COUNT(*) FILTER (WHERE fulfillment_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE fulfillment_status = 'legacy') as legacy,
        SUM(amount) as total_revenue
      FROM orders
    `);

    res.json({
      orders: result.rows.map(r => ({
        ...r,
        amount: r.amount ? parseFloat(r.amount) : null
      })),
      summary: {
        total: parseInt(summary.rows[0].total),
        fulfilled: parseInt(summary.rows[0].fulfilled),
        failed: parseInt(summary.rows[0].failed),
        pending: parseInt(summary.rows[0].pending),
        legacy: parseInt(summary.rows[0].legacy),
        totalRevenue: parseFloat(summary.rows[0].total_revenue || 0)
      }
    });
  } catch (err) {
    console.error('Orders dashboard error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

// POST /api/admin/resend-fulfillment - Resend fulfillment email for an order
app.post('/api/admin/resend-fulfillment', requireDashboardAuth, async (req, res) => {
  try {
    const { email, session_id, order_id } = req.body;

    if (!email && !session_id && !order_id) {
      return res.status(400).json({ error: 'Provide email, session_id, or order_id' });
    }

    let orderQuery, orderParams;
    if (order_id) {
      orderQuery = 'SELECT * FROM orders WHERE id = $1 LIMIT 1';
      orderParams = [order_id];
    } else if (session_id) {
      orderQuery = 'SELECT * FROM orders WHERE stripe_session_id = $1 LIMIT 1';
      orderParams = [session_id];
    } else {
      // By email — resend to the most recent order for this email
      orderQuery = 'SELECT * FROM orders WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1';
      orderParams = [email];
    }

    const result = await pool.query(orderQuery, orderParams);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = result.rows[0];

    if (!order.email) {
      return res.status(400).json({ error: 'Order has no email address — cannot resend' });
    }

    console.log(`Resending fulfillment: order=${order.id} email=${order.email}`);

    // Derive productSlug from stored product_name for accurate URL generation
    const resendSlug = lookupProductSlugByName(order.product_name);
    if (!resendSlug) {
      console.warn(`[resend] Could not resolve productSlug for product_name="${order.product_name}" — will use legacy fallback`);
    }

    const emailResult = await sendFulfillmentEmail({
      email: order.email,
      productName: order.product_name,
      amount: order.amount,
      productSlug: resendSlug,
      sessionId: order.stripe_session_id
    });

    // Update fulfillment status
    await pool.query(
      `UPDATE orders
       SET fulfillment_status = $1,
           fulfillment_sent_at = $2,
           fulfillment_error = $3
       WHERE id = $4`,
      [
        emailResult.success ? 'fulfilled' : 'failed',
        emailResult.success ? new Date() : null,
        emailResult.success ? null : emailResult.error,
        order.id
      ]
    );

    if (emailResult.success) {
      res.json({ success: true, message: `Fulfillment email sent to ${order.email}` });
    } else {
      res.status(500).json({ success: false, error: `Email failed: ${emailResult.error}` });
    }
  } catch (err) {
    console.error('Resend fulfillment error:', err);
    res.status(500).json({ error: 'Failed to resend fulfillment' });
  }
});

// GET /api/dashboard/revenue - Revenue breakdown with trends
app.get('/api/dashboard/revenue', async (req, res) => {
  try {
    const monthly = await pool.query(`
      SELECT source, amount, category,
             TO_CHAR(recorded_at, 'YYYY-MM') as month
      FROM revenue_entries
      ORDER BY recorded_at ASC, source
    `);

    // Group by month
    const byMonth = {};
    monthly.rows.forEach(r => {
      if (!byMonth[r.month]) {
        byMonth[r.month] = { month: r.month, total: 0, breakdown: {} };
      }
      byMonth[r.month].total += parseFloat(r.amount);
      byMonth[r.month].breakdown[r.source] = parseFloat(r.amount);
    });

    res.json({
      months: Object.values(byMonth),
      totalAllTime: monthly.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0)
    });
  } catch (err) {
    console.error('Revenue error:', err);
    res.status(500).json({ error: 'Failed to load revenue data' });
  }
});

// ============================================================
// ANALYTICS METRICS ENDPOINTS
// All require dashboard auth. Data sourced from:
//   - email_subscribers  (subscriber metrics)
//   - page_views         (traffic metrics)
// ============================================================

// GET /api/metrics/subscribers — subscriber counts + source breakdown
app.get('/api/metrics/subscribers', requireDashboardAuth, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE subscribed_at >= NOW() - INTERVAL '1 day') AS today,
        COUNT(*) FILTER (WHERE subscribed_at >= NOW() - INTERVAL '7 days') AS this_week,
        COUNT(*) FILTER (WHERE subscribed_at >= NOW() - INTERVAL '30 days') AS this_month
      FROM email_subscribers
    `);

    const sources = await pool.query(`
      SELECT source, COUNT(*) AS count
      FROM email_subscribers
      GROUP BY source
      ORDER BY count DESC
    `);

    const daily = await pool.query(`
      SELECT DATE(subscribed_at) AS date, COUNT(*) AS count
      FROM email_subscribers
      WHERE subscribed_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(subscribed_at)
      ORDER BY date ASC
    `);

    const r = stats.rows[0];
    res.json({
      total:      parseInt(r.total),
      today:      parseInt(r.today),
      this_week:  parseInt(r.this_week),
      this_month: parseInt(r.this_month),
      sources:    sources.rows.map(s => ({ source: s.source, count: parseInt(s.count) })),
      daily:      daily.rows.map(d => ({ date: d.date, count: parseInt(d.count) }))
    });
  } catch (err) {
    console.error('Subscriber metrics error:', err);
    res.status(500).json({ error: 'Failed to load subscriber metrics' });
  }
});

// GET /api/metrics/traffic — page views + unique visitors + top paths + referrers
app.get('/api/metrics/traffic', requireDashboardAuth, async (req, res) => {
  try {
    const visitors = await pool.query(`
      SELECT
        COUNT(DISTINCT ip_hash) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')  AS unique_today,
        COUNT(DISTINCT ip_hash) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS unique_week,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')  AS views_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS views_week,
        COUNT(*) AS total_views
      FROM page_views
    `);

    const byPath = await pool.query(`
      SELECT path, COUNT(*) AS views
      FROM page_views
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY path
      ORDER BY views DESC
      LIMIT 15
    `);

    const referrers = await pool.query(`
      SELECT referrer, COUNT(*) AS count
      FROM page_views
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND referrer IS NOT NULL
        AND referrer <> ''
        AND referrer NOT LIKE '%deadhiddenos.polsia.app%'
        AND referrer NOT LIKE '%deadhidden.org%'
        AND referrer NOT LIKE '%localhost%'
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 10
    `);

    const v = visitors.rows[0];
    res.json({
      unique_today:  parseInt(v.unique_today),
      unique_week:   parseInt(v.unique_week),
      views_today:   parseInt(v.views_today),
      views_week:    parseInt(v.views_week),
      total_views:   parseInt(v.total_views),
      by_path:       byPath.rows.map(r => ({ path: r.path, views: parseInt(r.views) })),
      top_referrers: referrers.rows.map(r => ({ referrer: r.referrer, count: parseInt(r.count) }))
    });
  } catch (err) {
    console.error('Traffic metrics error:', err);
    res.status(500).json({ error: 'Failed to load traffic metrics' });
  }
});

// ============================================================
// FAITHWALL COHORT DETECTION
// ============================================================

/**
 * Returns 'faithwall_individual', 'faithwall_household', or null.
 * Checks productSlug first (most reliable), then product name, then amount.
 */
function detectFaithWallCohort(productSlug, productName, amount) {
  if (productSlug) {
    if (productSlug === 'faithwall-individual') return 'faithwall_individual';
    if (productSlug === 'faithwall-household') return 'faithwall_household';
  }
  if (productName) {
    const n = productName.toLowerCase();
    if (n.includes('faithwall') || n.includes('faith wall')) {
      if (n.includes('household')) return 'faithwall_household';
      return 'faithwall_individual';
    }
  }
  // Amount-based last resort: $29.99 = individual, $39.99 = household
  const amt = parseFloat(amount);
  if (amt === 39.99) return 'faithwall_household';
  if (amt === 29.99) return 'faithwall_individual';
  return null;
}

// ============================================================
// FAITHWALL EMAIL TEMPLATES
// Sender: Adam <adam@deadhidden.org>
// Reply-to: thebiblicalman1611@gmail.com
// Voice: KJV, direct, no emojis
// ============================================================

function buildFaithWallStep0Email(cohort) {
  const isHousehold = cohort === 'faithwall_household';
  const dashboardUrl = 'https://faithwall.deadhidden.org/dashboard';

  const householdSection = isHousehold ? `
  <p>You purchased the household license. <span class="bold">That means your wife and your children can be added to the dashboard.</span> Open the dashboard and invite them. The wall goes up for the whole house — not just you.</p>

  <hr class="divider">
` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.55rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:32px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .em { color:#f5f0e8; font-style:italic; }
  .bold { color:#f5f0e8; font-weight:600; font-style:normal; }
  .divider { border:none; border-top:1px solid rgba(201,162,39,0.18); margin:30px 0; }
  .verse-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:16px 20px; margin:24px 0; }
  .verse-ref { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .verse-text { color:rgba(245,240,232,0.72); font-style:italic; font-size:0.94rem; line-height:1.7; }
  .step-block { background:#1a1a1a; border:1px solid rgba(201,162,39,0.15); padding:16px 20px; margin:24px 0; border-radius:2px; }
  .step-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:10px; font-family:'Arial',sans-serif; }
  .step-item { color:rgba(245,240,232,0.7); font-size:0.9rem; line-height:1.7; margin:0 0 6px; padding-left:16px; border-left:2px solid rgba(201,162,39,0.3); }
  .cta-block { text-align:center; margin:32px 0; }
  .cta-btn { display:inline-block; background:#c9a227; color:#0f0f0f; text-decoration:none; font-weight:700; font-size:0.95rem; padding:14px 28px; letter-spacing:0.02em; font-family:'Arial',sans-serif; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall</div>
  <div class="title">You didn't buy a filter.<br>You drew a line.</div>

  <div class="verse-block">
    <div class="verse-ref">Job 31:1</div>
    <div class="verse-text">"I made a covenant with mine eyes; why then should I think upon a maid?"</div>
  </div>

  <p>Job didn't ask his wife to hide the magazines. He didn't rely on willpower when temptation appeared. He made a covenant — a binding agreement — with his own eyes, before the moment of weakness arrived.</p>

  <p>FaithWall is that covenant in software. <span class="bold">It is not a filter. Filters are passive. A covenant is a vow.</span> You have made a vow about what enters your eyes through the most contested territory in your home: the browser.</p>

  <hr class="divider">

  ${householdSection}

  <p>Here is how to have the wall fully up:</p>

  <div class="step-block">
    <div class="step-label">Three steps</div>
    <p class="step-item"><span class="bold">1. Install the extension</span> — Chrome Web Store, search FaithWall, or use the link in your receipt.</p>
    <p class="step-item"><span class="bold">2. Open the web app</span> — faithwall.deadhidden.org/dashboard. Set your passcode. This is yours alone.</p>
    <p class="step-item"><span class="bold">3. The new tab is now the wall.</span> Every time a new tab opens, Scripture appears. The temptation has to get past the Word first.</p>
  </div>

  <div class="cta-block">
    <a href="${dashboardUrl}" class="cta-btn">Open Dashboard</a>
  </div>

  <div class="footer">
    FaithWall — faithwall.deadhidden.org<br>
    You received this because you purchased FaithWall. Reply with questions.
  </div>
</div>
</body>
</html>`;

  const text = `FAITHWALL

You didn't buy a filter. You drew a line.

Job 31:1 — "I made a covenant with mine eyes; why then should I think upon a maid?"

Job didn't ask his wife to hide the magazines. He didn't rely on willpower when temptation appeared. He made a covenant — a binding agreement — with his own eyes, before the moment of weakness arrived.

FaithWall is that covenant in software. It is not a filter. Filters are passive. A covenant is a vow. You have made a vow about what enters your eyes through the most contested territory in your home: the browser.

${isHousehold ? 'You purchased the household license. That means your wife and your children can be added to the dashboard. Open the dashboard and invite them. The wall goes up for the whole house — not just you.\n\n' : ''}Here is how to have the wall fully up:

1. Install the extension — Chrome Web Store, search FaithWall, or use the link in your receipt.
2. Open the web app — faithwall.deadhidden.org/dashboard. Set your passcode. This is yours alone.
3. The new tab is now the wall. Every time a new tab opens, Scripture appears. The temptation has to get past the Word first.

Open Dashboard: ${dashboardUrl}

---
FaithWall — faithwall.deadhidden.org
You received this because you purchased FaithWall. Reply with questions.`;

  return { html, text };
}

function buildFaithWallStep1Email(cohort) {
  const supportUrl = 'https://faithwall.deadhidden.org/support';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.55rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:32px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .em { color:#f5f0e8; font-style:italic; }
  .bold { color:#f5f0e8; font-weight:600; font-style:normal; }
  .divider { border:none; border-top:1px solid rgba(201,162,39,0.18); margin:30px 0; }
  .verse-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:16px 20px; margin:24px 0; }
  .verse-ref { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .verse-text { color:rgba(245,240,232,0.72); font-style:italic; font-size:0.94rem; line-height:1.7; }
  .explain-block { background:#1a1a1a; border:1px solid rgba(201,162,39,0.15); padding:16px 20px; margin:24px 0; border-radius:2px; }
  .explain-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:10px; font-family:'Arial',sans-serif; }
  .cta-link { color:#c9a227; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall</div>
  <div class="title">The new tab is the battlefield.</div>

  <div class="verse-block">
    <div class="verse-ref">Psalm 101:3</div>
    <div class="verse-text">"I will set no wicked thing before mine eyes: I hate the work of them that turn aside; it shall not cleave to me."</div>
  </div>

  <p>David wrote that before browsers existed. He understood the principle anyway: <span class="bold">what you allow before your eyes shapes what cleaves to you.</span> The new tab is the most-opened surface in your browser. Most men open it dozens of times a day. Before FaithWall, it was empty or worse. Now it is the Word.</p>

  <hr class="divider">

  <p><span class="bold">How the Scripture override works:</span> Every time you open a new tab, FaithWall pulls a verse from the King James Bible. You cannot skip it. You cannot minimize it. You read it, or you close the tab. That is the design.</p>

  <div class="explain-block">
    <div class="explain-label">The passcode</div>
    <p style="margin:0;color:rgba(245,240,232,0.7);font-size:0.9rem;line-height:1.7;">The passcode belongs to the household head — not the user. This is intentional. If a child or a wife can override the wall themselves, it is not a wall. Set the passcode once. Keep it. The accountability stays with you because you are the one who established the covenant.</p>
  </div>

  <p>If the extension installed but the new tab is not showing Scripture, or if you need to set or reset your passcode, the answer is at the support page:</p>

  <p><a href="${supportUrl}" class="cta-link">faithwall.deadhidden.org/support</a></p>

  <div class="footer">
    FaithWall — faithwall.deadhidden.org<br>
    You received this because you purchased FaithWall. Reply with questions.
  </div>
</div>
</body>
</html>`;

  const text = `FAITHWALL

The new tab is the battlefield.

Psalm 101:3 — "I will set no wicked thing before mine eyes: I hate the work of them that turn aside; it shall not cleave to me."

David wrote that before browsers existed. He understood the principle anyway: what you allow before your eyes shapes what cleaves to you. The new tab is the most-opened surface in your browser. Most men open it dozens of times a day. Before FaithWall, it was empty or worse. Now it is the Word.

How the Scripture override works: Every time you open a new tab, FaithWall pulls a verse from the King James Bible. You cannot skip it. You cannot minimize it. You read it, or you close the tab. That is the design.

The passcode: The passcode belongs to the household head — not the user. This is intentional. If a child or a wife can override the wall themselves, it is not a wall. Set the passcode once. Keep it. The accountability stays with you because you are the one who established the covenant.

If the extension installed but the new tab is not showing Scripture, or if you need to set or reset your passcode, the answer is at the support page:

${supportUrl}

---
FaithWall — faithwall.deadhidden.org
You received this because you purchased FaithWall. Reply with questions.`;

  return { html, text };
}

function buildFaithWallStep2Email(cohort) {
  const testimonyFormUrl = 'https://deadhidden.org/os/stand';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.55rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:32px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .em { color:#f5f0e8; font-style:italic; }
  .bold { color:#f5f0e8; font-weight:600; font-style:normal; }
  .divider { border:none; border-top:1px solid rgba(201,162,39,0.18); margin:30px 0; }
  .ask-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:20px 24px; margin:28px 0; }
  .ask-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:10px; font-family:'Arial',sans-serif; }
  .cta-link { color:#c9a227; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall</div>
  <div class="title">One sentence.<br>How is it holding?</div>

  <p>One week in. The wall is either up and you are noticing something, or it is not yet working the way it should.</p>

  <p>I am asking directly: <span class="bold">has anything shifted?</span></p>

  <p>It does not have to be dramatic. One sentence. "The new tab is doing something." "I had to close it three times." "My son saw it and asked what it was." That is enough. That is a testimony.</p>

  <hr class="divider">

  <p>Two ways to respond:</p>

  <div class="ask-block">
    <div class="ask-label">Option 1</div>
    <p style="margin:0 0 10px;color:rgba(245,240,232,0.7);font-size:0.9rem;line-height:1.7;"><span class="bold">Reply to this email.</span> One sentence. I read every one.</p>
  </div>

  <div class="ask-block">
    <div class="ask-label">Option 2</div>
    <p style="margin:0 0 10px;color:rgba(245,240,232,0.7);font-size:0.9rem;line-height:1.7;">Submit it at the stand form — <a href="${testimonyFormUrl}" class="cta-link">deadhidden.org/os/stand</a>. These go on record. Other men read them.</p>
  </div>

  <div class="footer">
    FaithWall — faithwall.deadhidden.org<br>
    You received this because you purchased FaithWall. Reply any time.
  </div>
</div>
</body>
</html>`;

  const text = `FAITHWALL

One sentence. How is it holding?

One week in. The wall is either up and you are noticing something, or it is not yet working the way it should.

I am asking directly: has anything shifted?

It does not have to be dramatic. One sentence. "The new tab is doing something." "I had to close it three times." "My son saw it and asked what it was." That is enough. That is a testimony.

Two ways to respond:

1. Reply to this email. One sentence. I read every one.
2. Submit it at the stand form — ${testimonyFormUrl}. These go on record. Other men read them.

---
FaithWall — faithwall.deadhidden.org
You received this because you purchased FaithWall. Reply any time.`;

  return { html, text };
}

function buildFaithWallStep3Email(cohort, orderId) {
  // Per-buyer attribution hash — first 12 chars of SHA-256(orderId)
  // crypto is required at top of file
  const buyerIdHash = crypto
    .createHash('sha256')
    .update(String(orderId))
    .digest('hex')
    .slice(0, 12);

  const referralUrl = `https://faithwall.deadhidden.org?utm_source=buyer_referral&utm_medium=email&utm_campaign=faithwall_t14&utm_content=${buyerIdHash}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.55rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:32px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .em { color:#f5f0e8; font-style:italic; }
  .bold { color:#f5f0e8; font-weight:600; font-style:normal; }
  .divider { border:none; border-top:1px solid rgba(201,162,39,0.18); margin:30px 0; }
  .link-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:16px 20px; margin:24px 0; word-break:break-all; }
  .link-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:8px; font-family:'Arial',sans-serif; }
  .pass-link { color:#c9a227; text-decoration:none; font-size:0.9rem; word-break:break-all; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall</div>
  <div class="title">Who else needs<br>the wall up?</div>

  <p>Two weeks. The wall is up in your browser. The new tab is the Word instead of a blank page or worse.</p>

  <p>You know someone who needs this. <span class="bold">A brother who keeps losing the same fight. A father who has given up. A man at your church who would never ask for help but would accept it if you handed it to him directly.</span></p>

  <p>Send them the link. That is all.</p>

  <hr class="divider">

  <div class="link-block">
    <div class="link-label">Your referral link</div>
    <a href="${referralUrl}" class="pass-link">${referralUrl}</a>
  </div>

  <p>Forward this email. Copy the link into a text. Hand them your phone and say "install this." However it gets there — get it there.</p>

  <p>The covenant you made on day one was for yourself. <span class="em">Passing it on is for the next man who hasn't made it yet.</span></p>

  <div class="footer">
    FaithWall — faithwall.deadhidden.org<br>
    You received this because you purchased FaithWall.
  </div>
</div>
</body>
</html>`;

  const text = `FAITHWALL

Who else needs the wall up?

Two weeks. The wall is up in your browser. The new tab is the Word instead of a blank page or worse.

You know someone who needs this. A brother who keeps losing the same fight. A father who has given up. A man at your church who would never ask for help but would accept it if you handed it to him directly.

Send them the link. That is all.

Your referral link:
${referralUrl}

Forward this email. Copy the link into a text. Hand them your phone and say "install this." However it gets there — get it there.

The covenant you made on day one was for yourself. Passing it on is for the next man who hasn't made it yet.

---
FaithWall — faithwall.deadhidden.org
You received this because you purchased FaithWall.`;

  return { html, text };
}

// ============================================================
// FAITHWALL SEQUENCE STEP SENDER
// Reads from faithwall_sequence_sends for idempotency.
// All steps sent from Adam <adam@deadhidden.org> with
// reply-to thebiblicalman1611@gmail.com
// ============================================================

async function sendFaithWallSequenceStep(orderId, email, step, cohort, isBackfill = false) {
  // Idempotency guard
  const existing = await pool.query(
    'SELECT id FROM faithwall_sequence_sends WHERE order_id = $1 AND step = $2',
    [orderId, step]
  );
  if (existing.rows.length > 0) {
    console.log(`[fw-sequence] step=${step} already sent for order=${orderId} — skip`);
    return { skipped: true };
  }

  let emailContent;
  let subject;
  if (step === 0) {
    emailContent = buildFaithWallStep0Email(cohort);
    subject = 'You didn\'t buy a filter. You drew a line.';
  } else if (step === 1) {
    emailContent = buildFaithWallStep1Email(cohort);
    subject = 'The new tab is the battlefield.';
  } else if (step === 2) {
    emailContent = buildFaithWallStep2Email(cohort);
    subject = 'One sentence. How is it holding?';
  } else if (step === 3) {
    emailContent = buildFaithWallStep3Email(cohort, orderId);
    subject = 'Who else needs the wall up?';
  } else {
    throw new Error(`Unknown FaithWall sequence step: ${step}`);
  }

  // All FaithWall sequence emails from adam@ with reply-to thebiblicalman1611@gmail.com
  const result = await sendSequenceEmail({
    to: email,
    subject,
    htmlBody: emailContent.html,
    textBody: emailContent.text,
    from: 'Adam <adam@deadhidden.org>',
    replyTo: 'thebiblicalman1611@gmail.com'
  });

  const errorMsg = result.ok ? null : result.error;
  const resendId = result.ok ? (result.id || null) : null;
  const productVal = cohort || 'faithwall_individual';

  await pool.query(
    `INSERT INTO faithwall_sequence_sends (order_id, step, product, sent_at, is_backfill, error, resend_id)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6)
     ON CONFLICT (order_id, step) DO NOTHING`,
    [orderId, step, productVal, isBackfill, errorMsg, resendId]
  ).catch(() => {
    // resend_id column may not exist yet — fall back
    return pool.query(
      `INSERT INTO faithwall_sequence_sends (order_id, step, product, sent_at, is_backfill, error)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       ON CONFLICT (order_id, step) DO NOTHING`,
      [orderId, step, productVal, isBackfill, errorMsg]
    );
  });

  if (result.ok) {
    console.log(`[fw-sequence] step=${step} sent via Resend to ${email} order=${orderId} cohort=${productVal}${isBackfill ? ' (backfill)' : ''}${resendId ? ` id=${resendId}` : ''}`);
  } else {
    console.error(`[fw-sequence] step=${step} FAILED for order=${orderId}: ${result.error}`);
  }

  return result;
}

// ============================================================
// FAITHWALL BACKFILL ENDPOINT
// POST /api/admin/faithwall-sequence-backfill
// On deploy, runs the correct steps for buyers already past thresholds.
// Idempotent — no duplicates.
// ============================================================
app.post('/api/admin/faithwall-sequence-backfill', requireDashboardAuth, async (req, res) => {
  try {
    // Find all FaithWall orders (by product_cohort or product_name/amount fallback)
    const faithwallOrders = await pool.query(`
      SELECT o.id, o.email, o.amount, o.product_name, o.product_cohort, o.created_at
      FROM orders o
      WHERE o.email IS NOT NULL
        AND (
          o.product_cohort IN ('faithwall_individual', 'faithwall_household')
          OR o.product_name ILIKE '%faithwall%'
          OR o.product_name ILIKE '%faith wall%'
          OR (o.amount IN (29.99, 39.99) AND o.product_cohort IS NULL AND o.product_name IS NULL)
        )
      ORDER BY o.created_at ASC
    `);

    if (faithwallOrders.rows.length === 0) {
      return res.json({ success: true, processed: 0, message: 'No FaithWall orders found.' });
    }

    res.json({
      success: true,
      found: faithwallOrders.rows.length,
      message: `Found ${faithwallOrders.rows.length} FaithWall orders — running backfill in background`
    });

    // Run backfill fire-and-forget
    (async () => {
      const now = new Date();
      let sent = 0;
      let skipped = 0;

      for (const order of faithwallOrders.rows) {
        const cohort = order.product_cohort || detectFaithWallCohort(null, order.product_name, order.amount) || 'faithwall_individual';
        const ageMs = now - new Date(order.created_at);
        const ageDays = ageMs / (1000 * 60 * 60 * 24);

        // Ensure product_cohort is set
        if (!order.product_cohort) {
          await pool.query(
            `UPDATE orders SET product_cohort = $1 WHERE id = $2`,
            [cohort, order.id]
          ).catch(() => {});
        }

        // Send whichever steps are due based on order age
        const stepsToSend = [];
        if (ageDays >= 0) stepsToSend.push(0);
        if (ageDays >= 2) stepsToSend.push(1);
        if (ageDays >= 7) stepsToSend.push(2);
        if (ageDays >= 14) stepsToSend.push(3);

        for (const step of stepsToSend) {
          const result = await sendFaithWallSequenceStep(order.id, order.email, step, cohort, true);
          if (!result.skipped) sent++;
          else skipped++;
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      console.log(`[fw-backfill] Complete — sent=${sent} skipped=${skipped} orders=${faithwallOrders.rows.length}`);
    })().catch(err => console.error('[fw-backfill] Error:', err.message));

  } catch (err) {
    console.error('[fw-backfill] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Backfill failed', detail: err.message });
    }
  }
});

// ============================================================
// POST-PURCHASE EMAIL SEQUENCE
// Three steps after every order:
//   Step 0 — T+0 (immediate): Welcome / conviction reinforcement
//   Step 1 — T+2 days: Deeper-cut resource pointer
//   Step 2 — T+7 days: Testimonial / story ask
//
// Suppression: once a step is recorded in email_sequence_sends, it's
// never sent again for that order. Backfill orders get step 0 only.
// ============================================================

// Determine "category" from amount (since product_name is NULL on legacy orders)
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
  // Amount-based guess for NULL product_name orders
  const amt = parseFloat(amount);
  if (amt >= 100) return 'bundle';
  if (amt >= 60) return 'manual';
  if (amt >= 25) return 'pro';
  return 'warfare'; // $7, $14, $17 → warfare / battlefield content
}

// ---- Step 0: Welcome — "You didn't buy a PDF. You joined a stand." ----
function buildSequenceStep0Email(buyerEmail, amount, productName) {
  const category = guessProductCategory(amount, productName);
  const resourceLibraryUrl = 'https://deadhidden.org/library';

  // Primary adjacent resource — varies by what they likely bought
  let adjacentResource, adjacentLabel;
  if (category === 'man' || category === 'bundle') {
    adjacentResource = 'https://deadhidden.org/library#spiritual-warfare';
    adjacentLabel = 'Spiritual Warfare in the New Testament — free deep-cut in the library';
  } else if (category === 'woman') {
    adjacentResource = 'https://deadhidden.org/library#biblical-womanhood';
    adjacentLabel = 'Biblical Womanhood: What the Text Actually Says — library archive';
  } else {
    // warfare / default
    adjacentResource = 'https://deadhidden.org/library#masculinity';
    adjacentLabel = 'The Masculinity Crisis Is a Theology Crisis — start here if you haven\'t';
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
  .resource-link:hover { color:#f5f0e8; }
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

  <p>Your purchase is in your inbox (the confirmation email came first). But don't stop there.</p>

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

// ---- Step 1: T+2 — Deeper-cut resource pointer ----
function buildSequenceStep1Email(buyerEmail, amount, productName) {
  const category = guessProductCategory(amount, productName);

  let title, excerpt, url, urlLabel;
  if (category === 'woman') {
    title = 'The Sigh That Rises: On Feminine Sorrow and Biblical Hope';
    excerpt = 'The most honest piece in the library on what the Bible actually asks of women — and what it doesn\'t. Not softened. Not performed. Just the text and what it costs.';
    url = 'https://deadhidden.org/library#biblical-womanhood';
    urlLabel = 'Read it in the library →';
  } else if (category === 'man' || category === 'bundle') {
    title = 'The Dead Man\'s Posture: On Crucifixion, Masculinity, and Why Most Men Miss Both';
    excerpt = 'Galatians 2:20 is the operating system for everything Dead Hidden teaches about men. This is the primary document. If you haven\'t read it, read it before anything else.';
    url = 'https://deadhidden.org/library#masculinity';
    urlLabel = 'Read it in the library →';
  } else {
    // warfare default
    title = 'Spiritual Warfare Is Not a Metaphor: What the New Testament Actually Describes';
    excerpt = 'Not spiritual self-help dressed in military language. The actual principalities, the actual posture, the actual commands. Most churches never get here. This does.';
    url = 'https://deadhidden.org/library#spiritual-warfare';
    urlLabel = 'Read it in the library →';
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
  .eyebrow { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:rgba(245,240,232,0.35); margin-bottom:8px; font-family:'Arial',sans-serif; }
  .title { font-size:1.45rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.3; margin-bottom:28px; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .bold { color:#f5f0e8; font-weight:600; }
  .piece-block { background:#252525; border:1px solid rgba(139,37,0,0.2); padding:24px; margin:28px 0; }
  .piece-title { font-size:1.05rem; color:#f5f0e8; font-weight:700; line-height:1.35; margin-bottom:12px; font-family:'Georgia',serif; }
  .piece-excerpt { font-size:0.9rem; color:rgba(245,240,232,0.6); line-height:1.7; margin-bottom:16px; font-style:italic; }
  .cta { display:inline-block; background:#8b2500; color:#f5f0e8; text-decoration:none; padding:12px 24px; font-size:0.78rem; font-weight:700; letter-spacing:2px; text-transform:uppercase; font-family:'Arial',sans-serif; }
  .verse { font-style:italic; color:rgba(245,240,232,0.28); font-size:0.84rem; margin-top:32px; padding-top:24px; border-top:1px solid rgba(245,240,232,0.05); }
  .footer { margin-top:24px; font-size:0.78rem; color:rgba(245,240,232,0.22); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Dead Hidden</div>
  <div class="eyebrow">Two days in</div>
  <div class="title">One piece worth your time this week.</div>

  <p>You've had two days with what you bought. Hopefully you've cracked it. But there's one piece in the library that I want to put in front of you directly — because it's the thing most people in this space don't say out loud.</p>

  <div class="piece-block">
    <div class="piece-title">${title}</div>
    <div class="piece-excerpt">${excerpt}</div>
    <a href="${url}" class="cta">${urlLabel}</a>
  </div>

  <p>The library at <span class="bold">deadhidden.org/library</span> has everything archived. But this one is the entry point. If you read one thing this week, make it this.</p>

  <div class="verse">"Stand firm therefore, having fastened on the belt of truth." — Ephesians 6:14</div>
  <div class="footer">Dead Hidden — deadhidden.org | Reply with questions or pushback.</div>
</div>
</body>
</html>`;

  const text = `Dead Hidden — Two days in

One piece worth your time this week.

You've had two days with what you bought. Hopefully you've cracked it. But there's one piece in the library I want to put in front of you directly — because it's the thing most people in this space don't say out loud.

---

${title}

${excerpt}

Read it: ${url}

---

The library at deadhidden.org/library has everything archived. But this one is the entry point. If you read one thing this week, make it this.

"Stand firm therefore, having fastened on the belt of truth." — Ephesians 6:14

Dead Hidden — deadhidden.org
Reply with questions or pushback.`;

  return { html, text };
}

// ---- Step 2: T+7 — Direct testimonial / story ask ----
// ---- Step 3: T+14 — Referral / pass-it-on ----
function buildSequenceStep3Email(buyerEmail, amount, productName, orderId) {
  // Stable short hash of orderId for per-buyer UTM content tag
  const crypto = require('crypto');
  const buyerIdHash = crypto.createHash('sha256').update(String(orderId)).digest('hex').slice(0, 12);

  const referralUrl = `https://deadhidden.org/os?utm_source=buyer_referral&utm_medium=email&utm_campaign=t14&utm_content=${buyerIdHash}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#1a1a1a; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#8b2500; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .eyebrow { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:rgba(245,240,232,0.35); margin-bottom:8px; font-family:'Arial',sans-serif; }
  .title { font-size:1.45rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.3; margin-bottom:28px; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .pass-block { background:#252525; border-left:3px solid #8b2500; padding:20px 24px; margin:28px 0; }
  .pass-link { color:#c46030; text-decoration:none; font-size:0.9rem; word-break:break-all; }
  .pass-link:hover { color:#f5f0e8; }
  .sig { color:rgba(245,240,232,0.55); font-size:0.95rem; margin-top:28px; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Dead Hidden</div>
  <div class="eyebrow">Two weeks in</div>
  <div class="title">Who else?</div>

  <p>You're 14 days into the field manual.</p>

  <p>Somewhere in your circle is a man still running the good-man loop. A brother. A friend from work. Your father. Someone hiding behind church culture instead of standing on the Word.</p>

  <p>Pass this on:</p>

  <div class="pass-block">
    <a href="${referralUrl}" class="pass-link">${referralUrl}</a>
  </div>

  <p>That's it. No pitch from me. The work does the work.</p>

  <p class="sig">— Adam</p>

  <div class="footer">Dead Hidden — deadhidden.org</div>
</div>
</body>
</html>`;

  const text = `Dead Hidden — Two weeks in

You're 14 days into the field manual.

Somewhere in your circle is a man still running the good-man loop. A brother. A friend from work. Your father. Someone hiding behind church culture instead of standing on the Word.

Pass this on:
${referralUrl}

That's it. No pitch from me. The work does the work.

— Adam

Dead Hidden — deadhidden.org`;

  return { html, text };
}

// ---- Step 2: T+7 — Direct testimonial / story ask ----
function buildSequenceStep2Email(buyerEmail, amount, productName) {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#1a1a1a; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#8b2500; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .eyebrow { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:rgba(245,240,232,0.35); margin-bottom:8px; font-family:'Arial',sans-serif; }
  .title { font-size:1.45rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.3; margin-bottom:28px; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .bold { color:#f5f0e8; font-weight:600; }
  .ask-block { background:#1f1f1f; border:1px solid rgba(139,37,0,0.25); padding:24px 28px; margin:28px 0; }
  .ask-block p { margin:0; font-size:1.02rem; color:#f5f0e8; line-height:1.75; }
  .verse { font-style:italic; color:rgba(245,240,232,0.28); font-size:0.84rem; margin-top:32px; padding-top:24px; border-top:1px solid rgba(245,240,232,0.05); }
  .footer { margin-top:24px; font-size:0.78rem; color:rgba(245,240,232,0.22); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Dead Hidden</div>
  <div class="eyebrow">One week in</div>
  <div class="title">I'm asking you something.</div>

  <p>You've had a week. You've read some of it, or all of it, or you've been meaning to and life got in the way. That's real. I'm not going to perform concern about your engagement rate.</p>

  <p>But if something landed — one paragraph, one sentence, one moment where you thought <span class="bold">"that's exactly what I couldn't find the words for"</span> — I want to hear it.</p>

  <div class="ask-block">
    <p>Two ways to answer. Pick the one that feels right.</p>
    <p style="margin-top:16px;font-size:0.95rem;color:rgba(245,240,232,0.65);">Hit reply — one or two sentences is enough. Or go here:</p>
    <p style="margin-top:8px;"><a href="https://deadhiddenos.polsia.app/os/stand" style="color:#c46030;font-size:0.9rem;">deadhiddenos.polsia.app/os/stand</a></p>
  </div>

  <p>The page asks three things: your name (or initials), how long you've been running it, and the one thing that hit. You can also give permission to publish — we won't add words you didn't write.</p>

  <p>I read every reply. I don't forward them to a VA. I don't run them through a sentiment tool. I read them, and when someone says something worth putting in front of other people — with their permission — I do.</p>

  <p>If nothing shifted yet, that's an honest answer too. Reply with that.</p>

  <div class="verse">"For the word of God is living and active, sharper than any two-edged sword." — Hebrews 4:12</div>
  <div class="footer">Dead Hidden — deadhidden.org</div>
</div>
</body>
</html>`;

  const text = `Dead Hidden — One week in

I'm asking you something.

You've had a week. You've read some of it, or all of it, or you've been meaning to and life got in the way. That's real.

But if something landed — one paragraph, one sentence, one moment where you thought "that's exactly what I couldn't find the words for" — I want to hear it.

Two ways to answer:

Hit reply — one or two sentences is enough.

Or go here: https://deadhiddenos.polsia.app/os/stand

The page asks three things: your name (or initials), how long you've been running it, and the one thing that hit. You can also give permission to publish — we won't add words you didn't write.

I read every reply. I don't forward them to a VA. I don't run them through a sentiment tool. I read them, and when someone says something worth putting in front of other people — with their permission — I do.

If nothing shifted yet, that's an honest answer too. Reply with that.

"For the word of God is living and active, sharper than any two-edged sword." — Hebrews 4:12

Dead Hidden — deadhidden.org`;

  return { html, text };
}

// Send a single sequence step for an order — idempotent (skips if already sent)
async function sendSequenceStep(orderId, email, step, amount, productName, isBackfill = false) {
  // Check if already sent (idempotency guard)
  const existing = await pool.query(
    'SELECT id FROM email_sequence_sends WHERE order_id = $1 AND step = $2',
    [orderId, step]
  );
  if (existing.rows.length > 0) {
    console.log(`[sequence] step=${step} already sent for order=${orderId} — skip`);
    return { skipped: true };
  }

  let emailContent;
  let subject;
  if (step === 0) {
    emailContent = buildSequenceStep0Email(email, amount, productName);
    subject = 'You didn\'t buy a PDF. You joined a stand.';
  } else if (step === 1) {
    emailContent = buildSequenceStep1Email(email, amount, productName);
    subject = 'One piece worth your time this week — Dead Hidden';
  } else if (step === 2) {
    emailContent = buildSequenceStep2Email(email, amount, productName);
    subject = 'I\'m asking you something — Dead Hidden';
  } else if (step === 3) {
    emailContent = buildSequenceStep3Email(email, amount, productName, orderId);
    subject = 'Two weeks in. Who else?';
  } else {
    throw new Error(`Unknown sequence step: ${step}`);
  }

  // Step 2 gets a reply-to so buyers can reply directly to the operator
  // Step 3 (referral) sends from adam@ with reply-to thebiblicalman1611@gmail.com
  const replyTo = (step === 2) ? (process.env.ADMIN_EMAIL || 'support@deadhidden.org')
    : (step === 3) ? 'thebiblicalman1611@gmail.com'
    : undefined;
  const fromOverride = (step === 3) ? 'Adam <adam@deadhidden.org>' : undefined;

  // Route through Resend (deadhidden.org sender) to bypass Polsia 50/day cap
  const result = await sendSequenceEmail({
    to: email,
    subject,
    htmlBody: emailContent.html,
    textBody: emailContent.text,
    replyTo,
    from: fromOverride
  });

  // Record the send attempt (success or failure) — includes resend message id when available
  const errorMsg = result.ok ? null : result.error;
  const resendId = result.ok ? (result.id || null) : null;
  await pool.query(
    `INSERT INTO email_sequence_sends (order_id, step, sent_at, is_backfill, error, resend_id)
     VALUES ($1, $2, NOW(), $3, $4, $5)
     ON CONFLICT (order_id, step) DO NOTHING`,
    [orderId, step, isBackfill, errorMsg, resendId]
  ).catch(() => {
    // resend_id column may not exist yet — fall back to 4-param insert
    return pool.query(
      `INSERT INTO email_sequence_sends (order_id, step, sent_at, is_backfill, error)
       VALUES ($1, $2, NOW(), $3, $4)
       ON CONFLICT (order_id, step) DO NOTHING`,
      [orderId, step, isBackfill, errorMsg]
    );
  });

  if (result.ok) {
    console.log(`[sequence] step=${step} sent via Resend to ${email} order=${orderId}${isBackfill ? ' (backfill)' : ''}${resendId ? ` id=${resendId}` : ''}`);
  } else {
    console.error(`[sequence] step=${step} FAILED for order=${orderId}: ${result.error}`);
  }

  return result;
}

// ============================================================
// SEQUENCE SCHEDULER — runs every 30 minutes
// Finds orders due for step 1 (T+2d), step 2 (T+7d), or step 3 (T+14d)
// and sends the email if not already sent.
// ============================================================

// Exposed so the admin trigger endpoint can call it directly
let runScheduledSequenceFn = null;

function startSequenceScheduler() {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  async function runScheduledSequence() {
    try {
      // Step 1: orders created >= 2 days ago that haven't received step 1
      const step1Due = await pool.query(`
        SELECT o.id, o.email, o.amount, o.product_name
        FROM orders o
        WHERE o.email IS NOT NULL
          AND o.created_at <= NOW() - INTERVAL '2 days'
          AND NOT EXISTS (
            SELECT 1 FROM email_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 1
          )
          AND EXISTS (
            SELECT 1 FROM email_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 0
          )
        LIMIT 20
      `);

      for (const order of step1Due.rows) {
        await sendSequenceStep(order.id, order.email, 1, order.amount, order.product_name);
        // Small delay between sends to avoid rate-limit bursts
        await new Promise(r => setTimeout(r, 1200));
      }

      // Step 2: orders created >= 7 days ago that haven't received step 2
      const step2Due = await pool.query(`
        SELECT o.id, o.email, o.amount, o.product_name
        FROM orders o
        WHERE o.email IS NOT NULL
          AND o.created_at <= NOW() - INTERVAL '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM email_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 2
          )
          AND EXISTS (
            SELECT 1 FROM email_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 0
          )
        LIMIT 20
      `);

      for (const order of step2Due.rows) {
        await sendSequenceStep(order.id, order.email, 2, order.amount, order.product_name);
        await new Promise(r => setTimeout(r, 1200));
      }

      // Step 3: orders created >= 14 days ago that haven't received step 3
      // Referral / pass-it-on email from adam@deadhidden.org
      const step3Due = await pool.query(`
        SELECT o.id, o.email, o.amount, o.product_name
        FROM orders o
        WHERE o.email IS NOT NULL
          AND o.created_at <= NOW() - INTERVAL '14 days'
          AND NOT EXISTS (
            SELECT 1 FROM email_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 3
          )
          AND EXISTS (
            SELECT 1 FROM email_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 0
          )
        LIMIT 20
      `);

      for (const order of step3Due.rows) {
        await sendSequenceStep(order.id, order.email, 3, order.amount, order.product_name);
        await new Promise(r => setTimeout(r, 1200));
      }

      const totalSent = step1Due.rows.length + step2Due.rows.length + step3Due.rows.length;
      if (totalSent > 0) {
        console.log(`[sequence-scheduler] Sent step 1 to ${step1Due.rows.length}, step 2 to ${step2Due.rows.length}, step 3 to ${step3Due.rows.length}`);
      }

      // ---- FaithWall sequence steps ----
      // FaithWall orders detected by product_cohort or product_name/amount

      const fwStep1Due = await pool.query(`
        SELECT o.id, o.email, o.amount, o.product_name, o.product_cohort
        FROM orders o
        WHERE o.email IS NOT NULL
          AND o.created_at <= NOW() - INTERVAL '2 days'
          AND (
            o.product_cohort IN ('faithwall_individual', 'faithwall_household')
            OR o.product_name ILIKE '%faithwall%'
            OR o.product_name ILIKE '%faith wall%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM faithwall_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 1
          )
          AND EXISTS (
            SELECT 1 FROM faithwall_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 0
          )
        LIMIT 20
      `);

      for (const order of fwStep1Due.rows) {
        const cohort = order.product_cohort || detectFaithWallCohort(null, order.product_name, order.amount) || 'faithwall_individual';
        await sendFaithWallSequenceStep(order.id, order.email, 1, cohort);
        await new Promise(r => setTimeout(r, 1200));
      }

      const fwStep2Due = await pool.query(`
        SELECT o.id, o.email, o.amount, o.product_name, o.product_cohort
        FROM orders o
        WHERE o.email IS NOT NULL
          AND o.created_at <= NOW() - INTERVAL '7 days'
          AND (
            o.product_cohort IN ('faithwall_individual', 'faithwall_household')
            OR o.product_name ILIKE '%faithwall%'
            OR o.product_name ILIKE '%faith wall%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM faithwall_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 2
          )
          AND EXISTS (
            SELECT 1 FROM faithwall_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 0
          )
        LIMIT 20
      `);

      for (const order of fwStep2Due.rows) {
        const cohort = order.product_cohort || detectFaithWallCohort(null, order.product_name, order.amount) || 'faithwall_individual';
        await sendFaithWallSequenceStep(order.id, order.email, 2, cohort);
        await new Promise(r => setTimeout(r, 1200));
      }

      const fwStep3Due = await pool.query(`
        SELECT o.id, o.email, o.amount, o.product_name, o.product_cohort
        FROM orders o
        WHERE o.email IS NOT NULL
          AND o.created_at <= NOW() - INTERVAL '14 days'
          AND (
            o.product_cohort IN ('faithwall_individual', 'faithwall_household')
            OR o.product_name ILIKE '%faithwall%'
            OR o.product_name ILIKE '%faith wall%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM faithwall_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 3
          )
          AND EXISTS (
            SELECT 1 FROM faithwall_sequence_sends s
            WHERE s.order_id = o.id AND s.step = 0
          )
        LIMIT 20
      `);

      for (const order of fwStep3Due.rows) {
        const cohort = order.product_cohort || detectFaithWallCohort(null, order.product_name, order.amount) || 'faithwall_individual';
        await sendFaithWallSequenceStep(order.id, order.email, 3, cohort);
        await new Promise(r => setTimeout(r, 1200));
      }

      const fwTotalSent = fwStep1Due.rows.length + fwStep2Due.rows.length + fwStep3Due.rows.length;
      if (fwTotalSent > 0) {
        console.log(`[fw-sequence-scheduler] Sent step 1 to ${fwStep1Due.rows.length}, step 2 to ${fwStep2Due.rows.length}, step 3 to ${fwStep3Due.rows.length}`);
      }
    } catch (err) {
      console.error('[sequence-scheduler] Error:', err.message);
    }
  }

  // Expose for admin trigger endpoint
  runScheduledSequenceFn = runScheduledSequence;

  // Stagger first run by 2 minutes to let the app fully start
  setTimeout(() => {
    runScheduledSequence();
    setInterval(runScheduledSequence, INTERVAL_MS);
  }, 2 * 60 * 1000);

  console.log('[sequence-scheduler] Started (30-min interval, first run in 2min)');
}

// ============================================================
// BACKFILL ENDPOINT — one-time blast to existing buyers
// POST /api/admin/sequence-backfill
// Sends T+0 welcome to all orders that haven't received step 0.
// Idempotent — safe to call multiple times.
// ============================================================
app.post('/api/admin/sequence-backfill', requireDashboardAuth, async (req, res) => {
  try {
    const eligible = await pool.query(`
      SELECT o.id, o.email, o.amount, o.product_name
      FROM orders o
      WHERE o.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM email_sequence_sends s
          WHERE s.order_id = o.id AND s.step = 0
        )
      ORDER BY o.created_at ASC
    `);

    if (eligible.rows.length === 0) {
      return res.json({ success: true, sent: 0, message: 'No eligible orders — backfill already complete.' });
    }

    // Fire-and-forget with staggered delay so we don't blow the rate limit
    let sent = 0;
    let failed = 0;
    const results = [];

    for (const order of eligible.rows) {
      const result = await sendSequenceStep(order.id, order.email, 0, order.amount, order.product_name, true);
      if (result.skipped) {
        // Already sent (shouldn't happen given our query, but guard anyway)
      } else if (result.ok) {
        sent++;
      } else {
        failed++;
      }
      results.push({ id: order.id, email: order.email, ok: result.ok, skipped: result.skipped });
      await new Promise(r => setTimeout(r, 1500)); // 1.5s between sends
    }

    console.log(`[sequence-backfill] Complete — sent=${sent} failed=${failed} total=${eligible.rows.length}`);
    res.json({ success: true, sent, failed, total: eligible.rows.length, results });
  } catch (err) {
    console.error('[sequence-backfill] Error:', err);
    res.status(500).json({ error: 'Backfill failed', detail: err.message });
  }
});

// ============================================================
// ADMIN: TRIGGER SEQUENCE RUN NOW
// POST /api/admin/sequence-run-now — fires the scheduler immediately
// instead of waiting for the 30-min interval. Auth required.
// ============================================================
app.post('/api/admin/sequence-run-now', requireDashboardAuth, async (req, res) => {
  if (!runScheduledSequenceFn) {
    return res.status(503).json({ error: 'Scheduler not initialized yet — try again in a moment' });
  }
  console.log('[sequence-run-now] Manual trigger requested');
  // Fire-and-forget: respond immediately, run in background
  res.json({ success: true, message: 'Sequence run triggered — check logs or sequence-status in ~60s' });
  runScheduledSequenceFn().catch(err => {
    console.error('[sequence-run-now] Error:', err.message);
  });
});

// ============================================================
// SEQUENCE STATUS ENDPOINT
// GET /api/admin/sequence-status — shows send state per order
// ============================================================
app.get('/api/admin/sequence-status', requireDashboardAuth, async (req, res) => {
  try {
    // Field Manual cohort summary (email_sequence_sends)
    const fmSummary = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE email IS NOT NULL
          AND (product_cohort IS NULL OR product_cohort NOT LIKE 'faithwall%')
          AND product_name NOT ILIKE '%faithwall%'
        ) AS total_orders,
        COUNT(DISTINCT CASE WHEN step = 0 AND error IS NULL THEN order_id END) AS step0_sent,
        COUNT(DISTINCT CASE WHEN step = 1 AND error IS NULL THEN order_id END) AS step1_sent,
        COUNT(DISTINCT CASE WHEN step = 2 AND error IS NULL THEN order_id END) AS step2_sent,
        COUNT(DISTINCT CASE WHEN step = 3 AND error IS NULL THEN order_id END) AS step3_sent,
        COUNT(CASE WHEN step = 3 AND error IS NOT NULL THEN 1 END) AS step3_failures,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS total_failures,
        COUNT(CASE WHEN error ILIKE '%rate%' OR error ILIKE '%429%' OR error ILIKE '%limit%' THEN 1 END) AS rate_limit_failures,
        (
          SELECT COUNT(DISTINCT s2.order_id)
          FROM email_sequence_sends s2
          JOIN orders o2 ON s2.order_id = o2.id
          WHERE s2.error IS NULL
            AND s2.step IN (1, 2)
            AND o2.created_at < '2026-05-07T16:30:00Z'
        ) AS backfill_recovered
      FROM email_sequence_sends
    `);

    // FaithWall cohort summary (faithwall_sequence_sends)
    const fwSummaryResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE email IS NOT NULL
          AND (
            product_cohort IN ('faithwall_individual', 'faithwall_household')
            OR product_name ILIKE '%faithwall%'
          )
        ) AS total_fw_orders,
        (SELECT COUNT(*) FROM orders WHERE email IS NOT NULL AND product_cohort = 'faithwall_individual') AS individual_orders,
        (SELECT COUNT(*) FROM orders WHERE email IS NOT NULL AND product_cohort = 'faithwall_household') AS household_orders,
        COUNT(DISTINCT CASE WHEN step = 0 AND error IS NULL THEN order_id END) AS step0_sent,
        COUNT(DISTINCT CASE WHEN step = 1 AND error IS NULL THEN order_id END) AS step1_sent,
        COUNT(DISTINCT CASE WHEN step = 2 AND error IS NULL THEN order_id END) AS step2_sent,
        COUNT(DISTINCT CASE WHEN step = 3 AND error IS NULL THEN order_id END) AS step3_sent,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS total_failures,
        COUNT(CASE WHEN step = 3 AND is_backfill = true THEN 1 END) AS backfill_count
      FROM faithwall_sequence_sends
    `).catch(() => ({ rows: [{ total_fw_orders: 0, individual_orders: 0, household_orders: 0, step0_sent: 0, step1_sent: 0, step2_sent: 0, step3_sent: 0, total_failures: 0, backfill_count: 0 }] }));

    // UTM hash distribution for FaithWall T+14 referrals
    // Hash computed in JS (same algo as buildFaithWallStep3Email) — avoids pgcrypto dependency
    const fwUtmHashesRaw = await pool.query(`
      SELECT fws.order_id
      FROM faithwall_sequence_sends fws
      WHERE fws.step = 3 AND fws.error IS NULL
      ORDER BY fws.sent_at DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));
    const fwUtmHashes = {
      rows: fwUtmHashesRaw.rows.map(r => ({
        order_id: r.order_id,
        utm_hash: crypto.createHash('sha256').update(String(r.order_id)).digest('hex').slice(0, 12)
      }))
    };

    // Recent orders list — both cohorts
    const fmOrders = await pool.query(`
      SELECT o.id, o.email, o.amount, o.product_name, o.product_cohort, o.created_at,
        COALESCE(
          json_agg(
            json_build_object('step', s.step, 'error', s.error, 'sent_at', s.sent_at)
            ORDER BY s.step
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'
        ) AS sequence_sends
      FROM orders o
      LEFT JOIN email_sequence_sends s ON s.order_id = o.id
      WHERE o.email IS NOT NULL
        AND (o.product_cohort IS NULL OR o.product_cohort NOT LIKE 'faithwall%')
        AND (o.product_name IS NULL OR o.product_name NOT ILIKE '%faithwall%')
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 30
    `);

    const fwOrders = await pool.query(`
      SELECT o.id, o.email, o.amount, o.product_name, o.product_cohort, o.created_at,
        o.attributed_to_buyer_hash,
        COALESCE(
          json_agg(
            json_build_object('step', fws.step, 'error', fws.error, 'sent_at', fws.sent_at, 'product', fws.product)
            ORDER BY fws.step
          ) FILTER (WHERE fws.id IS NOT NULL),
          '[]'
        ) AS sequence_sends
      FROM orders o
      LEFT JOIN faithwall_sequence_sends fws ON fws.order_id = o.id
      WHERE o.email IS NOT NULL
        AND (
          o.product_cohort IN ('faithwall_individual', 'faithwall_household')
          OR o.product_name ILIKE '%faithwall%'
        )
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 30
    `).catch(() => ({ rows: [] }));

    // Attribution summary: which buyer hashes drove new FaithWall conversions
    const attributionSummary = await pool.query(`
      SELECT attributed_to_buyer_hash, COUNT(*) AS conversions
      FROM orders
      WHERE attributed_to_buyer_hash IS NOT NULL
        AND (
          product_cohort IN ('faithwall_individual', 'faithwall_household')
          OR product_name ILIKE '%faithwall%'
        )
      GROUP BY attributed_to_buyer_hash
      ORDER BY conversions DESC
    `).catch(() => ({ rows: [] }));

    // FaithWall launch blast summary
    const blastSummary = await pool.query(`
      SELECT
        COUNT(*) AS total_sent,
        COUNT(CASE WHEN error IS NULL THEN 1 END) AS success_count,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS error_count,
        COUNT(CASE WHEN subject_variant = 'A' AND error IS NULL THEN 1 END) AS variant_a_sent,
        COUNT(CASE WHEN subject_variant = 'B' AND error IS NULL THEN 1 END) AS variant_b_sent,
        MAX(sent_at) AS last_send
      FROM faithwall_launch_blast_sends
    `).catch(() => ({ rows: [{ total_sent: 0, success_count: 0, error_count: 0, variant_a_sent: 0, variant_b_sent: 0, last_send: null }] }));

    const blastRemaining = await pool.query(`
      SELECT COUNT(DISTINCT LOWER(email)) AS remaining
      FROM orders
      WHERE email IS NOT NULL
        AND LOWER(email) != 'toddhb@protonmail.com'
        AND faithwall_launch_blast_sent_at IS NULL
        AND (product_cohort IS NULL OR product_cohort NOT LIKE 'faithwall%')
        AND (product_name IS NULL OR product_name NOT ILIKE '%faithwall%')
    `).catch(() => ({ rows: [{ remaining: 0 }] }));

    const fm = fmSummary.rows[0];
    const fw = fwSummaryResult.rows[0];
    const bl = blastSummary.rows[0];

    res.json({
      sender: process.env.RESEND_API_KEY ? 'resend (deadhidden.org)' : 'polsia-proxy (fallback)',
      faithwall_launch_blast: {
        total_sent: parseInt(bl.total_sent) || 0,
        success_count: parseInt(bl.success_count) || 0,
        error_count: parseInt(bl.error_count) || 0,
        variant_a_sent: parseInt(bl.variant_a_sent) || 0,
        variant_b_sent: parseInt(bl.variant_b_sent) || 0,
        remaining_buyers: parseInt(blastRemaining.rows[0].remaining) || 0,
        last_send: bl.last_send
      },
      field_manual: {
        total_orders: parseInt(fm.total_orders) || 0,
        step0_sent: parseInt(fm.step0_sent) || 0,
        step1_sent: parseInt(fm.step1_sent) || 0,
        step2_sent: parseInt(fm.step2_sent) || 0,
        step3_sent: parseInt(fm.step3_sent) || 0,
        step3_failures: parseInt(fm.step3_failures) || 0,
        total_failures: parseInt(fm.total_failures) || 0,
        rate_limit_failures: parseInt(fm.rate_limit_failures) || 0,
        backfill_recovered: parseInt(fm.backfill_recovered) || 0
      },
      faithwall: {
        total_orders: parseInt(fw.total_fw_orders) || 0,
        individual_orders: parseInt(fw.individual_orders) || 0,
        household_orders: parseInt(fw.household_orders) || 0,
        step0_sent: parseInt(fw.step0_sent) || 0,
        step1_sent: parseInt(fw.step1_sent) || 0,
        step2_sent: parseInt(fw.step2_sent) || 0,
        step3_sent: parseInt(fw.step3_sent) || 0,
        total_failures: parseInt(fw.total_failures) || 0,
        backfill_count: parseInt(fw.backfill_count) || 0,
        utm_hashes_t14: fwUtmHashes.rows.map(r => ({ order_id: r.order_id, utm_content: r.utm_hash }))
      },
      field_manual_orders: fmOrders.rows.map(r => ({
        id: r.id,
        email: r.email,
        amount: r.amount ? parseFloat(r.amount) : null,
        product_name: r.product_name,
        created_at: r.created_at,
        steps_sent: r.sequence_sends.filter(s => !s.error).map(s => s.step),
        failures: r.sequence_sends.filter(s => s.error).map(s => ({ step: s.step, error: s.error }))
      })),
      faithwall_orders: fwOrders.rows.map(r => ({
        id: r.id,
        email: r.email,
        amount: r.amount ? parseFloat(r.amount) : null,
        product_cohort: r.product_cohort,
        created_at: r.created_at,
        attributed_to_buyer_hash: r.attributed_to_buyer_hash || null,
        steps_sent: r.sequence_sends.filter(s => !s.error).map(s => s.step),
        failures: r.sequence_sends.filter(s => s.error).map(s => ({ step: s.step, error: s.error, product: s.product }))
      })),
      share_attribution: attributionSummary.rows.map(r => ({
        buyer_hash: r.attributed_to_buyer_hash,
        conversions: parseInt(r.conversions) || 0
      }))
    });
  } catch (err) {
    console.error('[sequence-status] Error:', err);
    res.status(500).json({ error: 'Failed to load sequence status' });
  }
});

// ============================================================
// FAITHWALL LAUNCH BLAST — email templates
// Two subject variants for A/B test on 5-buyer hold-out.
// ============================================================
function buildFaithWallLaunchBlastEmail(variant, utmUrl) {
  // variant: 'A' or 'B'
  const subjectA = 'You drew a line in the manual. Now draw one on the device.';
  const subjectB = 'The wall the manual demanded.';
  const subject = variant === 'A' ? subjectA : subjectB;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:580px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.55rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.25; margin-bottom:32px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.97rem; line-height:1.8; margin:0 0 18px; }
  .em { color:#f5f0e8; font-style:italic; }
  .bold { color:#f5f0e8; font-weight:600; font-style:normal; }
  .divider { border:none; border-top:1px solid rgba(201,162,39,0.18); margin:30px 0; }
  .verse-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:16px 20px; margin:24px 0; }
  .verse-ref { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .verse-text { color:rgba(245,240,232,0.72); font-style:italic; font-size:0.94rem; line-height:1.7; }
  .pricing-block { background:#1a1a1a; border:1px solid rgba(201,162,39,0.15); padding:16px 20px; margin:24px 0; border-radius:2px; }
  .pricing-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:10px; font-family:'Arial',sans-serif; }
  .pricing-item { color:rgba(245,240,232,0.78); font-size:0.93rem; line-height:1.7; margin:0 0 6px; }
  .cta-block { text-align:center; margin:32px 0; }
  .cta-btn { display:inline-block; background:#c9a227; color:#0f0f0f; text-decoration:none; font-weight:700; font-size:0.95rem; padding:14px 28px; letter-spacing:0.02em; font-family:'Arial',sans-serif; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall — Dead Hidden</div>
  <div class="title">You drew a line in the manual.<br>Now draw one on the device.</div>

  <p>You bought the Field Manual. You know the problem — not the porn category you have a rule about, but the slow drift. The passive consumption. The thousand small inputs that add up to a man who can't hold his eyes still.</p>

  <p>The manual gave you a framework. <span class="bold">FaithWall gives you a wall.</span></p>

  <div class="verse-block">
    <div class="verse-ref">Psalm 101:3</div>
    <div class="verse-text">"I will set no wicked thing before mine eyes."</div>
  </div>

  <p>FaithWall is a browser extension that replaces the new tab — the exact moment the drift begins — with Scripture. Not a motivational quote. Not a habit tracker. The Word, on the screen, before your eyes land anywhere else.</p>

  <p>There is no algorithm. No feed. No "content for you." Just the covenant you already said you wanted to keep.</p>

  <hr class="divider">

  <p><span class="bold">Because you already bought the manual, you go first.</span> The web app and extension are live now.</p>

  <div class="pricing-block">
    <div class="pricing-label">Pricing</div>
    <p class="pricing-item"><span class="bold">Individual</span> — $29.99 one-time. Your devices.</p>
    <p class="pricing-item"><span class="bold">Household</span> — $39.99 one-time. Your wife, your children, the whole house.</p>
  </div>

  <div class="cta-block">
    <a href="${utmUrl}" class="cta-btn">Put the wall up &rarr;</a>
  </div>

  <p style="font-size:0.88rem; color:rgba(245,240,232,0.5);">One-time purchase. Yours permanently. No subscription.</p>

  <div class="footer">
    Dead Hidden — deadhidden.org<br>
    You received this because you purchased the Biblical Man Field Manual.
    Reply with questions — adam@deadhidden.org
  </div>
</div>
</body>
</html>`;

  const text = `FAITHWALL — DEAD HIDDEN

You drew a line in the manual. Now draw one on the device.

You bought the Field Manual. You know the problem — not the porn category you have a rule about, but the slow drift. The passive consumption. The thousand small inputs that add up to a man who can't hold his eyes still.

The manual gave you a framework. FaithWall gives you a wall.

Psalm 101:3 — "I will set no wicked thing before mine eyes."

FaithWall is a browser extension that replaces the new tab — the exact moment the drift begins — with Scripture. Not a motivational quote. Not a habit tracker. The Word, on the screen, before your eyes land anywhere else.

There is no algorithm. No feed. No "content for you." Just the covenant you already said you wanted to keep.

---

Because you already bought the manual, you go first. The web app and extension are live now.

PRICING
Individual — $29.99 one-time. Your devices.
Household — $39.99 one-time. Your wife, your children, the whole house.

Put the wall up: ${utmUrl}

One-time purchase. Yours permanently. No subscription.

---
Dead Hidden — deadhidden.org
You received this because you purchased the Biblical Man Field Manual.
Reply with questions — adam@deadhidden.org`;

  return { subject, html, text };
}

// ============================================================
// FAITHWALL LAUNCH BLAST
// POST /api/admin/faithwall-launch-blast — fires the one-time
// buyer blast to all Field Manual purchasers.
//
// Logic:
//   1. Pull distinct buyer emails from orders (product_slug=field-manual,
//      actually: product_cohort IS NULL or NOT faithwall + product_name
//      not faithwall). Exclude hard bounce toddhb@protonmail.com.
//   2. Exclude orders already sent (faithwall_launch_blast_sent_at IS NOT NULL).
//   3. Assign subject variant: first pass assigns A/B randomly; hold-out=5
//      buyers are split A=3, B=2 — send those first, report winner before
//      sending to remaining 33. (Defaults to auto-send if ?holdout=false)
//   4. Generate per-buyer UTM hash: SHA-256(orderId).hex().slice(0,12)
//   5. Spread sends across 30 minutes (1800s / count = delay per send).
//   6. Record every send in faithwall_launch_blast_sends + set
//      faithwall_launch_blast_sent_at on orders row.
//
// Query param:
//   ?phase=holdout   → send only the 5-buyer holdout batch (A/B test)
//   ?phase=winner&variant=A|B → send remaining buyers with winning variant
//   ?phase=all       → send everyone at once (skip A/B test)
// ============================================================
app.post('/api/admin/faithwall-launch-blast', requireDashboardAuth, async (req, res) => {
  const HARD_BOUNCE_LIST = ['toddhb@protonmail.com'];
  const HOLDOUT_SIZE = 5;
  const BASE_UTM_URL = 'https://faithwall.deadhidden.org/';

  const phase = (req.query.phase || 'holdout').toLowerCase();
  const winnerVariant = (req.query.variant || '').toUpperCase();

  try {
    // Pull all Field Manual buyers not yet blasted, excluding bounces
    const buyersResult = await pool.query(`
      SELECT DISTINCT ON (LOWER(o.email))
        o.id AS order_id,
        o.email,
        o.created_at
      FROM orders o
      WHERE o.email IS NOT NULL
        AND LOWER(o.email) != ALL($1)
        AND o.faithwall_launch_blast_sent_at IS NULL
        AND (
          o.product_cohort IS NULL
          OR o.product_cohort NOT LIKE 'faithwall%'
        )
        AND (
          o.product_name IS NULL
          OR o.product_name NOT ILIKE '%faithwall%'
        )
      ORDER BY LOWER(o.email), o.created_at ASC
    `, [HARD_BOUNCE_LIST]);

    const allBuyers = buyersResult.rows;

    if (allBuyers.length === 0) {
      return res.json({
        success: true,
        message: 'No unsent buyers found — blast already complete or no Field Manual buyers in DB.',
        sent: 0,
        skipped: 0
      });
    }

    let targetBuyers;
    let assignedVariant;

    if (phase === 'holdout') {
      // Take first HOLDOUT_SIZE buyers (deterministic by email sort)
      targetBuyers = allBuyers.slice(0, HOLDOUT_SIZE);
      // Alternate A/B: first 3 get A, last 2 get B
      assignedVariant = null; // per-buyer below
    } else if (phase === 'winner') {
      if (!['A', 'B'].includes(winnerVariant)) {
        return res.status(400).json({ error: 'Specify ?variant=A or ?variant=B when phase=winner' });
      }
      targetBuyers = allBuyers; // remaining buyers (already-sent excluded above)
      assignedVariant = winnerVariant;
    } else if (phase === 'all') {
      targetBuyers = allBuyers;
      assignedVariant = 'A'; // default to A if skipping test
    } else {
      return res.status(400).json({ error: 'phase must be holdout | winner | all' });
    }

    const totalToSend = targetBuyers.length;
    // Spread across 30 min (1800s) — minimum 1.5s per send
    const delayMs = Math.max(1500, Math.floor((30 * 60 * 1000) / totalToSend));

    console.log(`[fw-blast] Phase=${phase} | Sending to ${totalToSend} buyers | Delay ${delayMs}ms between sends`);

    // Respond immediately — sends happen async
    res.json({
      success: true,
      phase,
      total_buyers: totalToSend,
      delay_ms: delayMs,
      message: `Blast queued. ${totalToSend} emails sending over ~${Math.ceil(totalToSend * delayMs / 60000)} minutes. Check /api/admin/faithwall-blast-status for progress.`
    });

    // Async send loop
    (async () => {
      let sent = 0;
      let errors = 0;

      for (let i = 0; i < targetBuyers.length; i++) {
        const buyer = targetBuyers[i];

        // Assign variant
        let variant;
        if (phase === 'holdout') {
          // First 3 = A, last 2 = B (for 5-buyer holdout)
          variant = i < 3 ? 'A' : 'B';
        } else {
          variant = assignedVariant;
        }

        // Generate per-buyer UTM hash: SHA-256(orderId).hex().slice(0,12)
        const buyerHash = crypto.createHash('sha256').update(String(buyer.order_id)).digest('hex').slice(0, 12);
        const utmString = `utm_source=buyer_blast&utm_medium=email&utm_campaign=faithwall_launch&utm_content=${buyerHash}`;
        const utmUrl = `${BASE_UTM_URL}?${utmString}`;

        const { subject, html, text } = buildFaithWallLaunchBlastEmail(variant, utmUrl);

        // Double-check idempotency inside loop (race-safe)
        const alreadySent = await pool.query(
          'SELECT id FROM faithwall_launch_blast_sends WHERE order_id = $1',
          [buyer.order_id]
        ).catch(() => ({ rows: [] }));

        if (alreadySent.rows.length > 0) {
          console.log(`[fw-blast] Skip order #${buyer.order_id} — already in blast_sends table`);
          continue;
        }

        const result = await sendSequenceEmail({
          to: buyer.email,
          subject,
          htmlBody: html,
          textBody: text,
          from: 'Adam <adam@deadhidden.org>',
          replyTo: 'thebiblicalman1611@gmail.com'
        });

        const resendId = result.ok ? (result.id || null) : null;
        const errMsg = result.ok ? null : (result.error || 'unknown error');

        // Record in blast_sends table
        await pool.query(`
          INSERT INTO faithwall_launch_blast_sends
            (order_id, email, subject_variant, utm_hash, resend_id, error, sent_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (order_id) DO NOTHING
        `, [buyer.order_id, buyer.email, variant, buyerHash, resendId, errMsg]);

        // Mark sent on orders row (idempotency gate)
        if (result.ok) {
          await pool.query(
            'UPDATE orders SET faithwall_launch_blast_sent_at = NOW() WHERE id = $1',
            [buyer.order_id]
          );
          sent++;
          console.log(`[fw-blast] ✓ ${buyer.email} | variant=${variant} | hash=${buyerHash} | resend_id=${resendId}`);
        } else {
          errors++;
          console.error(`[fw-blast] ✗ ${buyer.email} | error: ${errMsg}`);
        }

        // Spread delay (skip after last send)
        if (i < targetBuyers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      console.log(`[fw-blast] Complete: ${sent} sent, ${errors} errors out of ${totalToSend} targeted`);
    })().catch(err => {
      console.error('[fw-blast] Async send loop error:', err.message);
    });

  } catch (err) {
    console.error('[fw-blast] Error:', err.message);
    res.status(500).json({ error: 'Blast failed: ' + err.message });
  }
});

// ============================================================
// FAITHWALL BLAST STATUS
// GET /api/admin/faithwall-blast-status — shows per-buyer send state
// ============================================================
app.get('/api/admin/faithwall-blast-status', requireDashboardAuth, async (req, res) => {
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*) AS total_sent,
        COUNT(CASE WHEN error IS NULL THEN 1 END) AS success_count,
        COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS error_count,
        COUNT(CASE WHEN subject_variant = 'A' AND error IS NULL THEN 1 END) AS variant_a_sent,
        COUNT(CASE WHEN subject_variant = 'B' AND error IS NULL THEN 1 END) AS variant_b_sent,
        MIN(sent_at) AS first_send,
        MAX(sent_at) AS last_send
      FROM faithwall_launch_blast_sends
    `).catch(() => ({ rows: [{ total_sent: 0, success_count: 0, error_count: 0, variant_a_sent: 0, variant_b_sent: 0, first_send: null, last_send: null }] }));

    // Remaining buyers not yet sent
    const remainingResult = await pool.query(`
      SELECT COUNT(DISTINCT LOWER(email)) AS remaining
      FROM orders
      WHERE email IS NOT NULL
        AND LOWER(email) != 'toddhb@protonmail.com'
        AND faithwall_launch_blast_sent_at IS NULL
        AND (product_cohort IS NULL OR product_cohort NOT LIKE 'faithwall%')
        AND (product_name IS NULL OR product_name NOT ILIKE '%faithwall%')
    `).catch(() => ({ rows: [{ remaining: 0 }] }));

    const sends = await pool.query(`
      SELECT order_id, email, subject_variant, utm_hash, resend_id, error, sent_at
      FROM faithwall_launch_blast_sends
      ORDER BY sent_at DESC
    `).catch(() => ({ rows: [] }));

    const s = summary.rows[0];
    res.json({
      summary: {
        total_sent: parseInt(s.total_sent) || 0,
        success_count: parseInt(s.success_count) || 0,
        error_count: parseInt(s.error_count) || 0,
        variant_a_sent: parseInt(s.variant_a_sent) || 0,
        variant_b_sent: parseInt(s.variant_b_sent) || 0,
        remaining_buyers: parseInt(remainingResult.rows[0].remaining) || 0,
        first_send: s.first_send,
        last_send: s.last_send
      },
      sends: sends.rows.map(r => ({
        order_id: r.order_id,
        email: r.email,
        variant: r.subject_variant,
        utm_hash: r.utm_hash,
        resend_id: r.resend_id,
        error: r.error,
        sent_at: r.sent_at
      }))
    });
  } catch (err) {
    console.error('[fw-blast-status] Error:', err.message);
    res.status(500).json({ error: 'Failed to load blast status' });
  }
});

// ============================================================
// FAITHWALL BUYER DASHBOARD — auth + data endpoints
//
// Auth: email-based magic link. Buyer submits email → receives
// a one-time token in email → clicks link → session cookie set.
// Session cookie: fw_buyer_token (HttpOnly, 30-day expiry).
//
// No passwords. No Stripe account required on buyer side.
// The buyer just needs the email they used to purchase.
// ============================================================

// Helper: generate share_hash for a buyer (deterministic from order ID)
// Same 12-char SHA-256 pattern used in T+14 referral email.
function buildBuyerShareHash(orderId) {
  return crypto.createHash('sha256').update(String(orderId)).digest('hex').slice(0, 12);
}

// Helper: build the buyer share URL
function buildBuyerShareUrl(orderId) {
  const hash = buildBuyerShareHash(orderId);
  return `https://faithwall.deadhidden.org/?utm_source=buyer_share&utm_medium=referral&utm_campaign=faithwall_word_of_mouth&utm_content=${hash}`;
}

// Helper: require buyer session (sets req.buyerOrder)
async function requireBuyerAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies['fw_buyer_token'];
  if (!token) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/dashboard/login');
  }
  try {
    const result = await pool.query(
      `SELECT s.order_id, s.email, o.created_at, o.product_cohort, o.product_name
       FROM faithwall_buyer_sessions s
       JOIN orders o ON o.id = s.order_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    if (!result.rows.length) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ error: 'Session expired' });
      }
      return res.redirect('/dashboard/login');
    }
    req.buyerSession = result.rows[0];
    // Update last_used_at async
    pool.query('UPDATE faithwall_buyer_sessions SET last_used_at = NOW() WHERE token = $1', [token])
      .catch(() => {});
    next();
  } catch (err) {
    console.error('[fw-buyer-auth] Error:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// POST /api/faithwall/request-access
// Body: { email: "buyer@example.com" }
// Sends a magic link to the buyer's email if they have a FaithWall order.
app.post('/api/faithwall/request-access', async (req, res) => {
  try {
    const raw = (req.body && req.body.email) ? req.body.email.trim().toLowerCase() : '';
    if (!raw || !raw.includes('@')) {
      return res.status(400).json({ error: 'valid_email_required' });
    }

    // Find the most recent FaithWall order for this email
    const orderResult = await pool.query(
      `SELECT id, email, product_cohort, created_at
       FROM orders
       WHERE LOWER(email) = $1
         AND (
           product_cohort IN ('faithwall_individual', 'faithwall_household')
           OR product_name ILIKE '%faithwall%'
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [raw]
    );

    // Always return success to prevent email enumeration
    if (!orderResult.rows.length) {
      console.log(`[fw-buyer-auth] No FaithWall order for email=${raw} (access denied silently)`);
      return res.json({ success: true });
    }

    const order = orderResult.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Store session
    await pool.query(
      `INSERT INTO faithwall_buyer_sessions (order_id, email, token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [order.id, order.email, token, expiresAt]
    );

    const magicLink = `https://faithwall.deadhidden.org/dashboard?token=${token}`;

    const emailHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:540px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.35rem; font-weight:700; color:#f5f0e8; letter-spacing:-0.02em; line-height:1.3; margin-bottom:28px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.95rem; line-height:1.8; margin:0 0 16px; }
  .link-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:16px 20px; margin:24px 0; }
  .link-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:8px; font-family:'Arial',sans-serif; }
  .magic-link { color:#c9a227; text-decoration:none; font-size:0.9rem; word-break:break-all; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall</div>
  <div class="title">Your dashboard access link.</div>

  <p>Click the link below to open your FaithWall dashboard. The link works for 30 days.</p>

  <div class="link-block">
    <div class="link-label">Dashboard access</div>
    <a href="${magicLink}" class="magic-link">${magicLink}</a>
  </div>

  <p>If you didn't request this, ignore this email. Your account is unchanged.</p>

  <div class="footer">
    FaithWall — faithwall.deadhidden.org<br>
    You received this because you purchased FaithWall.
  </div>
</div>
</body>
</html>`;

    const emailText = `FAITHWALL

Your dashboard access link.

Click the link below to open your FaithWall dashboard. The link works for 30 days.

${magicLink}

If you didn't request this, ignore this email.

---
FaithWall — faithwall.deadhidden.org`;

    sendSequenceEmail({
      to: order.email,
      subject: 'Your FaithWall dashboard access link',
      htmlBody: emailHtml,
      textBody: emailText
    }).catch(err => console.error('[fw-buyer-auth] Magic link email error:', err.message));

    console.log(`[fw-buyer-auth] Magic link sent to ${order.email} order=${order.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[fw-buyer-auth] request-access error:', err.message);
    res.status(500).json({ error: 'Failed to send access link' });
  }
});

// GET /api/faithwall/verify-token?token=xxx
// Called when buyer clicks magic link. Sets session cookie and redirects to dashboard.
app.get('/api/faithwall/verify-token', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect('/dashboard?error=missing_token');
  }
  try {
    const result = await pool.query(
      `SELECT s.id, s.order_id, s.email
       FROM faithwall_buyer_sessions s
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    if (!result.rows.length) {
      return res.redirect('/dashboard?error=invalid_token');
    }
    // Set cookie and redirect
    const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
    res.setHeader('Set-Cookie', `fw_buyer_token=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`);
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('[fw-buyer-auth] verify-token error:', err.message);
    return res.redirect('/dashboard?error=server_error');
  }
});

// GET /api/faithwall/buyer-me
// Returns buyer's dashboard data: covenant_day, plan, seat_count, seats_used, seats, share_hash, share_url
app.get('/api/faithwall/buyer-me', requireBuyerAuth, async (req, res) => {
  try {
    const { order_id, email, created_at, product_cohort, product_name } = req.buyerSession;

    // Determine plan
    const isHousehold = product_cohort === 'faithwall_household'
      || (product_name && product_name.toLowerCase().includes('household'));
    const plan = isHousehold ? 'household' : 'individual';

    // Covenant day — days since purchase, starting at day 1
    const purchaseDate = new Date(created_at);
    const today = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const covenantDay = Math.max(1, Math.floor((today - purchaseDate) / msPerDay) + 1);

    // Share hash and URL
    const shareHash = buildBuyerShareHash(order_id);
    const shareUrl = buildBuyerShareUrl(order_id);

    // Household seats (only for household plan)
    let seats = [];
    let seatsUsed = 0;
    const SEAT_LIMIT = 5;
    if (isHousehold) {
      const seatResult = await pool.query(
        `SELECT id, email, initials, accepted_at, invited_at
         FROM faithwall_household_seats
         WHERE head_order_id = $1
         ORDER BY invited_at ASC`,
        [order_id]
      );
      seats = seatResult.rows.map(s => ({
        id: s.id,
        email: s.email,
        initials: s.initials,
        accepted: !!s.accepted_at,
        invited_at: s.invited_at,
        accepted_at: s.accepted_at
      }));
      // Household head always counts as seat 1
      seatsUsed = 1 + seats.filter(s => s.accepted).length;
    }

    res.json({
      ok: true,
      order_id,
      email,
      plan,
      covenant_day: covenantDay,
      purchase_date: purchaseDate.toISOString(),
      share_hash: shareHash,
      share_url: shareUrl,
      seat_limit: SEAT_LIMIT,
      seats_used: seatsUsed,
      seats: isHousehold ? seats : undefined
    });
  } catch (err) {
    console.error('[fw-buyer-me] Error:', err.message);
    res.status(500).json({ error: 'Failed to load buyer data' });
  }
});

// POST /api/faithwall/invite-seat
// Body: { email, initials }
// Creates an invite for a household seat. Household plan only.
app.post('/api/faithwall/invite-seat', requireBuyerAuth, async (req, res) => {
  try {
    const { order_id, product_cohort, product_name } = req.buyerSession;
    const isHousehold = product_cohort === 'faithwall_household'
      || (product_name && product_name.toLowerCase().includes('household'));

    if (!isHousehold) {
      return res.status(403).json({ error: 'household_plan_required', message: 'Household seats require the Household plan.' });
    }

    const rawEmail = (req.body && req.body.email) ? req.body.email.trim().toLowerCase() : '';
    const rawInitials = (req.body && req.body.initials) ? req.body.initials.trim().toUpperCase().slice(0, 5) : '';

    if (!rawEmail && !rawInitials) {
      return res.status(400).json({ error: 'email_or_initials_required' });
    }

    // Check seat count
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM faithwall_household_seats WHERE head_order_id = $1`,
      [order_id]
    );
    const currentSeats = parseInt(countResult.rows[0].total) || 0;
    // 5 seats total: 1 head + 4 invited max
    if (currentSeats >= 4) {
      return res.status(400).json({ error: 'seat_limit_reached', message: 'Household plan allows 5 seats total (you + 4 members). Limit reached.' });
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');

    await pool.query(
      `INSERT INTO faithwall_household_seats (head_order_id, email, initials, invite_token)
       VALUES ($1, $2, $3, $4)`,
      [order_id, rawEmail || null, rawInitials || null, inviteToken]
    );

    const inviteUrl = `https://faithwall.deadhidden.org/dashboard?seat_token=${inviteToken}`;

    // Send invite email if email provided
    if (rawEmail) {
      const inviteHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:0; background:#0f0f0f; font-family:'Georgia',serif; }
  .wrap { max-width:540px; margin:0 auto; padding:48px 24px; }
  .brand { font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:#c9a227; font-weight:700; margin-bottom:6px; font-family:'Arial',sans-serif; }
  .title { font-size:1.35rem; font-weight:700; color:#f5f0e8; line-height:1.3; margin-bottom:28px; font-family:'Georgia',serif; }
  p { color:rgba(245,240,232,0.78); font-size:0.95rem; line-height:1.8; margin:0 0 16px; }
  .link-block { background:#1a1a1a; border-left:3px solid #c9a227; padding:16px 20px; margin:24px 0; }
  .link-label { font-size:0.72rem; letter-spacing:3px; text-transform:uppercase; color:#a08520; font-weight:700; margin-bottom:8px; font-family:'Arial',sans-serif; }
  .invite-link { color:#c9a227; text-decoration:none; font-size:0.9rem; word-break:break-all; }
  .footer { margin-top:32px; font-size:0.78rem; color:rgba(245,240,232,0.22); line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">FaithWall</div>
  <div class="title">The wall is going up in your household.</div>

  <p>You've been added to a FaithWall household. Click the link below to activate your seat — your new tab becomes Scripture instead of a blank page or worse.</p>

  <div class="link-block">
    <div class="link-label">Activate your seat</div>
    <a href="${inviteUrl}" class="invite-link">${inviteUrl}</a>
  </div>

  <p>Once you activate, install the FaithWall Chrome extension at <a href="https://faithwall.deadhidden.org" style="color:#c9a227;">faithwall.deadhidden.org</a> to put the wall up on your browser.</p>

  <div class="footer">
    FaithWall — faithwall.deadhidden.org<br>
    You received this because you were added to a FaithWall household.
  </div>
</div>
</body>
</html>`;

      sendSequenceEmail({
        to: rawEmail,
        subject: 'You\'ve been added to a FaithWall household',
        htmlBody: inviteHtml,
        textBody: `FAITHWALL\n\nThe wall is going up in your household.\n\nYou've been added to a FaithWall household. Click the link below to activate your seat.\n\n${inviteUrl}\n\n---\nFaithWall — faithwall.deadhidden.org`
      }).catch(err => console.error('[fw-invite] Email error:', err.message));
    }

    res.json({ success: true, invite_url: inviteUrl });
  } catch (err) {
    console.error('[fw-invite-seat] Error:', err.message);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// GET /api/faithwall/accept-seat?token=xxx
// Accepts a household seat invite. Creates a buyer session for the invited member.
app.get('/api/faithwall/accept-seat', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/dashboard?error=missing_token');

  try {
    const seatResult = await pool.query(
      `SELECT s.id, s.head_order_id, s.email, o.product_cohort
       FROM faithwall_household_seats s
       JOIN orders o ON o.id = s.head_order_id
       WHERE s.invite_token = $1`,
      [token]
    );
    if (!seatResult.rows.length) {
      return res.redirect('/dashboard?error=invalid_invite');
    }
    const seat = seatResult.rows[0];

    // Mark accepted
    await pool.query(
      `UPDATE faithwall_household_seats SET accepted_at = NOW() WHERE id = $1`,
      [seat.id]
    );

    // If seat has an email, create a session for them
    if (seat.email) {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO faithwall_buyer_sessions (order_id, email, token, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [seat.head_order_id, seat.email, sessionToken, expiresAt]
      );
      const maxAge = 30 * 24 * 60 * 60;
      res.setHeader('Set-Cookie', `fw_buyer_token=${sessionToken}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`);
    }

    return res.redirect('/dashboard?joined=1');
  } catch (err) {
    console.error('[fw-accept-seat] Error:', err.message);
    return res.redirect('/dashboard?error=server_error');
  }
});

// POST /api/faithwall/buyer-logout
app.post('/api/faithwall/buyer-logout', (req, res) => {
  res.setHeader('Set-Cookie', 'fw_buyer_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ success: true });
});

// ============================================================
// ONE-TIME BACKFILL: Resolve NULL product_name via Stripe session metadata
// Runs once at startup, resolves ambiguous orders ($17/$77) by
// fetching productSlug from each Stripe session's metadata.
// Safe to re-run — only touches orders with NULL product_name.
// ============================================================
async function backfillProductNamesFromStripe() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.startsWith('REPLACE_') || stripeKey.startsWith('sk_test_PLACEHOLDER')) {
    console.log('[backfill] Skipping Stripe backfill — STRIPE_SECRET_KEY not configured');
    return;
  }

  try {
    const { rows: nullOrders } = await pool.query(
      `SELECT id, stripe_session_id, amount FROM orders WHERE product_name IS NULL AND stripe_session_id IS NOT NULL`
    );

    if (nullOrders.length === 0) {
      console.log('[backfill] No orders with NULL product_name — nothing to do');
      return;
    }

    console.log(`[backfill] Found ${nullOrders.length} orders with NULL product_name — resolving via Stripe metadata`);

    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);
    let resolved = 0;
    let failed = 0;

    for (const order of nullOrders) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
        let productName = null;

        // Priority: metadata.product_name > productSlug lookup > subscription mode
        if (session.metadata && session.metadata.product_name) {
          productName = session.metadata.product_name;
        } else if (session.metadata && session.metadata.productSlug) {
          const slug = session.metadata.productSlug;
          if (CHECKOUT_PRODUCTS[slug]) {
            productName = CHECKOUT_PRODUCTS[slug].name;
          } else if (PRODUCT_SLUG_MAP[slug]) {
            productName = PRODUCT_SLUG_MAP[slug].label;
          }
        } else if (session.mode === 'subscription') {
          productName = 'Dead Hidden Pro Membership';
        }

        if (productName) {
          await pool.query(
            `UPDATE orders SET product_name = $1 WHERE id = $2`,
            [productName, order.id]
          );
          resolved++;
          console.log(`[backfill] Order #${order.id} → "${productName}"`);
        } else {
          failed++;
          console.warn(`[backfill] Order #${order.id} (session=${order.stripe_session_id}) — could not determine product name`);
        }
      } catch (err) {
        failed++;
        console.error(`[backfill] Order #${order.id} error: ${err.message}`);
      }
    }

    console.log(`[backfill] Complete: ${resolved} resolved, ${failed} unresolved out of ${nullOrders.length} total`);
  } catch (err) {
    console.error('[backfill] Stripe backfill failed:', err.message);
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  if (DASHBOARD_PASSWORD) {
    console.log('Dashboard auth: ENABLED (password protected)');
  } else {
    console.log('Dashboard auth: LOCKED (set DASHBOARD_PASSWORD env var to enable)');
  }
  startSequenceScheduler();

  // Run one-time backfill after startup (non-blocking, 5s delay to let migrations settle)
  setTimeout(() => backfillProductNamesFromStripe(), 5000);
});
