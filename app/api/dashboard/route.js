import snapshot from '../../../data/snapshot.json';

// GET /api/dashboard — the precomputed snapshot (chain stats + pools + ranked wallets).
// Served static so 1000 wallets load instantly; refreshed by scripts/seed.js + redeploy.
export async function GET() {
  return Response.json(snapshot, {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
  });
}
