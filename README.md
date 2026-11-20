# VICE (on Volta / Elysium)

A neon Miami on Elysium: burn $VICE (launched on Volta, paired with $VOLTA) to open a
hideout in Brickell, Downtown, Wynwood or Miami Beach, earn a share of the purchases of VOLTA,
SENT and VOID, vote for next week's token, grow your building by claiming. The map is real
Miami (OpenStreetMap via Overture Maps). The Italy version lives in juanantin/capitale-volta;
the Base/STONKEX version in juanantin/capitale.
Replica of Stockopolis — see `CLAUDE.md` (brief), `docs/stockopolis-reference.md` (spec)
and `docs/DECISIONS.md` (how ambiguities were resolved).

## Contracts (`src/`)
| Contract | What it does |
|---|---|
| `ViceNFT` | Buildings (ERC-721 "HIDEOUT"), 3,000 + Mayor #0, burn-to-build |
| `VicePricing` | Early bird / tier USD prices, $VICE price rules |
| `ViceVault` | Tax split, buys, dividends, height, weekly vote, street race |
| `libraries/RomeTime` | Sunday 20:00 Rome deadline with daylight saving |

## Develop
```sh
forge build
forge test            # unit + fuzz + invariant tests
```
## Website preview (`web/`)
Next.js + PixiJS, unplugged (sample data; a hidden test lab deploys a test city).
Map data: `python3 scripts/fetch-miami.py` (refresh the OSM extract, optional) then
`node scripts/build-miami.mjs` (writes `lib/miami.json`).
```sh
cd web && npm install && npm run dev
```
On Vercel it deploys as-is: `vercel.json` builds `web/` and serves the static export (`web/out`).
No Root Directory setting needed (setting it to `web` also works).

Status: **not audited**. Do not deploy to mainnet without a professional audit.
