// In-memory per-IP rate limiter for the key-less, CORS-open public API routes.
//
// Those routes fan out to the PAID Alchemy engine, so without a cap anyone could
// loop random addresses (a `?cachebust=` also defeats the CDN cache) and burn the
// quota — draining the owner's bill and killing the wallet drill-down for
// everyone. This bounds abuse per serverless instance with ZERO added
// dependencies; combined with the routes' `s-maxage` CDN caching it's a large
// reduction in abuse surface. For a hard GLOBAL limit across instances, front
// with Vercel WAF or an Upstash-backed limiter later.

const HITS = new Map(); // ip -> ascending request timestamps within the window
const MAX_KEYS = 5000;  // bound memory against IP-spray (crude reset on overflow)

function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

// Sliding-window limiter. Returns { ok:true } or { ok:false, retryAfter:<seconds> }.
function rateLimit(req, { limit = 20, windowMs = 60000 } = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  const cutoff = now - windowMs;
  let arr = HITS.get(ip);
  if (!arr) {
    if (HITS.size >= MAX_KEYS) HITS.clear();
    arr = [];
    HITS.set(ip, arr);
  }
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
    return { ok: false, retryAfter };
  }
  arr.push(now);
  return { ok: true };
}

// Standard 429 response for an over-limit request.
function tooMany(retryAfter) {
  return Response.json(
    { error: 'rate limited — slow down', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

module.exports = { rateLimit, clientIp, tooMany };
