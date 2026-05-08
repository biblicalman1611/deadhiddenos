// src/app/os/wife/page.tsx
// Dead Hidden OS — Biblical Womanhood landing page
// Drop into: bib1611/deadhidden at this exact path
//
// CTA links:
//   Field Manual ($77):       /checkout?slug=biblical-man-field-manual&utm_content=wife&utm_campaign=womanhood
//   FaithWall Household ($39.99): /checkout?slug=faithwall-household&utm_content=wife&utm_campaign=womanhood
// Update slugs if they differ in your Stripe config.
//
// Email capture POSTs to /api/signup (existing endpoint), source=os_wife.
// Meta Pixel ID: 1648664066389309 — fires PageView + ViewContent(wife_grid) on mount.

import type { Metadata } from 'next';
import WifeClient from './WifeClient';

export const metadata: Metadata = {
  title: 'Biblical Womanhood Without Apology — Dead Hidden Ministries',
  description:
    'Who can find a virtuous woman? for her price is far above rubies. — Prov 31:10 KJV. Biblical womanhood without the apology, the apology-tour, or the cultural edits.',
  openGraph: {
    title: 'Biblical Womanhood Without Apology — Dead Hidden Ministries',
    description:
      'Biblical womanhood without the apology, the apology-tour, or the cultural edits.',
    url: 'https://deadhidden.org/os/wife',
    images: [{ url: 'https://faithwall.deadhidden.org/og.png' }],
    siteName: 'Dead Hidden',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Biblical Womanhood Without Apology',
    description: 'Scripture does not soften this calling. Neither should we.',
    images: ['https://faithwall.deadhidden.org/og.png'],
  },
};

export default function WifePage() {
  return <WifeClient />;
}
