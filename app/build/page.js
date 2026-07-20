'use client';
import { useState } from 'react';

const BASE = 'https://rh-smart-money.vercel.app/robinhood';

const PROMPT = `Build a web app on top of the RobinAGNT open API — a live data layer for Robinhood Chain (chain id 4663).

Base URL: ${BASE}
All endpoints are public, CORS-open, and need no API key:

- GET /api/dashboard
    → { stats, tokens[], wallets[], pools[] }
    Chain stats, token market caps (with logos + 24h volume + 24h change),
    and a wallet leaderboard ranked by 7d trade volume.

- GET /api/wallet/{address}
    → { volume: { vol24h, vol7d }, holdings: { totalUsd, holdings[] }, moves[] }
    One wallet's 24h/7d volume, current token holdings, and recent transfers.

- GET /api/top-traders
    → wallets ranked by DEX volume (discovery feed).

Build me: <describe the app you want — e.g. "a token market-cap treemap",
"a wallet watchlist with alerts", "a leaderboard of the top 20 traders">.

Use /api/dashboard as the primary data source. Keep it a single-page app,
mobile-responsive, and deployable on Vercel. Fetch the data client-side.`;

export default function Build() {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div className="wrap bwrap">
      <a className="back" href="/robinhood">← RobinAGNT</a>
      <h1 className="bh">Build on <span>RobinAGNT</span></h1>
      <p className="bsub">
        RobinAGNT is an open data layer for Robinhood Chain. Fork it, extend it, ship your own —
        <span className="tok"> anyone can build and get paid from fees.</span> Two ways in:
      </p>

      <div className="bcards">
        <a className="bcard" href="https://my.agnt.social" target="_blank" rel="noreferrer">
          <div className="bct">Build visually →</div>
          <div className="bcd">Open it in <b>buildAGNT</b> — remix the dashboard in a no-code interface, no setup, deploy from your AGNT.</div>
        </a>
        <div className="bcard on">
          <div className="bct">Build with an AI coding agent</div>
          <div className="bcd">Paste the prompt below into <b>Claude, Cursor, or Codex</b> and it builds on the live API for you.</div>
        </div>
      </div>

      <div className="promptbox">
        <div className="pbh">
          <span>Prompt for Claude / Cursor / Codex</span>
          <button className="copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>
        </div>
        <pre className="pre">{PROMPT}</pre>
      </div>

      <h2 className="bh2">Or hit the API directly</h2>
      <div className="apiblock">
        <div className="ep"><span className="m">GET</span> {BASE}/api/dashboard</div>
        <div className="ep"><span className="m">GET</span> {BASE}/api/wallet/&lt;address&gt;</div>
        <div className="ep"><span className="m">GET</span> {BASE}/api/top-traders</div>
      </div>
      <p className="curl">Try it:&nbsp; <code>curl {BASE}/api/dashboard</code></p>

      <div className="bfoot">Open · CORS-enabled · no key · Robinhood Chain 4663 · built on AGNT</div>
    </div>
  );
}
