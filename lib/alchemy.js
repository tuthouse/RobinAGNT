// Alchemy Enhanced API on Robinhood Chain (4663).
// The whole tracker engine: getAssetTransfers gives every in/out move for a
// wallet in one call — no indexer to run.

const RPC =
  (process.env.ALCHEMY_RH_RPC || 'https://robinhood-mainnet.g.alchemy.com/v2') +
  '/' +
  (process.env.ALCHEMY_KEY || '');

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
    signal: AbortSignal.timeout(12000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'alchemy rpc error');
  return json.result;
}

// One direction of transfers (sent OR received) for an address.
async function transfers(address, direction, maxCount) {
  const key = direction === 'out' ? 'fromAddress' : 'toAddress';
  const result = await rpc('alchemy_getAssetTransfers', [
    {
      fromBlock: '0x0',
      toBlock: 'latest',
      [key]: address,
      category: ['external', 'erc20'],
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: '0x' + (maxCount || 100).toString(16),
      order: 'desc',
    },
  ]);
  return (result?.transfers || []).map((t) => ({
    direction, // 'in' | 'out'
    hash: t.hash,
    block: parseInt(t.blockNum, 16),
    ts: t.metadata?.blockTimestamp || null,
    from: t.from,
    to: t.to,
    asset: t.asset || (t.category === 'external' ? 'ETH' : null),
    contract: t.rawContract?.address || null,
    value: t.value != null ? Number(t.value) : null, // decimal-adjusted by Alchemy
    category: t.category,
  }));
}

// Merged recent activity for a wallet, newest first.
async function getWalletActivity(address, limit = 40) {
  const [out, incoming] = await Promise.all([
    transfers(address, 'out', limit),
    transfers(address, 'in', limit),
  ]);
  return [...out, ...incoming]
    .sort((a, b) => (b.block - a.block) || (b.direction === 'out' ? 1 : -1))
    .slice(0, limit);
}

module.exports = { getWalletActivity, rpc };
