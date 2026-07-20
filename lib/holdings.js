// Top holdings for a wallet on Robinhood Chain (4663).
// Blockscout's token-balances gives balance + USD price (exchange_rate) + logo in
// one keyless call; native ETH comes from the address coin_balance, priced off
// WETH. We surface the priced holdings and count the unpriced dust/spam rather
// than showing it.

const { tokenMeta } = require('./prices');

const BLOCKSCOUT = process.env.RH_BLOCKSCOUT || 'https://robinhoodchain.blockscout.com';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

async function getHoldings(address, topN = 12) {
  const [balRes, addrRes, ethMeta] = await Promise.all([
    fetch(`${BLOCKSCOUT}/api/v2/addresses/${address}/token-balances`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => []),
    fetch(`${BLOCKSCOUT}/api/v2/addresses/${address}`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => ({})),
    tokenMeta(WETH),
  ]);

  const ethPrice = ethMeta?.price || 0;
  const holdings = [];

  // Native ETH
  const wei = Number(addrRes?.coin_balance || 0);
  if (wei > 0) {
    const bal = wei / 1e18;
    const usd = bal * ethPrice;
    if (usd > 0.5) holdings.push({ symbol: 'ETH', balance: bal, usd, logo: null, native: true });
  }

  // ERC-20s
  let dust = 0;
  for (const b of Array.isArray(balRes) ? balRes : []) {
    const t = b.token || {};
    const dec = parseInt(t.decimals || '18', 10);
    const bal = Number(b.value || 0) / 10 ** dec;
    const rate = t.exchange_rate ? parseFloat(t.exchange_rate) : 0;
    const usd = bal * rate;
    if (usd > 0.5) {
      holdings.push({
        symbol: t.symbol || '?',
        address: t.address || t.address_hash || null,
        balance: bal,
        usd,
        logo: t.icon_url || null,
      });
    } else {
      dust += 1;
    }
  }

  holdings.sort((a, b) => b.usd - a.usd);
  const totalUsd = holdings.reduce((s, h) => s + h.usd, 0);

  return {
    totalUsd: Math.round(totalUsd),
    holdings: holdings.slice(0, topN),
    priced: holdings.length,
    dust, // count of unpriced/spam tokens hidden
  };
}

module.exports = { getHoldings };
