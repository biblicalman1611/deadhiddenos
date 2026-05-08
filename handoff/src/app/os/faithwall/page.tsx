// src/app/os/faithwall/page.tsx
// Dead Hidden OS — FaithWall landing page
// Drop into: bib1611/deadhidden at this exact path
//
// CTAs point to Adam's existing checkout:
//   Individual ($29.99): /checkout?slug=faithwall-individual&utm_content=faithwall_landing
//   Household  ($39.99): /checkout?slug=faithwall-household&utm_content=faithwall_landing
// If those slugs differ in your Stripe config, update the href values below.
//
// Email capture POSTs to /api/signup (existing endpoint).
// Meta Pixel ID: 1648664066389309 — fires PageView + ViewContent on mount.

import type { Metadata } from 'next';
import FaithWallClient from './FaithWallClient';

export const metadata: Metadata = {
  title: 'Your Eyes Are Not Neutral — FaithWall — Dead Hidden',
  description:
    'A Scripture-first habit wall for Christian homes — browser, mobile, household. FaithWall replaces what the new tab opens to.',
  openGraph: {
    title: 'Your Eyes Are Not Neutral — FaithWall — Dead Hidden',
    description:
      'A Scripture-first habit wall for Christian homes — browser, mobile, household.',
    url: 'https://deadhidden.org/os/faithwall',
    images: [{ url: 'https://faithwall.deadhidden.org/og.png' }],
    siteName: 'Dead Hidden',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Your Eyes Are Not Neutral — FaithWall',
    description: 'A Scripture-first habit wall for Christian homes.',
    images: ['https://faithwall.deadhidden.org/og.png'],
  },
};

export default function FaithWallPage() {
  return <FaithWallClient />;
}
