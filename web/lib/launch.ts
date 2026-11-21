// The real launch, from the founder's own wallet (no keys ever touch this code). Each step is one
// wallet confirmation; progress is remembered in this browser so the page can be closed and
// resumed. The irreversible step (sending Volta's creator NFT to the vault) is last and asks
// for an explicit confirmation in the UI.

import { encodeFunctionData, keccak256, encodeAbiParameters, parseEther, zeroAddress, zeroHash, type Address } from "viem";
import { getWalletClient, switchChain } from "@wagmi/core";
import { adapterAbi, nftAbi, oracleAbi, pricingAbi, timelockAbi, vaultAbi } from "./abis";
import { CHAIN, publicClient, wagmiConfig } from "./wagmi";
import { DISTRICTS, EARLY_BIRD_UNITS, EARLY_BIRD_USD, FOLLOWS_VOTE, TIERS } from "./config";
import { VOLTA, creatorNftAbi, positionManagerAbi } from "./volta";

export const TIMELOCK_DELAY = 48 * 3600;
const EARLY_BIRD_SECONDS = 6 * 3600;

export interface LaunchInputs {
  /** $VICE token address (after launching it on Volta, paired with $VOLTA). */
  vice: Address | "";
  /** Receives the 15% ops share (a 2-of-3 Safe is recommended). */
  ops: Address | "";
  /** Proposes and executes changes through the 48h timelock (default: the deployer). */
  admin: Address | "";
  /** When building opens (unix seconds); the 6-hour early bird starts here. */
  start: number;
  /** Buy order sizes in USD, converted to VOLTA at deploy time. */
  minOrderUsd: number;
  maxOrderUsd: number;
}

export interface LaunchState {
  inputs: LaunchInputs;
  oracle?: Address;
  adapter?: Address;
  pricing?: Address;
  nft?: Address;
  timelock?: Address;
  vault?: Address;
  linkedPricing?: boolean;
  linkedNft?: boolean;
  pricingToTimelock?: boolean;
  acceptScheduled?: number; // unix time when acceptOwnership was scheduled
  acceptDone?: boolean;
  creatorNftSent?: boolean;
}

const KEY = "vice.launch";

export function loadLaunch(): LaunchState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as LaunchState;
  } catch {
    /* fresh */
  }
  return { inputs: { vice: "", ops: "", admin: "", start: 0, minOrderUsd: 20, maxOrderUsd: 150 } };
}

export function saveLaunch(s: LaunchState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the page still works, but cannot resume after a reload */
  }
}

async function wallet() {
  let wc = await getWalletClient(wagmiConfig);
  if (!wc) throw new Error("Connect your wallet first.");
  if (wc.chain?.id !== CHAIN.id) {
    await switchChain(wagmiConfig, { chainId: CHAIN.id });
    wc = (await getWalletClient(wagmiConfig))!;
  }
  return wc;
}

async function deploy(abi: readonly unknown[], bytecode: `0x${string}`, args: unknown[]): Promise<Address> {
  const wc = await wallet();
  const hash = await wc.deployContract({ abi, bytecode, args, account: wc.account, chain: CHAIN } as never);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error("Deployment failed.");
  return r.contractAddress;
}

async function call(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) {
  const wc = await wallet();
  const hash = await wc.writeContract({ address, abi, functionName, args, account: wc.account, chain: CHAIN } as never);
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} failed.`);
}

const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args } as never) as Promise<T>;

export async function connectedAccount(): Promise<Address | null> {
  const wc = await getWalletClient(wagmiConfig).catch(() => null);
  return wc?.account.address ?? null;
}

// ─────────── checks on the $VICE launch ───────────

export interface TokenCheck {
  ok: boolean;
  problems: string[];
  notes: string[];
  tradingOpensAt: number;
  creatorNftId: bigint;
  creatorNftOwner: Address;
  swapFeeBps: number;
}

/** Reads the $VICE pool on Volta and checks it is set up the way the city needs. */
export async function checkVice(vice: Address, me: Address | null): Promise<TokenCheck> {
  const problems: string[] = [];
  const notes: string[] = [];
  const key = await read<{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }>(
    VOLTA.positionManager, positionManagerAbi, "poolKey", [vice],
  );
  const pair = key.currency0.toLowerCase() === vice.toLowerCase() ? key.currency1 : key.currency0;
  if (key.currency0.toLowerCase() !== vice.toLowerCase() && key.currency1.toLowerCase() !== vice.toLowerCase()) {
    problems.push("This address is not a token launched on Volta.");
  } else if (pair.toLowerCase() !== VOLTA.volta.toLowerCase()) {
    problems.push("$VICE must be paired with $VOLTA (its fees are the city tax, in VOLTA).");
  }
  const id = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
  const fees = await read<{ swapFee: number; tradingOpensAt: bigint; creatorSplit: { creator: number; buyback: number; holders: number } }>(
    VOLTA.positionManager, positionManagerAbi, "poolFees", [id],
  );
  if (fees.creatorSplit.creator !== 10_000) {
    problems.push(`The creator share is ${fees.creatorSplit.creator / 100}% of the split; the city expects 100% to the creator (the vault).`);
  }
  notes.push(`Swap fee ${fees.swapFee / 100}%. Of it, 70% goes to the creator side (the city tax) and 30% to Volta.`);
  const nftId = await read<bigint>(VOLTA.creatorNft, creatorNftAbi, "tokenId", [vice]);
  const owner = await read<Address>(VOLTA.creatorNft, creatorNftAbi, "ownerOf", [nftId]);
  if (me && owner.toLowerCase() !== me.toLowerCase()) {
    notes.push(`The creator NFT (#${nftId}) is held by ${owner}, not by the connected wallet. Connect that wallet for the last step.`);
  }
  return {
    ok: problems.length === 0,
    problems,
    notes,
    tradingOpensAt: Number(fees.tradingOpensAt),
    creatorNftId: nftId,
    creatorNftOwner: owner,
    swapFeeBps: fees.swapFee,
  };
}

// ─────────── the steps ───────────

export interface Step {
  key: string;
  title: string;
  detail: string;
  done: (s: LaunchState) => boolean;
  run: (s: LaunchState, me: Address) => Promise<Partial<LaunchState>>;
  /** Not available yet (e.g. waiting for the timelock); shows why. */
  blocked?: (s: LaunchState, now: number) => string | null;
}

const usd = (n: number) => parseEther(String(n));

export const STEPS: Step[] = [
  {
    key: "oracle",
    title: "Price oracle",
    detail: "Reads $VICE, VOLTA, SENT and VOID prices from their Volta pools (10-minute averages) and HYPE in USD.",
    done: (s) => !!s.oracle,
    run: async (s) => {
      const { oracleBytecode } = await import("./bytecode");
      const vice = s.inputs.vice as Address;
      const oracle = await deploy(oracleAbi, oracleBytecode, [
        VOLTA.poolManager,
        VOLTA.positionManager,
        VOLTA.oracle,
        VOLTA.usdcCalculator,
        VOLTA.usdcDecimals,
        vice,
        VOLTA.volta,
        [vice, VOLTA.volta, VOLTA.sent, VOLTA.void],
      ]);
      return { oracle };
    },
  },
  {
    key: "adapter",
    title: "Swap route",
    detail: "Buys SENT (VOLTA → SENT) and VOID (VOLTA → HYPE → VOID) in Volta's own Uniswap v4 pools.",
    done: (s) => !!s.adapter,
    run: async () => {
      const { adapterBytecode } = await import("./bytecode");
      return { adapter: await deploy(adapterAbi, adapterBytecode, [VOLTA.poolManager, VOLTA.positionManager]) };
    },
  },
  {
    key: "pricing",
    title: "Building prices",
    detail: "Early bird $40 for 6 hours from the start time, then $52 / $68 / $88 / $120.",
    done: (s) => !!s.pricing,
    run: async (s, me) => {
      const { pricingBytecode } = await import("./bytecode");
      const pricing = await deploy(pricingAbi, pricingBytecode, [
        me,
        s.oracle,
        BigInt(s.inputs.start),
        BigInt(EARLY_BIRD_UNITS),
        usd(EARLY_BIRD_USD),
        TIERS.map((t) => usd(t.usd)),
      ]);
      return { pricing };
    },
  },
  {
    key: "nft",
    title: "Hideout NFTs",
    detail: "The VICE / HIDEOUT collection: 3,000 hideouts plus the Mayor's #0 (minted to the deployer).",
    done: (s) => !!s.nft,
    run: async (s, me) => {
      const { nftBytecode } = await import("./bytecode");
      return { nft: await deploy(nftAbi, nftBytecode, [s.inputs.vice, s.pricing, me, DISTRICTS.length]) };
    },
  },
  {
    key: "timelock",
    title: "48-hour timelock",
    detail: "Owns the vault and the pricing contract: any change is public for 48 hours before it can happen.",
    done: (s) => !!s.timelock,
    run: async (s) => {
      const { timelockBytecode } = await import("./bytecode");
      const admin = s.inputs.admin as Address;
      return { timelock: await deploy(timelockAbi, timelockBytecode, [BigInt(TIMELOCK_DELAY), [admin], [admin], zeroAddress]) };
    },
  },
  {
    key: "vault",
    title: "Vault",
    detail: "Holds the city tax, buys the tokens, pays the hideouts. Owned by the timelock from the start; no withdrawal function.",
    done: (s) => !!s.vault,
    run: async (s) => {
      const { vaultBytecode } = await import("./bytecode");
      const incomeUsd = await read<bigint>(s.oracle!, oracleAbi, "incomeUsd");
      const voltaPerUsd = (10n ** 36n) / incomeUsd; // VOLTA (wei) per $1
      const minOrder = voltaPerUsd * BigInt(Math.round(s.inputs.minOrderUsd));
      const maxOrder = voltaPerUsd * BigInt(Math.round(s.inputs.maxOrderUsd));
      const vault = await deploy(vaultAbi, vaultBytecode, [
        {
          owner: s.timelock,
          nft: s.nft,
          earlyBirdEnd: BigInt(s.inputs.start + EARLY_BIRD_SECONDS),
          income: VOLTA.volta,
          feeEscrow: VOLTA.feeEscrow,
          oracle: s.oracle,
          ops: s.inputs.ops,
          weth: zeroAddress,
          districts: DISTRICTS.length,
          initialToken: 0, // Wynwood starts on VOLTA
          cityTokens: DISTRICTS.map((d) => (d.earns === "vote" ? FOLLOWS_VOTE : d.earns)).concat([0, 0, 0, 0]).slice(0, 4),
        },
        [VOLTA.volta, VOLTA.sent, VOLTA.void],
        [s.adapter, s.adapter, s.adapter],
        { minOrder, maxOrder, minInterval: 600, rejectPause: 6 * 3600, maxDeviationBps: 400 },
      ]);
      return { vault };
    },
  },
  {
    key: "linkPricing",
    title: "Link prices → hideouts",
    detail: "One-time link so only the hideout contract can lock in early-bird prices.",
    done: (s) => !!s.linkedPricing,
    run: async (s) => {
      await call(s.pricing!, pricingAbi, "setNft", [s.nft]);
      return { linkedPricing: true };
    },
  },
  {
    key: "linkNft",
    title: "Link hideouts → vault",
    detail: "One-time link: every new hideout is registered with the vault for rewards and the turf race.",
    done: (s) => !!s.linkedNft,
    run: async (s) => {
      await call(s.nft!, nftAbi, "setVault", [s.vault]);
      return { linkedNft: true };
    },
  },
  {
    key: "pricingOwner",
    title: "Hand prices to the timelock",
    detail: "Starts the ownership transfer of the pricing contract to the timelock.",
    done: (s) => !!s.pricingToTimelock,
    run: async (s) => {
      await call(s.pricing!, pricingAbi, "transferOwnership", [s.timelock]);
      return { pricingToTimelock: true };
    },
  },
  {
    key: "scheduleAccept",
    title: "Schedule the timelock's acceptance",
    detail: "The timelock accepts ownership of the pricing contract, publicly scheduled for 48 hours from now (needs the admin wallet).",
    done: (s) => !!s.acceptScheduled,
    run: async (s) => {
      const data = encodeFunctionData({ abi: pricingAbi, functionName: "acceptOwnership" });
      await call(s.timelock!, timelockAbi, "schedule", [s.pricing, 0n, data, zeroHash, zeroHash, BigInt(TIMELOCK_DELAY)]);
      return { acceptScheduled: Math.floor(Date.now() / 1000) };
    },
  },
  {
    key: "creatorNft",
    title: "Send Volta's creator NFT to the vault",
    detail: "IRREVERSIBLE. From now on the creator share of every $VICE trade is the city tax. The NFT can never leave the vault.",
    done: (s) => !!s.creatorNftSent,
    run: async (s, me) => {
      const id = await read<bigint>(VOLTA.creatorNft, creatorNftAbi, "tokenId", [s.inputs.vice]);
      await call(VOLTA.creatorNft, creatorNftAbi, "safeTransferFrom", [me, s.vault, id]);
      return { creatorNftSent: true };
    },
  },
  {
    key: "acceptExecute",
    title: "Finish: timelock takes the prices (after 48h)",
    detail: "Executes the scheduled acceptance. Until then the deployer still owns the pricing contract.",
    done: (s) => !!s.acceptDone,
    blocked: (s, now) =>
      s.acceptScheduled && now < s.acceptScheduled + TIMELOCK_DELAY + 60
        ? `Available after ${new Date((s.acceptScheduled + TIMELOCK_DELAY + 60) * 1000).toLocaleString()}.`
        : null,
    run: async (s) => {
      const data = encodeFunctionData({ abi: pricingAbi, functionName: "acceptOwnership" });
      await call(s.timelock!, timelockAbi, "execute", [s.pricing, 0n, data, zeroHash, zeroHash]);
      return { acceptDone: true };
    },
  },
];

// ─────────── final check ───────────

export interface Verify {
  ok: boolean;
  lines: { ok: boolean; text: string }[];
}

export async function verifyLaunch(s: LaunchState): Promise<Verify> {
  const lines: Verify["lines"] = [];
  const add = (ok: boolean, text: string) => lines.push({ ok, text });
  const safe = async <T>(p: Promise<T>) => p.catch(() => null);
  if (!s.vault || !s.nft || !s.pricing || !s.oracle || !s.timelock) return { ok: false, lines: [{ ok: false, text: "Not all contracts are deployed yet." }] };
  const [vNft, nVault, pNft, vOwner, pOwner, pPending, nftOwner, viceUsd, incomeUsd, sentUsd, voidUsd, quote] = await Promise.all([
    safe(read<Address>(s.vault, vaultAbi, "nft")),
    safe(read<Address>(s.nft, nftAbi, "vault")),
    safe(read<Address>(s.pricing, pricingAbi, "nft")),
    safe(read<Address>(s.vault, vaultAbi, "owner")),
    safe(read<Address>(s.pricing, pricingAbi, "owner")),
    safe(read<Address>(s.pricing, pricingAbi, "pendingOwner")),
    safe(read<Address>(VOLTA.creatorNft, creatorNftAbi, "ownerOf", [await read<bigint>(VOLTA.creatorNft, creatorNftAbi, "tokenId", [s.inputs.vice])])),
    safe(read<bigint>(s.oracle, oracleAbi, "viceUsdSpot")),
    safe(read<bigint>(s.oracle, oracleAbi, "incomeUsd")),
    safe(read<bigint>(s.oracle, oracleAbi, "tokenUsd", [VOLTA.sent])),
    safe(read<bigint>(s.oracle, oracleAbi, "tokenUsd", [VOLTA.void])),
    safe(read<readonly [bigint, bigint]>(s.pricing, pricingAbi, "quote", [1n])),
  ]);
  const eq = (a: string | null, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  add(eq(vNft, s.nft) && eq(nVault, s.vault) && eq(pNft, s.nft), "Vault, hideouts and prices are linked to each other.");
  add(eq(vOwner, s.timelock), "The vault is owned by the 48h timelock.");
  add(eq(pOwner, s.timelock) || eq(pPending, s.timelock), eq(pOwner, s.timelock) ? "The prices are owned by the timelock." : "The prices are being handed to the timelock (finish after 48h).");
  add(eq(nftOwner, s.vault), "Volta's creator NFT for $VICE is in the vault.");
  const f = (v: bigint | null) => (v ? `$${(Number(v) / 1e18).toPrecision(4)}` : "unavailable");
  add(!!viceUsd && !!incomeUsd && !!sentUsd && !!voidUsd, `Prices: $VICE ${f(viceUsd)}, VOLTA ${f(incomeUsd)}, SENT ${f(sentUsd)}, VOID ${f(voidUsd)}.`);
  add(!!quote, quote ? `Hideout #1 costs ${(Number(quote[0]) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 })} $VICE ($${Number(quote[1]) / 1e18}).` : "Building is not open yet (it opens at the start time).");
  return { ok: lines.every((l) => l.ok), lines };
}
