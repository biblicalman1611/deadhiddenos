'use client';

import { useEffect } from 'react';

const PIXEL_ID = '1648664066389309';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

function initPixel() {
  if (typeof window === 'undefined') return;
  if (window.fbq) return;

  const fbq = function (...args: unknown[]) {
    if ((fbq as unknown as { callMethod?: (...a: unknown[]) => void }).callMethod) {
      (fbq as unknown as { callMethod: (...a: unknown[]) => void }).callMethod(...args);
    } else {
      ((fbq as unknown as { queue: unknown[] }).queue =
        (fbq as unknown as { queue: unknown[] }).queue || []).push(args);
    }
  } as unknown as typeof window.fbq;

  if (!window._fbq) window._fbq = fbq;
  window.fbq = fbq;
  (window.fbq as unknown as { push: unknown; loaded: boolean; version: string; queue: unknown[] }).push = fbq;
  (window.fbq as unknown as { loaded: boolean }).loaded = true;
  (window.fbq as unknown as { version: string }).version = '2.0';
  (window.fbq as unknown as { queue: unknown[] }).queue = [];

  const t = document.createElement('script');
  t.async = true;
  t.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const s = document.getElementsByTagName('script')[0];
  s.parentNode?.insertBefore(t, s);

  window.fbq('init', PIXEL_ID);
}

interface PixelEventsProps {
  contentName: string;
  contentCategory?: string;
}

export default function PixelEvents({ contentName, contentCategory = 'narrative_landing' }: PixelEventsProps) {
  useEffect(() => {
    initPixel();
    window.fbq?.('track', 'PageView');
    window.fbq?.('track', 'ViewContent', {
      content_name: contentName,
      content_category: contentCategory,
    });
  }, [contentName, contentCategory]);

  return (
    <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        height="1"
        width="1"
        style={{ display: 'none' }}
        src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        alt=""
      />
    </noscript>
  );
}
