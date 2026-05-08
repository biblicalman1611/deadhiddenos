// src/app/os/dashboard/page.tsx
// Dead Hidden OS — FaithWall Buyer Dashboard
// Drop into: bib1611/deadhidden at this exact path
//
// Auth flow (magic link):
//   POST /api/faithwall/request-access  → sends magic link email
//   GET  /api/faithwall/verify-token?token=xxx → sets cookie, redirects back
//   GET  /api/faithwall/buyer-me   → returns buyer data (401 if unauthenticated)
//   POST /api/faithwall/buyer-logout
//   POST /api/faithwall/add-seat   → household plan only
//
// No Stripe checkout on this page — it is post-purchase only.
// Meta Pixel ID: 1648664066389309

import type { Metadata } from 'next';
import DashboardClient from './DashboardClient';

export const metadata: Metadata = {
  title: 'FaithWall — Your Dashboard',
  description: 'Your FaithWall covenant dashboard.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'FaithWall — Your Dashboard',
    images: [{ url: 'https://faithwall.deadhidden.org/og.png' }],
  },
};

export default function DashboardPage() {
  return <DashboardClient />;
}
