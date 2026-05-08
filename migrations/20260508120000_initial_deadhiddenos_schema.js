// Initial deadhiddenos schema — reconstructed from server.js + db/orders.js queries.
// Polsia's original migrations folder was not in the snapshot zip; this is the
// equivalent schema inferred from production code (8 tables).

module.exports = {
  name: '20260508120000_initial_deadhiddenos_schema',
  up: async (client) => {
    // email_subscribers — newsletter / FaithWall waitlist signups
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_subscribers (
        id          SERIAL PRIMARY KEY,
        email       VARCHAR(255) NOT NULL,
        source      VARCHAR(100),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS email_subscribers_email_unique_idx
        ON email_subscribers (LOWER(email))
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS email_subscribers_source_idx
        ON email_subscribers (source)
    `);

    // orders — Stripe purchase records + fulfillment status + referral attribution
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id                              SERIAL PRIMARY KEY,
        email                           VARCHAR(255),
        product_name                    VARCHAR(255),
        product_cohort                  VARCHAR(100),
        amount                          NUMERIC(10,2),
        stripe_session_id               VARCHAR(255) UNIQUE,
        fulfillment_status              VARCHAR(50) DEFAULT 'pending',
        fulfillment_sent_at             TIMESTAMPTZ,
        fulfillment_error               TEXT,
        attributed_to_buyer_hash        VARCHAR(255),
        faithwall_launch_blast_sent_at  TIMESTAMPTZ,
        referral_corrective_sent_at     TIMESTAMPTZ,
        created_at                      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (LOWER(email))
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS orders_attributed_to_buyer_hash_idx
        ON orders (attributed_to_buyer_hash)
        WHERE attributed_to_buyer_hash IS NOT NULL
    `);

    // email_sequence_sends — Field Manual 4-step post-purchase drip log
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_sequence_sends (
        id          SERIAL PRIMARY KEY,
        order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        step        INTEGER NOT NULL,
        sent_at     TIMESTAMPTZ DEFAULT NOW(),
        is_backfill BOOLEAN DEFAULT FALSE,
        error       TEXT,
        resend_id   VARCHAR(255)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS email_sequence_sends_order_step_idx
        ON email_sequence_sends (order_id, step)
    `);

    // faithwall_sequence_sends — FaithWall post-purchase 4-step drip log
    await client.query(`
      CREATE TABLE IF NOT EXISTS faithwall_sequence_sends (
        id          SERIAL PRIMARY KEY,
        order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        step        INTEGER NOT NULL,
        product     VARCHAR(100),
        sent_at     TIMESTAMPTZ DEFAULT NOW(),
        is_backfill BOOLEAN DEFAULT FALSE,
        error       TEXT,
        resend_id   VARCHAR(255)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS faithwall_sequence_sends_order_step_idx
        ON faithwall_sequence_sends (order_id, step)
    `);

    // faithwall_launch_blast_sends — idempotent one-time FW launch blast
    await client.query(`
      CREATE TABLE IF NOT EXISTS faithwall_launch_blast_sends (
        id              SERIAL PRIMARY KEY,
        order_id        INTEGER UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        email           VARCHAR(255),
        subject_variant VARCHAR(10),
        utm_hash        VARCHAR(255),
        resend_id       VARCHAR(255),
        error           TEXT,
        sent_at         TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // testimonies — user-submitted, admin-approved
    await client.query(`
      CREATE TABLE IF NOT EXISTS testimonies (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255),
        running_since   VARCHAR(255),
        what_hit        TEXT,
        publish_allowed BOOLEAN DEFAULT FALSE,
        source          VARCHAR(100),
        approved_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS testimonies_approved_at_idx
        ON testimonies (approved_at DESC)
        WHERE approved_at IS NOT NULL
    `);

    // page_views — middleware-tracked traffic
    await client.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        id          SERIAL PRIMARY KEY,
        path        VARCHAR(512),
        referrer    TEXT,
        user_agent  TEXT,
        ip_hash     VARCHAR(64),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS page_views_created_at_idx
        ON page_views (created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS page_views_path_idx
        ON page_views (path)
    `);

    // referral_visits — Bring a Brother referral link tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_visits (
        id          SERIAL PRIMARY KEY,
        ref_code    VARCHAR(255) NOT NULL,
        path        VARCHAR(512),
        visited_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS referral_visits_ref_code_idx
        ON referral_visits (ref_code)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS referral_visits_visited_at_idx
        ON referral_visits (visited_at DESC)
    `);
  },
};
