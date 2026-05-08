# DeadHiddenOS — CLAUDE.md

## What This App Does

Dead Hidden Ministries storefront and digital platform. Sells biblical field manuals and study guides, captures email subscribers, serves post-purchase buyer dashboards, and hosts FaithWall (Chrome extension + iOS app for Scripture-first new tab replacement).

## Stack

Express.js + PostgreSQL (Neon) + Render deploy + Resend email + Stripe payments + Meta Pixel + GTM

## Directory Map

- `server.js` — monolithic entry (legacy); all routes and business logic
- `routes/` — new extracted route modules (referral.js)
- `db/` — database access layer (index.js pool, orders.js queries)
- `public/` — static HTML pages served by Express routes
- `migrations/` — node-pg-migrate SQL migration files
- `migrate.js` — migration runner (called at build time via `npm run build`)
- `faithwall-extension/` — Chrome extension source (separate artifact, not served)
- `scripts/` — one-off admin scripts
- `private/` — admin dashboard HTML (auth-gated)
- `debug/` — diagnostic pages (not linked publicly)

## Database

- `email_subscribers` — waitlist and newsletter signups (email, source)
- `orders` — Stripe purchase records with fulfillment status and product cohort
- `email_sequence_sends` — Field Manual post-purchase 4-step drip log
- `faithwall_sequence_sends` — FaithWall post-purchase 4-step drip log
- `faithwall_launch_blast_sends` — one-time buyer blast send log (idempotent)
- `testimonies` — user-submitted testimonies, approved by admin
- `page_views` — basic page view tracking
- `referral_visits` — referral link visit log (ref_code, path, visited_at)

## External Integrations

- **Stripe** — payment processing; webhooks at `/api/orders`
- **Resend** — transactional email (sequence@deadhidden.org, adam@deadhidden.org)
- **Meta Pixel** — ID 1648664066389309; Lead + Purchase + ViewContent events
- **GTM** — GTM-XXXXXXX container (placeholder; replace with real ID)
- **Polsia email proxy** — contact registration on signup via `POLSIA_API_KEY`
- **deadhidden.org** — secure file serve API for downloads

## Recent Changes

- 2026-05-07: BUG FIX — referral checkout links now point to `deadhidden.org` (was `deadhiddenos.polsia.app` → 503). Added 301 redirect on `/checkout` for polsia.app host. Corrective email endpoint at `/api/refer/send-corrective`. Migration 016 adds `referral_corrective_sent_at` to orders.
- 2026-05-07: Added OG/Twitter meta tags to `/os/faithwall` and `/faithwall` — og:image generated via DALL-E 3, hosted on R2 CDN; twitter:card=summary_large_image, twitter:site=@biblicalman
- 2026-05-07: Bring a Brother referral system — `/os/refer` buyer page, `/api/refer/lookup` API, `/os/refer/stats` admin view, `referral_visits` migration, visit tracking wired into checkout
- 2026-05-07: Added `db/` (pool + orders queries) and `routes/` (referral router) — new code follows extracted module pattern
- 2026-05-07: Added `/faithwall` waitlist page (`public/faithwall-waitlist.html`) — email capture with `source=faithwall` tag, Meta Pixel Lead event, GTM `faithwall_waitlist_signup` event, Chrome extension CTA
