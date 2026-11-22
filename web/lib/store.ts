// Preview ("unplugged") city state. Everything here is made-up sample data that behaves like
// the real contracts, so the screens and the map can be designed before the testnet deploy.
// When the contracts are live, this file is replaced by reads from Elysium via wagmi/viem.

import { useSyncExternalStore } from "react";
import { DISTRICTS, DistrictId, MAX_BUILDINGS, TOKENS, TokenId, cityToken, levelForUsd, usdForBuilding } from "./config";
import { nextDeadline } from "./romeTime";

export const YOU = "you";

/** Plain UI flags shared with the map (no re-render needed). */
export const ui = { panelOpen: false };

export interface Building {
  id: number;
  district: DistrictId;
  style: 0 | 1 | 2;
  plot: number;
  owner: string;
  inviter: number;
  invites: number;
  earlyBird: boolean;
  claimedUsd: number;
  pendingUsd: number;
  /** Claimable amount of each reward token (VOLTA, SENT, VOID), in whole tokens. */
  pendingTokens: number[];
  votedWeek: number; // week number it last voted in, -1 never
  builtAt: number;
}

export interface Purchase {
  at: number;
  token: TokenId;
  amount: number; // income spent (VOLTA)
  tokens: number;
  usd: number;
}

export type Mode = "preview" | "testnet";

/** Live data only available when connected to a deployed test city. */
export interface ChainInfo {
  vault: `0x${string}`;
  nft: `0x${string}`;
  pricing: `0x${string}`;
  vice: `0x${string}`;
  oracle: `0x${string}`;
  adapter: `0x${string}`;
  tokens: `0x${string}`[];
  gasBalance: number;
  vaultIncome: number;
  allowance: bigint;
  viceWei: bigint;
  quote: { id: number; usd: number; tokens: number; tokensWei: bigint } | null;
  quoteError: string | null;
  isEarlyBird: boolean;
  earlyBirdEnd: number;
  earlyBirdFinalized: boolean;
  pausedUntil: number;
  lastBuyAt: number;
  schedulerActive: boolean;
  minOrder: number;
  maxOrder: number;
  minInterval: number;
  oracleOwner: string;
  adapterQuality: number;
  blockTime: number;
}

export interface ChainActions {
  approve: () => Promise<void>;
  build: (district: DistrictId, style: 0 | 1 | 2, inviter: number, maxTokensWei: bigint) => Promise<number | null>;
  claim: (ids: number[]) => Promise<void>;
  vote: (ids: number[], token: TokenId) => Promise<void>;
  send: (id: number, to: string) => Promise<void>;
}

export interface CityState {
  mode: Mode;
  /** The player: "you" in preview, the connected wallet address on testnet. */
  me: string;
  chain: ChainInfo | null;
  buildings: Building[];
  districtCount: number[];
  week: number;
  weekEnd: number;
  currentToken: TokenId;
  votes: number[];
  newBuilds: number[];
  totalTax: number;
  totalPurchases: number;
  totalBoughtUsd: number;
  purchases: Purchase[];
  residentsFunds: number;
  streetFunds: number;
  opsFunds: number;
  opsPaid: number;
  holdings: number[];
  incomeUsd: number;
  viceUsd: number;
  tokenUsd: number[];
  approved: boolean;
  viceBalance: number;
  live: boolean;
}

export type CityEvent =
  | { type: "built"; building: Building }
  | { type: "levelUp"; building: Building; from: number }
  | { type: "invited"; building: Building }
  | { type: "focus"; id: number }
  | { type: "bought"; token: TokenId; tokens: number; usd: number; buildings: number }
  | { type: "voted"; token: TokenId; count: number; district: number | null }
  | { type: "taxIn"; amount: number }
  | { type: "weekClosed"; token: TokenId; winners: number[] }
  /** Live city, first load: recent real history for the feed (oldest first, with times). */
  | { type: "history"; events: { at: number; event: CityEvent }[] };

// ─────────── deterministic sample data ───────────

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["0x7a3…91c", "0x1fe…b20", "0xc04…7d1", "0x9bb…e03", "0x44d…a8f", "0x02c…5e7", "0xd1a…0c4"];

function makeInitial(): CityState {
  const r = rng(20261022);
  const now = Math.floor(Date.now() / 1000);
  const weekEnd = nextDeadline(now);
  const buildings: Building[] = [];
  const districtCount = DISTRICTS.map(() => 0);
  const weights = [0.3, 0.32, 0.2, 0.18];
  const total = 1247;
  for (let id = 1; id <= total; id++) {
    let x = r();
    let d = 0 as DistrictId;
    for (let k = 0; k < DISTRICTS.length; k++) {
      if (x < weights[k]) {
        d = k as DistrictId;
        break;
      }
      x -= weights[k];
    }
    const age = (total - id) / total; // 1 = oldest
    const roll = r();
    const claimed = roll < 0.55 ? r() * 6 * (0.3 + age) : roll < 0.85 ? 5 + r() * 45 * age : roll < 0.97 ? 50 + r() * 150 * age : 150 + r() * 600;
    const owner = id % 97 === 5 || id === 1203 ? YOU : NAMES[Math.floor(r() * NAMES.length)];
    buildings.push({
      id,
      district: d,
      style: Math.floor(r() * 3) as 0 | 1 | 2,
      plot: districtCount[d]++,
      owner,
      inviter: 0,
      invites: 0,
      earlyBird: id <= 300,
      claimedUsd: Math.round(claimed * 100) / 100,
      pendingUsd: Math.round(r() * 12 * (0.3 + age) * 100) / 100,
      pendingTokens: [],
      votedWeek: r() < 0.35 ? 0 : -1,
      builtAt: now - Math.floor(age * 30 * 86400),
    });
  }
  // Each district earns its own token; Wynwood (the vote district) has earned all three over past weeks.
  const sampleUsd = [0.00059, 0.00005, 0.000135];
  for (const b of buildings) {
    const earns = DISTRICTS[b.district].earns;
    const mix = earns === "vote" ? [0.5, 0.3, 0.2] : TOKENS.map((t) => (t.id === earns ? 1 : 0));
    b.pendingTokens = mix.map((w, t) => (b.pendingUsd * w) / sampleUsd[t]);
  }

  // A few well-connected inviters (fireworks).
  for (let k = 0; k < 160; k++) {
    const invitee = buildings[Math.floor(r() * total)];
    const inviter = buildings[Math.floor(r() * Math.min(invitee.id - 1, 400))];
    if (!inviter || inviter.id >= invitee.id) continue;
    invitee.inviter = inviter.id;
    inviter.invites += 1;
  }
  const votes = TOKENS.map(() => 0);
  for (const b of buildings) if (b.votedWeek === 0) votes[r() < 0.45 ? 0 : r() < 0.6 ? 1 : 2]++;
  const purchases: Purchase[] = [];
  for (let k = 0; k < 12; k++) {
    const amount = 60_000 + r() * 240_000;
    const t = (k % 3) as TokenId;
    purchases.push({ at: now - k * 3600 - Math.floor(r() * 1800), token: t, amount, tokens: 0, usd: amount * 0.00059 });
  }
  return {
    mode: "preview",
    me: YOU,
    chain: null,
    buildings,
    districtCount,
    week: 0,
    weekEnd,
    currentToken: 0,
    votes,
    newBuilds: [41, 38, 22, 29],
    totalTax: 18_240_000,
    totalPurchases: 212,
    totalBoughtUsd: 9_150,
    purchases,
    residentsFunds: 141_200,
    streetFunds: 30_250,
    opsFunds: 36_100,
    opsPaid: 2_700_000,
    holdings: [9_120_000, 61_400_000, 18_900_000],
    incomeUsd: 0.00059,
    viceUsd: 0.0000412,
    tokenUsd: [0.00059, 0.00005, 0.000135],
    approved: false,
    viceBalance: 9_000_000,
    live: true,
  };
}

// ─────────── tiny external store ───────────

let state: CityState | null = null;
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: CityEvent) => void>();

function get(): CityState {
  if (!state) state = makeInitial();
  return state;
}

function set(patch: Partial<CityState>) {
  state = { ...get(), ...patch };
  listeners.forEach((l) => l());
}

function emit(e: CityEvent) {
  eventListeners.forEach((l) => l(e));
}

export function useCity(): CityState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    get,
  );
}

export function getCity(): CityState {
  return get();
}

let previewState: CityState | null = null;
let chainActions: ChainActions | null = null;

export function registerChain(actions: ChainActions) {
  chainActions = actions;
}

/** Switch between sample data and a deployed test city (whose state chain.ts then pushes in). */
export function setMode(mode: Mode) {
  const s = get();
  if (s.mode === mode) return;
  if (mode === "testnet") {
    previewState = s;
    // Start from a blank city: nothing from the sample data may show while the chain loads.
    const zeros = <T,>(arr: readonly T[]) => arr.map(() => 0) as unknown;
    state = {
      ...s,
      mode,
      live: false,
      chain: null,
      buildings: [],
      districtCount: DISTRICTS.map(() => 0) as CityState["districtCount"],
      newBuilds: zeros(s.newBuilds) as CityState["newBuilds"],
      votes: zeros(s.votes) as CityState["votes"],
      holdings: zeros(s.holdings) as CityState["holdings"],
      purchases: [],
      totalTax: 0,
      totalPurchases: 0,
      totalBoughtUsd: 0,
      residentsFunds: 0,
      streetFunds: 0,
      opsFunds: 0,
      opsPaid: 0,
      me: "",
    };
  } else {
    state = previewState ?? makeInitial();
  }
  listeners.forEach((l) => l());
}

/** Replace the city with state read from the chain (testnet mode only). */
export function setChainState(next: Partial<CityState>) {
  if (get().mode !== "testnet") return;
  set(next);
}

/** Announce a city event from outside the store (e.g. a purchase seen on chain). */
export function announce(e: CityEvent) {
  emit(e);
}

export function onCityEvent(l: (e: CityEvent) => void): () => void {
  eventListeners.add(l);
  return () => eventListeners.delete(l);
}

// ─────────── actions (simulated transactions) ───────────

export function quoteBuild(): { id: number; usd: number; tokens: number } {
  const s = get();
  if (s.mode === "testnet") {
    const q = s.chain?.quote;
    return q ? { id: q.id, usd: q.usd, tokens: q.tokens } : { id: s.buildings.length + 1, usd: 0, tokens: 0 };
  }
  const id = s.buildings.length + 1;
  const usd = usdForBuilding(id, false);
  return { id, usd, tokens: Math.ceil(usd / s.viceUsd) };
}

export async function approve() {
  if (get().mode === "testnet") return chainActions?.approve();
  set({ approved: true });
}

/** Build for the player. Returns the new building number. */
export async function buildMine(district: DistrictId, style: 0 | 1 | 2, inviter: number, maxTokensWei: bigint): Promise<number | null> {
  const s = get();
  if (s.mode === "testnet") return chainActions ? chainActions.build(district, style, inviter, maxTokensWei) : null;
  return build(s.me, district, style, inviter)?.id ?? null;
}

export function build(owner: string, district: DistrictId, style: 0 | 1 | 2, inviter: number): Building | null {
  const s = get();
  if (s.buildings.length >= MAX_BUILDINGS) return null;
  const q = quoteBuild();
  const districtCount = [...s.districtCount] as CityState["districtCount"];
  const buildings = [...s.buildings];
  const b: Building = {
    id: q.id,
    district,
    style,
    plot: districtCount[district]++,
    owner,
    inviter: 0,
    invites: 0,
    earlyBird: false,
    claimedUsd: 0,
    pendingUsd: 0,
    pendingTokens: TOKENS.map(() => 0),
    votedWeek: -1,
    builtAt: Math.floor(Date.now() / 1000),
  };
  let inviterB: Building | undefined;
  if (inviter > 0 && inviter < b.id) {
    const i = buildings[inviter - 1];
    if (i && i.owner !== owner) {
      b.inviter = inviter;
      inviterB = { ...i, invites: i.invites + 1 };
      buildings[inviter - 1] = inviterB;
    }
  }
  buildings.push(b);
  const newBuilds = [...s.newBuilds] as CityState["newBuilds"];
  newBuilds[district]++;
  set({
    buildings,
    districtCount,
    newBuilds,
    viceBalance: owner === YOU ? s.viceBalance - q.tokens : s.viceBalance,
  });
  emit({ type: "built", building: b });
  if (inviterB) emit({ type: "invited", building: inviterB });
  return b;
}

/** Give a hideout to another wallet. Its pending rewards, height and this week's vote go with it. */
export async function sendHideout(id: number, to: string) {
  if (get().mode === "testnet") return chainActions?.send(id, to);
  const buildings = [...get().buildings];
  const b = buildings[id - 1];
  if (b) buildings[id - 1] = { ...b, owner: to.toLowerCase() };
  set({ buildings });
}

export async function claim(ids: number[]) {
  if (get().mode === "testnet") return chainActions?.claim(ids);
  const s = get();
  const buildings = [...s.buildings];
  for (const id of ids) {
    const b = buildings[id - 1];
    if (!b || b.pendingUsd <= 0) continue;
    const from = levelForUsd(b.claimedUsd);
    const nb = { ...b, claimedUsd: b.claimedUsd + b.pendingUsd, pendingUsd: 0, pendingTokens: TOKENS.map(() => 0) };
    buildings[id - 1] = nb;
    if (levelForUsd(nb.claimedUsd) > from) queueMicrotask(() => emit({ type: "levelUp", building: nb, from }));
  }
  set({ buildings });
}

export async function vote(ids: number[], token: TokenId) {
  if (get().mode === "testnet") return chainActions?.vote(ids, token);
  const s = get();
  const buildings = [...s.buildings];
  const votes = [...s.votes] as CityState["votes"];
  for (const id of ids) {
    const b = buildings[id - 1];
    if (!b || b.votedWeek === s.week) continue;
    buildings[id - 1] = { ...b, votedWeek: s.week };
    votes[token]++;
  }
  set({ buildings, votes });
}

export function focus(id: number) {
  emit({ type: "focus", id });
}

export function setLive(live: boolean) {
  set({ live });
}

/** Settles the week in the preview when the countdown reaches zero. */
export function settleIfDue(now: number) {
  const s = get();
  if (s.mode !== "preview") return;
  if (now < s.weekEnd) return;
  let best = 0;
  let idx = s.currentToken;
  let tie = false;
  s.votes.forEach((v, i) => {
    if (v > best) {
      best = v;
      idx = i as TokenId;
      tie = false;
    } else if (v === best && v > 0) tie = true;
  });
  set({
    week: s.week + 1,
    weekEnd: nextDeadline(now),
    currentToken: best > 0 && !tie ? idx : s.currentToken,
    votes: TOKENS.map(() => 0),
    newBuilds: DISTRICTS.map(() => 0),
  });
}

/** Preview life: other residents keep building, buys happen, rewards accrue, some level up. */
export function tick() {
  const s = get();
  if (s.mode !== "preview" || !s.live) return;
  const r = Math.random();
  if (r < 0.45 && s.buildings.length < MAX_BUILDINGS) {
    const d = Math.floor(Math.random() * DISTRICTS.length) as DistrictId;
    const inviter = Math.random() < 0.35 ? 1 + Math.floor(Math.random() * Math.min(400, s.buildings.length)) : 0;
    build(NAMES[Math.floor(Math.random() * NAMES.length)], d, Math.floor(Math.random() * 3) as 0 | 1 | 2, inviter);
  } else if (r < 0.75) {
    // Another owner claims and grows a floor.
    const pick = s.buildings[Math.floor(Math.random() * s.buildings.length)];
    if (pick && pick.owner !== s.me) {
      const buildings = [...s.buildings];
      const from = levelForUsd(pick.claimedUsd);
      const nb = { ...pick, claimedUsd: Math.max(pick.claimedUsd, [5, 20, 50, 100][from - 1] ?? pick.claimedUsd + 50) };
      buildings[pick.id - 1] = nb;
      set({ buildings });
      if (levelForUsd(nb.claimedUsd) > from) emit({ type: "levelUp", building: nb, from });
    }
  } else {
    // An order: the residents' share is split across cities by building count (same value for
    // every building) and each city's part buys its own token; cities on one token share a swap.
    const amount = 60_000 + Math.random() * 240_000;
    const usd = amount * s.incomeUsd;
    const n = s.buildings.length || 1;
    const per = usd / n; // every building gets the same value
    const tokIn = TOKENS.map(() => 0); // USD bought per token
    const tokBuildings = TOKENS.map(() => 0);
    DISTRICTS.forEach((d) => {
      const t = cityToken(d, s.currentToken);
      tokIn[t] += per * s.districtCount[d.id];
      tokBuildings[t] += s.districtCount[d.id];
    });
    const buildings = s.buildings.map((b) => {
      const t = cityToken(DISTRICTS[b.district], s.currentToken);
      const pendingTokens = [...b.pendingTokens];
      pendingTokens[t] += per / s.tokenUsd[t];
      return { ...b, pendingUsd: Math.round((b.pendingUsd + per) * 100) / 100, pendingTokens };
    });
    const now = Math.floor(Date.now() / 1000);
    const bought = TOKENS.map((tk) => ({ t: tk.id, usd: tokIn[tk.id], tokens: tokIn[tk.id] / s.tokenUsd[tk.id] })).filter((x) => x.usd > 0);
    const purchases = [
      ...bought.map((x) => ({ at: now, token: x.t, amount: x.usd / s.incomeUsd, tokens: x.tokens, usd: x.usd })),
      ...s.purchases,
    ].slice(0, 30);
    const holdings = [...s.holdings] as CityState["holdings"];
    for (const x of bought) holdings[x.t] += x.tokens;
    set({
      buildings,
      purchases,
      holdings,
      totalPurchases: s.totalPurchases + bought.length,
      totalBoughtUsd: s.totalBoughtUsd + usd,
      totalTax: s.totalTax + amount / 0.7,
    });
    // Announce one token per order, rotating, so each city's buy shows on the map.
    const x = bought[s.totalPurchases % bought.length];
    if (x) emit({ type: "bought", token: x.t, tokens: x.tokens, usd: x.usd, buildings: tokBuildings[x.t] });
  }
}

export function districtOf(id: DistrictId) {
  return DISTRICTS[id];
}
