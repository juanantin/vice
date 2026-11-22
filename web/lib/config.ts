// Static facts about VICE on Elysium: four districts, three reward tokens (VOLTA, SENT, VOID).
// $VICE launches on Volta paired with $VOLTA; its creator fee (in VOLTA) is the city tax.
// Contract addresses are filled in after the testnet deploy.

/** The game's name, ticker and words for a building. Change them here and the whole site follows.
 *  (The NFT's name "VICE" and symbol HIDEOUT are strings in src/ViceNFT.sol.) */
export const GAME = {
  name: "VICE",
  /** Shown as $TICKER. */
  ticker: "VICE",
  tagline: "Miami · on Volta",
  building: "hideout",
  buildings: "hideouts",
  /** Social handle of the in-game news account. */
  news: "@vice.news",
  /** The official X account (linked in the header). */
  x: "https://x.com/playcityvice",
  xHandle: "@playcityvice",
};
export const TICKER = `$${GAME.ticker}`;

/** A district on the map. A district sets a building's plot, its team in the weekly street race
 *  and the token it earns (Wynwood's is picked by the weekly vote). */
export type DistrictId = 0 | 1 | 2 | 3;

export interface District {
  id: DistrictId;
  city: string;
  place: "brickell" | "downtown" | "wynwood" | "miamibeach";
  landmark: string;
  colour: string; // main colour
  light: string;
  dark: string;
  styles: [string, string, string];
  /** The token this district's buildings earn, or "vote": the token the weekly vote picks. */
  earns: TokenId | "vote";
  /** The district's crew and its social handle. */
  crew: string;
  handle: string;
}

// Suggested token per district (one deploy value, `cityTokens`): Downtown VOLTA, Brickell SENT,
// Miami Beach VOID, Wynwood follows the weekly vote. Index order matches the contracts.
export const DISTRICTS: District[] = [
  { id: 0, city: "Brickell", crew: "Los Banqueros", handle: "@banqueros.brickell", place: "brickell", earns: 1, landmark: "Glass towers", colour: "#f5c451", light: "#3d3420", dark: "#a87a12", styles: ["Glass Tower", "Bank Tower", "Pool Condo"] },
  { id: 1, city: "Downtown", crew: "Bayfront Royals", handle: "@royals.downtown", place: "downtown", earns: 0, landmark: "Freedom Tower", colour: "#ff8a4c", light: "#3d2a1f", dark: "#c2541f", styles: ["Skyscraper", "Deco Office", "Bayside Hotel"] },
  { id: 2, city: "Wynwood", crew: "Los Muralistas", handle: "@muralistas.wynwood", place: "wynwood", earns: "vote", landmark: "Mural walls", colour: "#b8f04a", light: "#2c3a1a", dark: "#5a8a10", styles: ["Loft Tower", "Mural Warehouse", "Gallery"] },
  { id: 3, city: "Miami Beach", crew: "Los Flamingos", handle: "@flamingos.beach", place: "miamibeach", earns: 2, landmark: "Ocean Drive", colour: "#3fd9f5", light: "#163640", dark: "#0f86a3", styles: ["Oceanfront Condo", "Deco Hotel", "Beach House"] },
];

/** Contract value for a city that follows the weekly vote (ViceVault.FOLLOWS_VOTE). */
export const FOLLOWS_VOTE = 254;

/** The token district `d` earns while `current` is the vote's pick. */
export function cityToken(d: District, current: TokenId): TokenId {
  return d.earns === "vote" ? current : d.earns;
}

/** The districts that follow the weekly vote (Wynwood). */
export const VOTE_CITIES = () => DISTRICTS.filter((d) => d.earns === "vote");

/** A reward token. Each district earns one; the weekly vote picks Wynwood's. */
export type TokenId = 0 | 1 | 2;

export interface RewardToken {
  id: TokenId;
  token: string;
  symbol: string;
  colour: string;
  /** Darker ink for the light theme. */
  colourLight: string;
  tokenAddress: `0x${string}`;
}

export const TOKENS: RewardToken[] = [
  { id: 0, token: "VOLTA", symbol: "VOLTA", colour: "#80e3ba", colourLight: "#08704b", tokenAddress: "0x0f79931689Af199e7CF868ed1107bBA2C83c68f7" },
  { id: 1, token: "SENT", symbol: "SENT", colour: "#e0a35f", colourLight: "#a8621a", tokenAddress: "0xA713a15b85Cab304F9e2fbc649440B5e3AB8a8D4" },
  { id: 2, token: "VOID", symbol: "VOID", colour: "#b59ce8", colourLight: "#7a52b8", tokenAddress: "0xD31B21Cb80E431AC996269deC31A40fCf048B77f" },
];

export const MAX_BUILDINGS = 3000;
export const EARLY_BIRD_UNITS = 300;
export const EARLY_BIRD_USD = 40;
export const TIERS = [
  { upTo: 800, usd: 52 },
  { upTo: 1500, usd: 68 },
  { upTo: 2300, usd: 88 },
  { upTo: 3000, usd: 120 },
];

/** The real city, filled in after the launch (the launch page prints both addresses). While
 *  `vault` is null the site shows the preview with sample data. */
export const LIVE: { vault: `0x${string}` | null; vice: `0x${string}` | null } = {
  vault: null,
  vice: null,
};
/** The $VTEST rehearsal city (Nov 2026), still running on Elysium. Open it with
 *  vicetoken.city/?city=rehearsal. The keeper tends it until LIVE.vault is set. */
export const REHEARSAL = {
  vault: "0x5840306E5A03dfFc8c247AEC70484d7754B381f8" as `0x${string}`,
  vice: "0x1f7Efa7f66EEcf76f5f1d102fc8BFe0dbb3C3374" as `0x${string}`,
};
export const VICE_ADDRESS = LIVE.vice;
/** The city tax is paid in the asset $VICE is paired with on Volta. */
export const INCOME = { symbol: "VOLTA", tokenAddress: "0x0f79931689Af199e7CF868ed1107bBA2C83c68f7" as `0x${string}` };
export const GAS_SYMBOL = "HYPE";
export const VOLTA_URL = "https://volta.family";

export function usdForBuilding(id: number, earlyBird: boolean): number {
  if (earlyBird && id <= EARLY_BIRD_UNITS) return EARLY_BIRD_USD;
  return (TIERS.find((t) => id <= t.upTo) ?? TIERS[TIERS.length - 1]).usd;
}

/** L1 $0, L2 $5, L3 $20, L4 $50, L5 $100, then +1 per extra $50 (same rule as the vault). */
export function levelForUsd(usd: number): number {
  if (usd < 5) return 1;
  if (usd < 20) return 2;
  if (usd < 50) return 3;
  if (usd < 100) return 4;
  return 5 + Math.floor((usd - 100) / 50);
}

export function usdForNextLevel(level: number): number {
  return [0, 5, 20, 50, 100][level] ?? 100 + (level - 4) * 50;
}
