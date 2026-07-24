// Dependency-free deterministic check for the pure tape helper (lib/tradeTape.js).
// No network, no test framework — run with: node scripts/tape.check.js
// Exits non-zero on the first failed invariant so it can gate a build.

const assert = require('assert');
const { buildTape } = require('../lib/tradeTape');

const NOW = Date.parse('2026-07-22T00:00:00.000Z'); // fixed clock for determinism
const MIN = 60000;
const mkHash = (i) => '0x' + i.toString(16).padStart(64, '0');
const mkWallet = (i) => '0x' + i.toString(16).padStart(40, '0');
const iso = (msFromNow) => new Date(NOW + msFromNow).toISOString();

function trade(over = {}) {
  return {
    ts: iso(-5 * MIN),
    hash: mkHash(1),
    wallet: mkWallet(1),
    side: 'buy',
    usd: 1000,
    token: { symbol: 'ABC', address: mkWallet(0xabc), logo: 'https://x/l.png' },
    pool: 'ABC / WETH',
    ...over,
  };
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}

// 1. Malformed records are rejected (invalid ts, hash, wallet, side, usd, token).
check('malformed records are rejected', () => {
  const bad = [
    trade({ ts: 'not-a-date' }),
    trade({ ts: null }),
    trade({ hash: '0xdeadbeef' }),          // too short
    trade({ hash: 123 }),
    trade({ wallet: '0xnothex' }),
    trade({ side: 'BUY' }),                  // wrong case
    trade({ side: 'swap' }),
    trade({ usd: 0 }),
    trade({ usd: -5 }),
    trade({ usd: 'abc' }),
    trade({ usd: Infinity }),
    trade({ token: { symbol: '', address: mkWallet(2) } }), // no symbol
    trade({ token: null }),
    null,
    'garbage',
  ];
  const good = trade({ hash: mkHash(99), usd: 42 });
  const out = buildTape([...bad, good], { now: NOW });
  assert.strictEqual(out.length, 1, 'only the one valid record should survive');
  assert.strictEqual(out[0].hash, mkHash(99));
});

// 2. Records outside the previous 24h are excluded (older than 24h and future).
check('records outside 24h are excluded', () => {
  const out = buildTape([
    trade({ hash: mkHash(1), ts: iso(-25 * 60 * MIN) }), // 25h old -> drop
    trade({ hash: mkHash(2), ts: iso(-23 * 60 * MIN) }), // 23h old -> keep
    trade({ hash: mkHash(3), ts: iso(+1 * MIN) }),       // 1m future -> drop
  ], { now: NOW });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, mkHash(2));
});

// 3. Duplicate hashes keep the highest-USD record.
check('duplicate hashes keep highest-USD record', () => {
  const out = buildTape([
    trade({ hash: mkHash(7), usd: 100, ts: iso(-2 * MIN) }),
    trade({ hash: mkHash(7), usd: 900, ts: iso(-3 * MIN) }),
    trade({ hash: mkHash(7), usd: 500, ts: iso(-1 * MIN) }),
  ], { now: NOW });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].usd, 900);
});

// 4. Only valid buy/sell values survive.
check('only buy/sell survive', () => {
  const out = buildTape([
    trade({ hash: mkHash(1), side: 'buy' }),
    trade({ hash: mkHash(2), side: 'sell' }),
    trade({ hash: mkHash(3), side: 'mint' }),
    trade({ hash: mkHash(4), side: '' }),
  ], { now: NOW });
  assert.strictEqual(out.length, 2);
  assert.ok(out.every((r) => r.side === 'buy' || r.side === 'sell'));
});

// 5 + 6. Selection keeps the largest 40 BY USD, and the final list is newest-first.
// USD and time are deliberately anti-correlated: the 5 dropped records are the
// NEWEST but smallest — proving selection is value-based, ordering is time-based.
check('keeps largest 40 by USD, output is newest-first', () => {
  const raw = [];
  for (let i = 1; i <= 45; i++) {
    raw.push(trade({ hash: mkHash(i), wallet: mkWallet(i), usd: i, ts: iso(-i * MIN) }));
  }
  const out = buildTape(raw, { now: NOW });
  assert.strictEqual(out.length, 40, 'must cap at 40');

  const idx = out.map((r) => parseInt(r.hash, 16));
  // Value-based selection: kept i in 6..45 (usd 6..45), dropped the 5 smallest (i 1..5).
  assert.deepStrictEqual([...idx].sort((a, b) => a - b), Array.from({ length: 40 }, (_, k) => k + 6));

  // Newest-first display: ts strictly descending (i ascending, since ts = now - i*min).
  for (let k = 0; k < out.length - 1; k++) {
    assert.ok(Date.parse(out[k].ts) >= Date.parse(out[k + 1].ts), 'ts must be newest-first at ' + k);
  }
  assert.strictEqual(parseInt(out[0].hash, 16), 6, 'newest kept record first');
  assert.strictEqual(parseInt(out[39].hash, 16), 45, 'oldest kept record last');
});

// 7. Missing optional logo (and missing address) are accepted and degrade to null.
check('missing logo / address degrade to null', () => {
  const out = buildTape([
    trade({ hash: mkHash(1), token: { symbol: 'NOLOGO', address: mkWallet(5) } }),
    trade({ hash: mkHash(2), token: { symbol: 'NOADDR', logo: 'https://x/y.png' } }),
    trade({ hash: mkHash(3), token: { symbol: 'BADADDR', address: '0xnope', logo: null } }),
  ], { now: NOW });
  assert.strictEqual(out.length, 3);
  const bySym = Object.fromEntries(out.map((r) => [r.token.symbol, r.token]));
  assert.strictEqual(bySym.NOLOGO.logo, null);
  assert.strictEqual(bySym.NOADDR.address, null);
  assert.strictEqual(bySym.BADADDR.address, null, 'invalid address must degrade to null');
});

// 8. Output matches the documented contract exactly (no internals, no provider metadata).
check('output matches the documented contract', () => {
  const out = buildTape([trade({ hash: mkHash(1) })], { now: NOW });
  assert.strictEqual(out.length, 1);
  const r = out[0];
  assert.deepStrictEqual(Object.keys(r).sort(), ['hash', 'pool', 'side', 'ts', 'usd', 'wallet'].concat(['token']).sort());
  assert.deepStrictEqual(Object.keys(r.token).sort(), ['address', 'logo', 'symbol']);
  assert.ok(!('_t' in r), 'internal _t must be stripped');
  assert.strictEqual(typeof r.usd, 'number');
  assert.ok(Number.isFinite(Date.parse(r.ts)), 'ts must be a valid timestamp');
  assert.strictEqual(r.ts, new Date(r.ts).toISOString(), 'ts must be normalized ISO');
});

// Empty / non-array input is safe.
check('empty and non-array input return []', () => {
  assert.deepStrictEqual(buildTape([], { now: NOW }), []);
  assert.deepStrictEqual(buildTape(undefined, { now: NOW }), []);
  assert.deepStrictEqual(buildTape(null, { now: NOW }), []);
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall tape checks passed');
