// Rate limiter for the key-less, CORS-open public API routes.
//
// These fan out to the PAID Alchemy engine, so without a cap anyone could loop
// random addresses (a `?cachebust=` also defeats the CDN cache) and burn the
// quota. On serverless, an in-memory limiter is PER-INSTANCE — Vercel spreads a
// concurrent burst across instances, so it never stops a real flood. The only
// limiter that actually works globally is one backed by shared state.
//
// So: use Upstash Redis (shared across all instances) when its env is present,
// and FALL BACK to a per-instance in-memory limiter when it isn't (local dev, or
// before the env vars are set). Every Redis error FAILS OPEN — a Redis blip must
// never block legitimate traffic. Per-route buckets (via `name`) so routes don't
// share counters.
//
// To activate the global limiter, set on the Vercel project:
//   KV_REST_API_URL / KV_REST_API_TOKEN   (Vercel KV — this IS Upstash), or
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// You can reuse an existing Upstash/KV instance — keys are prefixed `rhsm:rl:`.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REDIS_URL && REDIS_TOKEN ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN }) : null;

// One Ratelimit per (name, limit, window) — reused across warm invocations.
const limiters = new Map();
function getLimiter(name, limit, windowMs) {
  if (!redis) return null;
  const key = `${name}:${limit}:${windowMs}`;
  let l = limiters.get(key);
  if (!l) {
    l = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${Math.round(windowMs / 1000)} s`),
      prefix: `rhsm:rl:${name}`,
      analytics: false,
    });
    limiters.set(key, l);
  }
  return l;
}

function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

// ---- in-memory fallback (per-instance; used only when Redis is absent) --------
const HITS = new Map(); // `${name}:${ip}` -> ascending timestamps in-window
const MAX_KEYS = 5000;
function memoryLimit(name, ip, limit, windowMs) {
  const bucket = `${name}:${ip}`;
  const now = Date.now();
  const cutoff = now - windowMs;
  let arr = HITS.get(bucket);
  if (!arr) {
    if (HITS.size >= MAX_KEYS) HITS.clear();
    arr = [];
    HITS.set(bucket, arr);
  }
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
  }
  arr.push(now);
  return { ok: true };
}

// Async: Redis path is a network call. Returns { ok:true } | { ok:false, retryAfter }.
export async function rateLimit(req, { name = 'api', limit = 20, windowMs = 60000 } = {}) {
  const ip = clientIp(req);
  const limiter = getLimiter(name, limit, windowMs);
  if (limiter) {
    try {
      const { success, reset } = await limiter.limit(ip);
      if (success) return { ok: true };
      return { ok: false, retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
    } catch {
      // Redis unreachable — fail open, but still apply the per-instance guard.
    }
  }
  return memoryLimit(name, ip, limit, windowMs);
}

// Standard 429 for an over-limit request.
export function tooMany(retryAfter) {
  return Response.json(
    { error: 'rate limited — slow down', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
