# Dead Hidden OS — Next.js Drop-in Pages

Three Next.js App Router pages for `bib1611/deadhidden`. Drop them in, push, Vercel auto-deploys.

## What's included

| File | Route | Notes |
|------|-------|-------|
| `src/app/os/faithwall/page.tsx` + `FaithWallClient.tsx` | `/os/faithwall` | Server component + client island |
| `src/app/os/wife/page.tsx` + `WifeClient.tsx` | `/os/wife` | Server component + client island |
| `src/app/os/dashboard/page.tsx` + `DashboardClient.tsx` | `/os/dashboard` | FaithWall buyer dashboard |
| `src/components/PixelEvents.tsx` | shared | Meta Pixel 1648664066389309 — PageView + ViewContent |

## Paste instructions

```bash
cd bib1611/deadhidden
```

Copy the files into your repo — maintaining the exact directory structure:

```
src/
  app/
    os/
      faithwall/
        page.tsx
        FaithWallClient.tsx
      wife/
        page.tsx
        WifeClient.tsx
      dashboard/
        page.tsx
        DashboardClient.tsx
  components/
    PixelEvents.tsx
```

Then commit and push:

```bash
git add src/app/os/faithwall src/app/os/wife src/app/os/dashboard src/components/PixelEvents.tsx
git commit -m "Add OS pages: faithwall, wife, dashboard (Next.js drop-ins)"
git push origin main
```

Vercel auto-deploys on push to main.

## Checkout URLs

The CTAs use your existing slugs:
- `faithwall-individual` → $29.99
- `faithwall-household` → $39.99
- `biblical-man-field-manual` → $77

If your Stripe slugs differ, update the `href` values in `FaithWallClient.tsx` and `WifeClient.tsx`.

## API endpoints required

These pages call endpoints that already exist in your deployed app:

| Endpoint | Used by |
|----------|---------|
| `POST /api/signup` | Email capture on faithwall + wife pages |
| `POST /api/faithwall/request-access` | Dashboard magic link |
| `GET /api/faithwall/verify-token` | Magic link verification |
| `GET /api/faithwall/buyer-me` | Dashboard auth check |
| `POST /api/faithwall/buyer-logout` | Dashboard sign out |
| `GET /api/faithwall/accept-seat` | Seat invite accept |
| `POST /api/faithwall/add-seat` | Household seat management |

## Meta Pixel

Pixel ID `1648664066389309` is wired in `PixelEvents.tsx`. It fires:
- `PageView` on every page mount
- `ViewContent` with `content_name` per page (`faithwall_landing`, `wife_grid`, `faithwall_dashboard`)
- `Lead` on successful email capture
- `InitiateCheckout` on FaithWall CTA click (with product slug + value)

## OG images

Both `page.tsx` files reference `https://faithwall.deadhidden.org/og.png` as a placeholder. Replace with the real OG image URL when it's ready.

## No new dependencies

These pages use only Next.js built-ins and React. No additional npm packages needed.
