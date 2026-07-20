// Wallet discovery by DEX volume on Robinhood Chain (4663).
// There is no "top wallets" endpoint on RH — so we aggregate it:
//   top pools by 24h volume  ->  each pool's recent trades  ->  sum USD per trader.
// Real swap volume, USD-denominated, swap-only (no transfer/airdrop noise),
// no indexer. This is the DISCOVERY layer: volume finds candidates, the P&L
// filter judges them.

const GT = 'https://api.geckoterminal.com/api/v2';
const NET = 'robinhood';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GT free tier rate-limits bursts (~30/min). Retry 429s with backoff so a
// public endpoint stays reliable; results are cached upstream anyway.
async function gt(path, attempt = 0) {
  const res = await fetch(`${GT}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 429 && attempt < 4) {
    await sleep(1200 * (attempt + 1)); // 1.2s, 2.4s, 3.6s, 4.8s
    return gt(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`GT ${res.status} on ${path}`);
  return res.json();
}

async function topPools(limit = 15) {
  const j = await gt(`/networks/${NET}/pools?sort=h24_volume_usd_desc`);
  return (j.data || []).slice(0, limit).map((p) => ({
    address: p.attributes?.address,
    name: p.attributes?.name,
    vol24h: Number(p.attributes?.volume_usd?.h24 || 0),
  }));
}

async function poolTrades(poolAddr) {
  const j = await gt(`/networks/${NET}/pools/${poolAddr}/trades`);
  return (j.data || []).map((t) => ({
    wallet: (t.attributes?.tx_from_address || '').toLowerCase(),
    usd: Number(t.attributes?.volume_in_usd || 0),
    kind: t.attributes?.kind, // 'buy' | 'sell'
    ts: t.attributes?.block_timestamp || null,
  }));
}

// Rank wallets by total DEX volume across the busiest pools.
async function topTradersByVolume({ pools = 15, top = 30 } = {}) {
  const poolList = await topPools(pools);

  // Sequential + tiny gap — GT free tier rate-limits bursts (~30/min).
  const tally = new Map();
  for (let i = 0; i < poolList.length; i++) {
    const p = poolList[i];
    if (!p.address) continue;
    if (i > 0) await sleep(350); // stay under GT's burst limit
    let trades = [];
    try {
      trades = await poolTrades(p.address);
    } catch {
      continue; // one bad pool shouldn't sink the leaderboard
    }
    for (const tr of trades) {
      if (!/^0x[a-f0-9]{40}$/.test(tr.wallet)) continue;
      const e = tally.get(tr.wallet) || {
        wallet: tr.wallet, volUsd: 0, trades: 0, buys: 0, sells: 0,
        pools: new Set(), lastTs: null,
      };
      e.volUsd += tr.usd;
      e.trades += 1;
      if (tr.kind === 'buy') e.buys += 1;
      else if (tr.kind === 'sell') e.sells += 1;
      e.pools.add(p.name);
      if (!e.lastTs || (tr.ts && tr.ts > e.lastTs)) e.lastTs = tr.ts;
      tally.set(tr.wallet, e);
    }
  }

  return [...tally.values()]
    .map((e) => ({
      wallet: e.wallet,
      volUsd: Math.round(e.volUsd),
      trades: e.trades,
      buys: e.buys,
      sells: e.sells,
      pools: [...e.pools].slice(0, 4),
      lastTs: e.lastTs,
    }))
    .sort((a, b) => b.volUsd - a.volUsd)
    .slice(0, top);
}

module.exports = { topTradersByVolume, topPools };
