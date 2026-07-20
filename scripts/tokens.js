// Build the token market-cap map data: symbol, logo, market cap, 24h volume,
// 24h change. Area = mcap, brightness = volume (like the reference map).
// Logos from GT (image_url); Blockscout fills the ones GT misses.
// Writes token data into data/snapshot.json (keeps wallets untouched).

const fs = require('fs');
const path = require('path');
const GT = 'https://api.geckoterminal.com/api/v2';
const NET = 'robinhood';
const BLOCKSCOUT = 'https://robinhoodchain.blockscout.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUOTES = new Set(['WETH', 'USDG', 'USDE', 'USDC', 'USDT', 'DAI', 'ETH']);
// Bridged / launchpad tokens whose market cap is a GLOBAL figure, not RH-chain.
// They'd dominate the map and bury native tokens. Grow as spotted.
const EXCLUDE = new Set(['VIRTUAL']);
const PAGES = parseInt(process.env.TOKEN_PAGES || '3', 10);

async function gt(p, a = 0) {
  const r = await fetch(GT + p, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (r.status === 429 && a < 5) { await sleep(1500 * (a + 1)); return gt(p, a + 1); }
  if (!r.ok) throw new Error('GT ' + r.status);
  return r.json();
}

function cleanLogo(u) {
  if (!u || /missing\.png|missing_/.test(u)) return null;
  return u;
}

async function blockscoutLogo(addr) {
  try {
    const r = await fetch(`${BLOCKSCOUT}/api/v2/tokens/${addr}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return cleanLogo(j?.icon_url);
  } catch { return null; }
}

(async () => {
  const tokenById = new Map(); // gt token id -> {address, symbol, logo}
  const byAddr = new Map();    // address -> token row

  for (let page = 1; page <= PAGES; page++) {
    let j;
    try { j = await gt(`/networks/${NET}/pools?include=base_token&sort=h24_volume_usd_desc&page=${page}`); }
    catch { break; }
    for (const t of (j.included || []).filter((x) => x.type === 'token')) {
      tokenById.set(t.id, {
        address: (t.attributes?.address || '').toLowerCase(),
        symbol: t.attributes?.symbol,
        logo: cleanLogo(t.attributes?.image_url),
      });
    }
    const data = j.data || [];
    if (!data.length) break;
    for (const p of data) {
      const a = p.attributes || {};
      const baseId = p.relationships?.base_token?.data?.id;
      const tok = baseId && tokenById.get(baseId);
      const symbol = tok?.symbol || (a.name || '').split(' / ')[0]?.trim();
      if (!symbol || QUOTES.has(symbol.toUpperCase()) || EXCLUDE.has(symbol.toUpperCase())) continue;
      const addr = tok?.address || symbol;
      const mcap = Number(a.market_cap_usd || a.fdv_usd || 0);
      const vol24h = Number(a.volume_usd?.h24 || 0);
      const prev = byAddr.get(addr);
      if (prev && prev.mcap >= mcap && prev.vol24h >= vol24h) continue;
      byAddr.set(addr, {
        symbol, address: addr, logo: tok?.logo || null,
        mcap, vol24h,
        change24h: Number(a.price_change_percentage?.h24 ?? 0),
        priceUsd: Number(a.base_token_price_usd || 0),
      });
    }
    await sleep(400);
  }

  let tokens = [...byAddr.values()]
    .filter((t) => t.mcap > 0)
    .sort((x, y) => y.mcap - x.mcap)
    .slice(0, 28);

  // Fill missing logos from Blockscout (only the ones on the board).
  for (const t of tokens) {
    if (!t.logo && /^0x[a-f0-9]{40}$/.test(t.address)) {
      t.logo = await blockscoutLogo(t.address);
      await sleep(120);
    }
  }

  const snap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'snapshot.json'), 'utf8'));
  snap.tokens = tokens;
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'snapshot.json'), JSON.stringify(snap));

  console.log(`tokens: ${tokens.length}, with logo: ${tokens.filter((t) => t.logo).length}`);
  tokens.slice(0, 10).forEach((t) =>
    console.log(`  ${t.symbol.padEnd(10)} mcap $${(t.mcap / 1e6).toFixed(2)}M  vol $${(t.vol24h / 1e6).toFixed(2)}M  logo:${t.logo ? 'Y' : 'n'}`));
})();
