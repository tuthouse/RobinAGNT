'use client';
import { useEffect, useMemo, useState } from 'react';

const BP = '/robinhood'; // basePath — prefix plain fetch()/href (Next only auto-prefixes Link/assets)
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
function usd(n) {
  if (n == null) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + Number(n.toPrecision(3));
}
function num(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}
function amt(n) {
  if (n == null) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Number(n.toPrecision(4)).toString();
}
function pct(n) {
  const v = n ?? 0;
  if (v >= 1000) return '>+999%';   // new-token noise
  if (v <= -99.5) return '-99%';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}
function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - Date.parse(ts)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

// green intensity by value share (brighter = more) — RH-chain green
function volColor(t) {
  const l = 13 + Math.max(0, Math.min(1, t)) * 30;
  return `hsl(150 70% ${l}%)`;
}
// brightness overlay: high volume = brighter tile (less dark wash)
function brightness(volNorm) {
  const b = Math.pow(Math.max(0, Math.min(1, volNorm)), 0.45); // perceptual
  return 0.72 * (1 - b); // opacity of the black wash
}

// squarified treemap → tiles as % of a W×H box (Bruls et al.)
function squarify(data, W, H) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const nodes = data.map((d) => ({ ...d, area: (d.value / total) * (W * H) }));
  const tiles = [];
  let x = 0, y = 0, w = W, h = H, i = 0, row = [];
  const sum = (r) => r.reduce((a, b) => a + b.area, 0);
  const worst = (r, len) => {
    if (!r.length) return Infinity;
    const s = sum(r), mx = Math.max(...r.map((n) => n.area)), mn = Math.min(...r.map((n) => n.area));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  const lay = (r, horiz) => {
    const s = sum(r);
    if (horiz) { const rh = s / w; let cx = x; for (const n of r) { const tw = n.area / rh; tiles.push({ ...n, X: cx, Y: y, Wd: tw, Ht: rh }); cx += tw; } y += rh; h -= rh; }
    else { const rw = s / h; let cy = y; for (const n of r) { const th = n.area / rw; tiles.push({ ...n, X: x, Y: cy, Wd: rw, Ht: th }); cy += th; } x += rw; w -= rw; }
  };
  while (i < nodes.length) {
    const len = Math.min(w, h), n = nodes[i];
    if (!row.length || worst([...row, n], len) <= worst(row, len)) { row.push(n); i++; }
    else { lay(row, Math.min(w, h) === w); row = []; }
  }
  if (row.length) lay(row, Math.min(w, h) === w);
  return tiles.map((t) => ({ ...t, left: (t.X / W) * 100, top: (t.Y / H) * 100, width: (t.Wd / W) * 100, height: (t.Ht / H) * 100 }));
}

export default function Dashboard() {
  const [snap, setSnap] = useState(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sel, setSel] = useState(null);
  const [tokView, setTokView] = useState('heatmap');
  const [walView, setWalView] = useState('list');

  useEffect(() => {
    fetch(BP + '/api/dashboard').then((r) => r.json()).then(setSnap).catch(() => setSnap({ wallets: [] }));
  }, []);

  const wallets = snap?.wallets || [];
  const tokens = snap?.tokens || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? wallets.filter((w) => w.address.toLowerCase().includes(s)) : wallets;
  }, [q, wallets]);
  const shown = showAll ? filtered : filtered.slice(0, 100);
  const maxPool = snap?.pools?.[0]?.vol24h || 1;
  const maxWvol = wallets[0]?.vol7d || 1;

  function openStored(w) { setSel({ addr: w.address, stored: w }); }
  function openWallet(address) {
    const hit = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
    setSel({ addr: address, stored: hit || null }); // stored when on the board, else live lookup
  }
  function onFind(e) {
    if (e.key === 'Enter' && /^0x[a-fA-F0-9]{40}$/.test(q.trim())) {
      const hit = wallets.find((w) => w.address.toLowerCase() === q.trim().toLowerCase());
      setSel({ addr: q.trim(), stored: hit || null });
    }
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="title">Robin<span>AGNT</span></div>
          <div className="sub">
            An experimental decentralized dashboard for Robinhood. Powered by <span className="tok">$RobinAGNT</span> — anyone can build and get paid from fees.
          </div>
        </div>
        <a className="live" href={BP + '/api/dashboard'}>API ↗</a>
      </header>

      <div className="herocta">
        <span className="noexp">No experience needed</span>
        <div className="btns">
          <a className="btn primary" href="https://my.agnt.social" target="_blank" rel="noreferrer">Build here</a>
          <a className="btn ghost" href={BP + '/build'}>Build in Claude / Cursor</a>
        </div>
      </div>

      <section className="tiles">
        <Tile k="Total wallets" v={num(snap?.stats?.addresses)} sub="on-chain addresses" />
        <Tile k="Txns / 24h" v={num(snap?.stats?.txnsDaily)} sub="chain-wide" />
        <Tile k="Active traders" v={num(snap?.discovered?.uniqueTraders)} sub="unique DEX wallets" />
        <Tile k="Tracked" v={num(snap?.wallets?.length)} accent sub="ranked by 7d volume" />
      </section>

      {/* TOKENS */}
      <section className="block">
        <div className="sech">
          <h2>Market cap map</h2>
          <div className="sactions">
            {tokView === 'heatmap' && <span className="legend">area = mkt cap · brightness = 24h vol</span>}
            <Toggle v={tokView} set={setTokView} opts={[['heatmap', 'Map'], ['list', 'List']]} />
          </div>
        </div>
        {tokView === 'heatmap' ? (
          <TokenMap tokens={tokens} />
        ) : (
          <div className="ttable">
            <div className="tth"><span>Token</span><span className="n">Price</span><span className="n">24h</span><span className="n">Volume</span><span className="n mc">Mkt cap</span></div>
            {tokens.slice(0, 20).map((t, i) => (
              <div className="ttr" key={t.symbol + i}>
                <span className="tsy">{t.symbol}</span>
                <span className="n">{usd(t.priceUsd)}</span>
                <span className={'n ' + (t.change24h >= 0 ? 'up' : 'dn')}>{pct(t.change24h)}</span>
                <span className="n">{usd(t.vol24h)}</span>
                <span className="n mc">{usd(t.mcap)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <TapeSection tape={snap?.tape} generatedAt={snap?.generatedAt} loading={!snap} onWallet={openWallet} />

      <div className="cols">
        {/* WALLETS */}
        <section className="lead">
          <div className="sech">
            <h2>Wallets · volume</h2>
            <div className="sactions">
              <input className="find" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onFind} placeholder="filter or paste 0x… + Enter" />
              <Toggle v={walView} set={setWalView} opts={[['list', 'List'], ['heatmap', 'Heatmap']]} />
            </div>
          </div>

          {walView === 'heatmap' ? (
            <WalletMap wallets={filtered.slice(0, 40)} onPick={openStored} />
          ) : (
            <>
              <div className="lbhead">
                <span className="r">#</span><span>Wallet</span><span className="n">24h vol</span><span className="n">7d vol</span><span className="n tr">trades</span><span className="n">last</span>
              </div>
              {!snap ? <div className="empty">Loading snapshot…</div>
                : shown.length === 0 ? <div className="empty">No wallets yet.</div>
                : shown.map((w) => (
                  <button className="lb" key={w.address} onClick={() => openStored(w)}>
                    <span className="r">{filtered.indexOf(w) + 1}</span>
                    <span className="w">{short(w.address)}</span>
                    <span className="n">{usd(w.vol24h)}</span>
                    <span className="n hot">{usd(w.vol7d)}{w.capped ? '+' : ''}</span>
                    <span className="n tr">{w.trades7d}</span>
                    <span className="n dim">{ago(w.lastTs)}</span>
                  </button>
                ))}
              {!showAll && filtered.length > 100 && (
                <button className="more" onClick={() => setShowAll(true)}>Show all {filtered.length} →</button>
              )}
            </>
          )}
        </section>

        <aside className="rail">
          <div className="panel">
            <h3>Top pools · 24h volume</h3>
            {(snap?.pools || []).slice(0, 10).map((p, i) => (
              <div className="pool" key={i}>
                <div className="pl"><span className="pn">{p.name}</span><span className="pv">{usd(p.vol24h)}</span></div>
                <div className="bar"><div className="fill" style={{ width: Math.max(3, (p.vol24h / maxPool) * 100) + '%' }} /></div>
              </div>
            ))}
            {!snap?.pools?.length && <div className="empty sm">—</div>}
          </div>
          <div className="panel build">
            <h3>Build on this</h3>
            <p>Open API, no key. Fork it into an AGNT app.</p>
            <div className="ep">GET /api/dashboard</div>
            <div className="ep">GET /api/wallet/&lt;addr&gt;</div>
          </div>
        </aside>
      </div>

      <footer className="foot">
        Volume = ETH + USDG trade legs (address-verified), in-window. Holdings via Blockscout; spam hidden. Not investment advice.
      </footer>

      {sel && <WalletModal addr={sel.addr} stored={sel.stored} onClose={() => setSel(null)} />}
    </div>
  );
}

function Tile({ k, v, sub, accent }) {
  return <div className={'tile' + (accent ? ' acc' : '')}><div className="tk">{k}</div><div className="tv">{v}</div><div className="ts">{sub}</div></div>;
}
function Toggle({ v, set, opts }) {
  return (
    <div className="seg">
      {opts.map(([val, label]) => (
        <button key={val} className={v === val ? 'on' : ''} onClick={() => set(val)}>{label}</button>
      ))}
    </div>
  );
}

// Honest freshness line for the snapshot-based tape (no real-time claim).
function freshness(generatedAt) {
  const t = generatedAt ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const rel = ago(generatedAt);
  return `snapshot · ${rel === 'now' ? 'updated just now' : 'updated ' + rel + ' ago'} · ${hh}:${mm} UTC`;
}

// Big Trades (24h): largest recent swaps from the snapshot's precomputed tape.
// Each row is defensively validated so a malformed record can't break the page.
function TapeSection({ tape, generatedAt, loading, onWallet }) {
  const rows = (Array.isArray(tape) ? tape : []).filter(
    (r) => r && typeof r.hash === 'string' && typeof r.wallet === 'string'
      && (r.side === 'buy' || r.side === 'sell') && Number.isFinite(r.usd)
      && r.token && typeof r.token.symbol === 'string' && r.token.symbol
  );
  return (
    <section className="block">
      <div className="sech">
        <h2>Big Trades · 24h</h2>
        {generatedAt ? <span className="legend">{freshness(generatedAt)}</span> : null}
      </div>
      {loading ? (
        <div className="empty">Loading snapshot…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No large trades in the last 24h.</div>
      ) : (
        <div className="tape">
          {rows.map((r) => (
            <div className="tprow" key={r.hash + ':' + r.wallet}>
              <span className={'pill tp ' + (r.side === 'buy' ? 'buy' : 'sell')}>{r.side === 'buy' ? 'BUY' : 'SELL'}</span>
              <span className="tptok">
                {r.token.logo
                  ? <img className="tplogo" src={r.token.logo} alt="" loading="lazy" />
                  : <span className="tplogo ph">{r.token.symbol[0]}</span>}
                <span className="tptoktext">
                  <span className="tpsym">{r.token.symbol}</span>
                  {r.pool ? <span className="tppool">{r.pool}</span> : null}
                </span>
              </span>
              <span className="tpusd">{usd(r.usd)}</span>
              <button className="tpwal" onClick={() => onWallet(r.wallet)} title={r.wallet}>{short(r.wallet)}</button>
              <a className="tptime" href={`https://robinhoodchain.blockscout.com/tx/${r.hash}`}
                target="_blank" rel="noopener noreferrer" title="View transaction on Blockscout">
                {ago(r.ts)}<span className="tpext"> ↗</span>
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Token market-cap map: area = mcap, brightness = 24h volume, logo-filled tiles.
function TokenMap({ tokens }) {
  const items = (tokens || []).filter((t) => t.mcap > 0).slice(0, 28);
  if (!items.length) return <div className="empty">No token data yet.</div>;
  const maxVol = Math.max(...items.map((t) => t.vol24h || 0), 1);
  const tiles = squarify(items.map((t) => ({ item: t, value: t.mcap })), 1000, 520);
  return (
    <div className="tmap">
      {tiles.map((tl) => {
        const t = tl.item;
        const wash = brightness((t.vol24h || 0) / maxVol);
        return (
          <a key={t.address || t.symbol} className="tmtile"
            style={{ left: tl.left + '%', top: tl.top + '%', width: tl.width + '%', height: tl.height + '%' }}
            href={`https://robinhoodchain.blockscout.com/token/${t.address}`} target="_blank" rel="noreferrer" title={`${t.symbol} · ${usd(t.mcap)} mcap · ${usd(t.vol24h)} 24h vol`}>
            {t.logo ? <img className="tmimg" src={t.logo} alt="" loading="lazy" /> : <span className="tmph">{t.symbol?.[0] || '?'}</span>}
            <span className="tmwash" style={{ background: `rgba(4,16,10,${wash.toFixed(2)})` }} />
            <span className="tmlabel">
              <span className="tmsym">{t.symbol}</span>
              <span className="tmmc">{usd(t.mcap)}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

// Wallet volume map: area = 7d volume, green tiles.
function WalletMap({ wallets, onPick }) {
  const items = (wallets || []).filter((w) => w.vol7d > 0);
  if (!items.length) return <div className="empty">No wallets yet.</div>;
  const max = items[0].vol7d || 1;
  const tiles = squarify(items.map((w) => ({ item: w, value: w.vol7d })), 1000, 420);
  return (
    <div className="tmap wal">
      {tiles.map((tl) => {
        const w = tl.item;
        return (
          <button key={w.address} className="tmtile wtile"
            style={{ left: tl.left + '%', top: tl.top + '%', width: tl.width + '%', height: tl.height + '%', background: volColor(w.vol7d / max) }}
            onClick={() => onPick(w)} title={`${w.address} · ${usd(w.vol7d)} 7d`}>
            <span className="tmlabel">
              <span className="tmsym mono">{short(w.address)}</span>
              <span className="tmmc">{usd(w.vol7d)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WalletModal({ addr, stored, onClose }) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!stored) {
      setLive({ loading: true });
      fetch(BP + '/api/wallet/' + addr).then((r) => r.json()).then(setLive).catch(() => setLive({ error: 'lookup failed' }));
    }
  }, [addr, stored]);

  const vol24 = stored ? stored.vol24h : live?.volume?.vol24h;
  const vol7 = stored ? stored.vol7d : live?.volume?.vol7d;
  const capped = stored ? stored.capped : live?.volume?.capped;
  const hUsd = stored ? stored.holdingsUsd : live?.holdings?.totalUsd;
  const holdings = stored ? stored.holdings : live?.holdings?.holdings;
  const dust = stored ? stored.dust : live?.holdings?.dust;
  const loading = !stored && (!live || live.loading);
  const error = !stored && live?.error;

  async function loadMoves() {
    if (live?.moves) return;
    setLive({ ...(live || {}), loadingMoves: true });
    try { const d = await (await fetch(BP + '/api/wallet/' + addr)).json(); setLive((p) => ({ ...(p || {}), moves: d.moves || [] })); }
    catch { setLive((p) => ({ ...(p || {}), moves: [] })); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div className="ma">{short(addr)}</div>
            <a className="mx" href={`https://robinhoodchain.blockscout.com/address/${addr}`} target="_blank" rel="noreferrer">explorer ↗</a>
          </div>
          <button className="mc" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {loading ? <div className="empty">Loading wallet…</div>
          : error ? <div className="empty">{error}</div>
          : <>
              <div className="mstats">
                <div className="ms"><div className="msv">{usd(vol24)}</div><div className="msk">24h volume</div></div>
                <div className="ms"><div className="msv">{usd(vol7)}{capped ? '+' : ''}</div><div className="msk">7d volume</div></div>
                <div className="ms"><div className="msv acc">{usd(hUsd)}</div><div className="msk">holdings value</div></div>
              </div>
              <div className="mlabel">Top holdings{dust ? ` · ${dust} spam hidden` : ''}</div>
              {(holdings || []).length === 0 ? <div className="empty sm">No priced holdings — likely flips everything.</div>
                : holdings.map((h, i) => (
                  <div className="hold" key={i}>
                    {h.logo ? <img className="hlogo" src={h.logo} alt="" /> : <div className="hlogo ph">{(h.symbol || '?')[0]}</div>}
                    <span className="hsym">{h.symbol}</span>
                    <span className="hbal">{amt(h.balance)}</span>
                    <span className="hus">{usd(h.usd)}</span>
                  </div>
                ))}
              <div className="mlabel">Recent moves</div>
              {live?.moves ? (
                live.moves.length === 0 ? <div className="empty sm">No recent moves.</div>
                : live.moves.slice(0, 8).map((m, i) => (
                  <div className="mv" key={m.hash + i}>
                    <span className={'pill ' + (m.direction === 'in' ? 'in' : 'out')}>{m.direction === 'in' ? 'IN' : 'OUT'}</span>
                    <span className="mvasset">{m.asset || 'token'}</span>
                    <span className="mvval">{m.usd ? usd(m.usd) : amt(m.value)}</span>
                  </div>
                ))
              ) : (
                <button className="loadmoves" onClick={loadMoves} disabled={live?.loadingMoves}>
                  {live?.loadingMoves ? 'Loading…' : 'Load recent moves (live)'}
                </button>
              )}
            </>}
      </div>
    </div>
  );
}
