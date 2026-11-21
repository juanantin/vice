// Test mode: reads a deployed test city from Elysium into the store, and sends the
// player's transactions through their own wallet. No keys ever touch this code.

import { formatEther, formatUnits, parseEventLogs, type Address } from "viem";
import { getWalletClient, switchChain } from "@wagmi/core";
import { nftAbi, oracleAbi, pricingAbi, testAdapterAbi, testFeeEscrowAbi, testOracleAbi, testTokenAbi, vaultAbi } from "./abis";
import { CHAIN, publicClient, wagmiConfig } from "./wagmi";
import { DISTRICTS, LIVE, TOKENS, cityToken, type DistrictId, type TokenId } from "./config";
import { announce, getCity, registerChain, setChainState, type Building, type ChainInfo, type Purchase } from "./store";

const MAX = 2n ** 256n - 1n;
const num = (v: bigint, d = 18) => Number(formatUnits(v, d));

export interface CityAddresses {
  vault: Address;
  nft: Address;
  pricing: Address;
  vice: Address;
  oracle: Address;
  adapter: Address;
  tokens: Address[];
  districts: number;
  income: Address;
  feeEscrow: Address;
}

// ─────────── where the test city lives ───────────

const KEY = "vice.testCity";

/** True when the loaded city is the real, launched one. */
export function isLiveCity(vault: string | null | undefined) {
  return !!vault && !!LIVE.vault && vault.toLowerCase() === LIVE.vault.toLowerCase();
}

export function savedCity(): Address | null {
  try {
    const q = new URLSearchParams(window.location.search).get("city");
    if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) return q as Address;
    // After launch the real city is the default (a test city needs an explicit ?city= link).
    if (LIVE.vault) return LIVE.vault;
    const ls = window.localStorage.getItem(KEY);
    if (ls && /^0x[0-9a-fA-F]{40}$/.test(ls)) return ls as Address;
  } catch {
    /* storage blocked */
  }
  const env = process.env.NEXT_PUBLIC_TEST_CITY;
  return env && /^0x[0-9a-fA-F]{40}$/.test(env) ? (env as Address) : null;
}

export function rememberCity(vault: Address | null) {
  try {
    if (vault) window.localStorage.setItem(KEY, vault);
    else window.localStorage.removeItem(KEY);
    const url = new URL(window.location.href);
    if (vault) url.searchParams.set("city", vault);
    else url.searchParams.delete("city");
    window.history.replaceState(null, "", url);
  } catch {
    /* ignore */
  }
}

export async function resolveAddresses(vault: Address): Promise<CityAddresses> {
  const v = { address: vault, abi: vaultAbi } as const;
  const [n0, cities] = (await Promise.all([
    publicClient.readContract({ ...v, functionName: "tokenCount" }),
    publicClient.readContract({ ...v, functionName: "districts" }),
  ])).map(Number);
  const [nft, oracle, income, feeEscrow, adapter, ...tokens] = await Promise.all([
    publicClient.readContract({ ...v, functionName: "nft" }),
    publicClient.readContract({ ...v, functionName: "oracle" }),
    publicClient.readContract({ ...v, functionName: "income" }),
    publicClient.readContract({ ...v, functionName: "feeEscrow" }),
    publicClient.readContract({ ...v, functionName: "adapters", args: [0n] }),
    ...Array.from({ length: n0 }, (_, i) => publicClient.readContract({ ...v, functionName: "tokens", args: [BigInt(i)] })),
  ]);
  const n = { address: nft as Address, abi: nftAbi } as const;
  const [pricing, vice] = await Promise.all([
    publicClient.readContract({ ...n, functionName: "pricing" }),
    publicClient.readContract({ ...n, functionName: "vice" }),
  ]);
  return {
    vault,
    nft: nft as Address,
    pricing: pricing as Address,
    vice: vice as Address,
    oracle: oracle as Address,
    adapter: adapter as Address,
    tokens: tokens as Address[],
    districts: cities,
    income: income as Address,
    feeEscrow: feeEscrow as Address,
  };
}

// ─────────── reading the city ───────────

const buildingCache = new Map<number, { district: DistrictId; style: 0 | 1 | 2; plot: number; inviter: number; earlyBird: boolean; builtAt: number }>();

async function readCity(a: CityAddresses, me: Address | null) {
  const v = { address: a.vault, abi: vaultAbi } as const;
  const n = { address: a.nft, abi: nftAbi } as const;
  const p = { address: a.pricing, abi: pricingAbi } as const;
  const o = { address: a.oracle, abi: oracleAbi } as const;
  const c = { address: a.vice, abi: testTokenAbi } as const;
  const rv = <T>(fn: string, args: unknown[] = []) =>
    publicClient.readContract({ ...v, functionName: fn as never, args: args as never }) as Promise<T>;

  const [block, totalResidents, week, weekEnd, currentToken, totalTax, totalPurchases, totalBoughtUsd, rEth, sEth, oEth, pausedUntil, lastBuyAt, active, params, ebEnd, ebFinal, vaultIncome] =
    await Promise.all([
      publicClient.getBlock(),
      publicClient.readContract({ ...n, functionName: "totalResidents" }),
      rv<bigint>("week"),
      rv<bigint>("weekEnd"),
      rv<number>("currentToken"),
      rv<bigint>("totalTax"),
      rv<bigint>("totalPurchases"),
      rv<bigint>("totalBoughtUsd"),
      rv<bigint>("residentsFunds"),
      rv<bigint>("streetFunds"),
      rv<bigint>("opsFunds"),
      rv<bigint>("pausedUntil"),
      rv<bigint>("lastBuyAt"),
      rv<boolean>("schedulerActive"),
      rv<readonly [bigint, bigint, number, number, number]>("buyParams"),
      rv<bigint>("earlyBirdEnd"),
      rv<boolean>("earlyBirdFinalized"),
      publicClient.readContract({ address: a.income, abi: testTokenAbi, functionName: "balanceOf", args: [a.vault] }),
    ]);

  const N = Number(totalResidents);
  const nextId = N + 1;
  const [votes, newBuilds, incomeUsd, capUsd, isEB, oracleOwner, quality, ...rest] = await Promise.all([
    rv<readonly bigint[]>("votesOf", [week]),
    rv<readonly bigint[]>("newBuildsOf", [week]),
    publicClient.readContract({ ...o, functionName: "incomeUsd" }),
    publicClient.readContract({ ...o, functionName: "viceUsdSpot" }),
    publicClient.readContract({ ...p, functionName: "isEarlyBird" }),
    // Only the test oracle has an owner (the real one has none).
    publicClient.readContract({ address: a.oracle, abi: testOracleAbi, functionName: "owner" }).catch(() => "0x0000000000000000000000000000000000000000"),
    publicClient.readContract({ address: a.adapter, abi: testAdapterAbi, functionName: "qualityBps" }).catch(() => 10_000n),
    ...a.tokens.map((t) => publicClient.readContract({ ...o, functionName: "tokenUsd", args: [t] })),
    ...a.tokens.map((t) => publicClient.readContract({ address: t, abi: testTokenAbi, functionName: "balanceOf", args: [a.vault] })),
  ]);
  const nT = a.tokens.length;
  const tokenUsd = rest.slice(0, nT) as bigint[];
  const holdings = rest.slice(nT, 2 * nT) as bigint[];

  let quote: ChainInfo["quote"] = null;
  let quoteError: string | null = null;
  try {
    const [tok, usd] = (await publicClient.readContract({ ...p, functionName: "quote", args: [BigInt(nextId)] })) as readonly [bigint, bigint];
    quote = { id: nextId, usd: num(usd), tokens: num(tok), tokensWei: tok };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    quoteError = msg.includes("EarlyBirdSoldOut") ? "Early bird sold out: building reopens when the 6 hours end." : msg.includes("CityLocked") ? "The city is complete." : msg.includes("NotStarted") ? "Building has not started yet." : "Price unavailable right now.";
  }

  let gasBalance = 0n;
  let capWei = 0n;
  let allowance = 0n;
  if (me) {
    [gasBalance, capWei, allowance] = await Promise.all([
      publicClient.getBalance({ address: me }),
      publicClient.readContract({ ...c, functionName: "balanceOf", args: [me] }),
      publicClient.readContract({ ...c, functionName: "allowance", args: [me, a.nft] }),
    ]);
  }

  // Buildings: static facts once, live facts every poll.
  const missing = [];
  for (let id = 1; id <= N; id++) if (!buildingCache.has(id)) missing.push(id);
  const statics = await Promise.all(missing.map((id) => publicClient.readContract({ ...n, functionName: "buildingOf", args: [BigInt(id)] })));
  missing.forEach((id, i) => {
    const b = statics[i] as { district: number; style: number; earlyBird: boolean; plot: number; inviter: number; builtAt: bigint };
    buildingCache.set(id, { district: b.district as DistrictId, style: b.style as 0 | 1 | 2, plot: Number(b.plot), inviter: Number(b.inviter), earlyBird: b.earlyBird, builtAt: Number(b.builtAt) });
  });
  const ids = Array.from({ length: N }, (_, i) => i + 1);
  const live = await Promise.all(
    ids.map((id) =>
      Promise.all([
        publicClient.readContract({ ...n, functionName: "ownerOf", args: [BigInt(id)] }),
        rv<bigint>("claimedUsd", [BigInt(id)]),
        rv<bigint>("pendingUsd", [BigInt(id)]),
        rv<readonly bigint[]>("pendingAll", [BigInt(id)]),
        rv<bigint>("lastVotedWeek", [BigInt(id)]),
        publicClient.readContract({ ...n, functionName: "buildingOf", args: [BigInt(id)] }),
      ]),
    ),
  );
  const buildings: Building[] = ids.map((id, i) => {
    const st = buildingCache.get(id)!;
    const [owner, claimed, pending, pendingAll, voted, full] = live[i] as [Address, bigint, bigint, readonly bigint[], bigint, { invites: number }];
    return {
      id,
      district: st.district,
      style: st.style,
      plot: st.plot,
      owner: owner.toLowerCase(),
      inviter: st.inviter,
      invites: Number(full.invites),
      earlyBird: st.earlyBird,
      claimedUsd: num(claimed),
      pendingUsd: num(pending),
      pendingTokens: pendingAll.map((v) => num(v)),
      votedWeek: Number(voted) - 1,
      builtAt: st.builtAt,
    };
  });
  const districtCount = Array.from({ length: a.districts }, () => 0);
  for (const b of buildings) districtCount[b.district]++;

  // Recent purchases from events (public nodes limit how far back logs can go).
  let purchases: Purchase[] = [];
  try {
    const logs = await publicClient.getContractEvents({ address: a.vault, abi: vaultAbi, eventName: "Bought", fromBlock: block.number > 9000n ? block.number - 9000n : 0n });
    purchases = logs.reverse().slice(0, 30).map((l) => {
      const args = l.args as { token: number; amountIn: bigint; tokensOut: bigint; usd: bigint };
      return { at: Number(block.timestamp) - Number(block.number - (l.blockNumber ?? block.number)) * 2, token: args.token as TokenId, amount: num(args.amountIn), tokens: num(args.tokensOut), usd: num(args.usd) };
    });
  } catch {
    /* logs unavailable */
  }

  const chain: ChainInfo = {
    ...a,
    gasBalance: num(gasBalance),
    vaultIncome: num(vaultIncome),
    allowance,
    viceWei: capWei,
    quote,
    quoteError,
    isEarlyBird: isEB as boolean,
    earlyBirdEnd: Number(ebEnd),
    earlyBirdFinalized: ebFinal,
    pausedUntil: Number(pausedUntil),
    lastBuyAt: Number(lastBuyAt),
    schedulerActive: active,
    minOrder: num(params[0]),
    maxOrder: num(params[1]),
    minInterval: Number(params[2]),
    oracleOwner: (oracleOwner as Address).toLowerCase(),
    adapterQuality: Number(quality),
    blockTime: Number(block.timestamp),
  };
  const maxBurn = quote ? (quote.tokensWei * 102n) / 100n : 0n;
  return {
    me: me?.toLowerCase() ?? "",
    chain,
    buildings,
    districtCount,
    week: Number(week),
    weekEnd: Number(weekEnd),
    currentToken: currentToken as TokenId,
    votes: votes.map(Number),
    newBuilds: newBuilds.map(Number),
    totalTax: num(totalTax),
    totalPurchases: Number(totalPurchases),
    totalBoughtUsd: num(totalBoughtUsd),
    purchases,
    residentsFunds: num(rEth),
    streetFunds: num(sEth),
    opsFunds: num(oEth),
    opsPaid: 0,
    holdings: holdings.map((h) => num(h)),
    incomeUsd: num(incomeUsd as bigint),
    viceUsd: num(capUsd as bigint),
    tokenUsd: tokenUsd.map((t) => num(t)),
    approved: quote ? allowance >= maxBurn && allowance > 0n : allowance > 0n,
    viceBalance: num(capWei),
    live: false,
  };
}

// ─────────── polling ───────────

let addresses: CityAddresses | null = null;
let account: Address | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let lastError: string | null = null;

export function chainError() {
  return lastError;
}

export async function refresh() {
  if (!addresses) return;
  const gen = generation;
  try {
    const next = await readCity(addresses, account);
    if (gen !== generation) return;
    lastError = null;
    const before = getCity();
    setChainState(next);
    // A new on-chain buy: let the map celebrate it like in the preview.
    if (before.chain && next.totalPurchases > before.totalPurchases && next.purchases[0]) {
      const p = next.purchases[0];
      const onToken = next.buildings.filter((b) => cityToken(DISTRICTS[b.district], next.currentToken) === p.token).length;
      announce({ type: "bought", token: p.token, tokens: p.tokens, usd: p.usd, buildings: onToken });
    }
  } catch (e) {
    lastError = (e as Error).message?.split("\n")[0] ?? String(e);
    console.warn("VICE: could not read the city", e);
  }
}

export async function connectCity(vault: Address | null, me: Address | null) {
  generation++;
  account = me;
  if (timer) clearTimeout(timer);
  timer = null;
  if (!vault) {
    addresses = null;
    return;
  }
  if (!addresses || addresses.vault.toLowerCase() !== vault.toLowerCase()) {
    buildingCache.clear();
    addresses = await resolveAddresses(vault);
  }
  const gen = generation;
  const loop = async () => {
    await refresh();
    if (gen === generation) timer = setTimeout(loop, 8000);
  };
  await loop();
}

// ─────────── transactions ───────────

async function wallet() {
  const wc = await getWalletClient(wagmiConfig);
  if (!wc) throw new Error("Connect your wallet first.");
  if (wc.chain?.id !== CHAIN.id) {
    await switchChain(wagmiConfig, { chainId: CHAIN.id });
    return (await getWalletClient(wagmiConfig))!;
  }
  return wc;
}

export async function send(tx: Parameters<Awaited<ReturnType<typeof wallet>>["writeContract"]>[0]) {
  const wc = await wallet();
  const hash = await wc.writeContract({ ...tx, account: wc.account, chain: CHAIN } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction failed.");
  await refresh();
  return receipt;
}

function need(): CityAddresses {
  if (!addresses) throw new Error("The city is still loading.");
  return addresses;
}

export const testActions = {
  faucet: () => send({ address: need().vice, abi: testTokenAbi, functionName: "faucet" } as never),
  /** Stand-in for $VICE trading on Volta: credits creator fees (test VOLTA) to the vault in the test escrow. */
  simulateTrading: (fees: bigint) =>
    send({ address: need().feeEscrow, abi: testFeeEscrowAbi, functionName: "simulateTrading", args: [need().vault, fees] } as never),
  /** Pulls the creator fees from the escrow into the vault (anyone can; the keeper does it hourly). */
  collectFees: () => send({ address: need().vault, abi: vaultAbi, functionName: "collectCreatorFees" } as never),
  async requestBuy() {
    const r = await send({ address: need().vault, abi: vaultAbi, functionName: "requestBuy" } as never);
    const logs = parseEventLogs({ abi: vaultAbi, logs: r.logs });
    const names = logs.map((l) => l.eventName);
    if (names.includes("Bought")) return "Bought! Rewards were added to every building.";
    if (names.includes("BuyRejected")) return "Rejected: the fill was more than 4% off the reference. Buying is paused for 6 hours.";
    const skip = logs.find((l) => l.eventName === "BuySkipped") as { args: { reason: number } } | undefined;
    return ["", "Skipped: buying is paused.", "Skipped: wait 10 minutes between orders.", "Skipped: not enough VOLTA waiting yet."][skip?.args.reason ?? 0] || "Done.";
  },
  settle: () => send({ address: need().vault, abi: vaultAbi, functionName: "settle" } as never),
  payOps: () => send({ address: need().vault, abi: vaultAbi, functionName: "payOps" } as never),
  setVicePrice: (usd: number) => {
    const v = BigInt(Math.round(usd * 1e12)) * 10n ** 6n;
    return send({ address: need().oracle, abi: testOracleAbi, functionName: "setVice", args: [v, v] } as never);
  },
  setQuality: (bps: number) => send({ address: need().adapter, abi: testAdapterAbi, functionName: "setQuality", args: [BigInt(bps)] } as never),
};

registerChain({
  approve: async () => {
    await send({ address: need().vice, abi: testTokenAbi, functionName: "approve", args: [need().nft, MAX] } as never);
  },
  build: async (district, style, inviter, maxTokensWei) => {
    const r = await send({ address: need().nft, abi: nftAbi, functionName: "mint", args: [district, style, BigInt(inviter), maxTokensWei] } as never);
    const built = parseEventLogs({ abi: nftAbi, logs: r.logs, eventName: "Built" })[0] as { args: { id: bigint } } | undefined;
    return built ? Number(built.args.id) : null;
  },
  claim: async (ids) => {
    await send({ address: need().vault, abi: vaultAbi, functionName: "claimMany", args: [ids.map(BigInt)] } as never);
  },
  vote: async (ids, token) => {
    await send({ address: need().vault, abi: vaultAbi, functionName: "vote", args: [ids.map(BigInt), token] } as never);
  },
});

export function describeError(e: unknown): string {
  const m = String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e);
  if (/User rejected|denied/i.test(m)) return "You cancelled the transaction in your wallet.";
  if (/insufficient funds/i.test(m)) return "Not enough HYPE in your wallet for gas. Bridge a little HYPE to Elysium (volta.family/bridge).";
  const custom = m.match(/reverted with the following reason:\s*(.+)/) ?? m.match(/error:\s*([A-Za-z]+\(.*?\))/);
  return custom ? custom[1] : m.split("\n")[0];
}

export const tokenLabel = (t: number) => TOKENS[t].token;
export { formatEther };
