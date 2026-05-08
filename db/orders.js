// db/orders.js — Queries for orders and referral attribution.
// OWNS: orders table, referral_visits table.
// Does NOT own: Stripe sessions, email sends, sequence logic.
const pool = require('./index');
const crypto = require('crypto');

// Deterministic 12-char hash from orderId — matches T+14 email referral pattern.
function buyerHash(orderId) {
  return crypto.createHash('sha256').update(String(orderId)).digest('hex').slice(0, 12);
}

// Look up a Field Manual buyer by email and return their referral hash.
// Returns null if email not found in orders.
async function getReferralCodeForEmail(email) {
  const { rows } = await pool.query(
    `SELECT id FROM orders
     WHERE LOWER(email) = LOWER($1)
       AND product_name IS NOT NULL
       AND (
         product_name ILIKE '%field manual%'
         OR product_name ILIKE '%biblical man%'
         OR product_name ILIKE '%biblical woman%'
         OR product_name ILIKE '%household%'
         OR product_name ILIKE '%battle notes%'
         OR product_name ILIKE '%map of the dead%'
         OR product_name ILIKE '%dead hidden pro%'
         OR product_name ILIKE '%christian soldier%'
       )
     ORDER BY id ASC
     LIMIT 1`,
    [email]
  );
  if (!rows.length) return null;
  return buyerHash(rows[0].id);
}

// Log a referral visit (fire-and-forget, non-blocking).
async function trackReferralVisit(refCode, path) {
  await pool.query(
    `INSERT INTO referral_visits (ref_code, path, visited_at) VALUES ($1, $2, NOW())`,
    [refCode, path || '/checkout']
  );
}

// Get referral stats: visits and conversions per code.
async function getReferralStats() {
  const visits = await pool.query(
    `SELECT ref_code, COUNT(*) AS visit_count
     FROM referral_visits
     GROUP BY ref_code
     ORDER BY visit_count DESC`
  );

  const conversions = await pool.query(
    `SELECT attributed_to_buyer_hash AS ref_code, COUNT(*) AS conversion_count
     FROM orders
     WHERE attributed_to_buyer_hash IS NOT NULL
     GROUP BY attributed_to_buyer_hash
     ORDER BY conversion_count DESC`
  );

  // Merge visits + conversions by code
  const convMap = {};
  for (const row of conversions.rows) {
    convMap[row.ref_code] = parseInt(row.conversion_count, 10);
  }

  return visits.rows.map(r => ({
    ref_code: r.ref_code,
    visits: parseInt(r.visit_count, 10),
    conversions: convMap[r.ref_code] || 0
  }));
}

// Get all Field Manual buyers for the blast email.
async function getFieldManualBuyers() {
  const { rows } = await pool.query(
    `SELECT id, email FROM orders
     WHERE email IS NOT NULL
       AND (
         product_name ILIKE '%field manual%'
         OR product_name ILIKE '%biblical man%'
         OR product_name ILIKE '%biblical woman%'
         OR product_name ILIKE '%household%'
       )
     ORDER BY id ASC`
  );
  return rows.map(r => ({ id: r.id, email: r.email, hash: buyerHash(r.id) }));
}

// Get buyers who received the FW blast but NOT the referral corrective email.
// These are the 44 buyers who got broken checkout links on polsia.app.
async function getBuyersNeedingCorrectiveEmail() {
  const { rows } = await pool.query(
    `SELECT id, email FROM orders
     WHERE faithwall_launch_blast_sent_at IS NOT NULL
       AND referral_corrective_sent_at IS NULL
       AND email IS NOT NULL
     ORDER BY id ASC`
  );
  return rows.map(r => ({ id: r.id, email: r.email, hash: buyerHash(r.id) }));
}

// Mark a buyer as having received the corrective email.
async function markCorrectiveEmailSent(orderId) {
  await pool.query(
    'UPDATE orders SET referral_corrective_sent_at = NOW() WHERE id = $1',
    [orderId]
  );
}

module.exports = {
  getReferralCodeForEmail, trackReferralVisit, getReferralStats,
  getFieldManualBuyers, buyerHash,
  getBuyersNeedingCorrectiveEmail, markCorrectiveEmailSent
};
