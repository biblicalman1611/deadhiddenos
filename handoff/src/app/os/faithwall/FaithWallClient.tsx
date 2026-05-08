'use client';

import { useState, useEffect, useRef } from 'react';
import PixelEvents from '../../../components/PixelEvents';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const BLOCKS = [
  {
    category: 'Pornography',
    verse:
      '\u201cI made a covenant with mine eyes; why then should I think upon a maid?\u201d',
    ref: 'Job 31:1',
    note: 'The covenant is active, not passive. Job drew the line at the eye \u2014 not at the act. FaithWall draws it at the browser. The gate is set before the craving speaks.',
  },
  {
    category: 'Gambling',
    verse:
      '\u201cHe that hasteth to be rich hath an evil eye, and considereth not that poverty shall come upon him.\u201d',
    ref: 'Proverbs 28:22 KJV',
    note: 'Gambling is not a recreation problem. It is a covetousness problem with a browser entry point. Block the access point; address the root.',
  },
  {
    category: 'Occult & divination',
    verse:
      '\u201cThere shall not be found among you any one that maketh his son or his daughter to pass through the fire, or that useth divination, or an observer of times, or an enchanter, or a witch.\u201d',
    ref: 'Deuteronomy 18:10 KJV',
    note: 'Horoscopes, tarot, astrology \u2014 Scripture does not soften on any of it. The wall makes the boundary physical, not just theoretical.',
  },
  {
    category: 'Secular dating & hookup culture',
    verse:
      '\u201cFlee fornication. Every sin that a man doeth is without the body; but he that committeth fornication sinneth against his own body.\u201d',
    ref: '1 Corinthians 6:18 KJV',
    note: 'Flee is a verb of motion. Not negotiate, not moderate \u2014 flee. Access to the platform is not moderated exposure; it is the first step.',
  },
  {
    category: 'Doomscrolling & idle feeds',
    verse:
      '\u201cFinally, brethren, whatsoever things are true, whatsoever things are honest, whatsoever things are just, whatsoever things are pure, whatsoever things are lovely, whatsoever things are of good report; if there be any virtue, and if there be any praise, think on these things.\u201d',
    ref: 'Philippians 4:8 KJV',
    note: 'The algorithmic feed was not designed to help you think on these things. It was designed to keep you thinking on the next thing. The new tab is the first redirect.',
  },
  {
    category: 'Gossip & slander outlets',
    verse:
      '\u201cA froward man soweth strife: and a whisperer separateth chief friends.\u201d',
    ref: 'Proverbs 16:28 KJV',
    note: 'Celebrity gossip, outrage media, and drama feeds are industrialized whispering. The content changes. The spiritual mechanism is ancient. Block the pipeline.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Install the extension',
    body: 'Add FaithWall to Chrome. It takes sixty seconds. No account required to start \u2014 the wall goes up on install.',
  },
  {
    n: '02',
    title: 'Set the household passcode',
    body: 'You set it. You keep it. The passcode belongs to the household head \u2014 not the user. If anyone can override the wall themselves, it is not a wall.',
  },
  {
    n: '03',
    title: 'Every new tab opens to Scripture, not a feed',
    body: 'The blocked sites redirect. The new tab loads a verse. The habit changes before the craving has time to route around your intentions.',
  },
];

export default function FaithWallClient() {
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

  function buildCtaHref(slug: string): string {
    const base = `/checkout?slug=${slug}&utm_content=faithwall_landing`;
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
    let source = 'faithwall_landing';
    if (utm.source) source = `faithwall_landing|${utm.source}`;

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

  function handleCtaClick(slug: string, value: number) {
    window.fbq?.('track', 'InitiateCheckout', {
      content_name: slug,
      value,
      currency: 'USD',
    });
  }

  return (
    <>
      <PixelEvents contentName="faithwall_landing" />

      {/* ── Inline styles matching original design system ── */}
      <style>{`
        :root {
          --bg: #111; --bg2: #1a1a1a; --bg3: #222;
          --border: rgba(139,37,0,0.2); --border-focus: #8b2500;
          --text: #f5f0e8; --text-dim: rgba(245,240,232,0.55);
          --text-faint: rgba(245,240,232,0.25);
          --accent: #8b2500; --accent-hover: #a02c00; --label: #a0522d;
        }
        html { background: var(--bg); }
        .fw-body { background:var(--bg); color:var(--text); font-family:Georgia,serif; min-height:100vh; }
        .fw-header { border-bottom:1px solid var(--border); padding:18px 24px; display:flex; align-items:center; }
        .fw-brand { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:5px; text-transform:uppercase; color:var(--accent); font-weight:700; text-decoration:none; }
        .fw-container { max-width:640px; margin:0 auto; padding:64px 24px 96px; }
        .fw-eyebrow { font-family:Arial,sans-serif; font-size:0.7rem; letter-spacing:4px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:16px; }
        .fw-h1 { font-size:clamp(2rem,5vw,3rem); font-weight:700; line-height:1.1; letter-spacing:-0.03em; color:var(--text); margin-bottom:28px; }
        .fw-lead { font-size:1.1rem; line-height:1.8; color:var(--text-dim); margin-bottom:40px; max-width:560px; }
        .fw-lead strong { color:var(--text); font-weight:600; }
        .fw-verse-block { border-left:3px solid var(--accent); padding:20px 24px; margin-bottom:28px; background:var(--bg2); }
        .fw-verse-ref { font-family:Arial,sans-serif; font-size:0.65rem; letter-spacing:3px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:10px; }
        .fw-verse-text { font-size:1rem; line-height:1.75; color:var(--text); font-style:italic; }
        .fw-divider { border:none; border-top:1px solid var(--border); margin:48px 0; }
        .fw-section-label { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:4px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:20px; }
        .fw-block-grid { display:flex; flex-direction:column; gap:20px; margin-bottom:48px; }
        .fw-block-item { background:var(--bg2); border:1px solid var(--border); padding:22px 24px; }
        .fw-block-category { font-family:Arial,sans-serif; font-size:0.68rem; letter-spacing:3px; text-transform:uppercase; color:var(--label); font-weight:700; margin-bottom:8px; }
        .fw-block-verse { font-size:0.93rem; line-height:1.7; color:var(--text); font-style:italic; margin-bottom:10px; }
        .fw-block-ref { font-family:Arial,sans-serif; font-size:0.65rem; letter-spacing:2px; text-transform:uppercase; color:var(--label); margin-bottom:10px; }
        .fw-block-note { font-family:Arial,sans-serif; font-size:0.82rem; color:var(--text-dim); line-height:1.55; }
        .fw-steps { display:flex; flex-direction:column; gap:0; margin-bottom:48px; }
        .fw-step { display:flex; gap:20px; padding:22px 0; border-bottom:1px solid var(--border); }
        .fw-step:last-child { border-bottom:none; }
        .fw-step-number { font-family:Arial,sans-serif; font-size:0.65rem; letter-spacing:3px; color:var(--label); font-weight:700; padding-top:4px; flex-shrink:0; width:24px; }
        .fw-step-content h3 { font-size:1rem; font-weight:700; letter-spacing:-0.01em; margin-bottom:6px; color:var(--text); }
        .fw-step-content p { font-family:Arial,sans-serif; font-size:0.85rem; color:var(--text-dim); line-height:1.6; }
        .fw-email-section { background:var(--bg3); border:1px solid var(--border); padding:32px 28px; margin-bottom:48px; }
        .fw-email-section h2 { font-size:1.3rem; font-weight:700; line-height:1.25; letter-spacing:-0.02em; margin-bottom:10px; }
        .fw-email-section p { font-size:0.93rem; color:var(--text-dim); line-height:1.65; margin-bottom:20px; }
        .fw-email-row { display:flex; gap:0; flex-wrap:wrap; }
        .fw-email-input { flex:1 1 220px; background:var(--bg2); border:1px solid var(--border); border-right:none; color:var(--text); font-family:Georgia,serif; font-size:1rem; padding:14px 18px; outline:none; min-width:0; }
        .fw-email-input::placeholder { color:var(--text-faint); }
        .fw-email-input:focus { border-color:var(--border-focus); }
        .fw-email-btn { background:var(--accent); color:var(--text); border:none; padding:14px 28px; font-family:Arial,sans-serif; font-size:0.75rem; font-weight:700; letter-spacing:2px; text-transform:uppercase; cursor:pointer; white-space:nowrap; flex-shrink:0; }
        .fw-email-btn:hover:not(:disabled) { background:var(--accent-hover); }
        .fw-email-btn:disabled { opacity:0.55; cursor:not-allowed; }
        .fw-success { font-family:Arial,sans-serif; font-size:0.85rem; color:#a3e4a3; letter-spacing:1px; margin-top:12px; }
        .fw-error { font-size:0.88rem; color:#fca5a5; margin-top:10px; line-height:1.5; }
        .fw-buy-grid { display:flex; flex-direction:column; gap:16px; margin-bottom:48px; }
        .fw-buy-card { background:var(--bg2); border:1px solid rgba(139,37,0,0.45); padding:28px 28px 24px; }
        .fw-buy-card h3 { font-size:1.15rem; font-weight:700; line-height:1.25; letter-spacing:-0.02em; margin-bottom:8px; }
        .fw-buy-card p { font-family:Arial,sans-serif; font-size:0.85rem; color:var(--text-dim); line-height:1.6; margin-bottom:20px; }
        .fw-buy-btn { display:inline-block; background:var(--accent); color:var(--text); text-decoration:none; padding:16px 36px; font-family:Arial,sans-serif; font-size:0.78rem; font-weight:700; letter-spacing:3px; text-transform:uppercase; }
        .fw-buy-btn:hover { background:var(--accent-hover); }
        .fw-price-note { display:block; margin-top:12px; font-family:Arial,sans-serif; font-size:0.75rem; color:var(--text-faint); letter-spacing:1px; }
        .fw-footer { margin-top:80px; padding:32px 24px; border-top:1px solid var(--border); text-align:center; }
        .fw-footer p { font-family:Arial,sans-serif; font-size:0.75rem; color:var(--text-faint); letter-spacing:1px; margin-bottom:10px; }
        .fw-footer p:last-child { margin-bottom:0; }
        .fw-footer a { color:rgba(245,240,232,0.35); text-decoration:none; }
        .fw-footer a:hover { color:var(--text-dim); }
        @media (max-width:480px) {
          .fw-email-row { flex-direction:column; }
          .fw-email-input { border-right:1px solid var(--border); border-bottom:none; }
          .fw-email-btn { width:100%; }
        }
      `}</style>

      <div className="fw-body">
        <header className="fw-header">
          <a href="https://deadhidden.org" className="fw-brand">Dead Hidden</a>
        </header>

        <main className="fw-container">
          {/* Hero */}
          <div className="fw-eyebrow">Dead Hidden OS &mdash; FaithWall</div>
          <h1 className="fw-h1">Your eyes are not neutral.</h1>

          <div className="fw-verse-block">
            <div className="fw-verse-ref">Job 31:1 KJV</div>
            <div className="fw-verse-text">
              &ldquo;I made a covenant with mine eyes; why then should I think upon a maid?&rdquo;
            </div>
          </div>

          <p className="fw-lead">
            Job didn&rsquo;t manage his eyes. He covenanted with them.<br />
            <strong>A Scripture-first habit wall for Christian homes &mdash; browser, mobile, household.</strong><br />
            Every new tab is a choice. FaithWall makes that choice before you do.
          </p>

          <hr className="fw-divider" />

          {/* What it blocks */}
          <div className="fw-section-label">What the wall holds back</div>
          <div className="fw-block-grid">
            {BLOCKS.map((b) => (
              <div key={b.category} className="fw-block-item">
                <div className="fw-block-category">{b.category}</div>
                <div className="fw-block-verse">{b.verse}</div>
                <div className="fw-block-ref">{b.ref}</div>
                <div className="fw-block-note">{b.note}</div>
              </div>
            ))}
          </div>

          <hr className="fw-divider" />

          {/* How it works */}
          <div className="fw-section-label">How it works</div>
          <div className="fw-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="fw-step">
                <div className="fw-step-number">{s.n}</div>
                <div className="fw-step-content">
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>

          <hr className="fw-divider" />

          {/* Email capture */}
          <div className="fw-email-section">
            <div className="fw-section-label">Stay in the fight</div>
            <h2>Get the material that goes deeper.</h2>
            <p>
              FaithWall updates, Scripture resources, and field notes &mdash; when they&rsquo;re ready, not on a schedule.
              No filler. You can leave whenever.
            </p>

            {status === 'success' || status === 'duplicate' ? (
              <div className="fw-success">
                {status === 'duplicate' ? "You\u2019re already on the list." : "You\u2019re in. Watch your inbox."}
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="fw-email-row">
                  <input
                    type="email"
                    className="fw-email-input"
                    placeholder="Your email address"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="fw-email-btn"
                    disabled={status === 'loading'}
                  >
                    {status === 'loading' ? 'Joining\u2026' : 'Join \u2192'}
                  </button>
                </div>
                {status === 'error' && <div className="fw-error">{errorMsg}</div>}
              </form>
            )}
          </div>

          <hr className="fw-divider" />

          {/* Buy CTAs */}
          <div className="fw-section-label">Put the wall up</div>
          <div className="fw-buy-grid">
            <div className="fw-buy-card">
              <div className="fw-eyebrow">Individual License</div>
              <h3>One browser. One covenant.</h3>
              <p>
                Install on your own machine. Full blocklist, Scripture new tab, passcode-protected settings.
                One-time purchase &mdash; no subscription, no recurring charges.
              </p>
              <a
                href={buildCtaHref('faithwall-individual')}
                className="fw-buy-btn"
                onClick={() => handleCtaClick('faithwall-individual', 29.99)}
              >
                FaithWall Individual &mdash; $29.99
              </a>
              <span className="fw-price-note">One-time. Your browser, your wall.</span>
            </div>

            <div className="fw-buy-card">
              <div className="fw-eyebrow">Household License</div>
              <h3>The whole house. One passcode.</h3>
              <p>
                Covers every browser in your household. Set the passcode once.
                Your wife, your children, every machine &mdash; the wall holds across all of them.
                You are the one who established the covenant; you are the one who keeps it.
              </p>
              <a
                href={buildCtaHref('faithwall-household')}
                className="fw-buy-btn"
                onClick={() => handleCtaClick('faithwall-household', 39.99)}
              >
                FaithWall Household &mdash; $39.99
              </a>
              <span className="fw-price-note">One-time. Every browser. Every member.</span>
            </div>
          </div>
        </main>

        <footer className="fw-footer">
          <p>
            <a href="https://deadhidden.org">Dead Hidden</a> &nbsp;|&nbsp;
            Questions: <a href="mailto:support@deadhidden.org">support@deadhidden.org</a>
          </p>
          <p>
            {/* Substack link — update href when URL is known */}
            <a href="#" id="substack-link">Run it on Substack? Read the long form &rarr;</a>
          </p>
        </footer>
      </div>
    </>
  );
}
