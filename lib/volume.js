// Per-wallet trade volume over 24h / 7d on Robinhood Chain (4663).
// Simple + accurate: pull the wallet's transfers (the engine we already have),
// then sum the USD of its ETH + stablecoin legs inside each window. Every RH
// pool is X/WETH or X/USDG, so the quote-asset leg IS the trade notional —
// no double-counting, priced trivially, attributed to the exact wallet, no
// indexer, no per-pool cap.

const { rpc } = require('./alchemy');
const { tokenMeta } = require('./prices');

// Canonical quote assets by CONTRACT ADDRESS (verified from the top pools).
// Address-based, not symbol-based, so a spam token can't spoof symbol "USDG"
// and inflate volume. RH pools are overwhelmingly X/WETH or X/USDG, so these
// two legs capture real trade notional.
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'; // Robinhood USDG, $1
const DAY = 86400e3;

// All transfers for a wallet (both directions), up to `cap` recent, with time.
async function walletTransfers(address, cap = 1000) {
  const base = {
    fromBlock: '0x0',
    toBlock: 'latest',
    category: ['external', 'erc20'],
    withMetadata: true,
    excludeZeroValue: true,
    maxCount: '0x' + Math.min(cap, 1000).toString(16),
    order: 'desc',
  };
  const [out, incoming] = await Promise.all([
    rpc('alchemy_getAssetTransfers', [{ ...base, fromAddress: address }]),
    rpc('alchemy_getAssetTransfers', [{ ...base, toAddress: address }]),
  ]);
  return [...(out?.transfers || []), ...(incoming?.transfers || [])];
}

async function getWalletVolume(address, cap = 1000) {
  const ethMeta = await tokenMeta(WETH);
  const ethPrice = ethMeta?.price || 0;
  const now = Date.now();

  const rows = await walletTransfers(address, cap);
  const acc = {
    vol24h: 0, vol7d: 0, trades24h: 0, trades7d: 0,
    lastTs: null, capped: rows.length >= 2000, // 1000 per direction
  };

  for (const t of rows) {
    const tsStr = t.metadata?.blockTimestamp;
    if (!tsStr) continue;
    const ts = Date.parse(tsStr);
    const age = now - ts;
    if (age > 7 * DAY) continue; // only the 7d window matters here

    const contract = (t.rawContract?.address || '').toLowerCase();
    const val = t.value != null ? Number(t.value) : 0;
    let usd = 0;
    if (t.category === 'external') usd = val * ethPrice;   // native ETH
    else if (contract === WETH) usd = val * ethPrice;      // WETH leg
    else if (contract === USDG) usd = val;                 // USDG leg, $1
    else continue; // token side or symbol-spoof — not a real quote leg

    if (!acc.lastTs || ts > acc.lastTs) acc.lastTs = ts;
    acc.vol7d += usd; acc.trades7d += 1;
    if (age <= DAY) { acc.vol24h += usd; acc.trades24h += 1; }
  }

  acc.vol24h = Math.round(acc.vol24h);
  acc.vol7d = Math.round(acc.vol7d);
  acc.lastTs = acc.lastTs ? new Date(acc.lastTs).toISOString() : null;
  return acc;
}

module.exports = { getWalletVolume };
