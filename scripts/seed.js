// Build the dashboard snapshot: chain stats + top pools + top wallets by volume.
// Runs OFFLINE (not per-request) so we can afford 2 Alchemy calls/wallet across
// hundreds of wallets. Writes data/snapshot.json which the site serves static.
//
// Usage:  node scripts/seed.js [maxWallets]
//   env:  ALCHEMY_KEY must be set (export from .env.local)

const fs = require('fs');
const path = require('path');
const { getWalletVolume } = require('../lib/volume');
const { getHoldings } = require('../lib/holdings');

const GT = 'https://api.geckoterminal.com/api/v2';
const NET = 'robinhood';
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEEP = parseInt(process.argv[2] || '1000', 10);            // wallets on the board
const CANDIDATES = parseInt(process.env.CANDIDATES || '2500', 10); // candidates to price
const POOL_PAGES = parseInt(process.env.POOL_PAGES || '5', 10);  // GT: 20 pools/page
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '12', 10); // parallel computes

async function gt(p, a = 0) {
  const res = await fetch(`${GT}${p}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (res.status === 429 && a < 6) { await sleep(1500 * (a + 1)); return gt(p, a + 1); }
  if (!res.ok) throw new Error(`GT ${res.status} ${p}`);
  return res.json();
}

async function chainStats() {
  try {
    const r = await fetch(`${BLOCKSCOUT}/api/v2/stats`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    return {
      addresses: Number(d.total_addresses) || null,
      txnsTotal: Number(d.total_transactions) || null,
      txnsDaily: Number(d.transactions_today || d.daily_transactions) || null,
      blocks: Number(d.total_blocks) || null,
    };
  } catch { return {}; }
}

const QUOTES = new Set(['WETH', 'USDG', 'USDE', 'USDC', 'USDT', 'DAI', 'ETH']);
const EXCLUDE = new Set(['VIRTUAL']); // bridged/launchpad tokens with global mcap

const WETH_ADDR = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const USDG_ADDR = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const cleanLogo = (u) => (!u || /missing/.test(u) ? null : u);

async function bsLogo(addr) {
  try {
    const r = await fetch(`${BLOCKSCOUT}/api/v2/tokens/${addr}`, { signal: AbortSignal.timeout(8000) });
    return cleanLogo((await r.json())?.icon_url);
  } catch { return null; }
}

async function discover() {
  // Pools + tokens (with address, logo, mcap, 24h vol/change) via GT include=base_token.
  const pools = [];
  const tokById = new Map();
  const tokByAddr = new Map();
  for (let page = 1; page <= POOL_PAGES; page++) {
    let j;
    try { j = await gt(`/networks/${NET}/pools?include=base_token&sort=h24_volume_usd_desc&page=${page}`); }
    catch { break; }
    for (const t of (j.included || []).filter((x) => x.type === 'token')) {
      tokById.set(t.id, { address: (t.attributes?.address || '').toLowerCase(), symbol: t.attributes?.symbol, logo: cleanLogo(t.attributes?.image_url) });
    }
    const data = j.data || [];
    if (!data.length) break;
    for (const p of data) {
      const a = p.attributes || {};
      if (!a.address) continue;
      pools.push({ address: a.address, name: a.name, vol24h: Number(a.volume_usd?.h24 || 0) });
      const tok = tokById.get(p.relationships?.base_token?.data?.id);
      const symbol = tok?.symbol || (a.name || '').split(' / ')[0]?.trim();
      if (!symbol || QUOTES.has(symbol.toUpperCase()) || EXCLUDE.has(symbol.toUpperCase())) continue;
      const addr = tok?.address || symbol;
      const mcap = Number(a.market_cap_usd || a.fdv_usd || 0);
      const vol24h = Number(a.volume_usd?.h24 || 0);
      const prev = tokByAddr.get(addr);
      if (prev && prev.mcap >= mcap && prev.vol24h >= vol24h) continue;
      tokByAddr.set(addr, { symbol, address: addr, logo: tok?.logo || null, mcap, vol24h, change24h: Number(a.price_change_percentage?.h24 ?? 0), priceUsd: Number(a.base_token_price_usd || 0) });
    }
    await sleep(350);
  }
  let tokens = [...tokByAddr.values()].filter((t) => t.mcap > 0).sort((x, y) => y.mcap - x.mcap);
  const bySym = new Set();
  tokens = tokens.filter((t) => { const k = t.symbol.toUpperCase(); if (bySym.has(k)) return false; bySym.add(k); return true; }).slice(0, 28);
  for (const t of tokens) { if (!t.logo && /^0x[a-f0-9]{40}$/.test(t.address)) { t.logo = await bsLogo(t.address); await sleep(120); } }

  // Wallet discovery = holders of the quote assets + top tokens (Blockscout,
  // keyless, no throttle). Holders of traded tokens ARE the traders; the volume
  // pass filters out idle ones. Chain is ~18 days old so holders are recent.
  const holderTokens = [WETH_ADDR, USDG_ADDR, ...tokens.map((t) => t.address).filter((a) => /^0x[a-f0-9]{40}$/.test(a))].slice(0, 24);
  const wallets = await bsHolders(holderTokens, CANDIDATES);
  return { pools, tokens, wallets };
}

// Collect unique EOA holders across a set of token contracts.
async function bsHolders(tokenAddrs, target) {
  const seen = new Set();
  for (const addr of tokenAddrs) {
    if (seen.size >= target) break;
    let npp = null;
    for (let pg = 0; pg < 6 && seen.size < target; pg++) {
      const qs = new URLSearchParams();
      if (npp) for (const [k, v] of Object.entries(npp)) qs.set(k, String(v));
      let j;
      try {
        const r = await fetch(`${BLOCKSCOUT}/api/v2/tokens/${addr}/holders?${qs}`, { signal: AbortSignal.timeout(12000) });
        j = await r.json();
      } catch { break; }
      for (const h of j.items || []) {
        const a = (h.address?.hash || '').toLowerCase();
        if (/^0x[a-f0-9]{40}$/.test(a) && !h.address?.is_contract && !a.startsWith('0x000000000000')) seen.add(a);
      }
      npp = j.next_page_params;
      if (!npp) break;
      await sleep(150);
    }
    console.log(`  discover ${seen.size}/${target} wallets`);
  }
  return [...seen];
}

// Pass 1: volume only (Alchemy — fast, paid key handles concurrency).
async function computeVolumes(addresses) {
  const out = [];
  let i = 0, done = 0;
  async function worker() {
    while (i < addresses.length) {
      const addr = addresses[i++];
      try {
        const v = await getWalletVolume(addr);
        // Keep real traders; drop bridge/treasury-style movers (huge volume in
        // very few txns — avg leg > $3M is not trading, it's moving funds).
        const avgLeg = v.trades7d ? v.vol7d / v.trades7d : Infinity;
        if (v.vol7d > 0 && avgLeg <= 3_000_000) {
          out.push({
            address: addr, vol24h: v.vol24h, vol7d: v.vol7d,
            trades24h: v.trades24h, trades7d: v.trades7d,
            lastTs: v.lastTs, capped: v.capped,
          });
        }
      } catch {}
      done++;
      if (done % 50 === 0) console.log(`  volumes ${done}/${addresses.length} (kept ${out.length})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// Pass 2: holdings only for the wallets that made the board (Blockscout — gentler).
async function enrichHoldings(wallets) {
  let i = 0, done = 0;
  async function worker() {
    while (i < wallets.length) {
      const w = wallets[i++];
      try {
        const h = await getHoldings(w.address, 8);
        w.holdingsUsd = h.totalUsd; w.holdings = h.holdings; w.dust = h.dust;
      } catch { w.holdingsUsd = 0; w.holdings = []; w.dust = 0; }
      done++;
      if (done % 50 === 0) console.log(`  holdings ${done}/${wallets.length}`);
    }
  }
  // Fewer parallel workers — Blockscout is keyless and rate-limits.
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, 8) }, worker));
  return wallets;
}

(async () => {
  console.log('1/4 chain stats…');
  const chain = await chainStats();
  console.log('    ', JSON.stringify(chain));

  console.log('2/4 discovering wallets + tokens across pools…');
  const { pools, tokens, wallets } = await discover();
  console.log(`     ${pools.length} pools, ${tokens.length} tokens, ${wallets.length} unique trader wallets`);

  const targets = wallets.slice(0, CANDIDATES);
  console.log(`3/5 pricing volume for ${targets.length} candidates (concurrency ${CONCURRENCY})…`);
  let priced = await computeVolumes(targets);
  priced.sort((a, b) => b.vol7d - a.vol7d);
  priced = priced.slice(0, KEEP);
  console.log(`     kept top ${priced.length} by 7d volume`);

  console.log(`4/5 fetching holdings for the ${priced.length} board wallets…`);
  await enrichHoldings(priced);

  console.log('5/5 writing snapshot…');
  const snapshot = {
    chain: 4663,
    generatedAt: new Date().toISOString(),
    stats: chain,
    discovered: { pools: pools.length, uniqueTraders: wallets.length },
    pools: pools.slice(0, 12).map((p) => ({ name: p.name, vol24h: Math.round(p.vol24h) })),
    tokens,
    wallets: priced,
  };
  const dest = path.join(__dirname, '..', 'data', 'snapshot.json');
  fs.writeFileSync(dest, JSON.stringify(snapshot, null, 0));
  console.log(`DONE — ${priced.length} wallets ranked, snapshot at data/snapshot.json`);
})();
