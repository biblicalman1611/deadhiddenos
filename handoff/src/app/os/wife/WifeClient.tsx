'use client';

import { useState, useEffect, useRef } from 'react';
import PixelEvents from '../../../components/PixelEvents';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const SCRIPTURES = [
  {
    ref: 'Proverbs 31:10\u201312 \u2014 KJV',
    text: '\u201cWho can find a virtuous woman? for her price is far above rubies. The heart of her husband doth safely trust in her, so that he shall have no need of spoil. She will do him good and not evil all the days of her life.\u201d',
    note: 'The question is rhetorical \u2014 she is rare, not impossible. Her value is not derived from the market or the culture; it is declared by God. The husband\u2019s trust is the measure: not affection as performance, but a life that makes him safe.',
  },
  {
    ref: 'Titus 2:3\u20135 \u2014 KJV',
    text: '\u201cThe aged women likewise, that they be in behaviour as becometh holiness, not false accusers, not given to much wine, teachers of good things; That they may teach the young women to be sober, to love their husbands, to love their children, to be discreet, chaste, keepers at home, good, obedient to their own husbands, that the word of God be not blasphemed.\u201d',
    note: 'This is not a suggestion for a different era. The stakes are stated plainly: when women abandon this calling, the word of God is blasphemed. The cultural edit that says \u201cthis was only for then\u201d is the blasphemy the text is warning against.',
  },
  {
    ref: '1 Peter 3:1\u20134 \u2014 KJV',
    text: '\u201cLikewise, ye wives, be in subjection to your own husbands; that, if any obey not the word, they also may without the word be won by the conversation of the wives; While they behold your chaste conversation coupled with fear. Whose adorning let it not be that outward adorning of plaiting the hair, and of wearing of gold, or of putting on of apparel; But let it be the hidden man of the heart, in that which is not corruptible, even the ornament of a meek and quiet spirit, which is in the sight of God of great price.\u201d',
    note: 'Meek and quiet are not personality descriptors \u2014 they are a posture before God. The woman who cultivates this is not diminished; she carries what God calls great price. The outward performance culture demands cannot purchase what the hidden man of the heart holds.',
  },
  {
    ref: 'Ephesians 5:22\u201324 \u2014 KJV',
    text: '\u201cWives, submit yourselves unto your own husbands, as unto the Lord. For the husband is the head of the wife, even as Christ is the head of the church: and he is the saviour of the body. Therefore as the church is subject unto Christ, so let the wives be to their own husbands in every thing.\u201d',
    note: 'The \u201cas unto the Lord\u201d is the part the modern revision cannot survive. This is not mutual negotiation dressed in biblical language \u2014 it is an ordered relationship with a theological rationale. The church\u2019s submission to Christ is not conditional or situational. Neither is this.',
  },
  {
    ref: '1 Timothy 2:9\u201310 \u2014 KJV',
    text: '\u201cIn like manner also, that women adorn themselves in modest apparel, with shamefacedness and sobriety; not with broided hair, or gold, or pearls, or costly array; But (which becometh women professing godliness) with good works.\u201d',
    note: 'Shamefacedness is not shame \u2014 it is a self-awareness that refuses to demand attention. The woman who professes godliness is known by works, not by the surface. The culture sells the inverse: surface first, works optional.',
  },
  {
    ref: 'Proverbs 14:1 \u2014 KJV',
    text: '\u201cEvery wise woman buildeth her house: but the foolish plucketh it down with her hands.\u201d',
    note: 'There is no neutral. Every woman is building or tearing down \u2014 and the tearing down can happen with the same hands that are supposed to build. The wise woman is defined by what she constructs. The foolish woman does not need an enemy; she is her own.',
  },
  {
    ref: 'Ruth 3:11 \u2014 KJV',
    text: '\u201cAnd now, my daughter, fear not; I will do to thee all that thou requirest: for all the city of my people doth know that thou art a virtuous woman.\u201d',
    note: 'Virtue is observable. The whole city knows. It is not a private spiritual condition \u2014 it is a lived reputation built over time through faithful, visible action. This is what the Proverbs 31 woman produces: a name that precedes her.',
  },
];

export default function WifeClient() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'duplicate' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const utmRef = useRef({ source: '', medium: '', campaign: '', content: '' });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    utmRef.current = {
      source: p.get('utm_source') || '',
      medium: p.get('utm_medium') || '',
      campaign: p.get('utm_campaign') || '',
      content: p.get('utm_content') || '',
    };
  }, []);

  function buildCtaHref(base: string): string {
    const { source, medium, campaign } = utmRef.current;
    const extra: string[] = [];
    if (source) extra.push(`utm_source=${encodeURIComponent(source)}`);
    if (medium) extra.push(`utm_medium=${encodeURIComponent(medium)}`);
    if (campaign) extra.push(`utm_campaign=${encodeURIComponent(campaign)}`);
    return extra.length ? `${base}&${extra.join('&')}` : base;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setStatus('loading');
    setErrorMsg('');

    const utm = utmRef.current;
    let source = 'os_wife';
    if (utm.source) source = `os_wife|${utm.source}`;

    try {
      const resp = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source }),
      });

      if (resp.ok) {
        window.fbq?.('track', 'Lead');
        setStatus('success');
      } else if (resp.status === 409) {
        setStatus('duplicate');
      } else {
        const data = await resp.json().catch(() => ({}));
        setErrorMsg((data as { message?: string }).message || 'Something went wrong. Please try again.');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Connection failed. Check your connection and try again.');
      setStatus('error');
    }
  }

  return (
    <>
      <PixelEvents contentName="wife_grid" contentCategory="narrative_landing" />

      <style>{`
        :root {
          --bg: #111; --bg2: #1a1a1a; --bg3: #222;
          --border: rgba(139,37,0,0.2); --border-focus: #8b2500;
          --text: #f5f0e8; --text-dim: rgba(245,240,232,0.55);
          --text-faint: rgba(245,240,232,0.25);
          --accent: #8b2500; --accent-hover: #a02c00; --label: #a0522d;
        }
        html { background: var(--bg); }
        .w-body { background:var(--bg); color:var(--text); font-family:Georgia,serif; min-height:100vh; }
        .w-header { border-bottom:1px solid var(--border); padding:18px 24px; display:flex; align-items:center; }
        .w-brand { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:var(--accent); font-weight:700; text-decoration:none; }
        .w-container { max-width:640px; margin:0 auto; padding:64px 24px 96px; }
        .w-eyebrow { font-family:Arial,sans-serif; font-size:0.7rem; letter-spacing:4px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:16px; }
        .w-h1 { font-size:clamp(2rem,5vw,3rem); font-weight:700; line-height:1.1; letter-spacing:-0.03em; color:var(--text); margin-bottom:28px; }
        .w-h1 em { font-style:italic; color:var(--text-dim); }
        .w-hero-verse { background:var(--bg2); border-left:3px solid var(--accent); padding:24px 28px; margin-bottom:28px; }
        .w-hero-verse .verse-text { font-size:1.05rem; line-height:1.85; color:var(--text); font-style:italic; margin-bottom:10px; }
        .w-hero-verse .verse-ref { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:3px; text-transform:uppercase; color:var(--label); font-weight:700; }
        .w-lead { font-size:1.1rem; line-height:1.8; color:var(--text-dim); margin-bottom:40px; max-width:560px; }
        .w-lead strong { color:var(--text); font-weight:600; }
        .w-divider { border:none; border-top:1px solid var(--border); margin:48px 0; }
        .w-section-label { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:4px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:20px; }
        .w-scripture-grid { display:flex; flex-direction:column; gap:20px; margin-bottom:48px; }
        .w-scripture-item { background:var(--bg2); border:1px solid var(--border); padding:22px 24px; }
        .w-scripture-ref { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:3px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:10px; }
        .w-scripture-text { font-size:1rem; line-height:1.75; color:var(--text); font-style:italic; }
        .w-scripture-note { margin-top:10px; font-family:Arial,sans-serif; font-size:0.82rem; color:var(--text-dim); line-height:1.55; }
        .w-email-section { background:var(--bg3); border:1px solid var(--border); padding:32px 28px; margin-bottom:48px; }
        .w-email-section h2 { font-size:1.3rem; font-weight:700; line-height:1.25; letter-spacing:-0.02em; margin-bottom:10px; }
        .w-email-section p { font-size:0.93rem; color:var(--text-dim); line-height:1.65; margin-bottom:20px; }
        .w-email-row { display:flex; gap:0; flex-wrap:wrap; }
        .w-email-input { flex:1 1 220px; background:var(--bg2); border:1px solid var(--border); border-right:none; color:var(--text); font-family:Georgia,serif; font-size:1rem; padding:14px 18px; outline:none; min-width:0; }
        .w-email-input::placeholder { color:var(--text-faint); }
        .w-email-input:focus { border-color:var(--border-focus); }
        .w-email-btn { background:var(--accent); color:var(--text); border:none; padding:14px 28px; font-family:Arial,sans-serif; font-size:0.75rem; font-weight:700; letter-spacing:2px; text-transform:uppercase; cursor:pointer; white-space:nowrap; flex-shrink:0; }
        .w-email-btn:hover:not(:disabled) { background:var(--accent-hover); }
        .w-email-btn:disabled { opacity:0.55; cursor:not-allowed; }
        .w-success { font-family:Arial,sans-serif; font-size:0.85rem; color:#a3e4a3; letter-spacing:1px; margin-top:12px; }
        .w-error { font-size:0.88rem; color:#fca5a5; margin-top:10px; line-height:1.5; }
        .w-manual-cta { background:var(--bg2); border:1px solid rgba(139,37,0,0.45); padding:32px 28px; margin-bottom:24px; }
        .w-manual-cta h2 { font-size:1.35rem; font-weight:700; line-height:1.3; letter-spacing:-0.02em; margin-bottom:12px; }
        .w-manual-cta p { font-size:0.93rem; color:var(--text-dim); line-height:1.65; margin-bottom:24px; }
        .w-manual-btn { display:inline-block; background:var(--accent); color:var(--text); text-decoration:none; padding:16px 36px; font-family:Arial,sans-serif; font-size:0.78rem; font-weight:700; letter-spacing:3px; text-transform:uppercase; }
        .w-manual-btn:hover { background:var(--accent-hover); }
        .w-price-note { display:block; margin-top:12px; font-family:Arial,sans-serif; font-size:0.75rem; color:var(--text-faint); letter-spacing:1px; }
        .w-secondary-cta { background:var(--bg2); border:1px solid var(--border); padding:24px 28px; margin-bottom:48px; }
        .w-secondary-cta p { font-family:Arial,sans-serif; font-size:0.88rem; color:var(--text-dim); line-height:1.6; margin-bottom:16px; }
        .w-secondary-btn { display:inline-block; background:transparent; color:var(--text); text-decoration:none; padding:13px 28px; border:1px solid rgba(139,37,0,0.5); font-family:Arial,sans-serif; font-size:0.75rem; font-weight:700; letter-spacing:2px; text-transform:uppercase; }
        .w-secondary-btn:hover { border-color:var(--accent); }
        .w-footer { margin-top:80px; padding:32px 24px; border-top:1px solid var(--border); text-align:center; }
        .w-footer p { font-family:Arial,sans-serif; font-size:0.75rem; color:var(--text-faint); letter-spacing:1px; }
        .w-footer a { color:rgba(245,240,232,0.35); text-decoration:none; }
        .w-footer a:hover { color:var(--text-dim); }
        @media (max-width:480px) {
          .w-email-row { flex-direction:column; }
          .w-email-input { border-right:1px solid var(--border); border-bottom:none; }
          .w-email-btn { width:100%; }
        }
      `}</style>

      <div className="w-body">
        <header className="w-header">
          <a href="https://deadhidden.org" className="w-brand">Dead Hidden</a>
        </header>

        <main className="w-container">
          {/* Hero */}
          <div className="w-eyebrow">Dead Hidden OS</div>
          <h1 className="w-h1">She is not a project.<br /><em>She is a calling.</em></h1>

          <div className="w-hero-verse">
            <div className="verse-text">
              &ldquo;Who can find a virtuous woman? for her price is far above rubies. The heart of her husband doth safely trust in her, so that he shall have no need of spoil. She will do him good and not evil all the days of her life.&rdquo;
            </div>
            <div className="verse-ref">Proverbs 31:10&ndash;12 &mdash; KJV</div>
          </div>

          <p className="w-lead">
            Biblical womanhood without the apology, the apology-tour, or the cultural edits.<br />
            <strong>Scripture does not soften this calling. Neither should we.</strong><br />
            The world has rewritten what a woman is for. What you find below is what it actually says.
          </p>

          <hr className="w-divider" />

          {/* Scripture Grid */}
          <div className="w-section-label">What Scripture Says</div>
          <div className="w-scripture-grid">
            {SCRIPTURES.map((s) => (
              <div key={s.ref} className="w-scripture-item">
                <div className="w-scripture-ref">{s.ref}</div>
                <div className="w-scripture-text">{s.text}</div>
                <div className="w-scripture-note">{s.note}</div>
              </div>
            ))}
          </div>

          <hr className="w-divider" />

          {/* Email Capture */}
          <div className="w-email-section">
            <div className="w-section-label">The Material Goes Deeper</div>
            <h2>Get what we&rsquo;re building for this lane.</h2>
            <p>
              Resources, field notes, and content built specifically for Christie&rsquo;s work &mdash; when it&rsquo;s ready, not on a schedule.
              No filler. No soft Christian aesthetics. You can leave whenever.
            </p>

            {status === 'success' || status === 'duplicate' ? (
              <div className="w-success">
                {status === 'duplicate' ? "You\u2019re already on the list." : "You\u2019re in. Watch your inbox."}
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="w-email-row">
                  <input
                    type="email"
                    className="w-email-input"
                    placeholder="Your email address"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="w-email-btn"
                    disabled={status === 'loading'}
                  >
                    {status === 'loading' ? 'Joining\u2026' : 'Join \u2192'}
                  </button>
                </div>
                {status === 'error' && <div className="w-error">{errorMsg}</div>}
              </form>
            )}
          </div>

          <hr className="w-divider" />

          {/* Field Manual CTA */}
          <div className="w-manual-cta">
            <div className="w-eyebrow">Field Manual</div>
            <h2>The calling is one page.<br />The Field Manual is thirteen chapters.</h2>
            <p>
              Thirteen chapters. Verse-by-verse. No popular frameworks, no personality typing &mdash;
              just what Scripture actually says and what it demands. Built for women who want to run it, not just read it.
            </p>
            <a
              href={buildCtaHref('/checkout?slug=biblical-man-field-manual&utm_content=wife&utm_campaign=womanhood')}
              className="w-manual-btn"
            >
              Get the Field Manual &mdash; $77
            </a>
            <span className="w-price-note">One-time. No subscription. Yours permanently.</span>
          </div>

          {/* Secondary CTA — FaithWall Household */}
          <div className="w-secondary-cta">
            <p>
              Looking to guard your household? FaithWall filters what enters &mdash; porn, gambling, gossip, secular noise &mdash; and replaces it with Scripture. Household plan covers the whole home.
            </p>
            <a
              href={buildCtaHref('/checkout?slug=faithwall-household&utm_content=wife&utm_campaign=womanhood')}
              className="w-secondary-btn"
            >
              FaithWall Household Plan &mdash; $39.99
            </a>
          </div>
        </main>

        <footer className="w-footer">
          <p>
            <a href="https://deadhidden.org">Dead Hidden</a> &nbsp;|&nbsp;
            Questions: <a href="mailto:support@deadhidden.org">support@deadhidden.org</a>
          </p>
        </footer>
      </div>
    </>
  );
}
