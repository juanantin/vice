# VICE MIAMI on VOLTA (Elysium) — project brief for Claude Code

This repo (`juanantin/vice`) is the **Miami** instance of VICE on Volta / Elysium. It
started as a copy of `juanantin/capitale-volta` (the **Italy** version: Milano, Roma, Napoli,
Venezia), which is separate and must stay untouched: never push there. The Base / STONKEX
version lives in `juanantin/capitale`. Do not merge them.

VICE is a replica of **Stockopolis ("Stock City")**. Here the map is **Miami** and the four
districts are **Brickell, Downtown, Wynwood and Miami Beach**. It runs on **Elysium** (chain id
99901, gas in HYPE) and launches on **Volta** (volta.family), a Uniswap v4 launchpad. The
owner, Juan, is an animation director with little Solidity experience: work autonomously,
explain decisions in plain language, and ask only when a decision is genuinely his.

**The spec is `docs/stockopolis-reference.md`. Copy every mechanic in it.** This brief
only lists what changes. When in doubt, do what Stockopolis does. `docs/DECISIONS.md` logs how
ambiguities were resolved (latest entry: Miami).

## Name (decided by Juan, Nov 2026)
The game is **VICE**, token **$VICE**, NFT name "VICE", symbol HIDEOUT. Never extend it to
"Vice City" or anything else from Rockstar's games (names, logos, fonts, characters). On the site the name lives in one place: `GAME` in `web/lib/config.ts` (name, ticker,
tagline, the word for a building, news handle). The NFT's name/symbol and "VICE #" are
strings in `src/ViceNFT.sol` (change them before deploy, then re-export the bytecode).

## What changes vs Stockopolis
| Stockopolis (BNB Chain) | VICE on Volta (Elysium) |
|---|---|
| BNB | $VOLTA is the city's income asset; gas is HYPE |
| Flap tax token, 1% buy + 1% sell | $VICE launched on Volta paired with $VOLTA. Volta: swap fee 1–5% (chosen at launch), 70% to the launch's split, 30% to Volta. VICE sends 100% of its split to the creator; the vault holds the creator NFT, so the creator share (in VOLTA) is the city tax |
| Flap VaultEx + Flap scheduled service | Vault pulls fees from Volta's FeeEscrow (`collectCreatorFees`, anyone) + whitelisted swap adapters + keeper bot with the same rules |
| 4 stock tokens | 3 reward tokens: VOLTA, SENT, VOID. Buying VOLTA = keep it 1:1, no swap |
| 4 Chinese-named streets, one stock each | 4 Miami districts (table below), one token each; Wynwood's is the weekly vote's pick |
| Chainlink / DEX average reference price | Volta's pool TWAPs (Oracle `twapTick`) and price calculators |
| Beijing time weekly deadline | Sunday 20:00 Rome time in the contracts (kept from the Italy version; shown on the site in Miami time, 2 PM most weeks). Moving it to Miami time needs a US-DST library: Juan's call |

## Elysium / Volta facts (from volta.family/docs, verify before mainnet)
- Chain id 99901, RPC https://rpc.elysium.kinetiq.xyz (Volta's: rpc.volta.family), explorer https://elysium.kinetiq.xyz
- $VOLTA 0x0f79931689Af199e7CF868ed1107bBA2C83c68f7 · SENT 0xA713a15b85Cab304F9e2fbc649440B5e3AB8a8D4 · VOID 0xD31B21Cb80E431AC996269deC31A40fCf048B77f (all 18 decimals)
- Volta PositionManager 0x3aB88DDc3CF2A012af88B60828edb4553697E5dC, Creator NFT 0xac466Ee5CEdD012eB750DBDA0B935F8B997402c7, FeeEscrow 0x3D36Beb546E451584736957F97E7EE9D2aCbD9a5 (`withdrawFees(token, recipient, unwrap)`), Oracle 0xa2A5eBE297a141160ca5c513c74fD43cB2c09B2e, UniversalRouter 0xA13f7611115752DEB2B13813BDDE16A5073e4b45, V4Quoter 0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5
- SENT trades mainly on the VOLTA/SENT Volta pool (~$13k liquidity, Nov 2026): keep orders small (≲ $100) or the 4% check rejects them. VOID trades against HYPE (~$37k).

## Districts
Index order matches the contracts and tests (it is the Italy order, renamed), so deploy values
and tests line up. The token mapping is a suggestion Juan may change (`cityTokens` at deploy,
`earns` in `web/lib/config.ts`; no code change).

| # | District | Was | Ink | Landmark (original drawing) | Crew · handle | Earns |
|---|---|---|---|---|---|---|
| 0 | Brickell | Milano | gold #f5c451 | glass towers + sky bridge | Los Banqueros · @banqueros.brickell | SENT |
| 1 | Downtown | Roma | orange #ff8a4c | Freedom-Tower-style tower + arena | Bayfront Royals · @royals.downtown | VOLTA |
| 2 | Wynwood | Napoli | lime #b8f04a | mural warehouses + water tower | Los Muralistas · @muralistas.wynwood | the weekly vote's pick |
| 3 | Miami Beach | Venezia | cyan #3fd9f5 | Art Deco hotel + lifeguard tower + palms | Los Flamingos · @flamingos.beach | VOID |

Building styles (3 per district, permanent): Brickell Glass Tower / Bank Tower / Pool Condo;
Downtown Skyscraper / Deco Office / Bayside Hotel; Wynwood Loft Tower / Mural Warehouse /
Gallery; Miami Beach Oceanfront Condo / Deco Hotel / Beach House. Drawn as tower, Art Deco
block, low-rise with rooftop pool, tinted per district.
The Mayor's building (#0) is a civic Art Deco hall on **Watson Island**, between the mainland
and the beach. Fisher Island, Virginia Key, Key Biscayne (Cape Florida lighthouse) and
PortMiami (cruise ships) are scenery, never plots.
Each order splits the residents' share across districts by building count (same value per
building) and buys each district's token (districts on one token share a swap). The street
share waits in VOLTA until the deadline names the winner, then is bought in the winner's
token. Banner: district name BIG, crew, hideout count, the token chip ("vote" + token for
Wynwood); the turf-race leader gets a "TURF LEADER" tag; Wynwood's current token is in the
stats bar. The contracts take the district count, the token list and the token per district
at deploy (max 4 each).

## The map (real Miami, never a game's map)
- Source: OpenStreetMap via **Overture Maps** (open data on AWS S3, ODbL). OSM / Census /
  Natural Earth / Miami-Dade hosts are blocked by this environment's network policy; S3 and
  npm are reachable. `web/scripts/fetch-miami.py` (pyarrow + shapely) writes a small clipped
  extract, `web/scripts/data/miami-src.geojson` (committed). `web/scripts/build-miami.mjs`
  projects it with d3-geo (Mercator) into `web/lib/miami.json`: land rings, water (Miami River,
  canals, lakes, marinas, enclosed bays), roads by class (motorway/trunk glow cyan, primary/
  secondary pink at night; white at golden hour), district anchors, Mayor, port, lighthouse,
  water and neighbourhood labels.
- Playable area: lon -80.226…-80.104, lat 25.662…25.858 (Wynwood/Little Haiti to Key
  Biscayne). Land beyond it is drawn dimmed. The camera opens on the four districts and can
  zoom out to the whole map.
- Attribution "© OpenStreetMap contributors · Overture Maps" is on the map and in the white
  paper. Keep it.
- Never trace, copy or imitate a video game's map, map art, logos, fonts, characters, names
  (no "Vice City", no "Leonida") or catchphrases. Real Miami place names are fine.

## Mechanics to implement (from the reference, with VICE values)
- **Tax:** 100% of the vault's fee income: 70% buys each district's token for its residents,
  15% for the weekly street pool (bought in the winner's token after the deadline), 15%
  stays in VOLTA for operations (2-of-3 multisig).
- **Buying:** accumulate, buy at a minimum order size, cap per order, one order at a time,
  minimum interval, price check against the reference with a max deviation (Stockopolis:
  0.5 BNB / 3 BNB / 10 min / 4% / 6h pause / 24h idle pause). Scale the ETH thresholds to
  similar USD values (in VOLTA, sized to each pool's liquidity) and keep them as parameters. Anyone can call requestBuy().
- **Buildings (ViceNFT):** 3,000 + Mayor #0 at deploy; mint(district, style,
  inviter, maxPrice); 4 districts × 3 styles, permanent; burn to dead address; sequential
  numbers; plots per district nearest-to-farthest from the landmark; freely transferable;
  rewards and height follow the NFT; vote lock after transfer within the week; invite
  decorations only. Non-upgradeable. Name "VICE", symbol "HIDEOUT", no royalties.
  tokenURI returns name, image and attributes (District, Style, Level, Invites, Plot, Early bird).
- **Pricing (VicePricing):** early bird 300 units at 40 USD for 6h,
  then tiers 52 / 68 / 88 / 120 USD at #800 / #1500 / #2300 / #3000; tokens to burn =
  USD target / price; early-bird reference price (drops follow instantly, rises after 60s);
  afterwards the lower of spot and a 30-60 min TWAP; revert above the builder's max.
- **Dividends (ViceVault):** residents' share split equally across
  buildings existing at purchase time; early-bird pool shared among early-bird buildings
  when that period ends; claim / claimMany pay all tokens at once, skipping any that
  fail to transfer; pendingUsd(id).
- **Height:** cumulative claimed USD at purchase-time value; L1 $0, L2 $5, L3 $20, L4 $50,
  L5 $100, then +1 level per extra $50, no cap. Cosmetic only.
- **Weekly vote:** one vote per building per week (not Mayor), any district; vote(ids, token) /
  voteAll(token); most votes picks next week's token for the vote district (Wynwood); no votes
  or tie = unchanged.
- **Street competition (turf race):** the district with the most new buildings this week wins
  the 15% street pool, split among its buildings; ties share; nobody built = all built districts
  share; after 3,000 buildings, shared city-wide.
- **Settlement:** lazy settle() on the next vote/build/buy/claim after the deadline;
  anyone may call it; unspent tax rolls over.
- **Permissions:** no withdrawal backdoor; multisig only receives the 15% ops share;
  pricing/protection changes behind a 48h timelock; NFT not upgradeable; vault not upgradeable.

## Visual style: Miami night (main)
An original neon-Miami crime-caper look riding the open-world crime game trend, never a
third-party game's name, logo, fonts, characters or catchphrases. Night by default: navy bay,
violet land, hot-pink linework, cyan shoreline glow and expressways, warm lit windows, palms.
Golden hour as the light theme: teal bay, warm sand, cream stucco with plum outlines, white
roads, sunset haze. Crews per district (above), social feed "<GAME> Live" from real city
events, breaking-news ticker that turns into a "heat" siren while buying is paused, buys shown
as a tilted "score" card, tabs as phone apps, buildings called hideouts. Fonts: Anton (display),
Manrope (text), JetBrains Mono (labels). Rounded cards. Logo/app icon: a striped sunset over
the bay with a palm (`web/scripts/build-icon.mjs`). Money mechanics unchanged.
All map art is procedural PixiJS Graphics in `web/lib/art.ts` (palettes, buildings, landmarks,
palms, pastel houses, speedboats, cruise ships, lighthouse); `web/lib/scene.ts` draws the map.

## Assets
`assets/manifest.json` lists older generated pastel art from the Italy project; the site does
not use it (no `public/sprites`). New art, if any, should match the neon-Miami look above.

## Frontend
Copy the Stockopolis screens: token header (name, CA, "via Volta · Elysium"); city stats
(crew x/3000, total city tax, total purchases, Wynwood's token this week); the map with
pan/zoom; tabs Live, Move in, Hideout, Next job (vote), Most wanted (turf race + tallest),
The bank (treasury), Rulebook (white paper), The Mayor; build flow (district → style →
inviter number → approve once → build with max burn); My hideouts (pending USD, claim,
level, vote status). All text is HTML/SVG overlay. Next.js 16 static export + wagmi/viem +
PixiJS 8 + d3-geo. Must run smoothly on phones. Deployed on Vercel from `main` (root
`vercel.json` builds `web/`; this repo needs its own Vercel project).

## Build order (status)
1. Contracts + tests — done (117 unit/fuzz/invariant tests). `requestBuy` runs the order with a
   fixed 3M gas budget (BUY_GAS) so a low-gas caller can't trigger a rejection + 6h pause.
2. Price reading — done: `src/volta/ViceOracle.sol`. Walks each Volta token's pool chain to HYPE
   ($VICE→VOLTA→HYPE, SENT→VOLTA→HYPE, VOID→HYPE): spot from PoolManager slot0, TWAP from
   Volta's Oracle (`twapTick`, 10-minute window — the spec asked 30-60 min; Volta only offers
   10). HYPE/USD from Volta's USDC calculator through a stored reference, `poke()` every ≥5 min,
   ±2% per poke. `tokenUsd` includes the route's Volta swap fees (currentSwapFee) so the 4%
   check measures slippage only. No owner.
3. Swap adapter — done: `src/volta/VoltaSwapAdapter.sol`, straight on the v4 PoolManager
   (unlock callback), route derived from `PositionManager.poolKey`: VOLTA→SENT (1 hop),
   VOLTA→HYPE→VOID (2 hops). Wallet gas estimates for these swaps run low: send extra gas.
4. Keeper — done: `keeper/keeper.mjs` (viem) + `.github/workflows/keeper.yml` (every 15 min;
   secret KEEPER_PRIVATE_KEY, variable VICE_VAULT): poke, collectCreatorFees, settle,
   requestBuy (simulated first), payOps above $25.
5. Frontend — done: preview, test lab, live mode (`LIVE` in `web/lib/config.ts`), and the launch
   wizard at `/launch` (deploys everything from Juan's wallet, resumable, irreversible NFT step
   gated by typing SEND, "Check everything" read-back). `script/DeployCity.s.sol` is the CLI
   equivalent.
6. Verified against live Elysium state (fork tests `test/fork/`, run with
   `ELYSIUM_RPC=https://rpc.elysium.kinetiq.xyz forge test --match-path 'test/fork/*'`): oracle vs
   Volta's calculators, swaps within 0.5% of the fee-adjusted reference, a whole city with SENT
   as stand-in $VICE (creator NFT → vault, fees, builds, buys, claims, ops). Also an anvil fork
   rehearsal: launch page clicked through end to end (incl. the 48h finish), a hideout built
   through the UI in live mode, keeper runs (collect + buy). Juan chose not to audit.
7. Real launch: Juan follows `LAUNCH.md`. Never deploy or send funds for him.
   LAUNCHED 22 Nov 2026: $VICE 0x2868d6B29CD2c1F58787bd62388f3773c63AEEb4 (2% swap fee, 100%
   creator, trading opened 19:39 UTC), vault 0x15ef34322f22594589126c107d67128aff19fcb7, building
   opened 21:10 UTC (early bird to 03:10 UTC 23 Nov). The 48h Finish on /launch is still due.
   Until then `LIVE` is null and `PRELAUNCH` is true: the home page is an empty, closed city
   ("Opening soon", no sample data; build/vote/claim refuse). The $VTEST rehearsal city
   (`REHEARSAL` in config) stays at /?city=rehearsal and the keeper tends it until `LIVE.vault`
   is set. The keeper is started every 10 min by cron-job.org (GitHub's own schedule is unreliable).

## Toolchain notes (cloud sessions)
- Foundry from npm (`@foundry-rs/forge`) with a solc-js shim (`forge test --use <shim>`) when
  GitHub release downloads are blocked; OpenZeppelin v5.4.0 and forge-std are submodules
  (`git submodule update --init`). After contract changes: `forge build`, then
  `node web/scripts/export-contracts.mjs`.
- `npm run build` in `web/` may stop once with a Next.js security-upgrade notice; running it
  again completes. Ask Juan before running Next's upgrade command.
- Screenshots of the PixiJS map in Playwright: launch Chromium with
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.

## Open questions
- Launch day: $VICE swap fee and anti-snipe (Juan), ops wallet (Safe or plain), keeper wallet.
- Token per district: suggested Downtown VOLTA, Brickell SENT, Miami Beach VOID, Wynwood vote.
- Weekly deadline: keep Sunday 20:00 Rome, or move to a Miami time (contract change).
- Swap fee for $VICE on Volta (1–5%) and anti-snipe settings: Juan's call at launch.
- Buy sizes per token vs pool liquidity (SENT pool is thin).
- Hosting: import `juanantin/vice` as a new Vercel project; domain TBD.

## Rules
- Never ask for, print or store private keys or seed phrases. Use a gitignored `.env` or a
  browser/hardware wallet.
- Never deploy to mainnet or send real funds without Juan's explicit confirmation.
- Juan decided (Nov 2026) not to audit this token; he accepts the risk. Don't block on it, but
  keep saying plainly that contracts are unaudited.
- Invites stay cosmetic. Never add profit-sharing referrals.
- Never push to `juanantin/capitale-volta` or `juanantin/capitale` from this project.
