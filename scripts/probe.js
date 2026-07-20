// How many unique trader wallets can we actually discover across RH pools?
const GT = 'https://api.geckoterminal.com/api/v2';
const NET = 'robinhood';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gt(path, attempt = 0) {
  const res = await fetch(`${GT}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (res.status === 429 && attempt < 5) { await sleep(1500 * (attempt + 1)); return gt(path, attempt + 1); }
  if (!res.ok) throw new Error(`GT ${res.status} ${path}`);
  return res.json();
}

(async () => {
  const pools = [];
  for (let page = 1; page <= 10; page++) {
    try {
      const j = await gt(`/networks/${NET}/pools?sort=h24_volume_usd_desc&page=${page}`);
      const batch = (j.data || []).map((p) => p.attributes?.address).filter(Boolean);
      if (!batch.length) break;
      pools.push(...batch);
      await sleep(300);
    } catch (e) { console.log('pools page', page, 'err', e.message); break; }
  }
  console.log('pools discovered:', pools.length);

  const wallets = new Set();
  let done = 0;
  for (const p of pools) {
    try {
      const j = await gt(`/networks/${NET}/pools/${p}/trades`);
      for (const t of j.data || []) {
        const w = (t.attributes?.tx_from_address || '').toLowerCase();
        if (/^0x[a-f0-9]{40}$/.test(w)) wallets.add(w);
      }
    } catch {}
    done++;
    if (done % 15 === 0) console.log(`  ${done}/${pools.length} pools -> ${wallets.size} unique wallets`);
    await sleep(320);
  }
  console.log('TOTAL unique wallets:', wallets.size);
})();
