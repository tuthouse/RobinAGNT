// Token USD prices + logos on Robinhood Chain (4663) via Blockscout's v2 API.
// exchange_rate is 429-proof relative to GeckoTerminal and covers RH's tokenized
// stocks/USDG/WETH. Same source MyAGNT uses in prod (robinhood-balances.js).

const BLOCKSCOUT = process.env.RH_BLOCKSCOUT || 'https://robinhoodchain.blockscout.com';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'; // RH-chain WETH (Blockscout-priced)

const cache = new Map(); // contract(lower) -> { price, symbol, logo }
let cachedAt = 0;

async function tokenMeta(contract) {
  const addr = (contract || '').toLowerCase();
  if (!addr) return null;
  if (cache.has(addr)) return cache.get(addr);
  try {
    const res = await fetch(`${BLOCKSCOUT}/api/v2/tokens/${addr}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const meta = {
      price: parseFloat(j?.exchange_rate || '0') || 0,
      symbol: j?.symbol || null,
      logo: j?.icon_url || null,
    };
    cache.set(addr, meta);
    return meta;
  } catch {
    return null;
  }
}

// Price a list of moves in place: fills `usd` (per-move dollar value) + `logo`.
async function priceMoves(moves) {
  const contracts = [...new Set(moves.map((m) => m.contract).filter(Boolean))];
  const metas = {};
  await Promise.all(
    contracts.map(async (c) => {
      metas[c.toLowerCase()] = await tokenMeta(c);
    })
  );
  // Native ETH priced off WETH.
  const ethMeta = await tokenMeta(WETH);
  const ethPrice = ethMeta?.price || 0;

  for (const m of moves) {
    const meta = m.contract ? metas[m.contract.toLowerCase()] : null;
    const price = m.contract ? meta?.price || 0 : ethPrice;
    m.usd = m.value != null ? m.value * price : null;
    m.logo = meta?.logo || null;
    if (!m.asset && meta?.symbol) m.asset = meta.symbol;
  }
  cachedAt = Date.now();
  return moves;
}

module.exports = { priceMoves, tokenMeta };
