# RobinAGNT

An experimental, decentralized dashboard for **Robinhood Chain** (chain id `4663`) — wallet volume, token market maps, and holdings, on an **open API anyone can build on**.

> Powered by **$RobinAGNT** — anyone can build and get paid from fees.

Live: **[agnt.social/robinhood](https://agnt.social/robinhood)** · Built on [AGNT](https://agnt.social)

---

## What it does

- **Wallet volume leaderboard** — wallets ranked by 24h / 7d trade volume. Click any wallet → its token holdings + recent moves.
- **Market-cap map** — a treemap of tokens (area = market cap, brightness = 24h volume), logo-filled.
- **Open, key-less API** — the whole dataset is public and CORS-enabled, so you can fork this or build something new on top.

## Open API

No key required. CORS open.

```
GET /api/dashboard              → chain stats + tokens[] + wallets[] (ranked by 7d volume)
GET /api/wallet/<address>       → one wallet's 24h/7d volume, holdings, recent moves
GET /api/top-traders            → wallets ranked by DEX volume
```

## Build on it

**In an AI coding agent (Claude / Cursor / Codex):** open [`/build`](https://agnt.social/robinhood/build) for a copy-paste prompt pre-loaded with the API.

**Locally:**

```bash
npm install
cp .env.local.example .env.local   # add an Alchemy key (Robinhood Chain enabled)
npm run dev
```

## How it works

- **Alchemy** (`getAssetTransfers`) — per-wallet trade volume on Robinhood Chain.
- **Blockscout** (keyless) — token holdings, prices, logos, chain stats, and wallet discovery (token-holder lists).
- **GeckoTerminal** — token market caps + logos for the map.
- Everything is **precomputed into a snapshot** (`scripts/seed.js` → `data/snapshot.json`) and served static, so the dashboard loads instantly and never hammers a data provider on a page view.

Volume is measured as the ETH + USDG legs of each wallet's transfers, matched by **contract address** (not symbol), so spoofed tokens can't inflate the numbers.

## License

MIT — fork it, ship it.
