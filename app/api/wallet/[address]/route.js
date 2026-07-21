import { getWalletActivity } from '../../../../lib/alchemy';
import { priceMoves } from '../../../../lib/prices';
import { getWalletVolume } from '../../../../lib/volume';
import { getHoldings } from '../../../../lib/holdings';
import { rateLimit, tooMany } from '../../../../lib/ratelimit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/wallet/:address?limit=40
// Public, CORS-open. The core engine builders fork.
export async function GET(req, { params }) {
  // Heaviest route (4 Alchemy calls/hit) — rate-limit hardest so nobody can loop
  // random addresses to burn the paid Alchemy quota.
  const rl = rateLimit(req, { limit: 20, windowMs: 60000 });
  if (!rl.ok) return tooMany(rl.retryAfter);

  const { address } = await params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) {
    return Response.json({ error: 'invalid address' }, { status: 400 });
  }
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '40', 10) || 40, 100);

  try {
    const [moves, volume, holdings] = await Promise.all([
      priceMoves(await getWalletActivity(address, limit)),
      getWalletVolume(address),
      getHoldings(address),
    ]);
    return Response.json(
      { chain: 4663, address, volume, holdings, count: moves.length, moves },
      { headers: { 'Cache-Control': 's-maxage=20, stale-while-revalidate=40' } }
    );
  } catch (e) {
    // Log the detail server-side; return a generic message so no upstream detail
    // (or a future URL-bearing error that could carry the key) reaches clients.
    console.error('[wallet]', address, String(e?.message || e));
    return Response.json({ error: 'upstream error' }, { status: 502 });
  }
}
