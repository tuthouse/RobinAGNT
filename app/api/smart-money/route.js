import { getWalletVolume } from '../../../lib/volume';
import watchlist from '../../../data/watchlist.json';
import { rateLimit, tooMany } from '../../../lib/ratelimit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/smart-money
// The tracker: every watched wallet with its 24h + 7d trade volume, ranked.
export async function GET(req) {
  // Bounded (fixed watchlist) but still fans out to Alchemy per wallet — cap it.
  const rl = rateLimit(req, { limit: 20, windowMs: 60000 });
  if (!rl.ok) return tooMany(rl.retryAfter);

  const wallets = watchlist.filter(
    (w) =>
      /^0x[a-fA-F0-9]{40}$/.test(w.address) &&
      w.address !== '0x0000000000000000000000000000000000000000'
  );

  const settled = await Promise.allSettled(
    wallets.map(async (w) => {
      const v = await getWalletVolume(w.address);
      return {
        address: w.address,
        label: w.label,
        vol24h: v.vol24h,
        vol7d: v.vol7d,
        trades24h: v.trades24h,
        trades7d: v.trades7d,
        lastTs: v.lastTs,
        capped: v.capped,
      };
    })
  );

  const rows = settled
    .filter((s) => s.status === 'fulfilled')
    .map((s) => s.value)
    .sort((a, b) => b.vol7d - a.vol7d);

  return Response.json(
    { chain: 4663, count: rows.length, wallets: rows },
    { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' } }
  );
}
