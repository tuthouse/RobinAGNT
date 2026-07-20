import { topTradersByVolume } from '../../../lib/topTraders';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/top-traders?pools=15&top=30
// Wallet leaderboard by DEX volume on Robinhood Chain. The discovery funnel.
export async function GET(req) {
  const url = new URL(req.url);
  const pools = Math.min(parseInt(url.searchParams.get('pools') || '15', 10) || 15, 20);
  const top = Math.min(parseInt(url.searchParams.get('top') || '30', 10) || 30, 100);
  try {
    const traders = await topTradersByVolume({ pools, top });
    return Response.json(
      { chain: 4663, source: 'geckoterminal', pools, count: traders.length, traders },
      { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' } }
    );
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
