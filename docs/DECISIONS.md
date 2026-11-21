# Step 1 decisions (contracts + tests)

Where the Stockopolis white paper is ambiguous, this is how Capitale reads it.
Change any of these by asking Claude; none is hard to revisit before deployment.

## Contracts
- `CapitalePricing` — USD price per building and tokens to burn. Owner = 48h timelock.
- `CapitaleNFT` — the buildings ("Capitale" / PALAZZO). No owner powers, not upgradeable,
  no royalties. On-chain `tokenURI` (name, simple SVG, district, city, style, level,
  invites, plot, early bird). Enumerable, so wallets can list their buildings on-chain.
- `CapitaleVault` — tax split, buys, dividends, early-bird pool, height, weekly vote,
  street race, settlement. Not upgradeable. Owner = 48h timelock, limited to: oracle,
  swap adapters, buy parameters, ops address.
- `RomeTime` library — "Sunday 20:00 Rome" computed on-chain from the EU daylight-saving
  rule (18:00 UTC in summer, 19:00 UTC in winter). No keeper needed for the schedule.

## Interpretations
- **Early bird**: open 6h from `startTime`. If the 300 sell out sooner, building pauses
  until the 6h are over, then tier 1 opens. Unsold early-bird numbers are sold at tier 1.
- **Early-bird reference price**: drops are followed at once; a rise is adopted only after
  the price has stayed above the reference for 60s, and then at the lowest level seen
  during those 60s. The very first reading uses min(spot, TWAP).
- **Burn rounding**: tokens to burn are rounded up (never below the USD target).
- **Inviter 0 = no inviter** (so the Mayor cannot be named as inviter). Self-invites and
  unknown numbers are ignored, not rejected. Cosmetic only.
- **Buys are synchronous**: `requestBuy()` swaps in the same transaction through a
  whitelisted adapter, so "one order at a time" holds automatically. A fill below the
  oracle reference minus 4% is rejected: the ETH stays in the vault and buying pauses 6h.
  Only the downside is checked (getting more tokens than expected is not rejected).
- **`requestBuy()` never reverts on rules** (paused, too soon, below minimum); it returns
  false and emits `BuySkipped`. It always counts as "activity", which is how anyone
  restarts an idle keeper (`schedulerActive()` is false after 24h without a buy or request).
- **Purchase-time USD value** = ETH spent × ETH/USD at the moment of the buy. This drives
  `pendingUsd(id)` and the building height.
- **Early-bird pool**: residents' 70% of buys during the 6h window. When the window ends
  it is shared among early-bird buildings; if there are none, it goes to everyone.
  The street 15% keeps going to the weekly street pool during early bird.
- **Street ties**: the pool is split per building across all tied districts (a district
  with more buildings takes a larger total share).
- **Nobody to pay** (no buildings yet): residents' tokens wait in `carry`, street pools
  roll over to next week.
- **Settlement** catches up at most 52 missed weeks per call (call again for more).
- **WETH income** can be unwrapped by anyone with `unwrapWeth()`.
- **Ops address** can be changed through the timelock (so funds are not stuck if the
  multisig must be replaced). It only ever receives the 15% ops share.

## Default parameters (to be resized once the real fee income is known)
- Buy minimum 0.1 ETH, maximum 0.6 ETH per order, 10 min between orders,
  4% max deviation, 6h pause after a rejected order.

## Confirmed by Juan (22 Oct 2026)
- $CAPITALE is paired with **ETH** on Stonks Exchange (Stockopolis pairs with BNB); the
  creator fee reaches the vault in ETH.
- All four reward tokens trade on **Uniswap v4** on Base:
  - STOCKIFY (STFY) `0xC6405D7a226e1C18E559Be2F335F74C01Ad07bF5`
  - STONKEX `0x5ab000ff9B9FfE0349CE5ffA5fD86f217C3680F5`
  - DGUY `0xe34356dcd3d7bb991248f322e4ec31b5d60bc54e`
  - TEMU `0x3c573bdd88008c94f025e5023212f28e5f39744c`
  (still to verify on Basescan in step 2: pools, fee tiers, liquidity)

# Preview website (web/) decisions
- Unplugged preview: all numbers are sample data (`web/lib/store.ts`); swapped for live
  contract reads after the Base Sepolia deploy.
- Italy is rebuilt from Natural Earth geodata (`web/scripts/build-italy.mjs`), not the
  generated base map, so the coastline is exact.
- Districts own the land closest to their city. Inside a district, plot 1 is next to the
  city's landmark and plots grow outwards (the contract's plot number decides the spot).
- Height: ground floor + one floor per level above 1 + the style's roof. No cap.
- Art is drawn in code (vector shapes) until Juan's sprites are processed; Vercel runs
  `scripts/fetch-assets.mjs` before each build to download, clean and use them.

# Testnet (Base Sepolia)
- `src/testnet/TestKit.sol` (testnet only, never mainnet): free test $CAPITALE (`faucet()`),
  four test reward tokens, a hand-set price feed and a swap that fills at that price
  (with a "bad fill" switch to exercise the 4% rejection and 6h pause).
- The website's 🧪 Test lab deploys a whole city from the user's own wallet (6 confirmations):
  no private keys anywhere. The city is remembered by its vault address (`?city=0x…`).
- Test buy rules: min 0.001 ETH, max 0.01 ETH per order (real values come later).
- Early bird can be shortened for a test (10 min / 1 h / 6 h) by starting the sale earlier.
- The vault now takes its four swap routes in the constructor (no setAdapter calls at deploy).

# Two districts (Juan, 27 Oct 2026)
- Capitale has **two** districts: STOCKIFY (Milano, gold) and STONKEX (Roma, orange).
  DGUY/Napoli and TEMU/Venezia are dropped everywhere (contracts, tests, website, test lab),
  along with the Vesuvius and Campanile landmarks. This also removes the TEMU trademark risk.
- The NFT and vault take the district count at deploy (1–4), so a future city could be added
  in a new deployment without code changes. Capitale deploys with 2.
- With two cities, the land splits by nearest city: Milano owns the north, Roma the centre,
  the south, Sicily and Sardinia. The Mayor's palazzo stays in Tuscany, between them.
- Votes are now STOCKIFY vs STONKEX; ties (more likely with two) keep the current token.
- The earlier entries above that mention DGUY/TEMU or four tokens are superseded.

# Four cities, two tokens (Juan, 27 Oct 2026; replaces "Two districts" above)
- Four cities are back: Milano, Roma, Napoli, Venezia (with Vesuvius and the Campanile).
- Only two reward tokens: STOCKIFY and STONKEX. **Every city earns both**: the weekly vote
  picks which token the vault buys, and the residents' 70% is shared by all buildings in
  all cities. DGUY and TEMU stay dropped (no TEMU trademark risk).
- Cities and tokens are now independent in the vault: `districts` (cities, 4) and
  `tokenCount` (reward tokens, 2), both fixed at deploy. `votesOf` returns one entry per
  token; `newBuildsOf` one per city.
- The street race is between the four cities; the winning city's buildings share the 15%
  street pool, paid in that week's token.
- Map banners show the city (big) and its palazzi count; the street-race leader gets a
  "LEADING" tag. Token colours: STOCKIFY purple, STONKEX pink.

# Capitale on Volta / Elysium (13 Nov 2026) — this repo
- New instance in `juanantin/capitale-volta`; the Base/STONKEX version stays in `juanantin/capitale`.
- $CAPITALE launches on Volta paired with $VOLTA; the vault holds the creator NFT, so the
  creator share of the swap fee (paid in VOLTA) is the city tax. `collectCreatorFees()` pulls
  it from Volta's FeeEscrow; anyone can call it. The creator NFT can never leave the vault.
- Income is generic (any ERC-20 or the native coin). VOLTA is also a reward token: buying it
  is a 1:1 allocation with no swap, and `heldRewards` keeps tokens owed to buildings apart
  from fresh income. Swaps for SENT/VOID go through whitelisted adapters with an exact
  allowance that is reset after each swap.
- Rewards: VOLTA, SENT, VOID; 4 cities, all earning all three.
- Look: Volta's engraved-banknote style (see CLAUDE.md). The old toy sprites are not used.
- Test mode deploys on Elysium itself (no public testnet; gas costs a little real HYPE),
  with test tokens tVOLTA/tSENT/tVOID/tCAPITALE and a test fee escrow that simulates trading.

# Miami (20 Nov 2026) — this repo, `juanantin/vice`
- Fresh copy of the Volta/Elysium Capitale; the Italy version stays in `juanantin/capitale-volta`.
- Juan: "the map of Miami ... instead of cities make it Miami Beach, Brickell, Wynwood and Downtown."
- Map: real geography only. Land, the bay/ocean, rivers/lakes and the main roads/causeways come
  from OpenStreetMap via Overture Maps (open data on AWS S3; the usual OSM/Census/Natural Earth
  hosts are blocked by this environment's network policy). `web/scripts/fetch-miami.py` writes a
  small clipped extract (`web/scripts/data/miami-src.geojson`, committed), `build-miami.mjs`
  projects it with d3-geo into `web/lib/miami.json`. Attribution is shown on the map and in the
  white paper (ODbL). Nothing is traced or copied from any video game's map.
- Districts keep the old index order so tests and deploy values line up: 0 Brickell (SENT, was
  Milano), 1 Downtown (VOLTA, was Roma), 2 Wynwood (follows the vote, was Napoli), 3 Miami Beach
  (VOID, was Venezia). Suggested mapping, Juan may change it (`cityTokens` at deploy, `earns` in
  `web/lib/config.ts`).
- The Mayor's building (#0) stands on Watson Island, between the mainland and the beach.
  Fisher Island, Virginia Key, Key Biscayne and PortMiami are scenery (palms, lighthouse,
  cruise ships), not plots.
- Contract logic unchanged. CapitaleNFT's tokenURI strings now say Brickell / Downtown / Wynwood /
  Miami Beach, "THE MAYOR", "Watson Island", trait "District", and Miami colours.
- The weekly deadline stays Sunday 20:00 Rome time in the contracts (RomeTime); the site shows
  it in Miami time (2 PM most weeks). Moving it to a Miami time needs a new US-DST library.
- Game name/ticker still Capitale / $CAPITALE / PALAZZO, pending Juan. The site reads them from
  `GAME` in `web/lib/config.ts` (one place); the NFT name/symbol are strings in CapitaleNFT.

# Name: VICE (Juan, 20 Nov 2026)
- The game is VICE, token $VICE (was Capitale / $CAPITALE). Contracts renamed ViceNFT,
  VicePricing, ViceVault (+ interfaces IVice*); NFT name "VICE", symbol HIDEOUT (was PALAZZO,
  an Italian word). Test tokens tVICE etc. Entries above keep the old names as history.
- Never extend the name to "Vice City" or use anything from Rockstar's games.

# Ready for the real launch (21 Nov 2026)
- Juan: launch without an audit ("I assume the risk").
- Oracle: Volta pools only. 10-minute TWAP (Volta's Oracle window) instead of the spec's
  30-60 min. HYPE/USD via a stored reference (poke ≥5 min apart, ±2% per step) so flash
  manipulation of the HYPE/USDC pool can't move build prices.
- The vault's reference price for a reward token includes Volta's swap fees on the route
  (2% VOLTA→SENT; ~3% VOLTA→HYPE→VOID today), so the 4% band is for slippage/impact only.
- Fix: requestBuy forwards a fixed 3M gas budget to the order and reverts (NotEnoughGas) if the
  caller sends less, instead of treating an out-of-gas as a rejected order (6h pause).
- Launch order: $VICE on Volta with a scheduled opening; deploy + wire the city; creator NFT to
  the vault before trading opens; pricing hands ownership to the 48h timelock (accepted after
  48h); the vault is owned by the timelock from deployment.
- Default buy sizes: $20 minimum, $150 maximum per order (converted to VOLTA at deploy).
