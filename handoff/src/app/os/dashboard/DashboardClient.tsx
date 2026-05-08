'use client';

import { useState, useEffect, useCallback } from 'react';
import PixelEvents from '../../../components/PixelEvents';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Seat {
  initials?: string;
  email?: string;
  accepted: boolean;
}

interface BuyerData {
  email: string;
  plan: 'individual' | 'household';
  covenant_day: number;
  share_url: string;
  seats?: Seat[];
  seats_used?: number;
  seat_limit?: number;
}

type AppState = 'loading' | 'login' | 'dashboard';

// ── Helpers ────────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DashboardClient() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [buyerData, setBuyerData] = useState<BuyerData | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [loginMsg, setLoginMsg] = useState('');
  const [urlError, setUrlError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [seatFormOpen, setSeatFormOpen] = useState(false);
  const [seatEmail, setSeatEmail] = useState('');
  const [seatInitials, setSeatInitials] = useState('');
  const [seatStatus, setSeatStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [seatMsg, setSeatMsg] = useState('');

  const init = useCallback(async () => {
    try {
      const r = await fetch('/api/faithwall/buyer-me', { credentials: 'same-origin' });
      if (r.status === 401) {
        setAppState('login');
        return;
      }
      const data: BuyerData = await r.json();
      if ((data as { error?: string }).error) {
        setAppState('login');
        return;
      }
      setBuyerData(data);
      setAppState('dashboard');
    } catch {
      setAppState('login');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const seatToken = params.get('seat_token');
    const err = params.get('error');

    if (urlToken) {
      window.location.href = `/api/faithwall/verify-token?token=${encodeURIComponent(urlToken)}`;
      return;
    }
    if (seatToken) {
      window.location.href = `/api/faithwall/accept-seat?token=${encodeURIComponent(seatToken)}`;
      return;
    }
    if (err === 'invalid_token' || err === 'missing_token') {
      setUrlError('That link has expired or is invalid. Enter your email to get a new one.');
    }
    init();
  }, [init]);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = loginEmail.trim();
    if (!email) return;
    setLoginStatus('loading');
    setLoginMsg('');
    try {
      const r = await fetch('/api/faithwall/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (data.success) {
        setLoginStatus('sent');
        setLoginMsg('Check your inbox. Link sent.');
        setLoginEmail('');
      } else {
        setLoginStatus('error');
        setLoginMsg((data as { error?: string }).error || 'Something went wrong. Try again.');
      }
    } catch {
      setLoginStatus('error');
      setLoginMsg('Could not send link. Check your connection.');
    }
  }

  async function handleLogout() {
    await fetch('/api/faithwall/buyer-logout', { method: 'POST', credentials: 'same-origin' });
    window.location.reload();
  }

  async function handleCopyLink() {
    if (!buyerData) return;
    try {
      await navigator.clipboard.writeText(buyerData.share_url);
    } catch {
      const el = document.createElement('textarea');
      el.value = buyerData.share_url;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }

  async function handleAddSeat() {
    setSeatStatus('loading');
    setSeatMsg('');
    try {
      const r = await fetch('/api/faithwall/add-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: seatEmail.trim() || undefined, initials: seatInitials.trim() || undefined }),
      });
      const data = await r.json();
      if (r.ok) {
        setSeatStatus('success');
        setSeatMsg(data.message || 'Seat added.');
        setSeatEmail('');
        setSeatInitials('');
        // Refresh buyer data
        init();
      } else {
        setSeatStatus('error');
        setSeatMsg((data as { error?: string }).error || 'Could not add seat.');
      }
    } catch {
      setSeatStatus('error');
      setSeatMsg('Connection failed. Try again.');
    }
  }

  // ── X share text ──────────────────────────────────────────────────────────
  const xHref = buyerData
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent('Job made a covenant with his eyes. So did I. ↓\n\n' + buyerData.share_url)}`
    : '#';
  const emailShareHref = buyerData
    ? `mailto:?subject=${encodeURIComponent('Put the wall up — FaithWall')}&body=${encodeURIComponent('Job made a covenant with his eyes.\n\nI did too. FaithWall replaces your browser\'s new tab with Scripture — before your eyes land anywhere else.\n\n' + buyerData.share_url + '\n\nOne-time purchase. No subscription.')}`
    : '#';

  return (
    <>
      <PixelEvents contentName="faithwall_dashboard" contentCategory="dashboard" />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&family=IM+Fell+English:ital@0;1&display=swap');
        :root {
          --ink:#0f0f0f; --char:#1a1a1a; --panel:#1e1e1e;
          --border:rgba(201,162,39,0.15); --gold:#c9a227; --gold2:#a08520;
          --bone:#f5f0e8; --muted:rgba(245,240,232,0.55); --dim:rgba(245,240,232,0.25);
        }
        html { font-size:16px; }
        .db-body { background:var(--ink); color:var(--bone); font-family:'DM Sans',sans-serif; -webkit-font-smoothing:antialiased; min-height:100vh; }
        .db-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:1px solid var(--border); }
        .db-brand { font-family:'Space Grotesk',sans-serif; font-size:0.65rem; letter-spacing:5px; text-transform:uppercase; color:var(--gold); font-weight:700; }
        .db-logout { background:none; border:none; color:var(--dim); font-family:'DM Sans',sans-serif; font-size:0.78rem; cursor:pointer; letter-spacing:0.03em; transition:color 0.2s; }
        .db-logout:hover { color:var(--bone); }
        .db-main { max-width:680px; margin:0 auto; padding:40px 24px 80px; }
        .db-center { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; text-align:center; gap:16px; }
        .db-ring { width:32px; height:32px; border:2px solid var(--border); border-top-color:var(--gold); border-radius:50%; animation:spin 0.8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .db-loading-text { color:var(--muted); font-size:0.88rem; }
        .db-login-eyebrow { font-family:'Space Grotesk',sans-serif; font-size:0.62rem; letter-spacing:5px; text-transform:uppercase; color:var(--gold2); font-weight:700; margin-bottom:12px; }
        .db-login-title { font-family:'IM Fell English',Georgia,serif; font-size:1.5rem; color:var(--bone); margin-bottom:8px; line-height:1.3; }
        .db-login-sub { color:var(--muted); font-size:0.88rem; line-height:1.6; max-width:340px; margin-bottom:32px; }
        .db-login-form { display:flex; flex-direction:column; gap:12px; width:100%; max-width:360px; }
        .db-input { width:100%; padding:13px 16px; background:var(--char); border:1px solid rgba(201,162,39,0.2); border-radius:4px; color:var(--bone); font-family:'DM Sans',sans-serif; font-size:0.95rem; outline:none; transition:border-color 0.2s; }
        .db-input:focus { border-color:var(--gold); }
        .db-input::placeholder { color:var(--dim); }
        .db-login-btn { width:100%; padding:13px; background:var(--gold); color:var(--ink); border:none; border-radius:4px; font-family:'Space Grotesk',sans-serif; font-size:0.78rem; font-weight:700; letter-spacing:2px; text-transform:uppercase; cursor:pointer; transition:opacity 0.2s; }
        .db-login-btn:hover { opacity:0.88; }
        .db-login-btn:disabled { opacity:0.5; cursor:default; }
        .db-msg { font-size:0.83rem; text-align:center; min-height:20px; margin-top:4px; }
        .db-msg-success { color:#4ade80; }
        .db-msg-error { color:#f87171; }
        .db-module { border:1px solid var(--border); border-radius:6px; padding:28px 28px 24px; margin-bottom:20px; background:var(--panel); }
        .db-cov-eyebrow { font-family:'Space Grotesk',sans-serif; font-size:0.62rem; letter-spacing:5px; text-transform:uppercase; color:var(--gold2); font-weight:700; margin-bottom:10px; }
        .db-cov-day { font-family:'IM Fell English',Georgia,serif; font-size:2rem; color:var(--bone); line-height:1.1; margin-bottom:20px; }
        .db-cov-day span { color:var(--gold); }
        .db-cov-divider { border:none; border-top:1px solid var(--border); margin:20px 0; }
        .db-verse-ref { font-family:'Space Grotesk',sans-serif; font-size:0.62rem; letter-spacing:4px; text-transform:uppercase; color:var(--gold2); font-weight:700; margin-bottom:10px; }
        .db-verse-text { font-family:'IM Fell English',Georgia,serif; font-style:italic; color:rgba(245,240,232,0.72); font-size:0.96rem; line-height:1.85; }
        .db-seats-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; gap:12px; flex-wrap:wrap; }
        .db-seats-eyebrow { font-family:'Space Grotesk',sans-serif; font-size:0.62rem; letter-spacing:5px; text-transform:uppercase; color:var(--gold2); font-weight:700; }
        .db-seats-count { font-family:'Space Grotesk',sans-serif; font-size:0.8rem; color:var(--muted); font-weight:500; }
        .db-seats-list { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px; min-height:44px; }
        .db-seat-chip { display:flex; align-items:center; gap:8px; background:var(--char); border:1px solid var(--border); border-radius:100px; padding:6px 14px 6px 8px; }
        .db-seat-avatar { width:28px; height:28px; background:rgba(201,162,39,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Space Grotesk',sans-serif; font-size:0.65rem; font-weight:700; color:var(--gold); flex-shrink:0; }
        .db-seat-label { font-size:0.8rem; color:var(--bone); }
        .db-seat-pending { font-size:0.72rem; color:var(--dim); margin-left:2px; }
        .db-add-toggle { background:none; border:1px solid rgba(201,162,39,0.3); color:var(--gold); font-family:'Space Grotesk',sans-serif; font-size:0.72rem; font-weight:600; letter-spacing:2px; text-transform:uppercase; padding:9px 16px; border-radius:4px; cursor:pointer; transition:all 0.2s; }
        .db-add-toggle:hover { background:rgba(201,162,39,0.08); }
        .db-seat-form { display:flex; flex-direction:column; gap:10px; padding-top:16px; border-top:1px solid var(--border); }
        .db-seat-row { display:flex; gap:10px; flex-wrap:wrap; }
        .db-seat-input { flex:1; min-width:0; padding:10px 14px; background:var(--char); border:1px solid rgba(201,162,39,0.2); border-radius:4px; color:var(--bone); font-family:'DM Sans',sans-serif; font-size:0.88rem; outline:none; transition:border-color 0.2s; }
        .db-seat-input:focus { border-color:var(--gold); }
        .db-seat-input::placeholder { color:var(--dim); }
        .db-seat-input-sm { width:80px; flex:0 0 80px; }
        .db-seat-submit { padding:10px 18px; background:var(--gold); color:var(--ink); border:none; border-radius:4px; font-family:'Space Grotesk',sans-serif; font-size:0.72rem; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; cursor:pointer; white-space:nowrap; align-self:flex-start; }
        .db-seat-submit:disabled { opacity:0.5; cursor:default; }
        .db-seat-msg { font-size:0.8rem; min-height:18px; }
        .db-seat-msg-success { color:#4ade80; }
        .db-seat-msg-error { color:#f87171; }
        .db-share-eyebrow { font-family:'Space Grotesk',sans-serif; font-size:0.62rem; letter-spacing:5px; text-transform:uppercase; color:var(--gold2); font-weight:700; margin-bottom:10px; }
        .db-share-headline { font-family:'IM Fell English',Georgia,serif; font-size:1.25rem; color:var(--bone); margin-bottom:6px; line-height:1.3; }
        .db-share-subline { color:var(--muted); font-size:0.88rem; line-height:1.6; margin-bottom:20px; }
        .db-share-link { background:var(--char); border-left:3px solid var(--gold); padding:12px 16px; border-radius:0 4px 4px 0; margin-bottom:16px; word-break:break-all; font-size:0.78rem; color:var(--muted); font-family:'Courier New',monospace; line-height:1.5; }
        .db-share-btns { display:flex; gap:10px; flex-wrap:wrap; }
        .db-share-btn { display:flex; align-items:center; gap:7px; padding:10px 16px; border-radius:4px; font-family:'Space Grotesk',sans-serif; font-size:0.72rem; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; cursor:pointer; text-decoration:none; transition:all 0.2s; white-space:nowrap; }
        .db-share-btn-copy { background:var(--gold); color:var(--ink); border:1px solid transparent; }
        .db-share-btn-copy:hover { opacity:0.88; }
        .db-share-btn-x { background:transparent; color:var(--bone); border:1px solid rgba(245,240,232,0.2); }
        .db-share-btn-x:hover { border-color:var(--bone); }
        .db-share-btn-email { background:transparent; color:var(--muted); border:1px solid var(--border); }
        .db-share-btn-email:hover { color:var(--bone); border-color:rgba(245,240,232,0.2); }
        .db-copy-feedback { font-size:0.75rem; color:#4ade80; display:flex; align-items:center; gap:4px; }
        @media (max-width:480px) {
          .db-main { padding:28px 16px 64px; }
          .db-module { padding:20px 18px 18px; }
          .db-cov-day { font-size:1.6rem; }
          .db-share-btns { flex-direction:column; }
          .db-share-btn { justify-content:center; }
          .db-seat-row { flex-direction:column; }
          .db-seat-input-sm { width:100%; flex:1; }
        }
      `}</style>

      <div className="db-body">
        {/* Top bar */}
        <div className="db-topbar">
          <div className="db-brand">FaithWall</div>
          {appState === 'dashboard' && (
            <button className="db-logout" onClick={handleLogout}>Sign out</button>
          )}
        </div>

        <div className="db-main">

          {/* Loading */}
          {appState === 'loading' && (
            <div className="db-center">
              <div className="db-ring" />
              <div className="db-loading-text">Loading your dashboard&hellip;</div>
            </div>
          )}

          {/* Login */}
          {appState === 'login' && (
            <div className="db-center">
              <div className="db-login-eyebrow">FaithWall</div>
              <div className="db-login-title">Your dashboard.</div>
              <div className="db-login-sub">Enter the email you used to purchase FaithWall. We&rsquo;ll send you a link.</div>
              <form className="db-login-form" onSubmit={handleLoginSubmit} autoComplete="on">
                <input
                  type="email"
                  className="db-input"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
                <button type="submit" className="db-login-btn" disabled={loginStatus === 'loading'}>
                  {loginStatus === 'loading' ? 'Sending\u2026' : 'Send access link'}
                </button>
                {(loginMsg || urlError) && (
                  <div className={`db-msg ${loginStatus === 'error' || urlError ? 'db-msg-error' : 'db-msg-success'}`}>
                    {loginMsg || urlError}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* Dashboard */}
          {appState === 'dashboard' && buyerData && (
            <>
              {/* 1. Covenant block */}
              <div className="db-module">
                <div className="db-cov-eyebrow">The covenant</div>
                <div className="db-cov-day">
                  Your covenant: day <span>{buyerData.covenant_day}.</span>
                </div>
                <hr className="db-cov-divider" />
                <div className="db-verse-ref">Job 31:1</div>
                <div className="db-verse-text">
                  &ldquo;I made a covenant with mine eyes;<br />
                  why then should I think upon a maid?<br />
                  <br />
                  For what portion of God is there from above?<br />
                  and what inheritance of the Almighty from on high?<br />
                  Is not destruction to the wicked?<br />
                  and a strange punishment to the workers of iniquity?<br />
                  Doth not he see my ways,<br />
                  and count all my steps?&rdquo;
                </div>
              </div>

              {/* 2. Household seats (household plan only) */}
              {buyerData.plan === 'household' && (
                <div className="db-module">
                  <div className="db-seats-header">
                    <div className="db-seats-eyebrow">Household</div>
                    <div className="db-seats-count">
                      {buyerData.seats_used}/{buyerData.seat_limit} seats active
                    </div>
                  </div>

                  <div className="db-seats-list">
                    {/* Head (buyer) */}
                    <div className="db-seat-chip">
                      <div className="db-seat-avatar">
                        {escHtml(buyerData.email.slice(0, 2).toUpperCase())}
                      </div>
                      <span className="db-seat-label">You</span>
                    </div>
                    {buyerData.seats?.map((s, i) => {
                      const label = s.initials || (s.email ? s.email.split('@')[0].toUpperCase().slice(0, 3) : '?');
                      return (
                        <div key={i} className="db-seat-chip">
                          <div className="db-seat-avatar">{escHtml(label.slice(0, 2).toUpperCase())}</div>
                          <span className="db-seat-label">{escHtml(s.email || s.initials || label)}</span>
                          {!s.accepted && <span className="db-seat-pending">(pending)</span>}
                        </div>
                      );
                    })}
                  </div>

                  <button className="db-add-toggle" onClick={() => setSeatFormOpen(!seatFormOpen)}>
                    {seatFormOpen ? 'Cancel' : '+ Add seat'}
                  </button>

                  {seatFormOpen && (
                    <div className="db-seat-form">
                      <div className="db-seat-row">
                        <input
                          type="email"
                          className="db-seat-input"
                          placeholder="Email (optional)"
                          autoComplete="off"
                          value={seatEmail}
                          onChange={(e) => setSeatEmail(e.target.value)}
                        />
                        <input
                          type="text"
                          className="db-seat-input db-seat-input-sm"
                          placeholder="Initials"
                          maxLength={5}
                          autoComplete="off"
                          value={seatInitials}
                          onChange={(e) => setSeatInitials(e.target.value)}
                        />
                        <button
                          type="button"
                          className="db-seat-submit"
                          disabled={seatStatus === 'loading'}
                          onClick={handleAddSeat}
                        >
                          {seatStatus === 'loading' ? 'Adding\u2026' : 'Add'}
                        </button>
                      </div>
                      {seatMsg && (
                        <div className={`db-seat-msg ${seatStatus === 'error' ? 'db-seat-msg-error' : 'db-seat-msg-success'}`}>
                          {seatMsg}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 3. Share block */}
              <div className="db-module">
                <div className="db-share-eyebrow">Pass the wall</div>
                <div className="db-share-headline">Who else is still hiding?</div>
                <div className="db-share-subline">Two weeks in. You know someone who needs this.</div>

                <div className="db-share-link">{buyerData.share_url}</div>

                <div className="db-share-btns">
                  <button className="db-share-btn db-share-btn-copy" onClick={handleCopyLink}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy link
                  </button>
                  <a className="db-share-btn db-share-btn-x" href={xHref} target="_blank" rel="noopener noreferrer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    Share on X
                  </a>
                  <a className="db-share-btn db-share-btn-email" href={emailShareHref} target="_blank" rel="noopener noreferrer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    Send by email
                  </a>
                  {copyFeedback && (
                    <div className="db-copy-feedback">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      Copied
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}
