// Pure, network-free builder for the "Big Trades (24h)" tape (Whale Trade Tape).
//
// Fed by GeckoTerminal pool-trade records already fetched during snapshot
// generation (scripts/seed.js reuses the pools it discovered — no extra pool
// list request). Keeping ALL normalization + selection here, with no fetching,
// makes it deterministic and unit-testable offline via scripts/tape.check.js.
//
// SIDE SEMANTICS — GeckoTerminal's `kind` is relative to the pool's BASE token.
// Verified against live RH-chain pools (POW/WETH, 300/300 trades consistent):
//   kind='buy'  => quote -> base  (the base token was BOUGHT)
//   kind='sell' => base -> quote  (the base token was SOLD)
// The tape ALWAYS displays the pool's base token, so `side` maps 1:1 to
// "bought / sold this token" — the BUY/SELL label is safe to show as-is.

const ADDR_RE = /^0x[a-f0-9]{40}$/;
const HASH_RE = /^0x[a-f0-9]{64}$/;
const DAY_MS = 86400000;

function normalizeToken(token) {
  if (!token || typeof token !== 'object') return null;
  const symbol = typeof token.symbol === 'string' ? token.symbol.trim() : '';
  if (!symbol) return null; // a labelled tape row needs a token symbol
  const rawAddr = typeof token.address === 'string' ? token.address.toLowerCase() : '';
  const address = ADDR_RE.test(rawAddr) ? rawAddr : null; // valid when present, else null
  const logo = typeof token.logo === 'string' && token.logo ? token.logo : null; // missing -> placeholder
  return { symbol, address, logo };
}

// One raw record -> a clean, contract-shaped record, or null if it fails any
// invariant. Carries an internal `_t` (numeric ms) for windowing/sorting that is
// stripped before output.
function normalizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const t = Date.parse(raw.ts);
  if (!Number.isFinite(t)) return null;

  const hash = typeof raw.hash === 'string' ? raw.hash.toLowerCase() : '';
  if (!HASH_RE.test(hash)) return null;

  const wallet = typeof raw.wallet === 'string' ? raw.wallet.toLowerCase() : '';
  if (!ADDR_RE.test(wallet)) return null;

  if (raw.side !== 'buy' && raw.side !== 'sell') return null;

  const usd = Number(raw.usd);
  if (!Number.isFinite(usd) || usd <= 0) return null;

  const token = normalizeToken(raw.token);
  if (!token) return null;

  const pool = typeof raw.pool === 'string' && raw.pool ? raw.pool : null;

  return { ts: new Date(t).toISOString(), _t: t, hash, wallet, side: raw.side, usd, token, pool };
}

// Build the tape from loosely-shaped GeckoTerminal trade records:
//   normalize -> keep prior-24h window -> dedupe by hash (highest USD) ->
//   rank by USD -> keep top `limit` -> sort newest-first.
// `now` defaults to wall-clock but is injected by tests for determinism.
function buildTape(rawTrades, { now = Date.now(), windowMs = DAY_MS, limit = 40 } = {}) {
  const cutoff = now - windowMs;
  const byHash = new Map();

  for (const raw of Array.isArray(rawTrades) ? rawTrades : []) {
    const rec = normalizeTrade(raw);
    if (!rec) continue;
    if (rec._t > now || rec._t < cutoff) continue; // strictly inside [now-window, now]
    const prev = byHash.get(rec.hash);
    if (!prev || rec.usd > prev.usd) byHash.set(rec.hash, rec); // keep highest-USD per tx
  }

  return [...byHash.values()]
    .sort((a, b) => b.usd - a.usd) // rank by value
    .slice(0, limit)               // keep the largest N
    .sort((a, b) => b._t - a._t)   // display newest-first
    .map(({ _t, ...rec }) => rec); // strip internal field -> contract shape
}

module.exports = { buildTape, normalizeTrade };
