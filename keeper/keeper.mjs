// VICE keeper: the hourly (here: every 15 minutes) housekeeping that keeps the city running.
// Everything it does, anyone may do; the keeper wallet has no special rights and only needs a
// little HYPE for gas. Each action is simulated first and only sent when it would do something.
//
//   1. poke the oracle's HYPE/USD reference (at most every 5 minutes, 2% per step);
//   2. collect the creator fees Volta credited to the vault (the city tax, in VOLTA);
//   3. settle the week after the Sunday deadline (and the early bird when it ends);
//   4. request a buy (one order; the vault enforces sizes, spacing and the 4% price check);
//      after 24h without buys the vault's scheduler rests until someone calls requestBuy;
//   5. pay the ops share out once it is worth it.
//
// Env: KEEPER_PRIVATE_KEY (secret), VICE_VAULT (or the LIVE vault in web/lib/config.ts),
//      ELYSIUM_RPC (optional), DRY_RUN=1 to only report.
// The private key is read from the environment only; it is never printed or stored.

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = defineChain({
  id: 99901,
  name: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ELYSIUM_RPC || "https://rpc.volta.family"] } },
});

const vaultAbi = parseAbi([
  "function oracle() view returns (address)",
  "function income() view returns (address)",
  "function feeEscrow() view returns (address)",
  "function weekEnd() view returns (uint256)",
  "function earlyBirdEnd() view returns (uint256)",
  "function earlyBirdFinalized() view returns (bool)",
  "function schedulerActive() view returns (bool)",
  "function opsFunds() view returns (uint256)",
  "function pausedUntil() view returns (uint256)",
  "function collectCreatorFees() returns (uint256)",
  "function settle()",
  "function requestBuy() returns (bool)",
  "function payOps()",
]);
const oracleAbi = parseAbi([
  "function poke() returns (uint256)",
  "function hypeUsdUpdatedAt() view returns (uint256)",
  "function hypeUsd() view returns (uint256)",
  "function hypeUsdSpot() view returns (uint256)",
  "function incomeUsd() view returns (uint256)",
]);
const escrowAbi = parseAbi(["function balances(address recipient, address token) view returns (uint256)"]);

/** Pay the ops share once it is worth at least this much (USD). */
const OPS_MIN_USD = Number(process.env.OPS_MIN_USD || 25);

function vaultAddress() {
  if (process.env.VICE_VAULT) return process.env.VICE_VAULT;
  try {
    const cfg = readFileSync(new URL("../web/lib/config.ts", import.meta.url), "utf8");
    const m = cfg.match(/vault:\s*"(0x[0-9a-fA-F]{40})"/);
    if (m) return m[1];
  } catch {
    /* no config */
  }
  return null;
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function main() {
  const vault = vaultAddress();
  if (!vault) {
    log("No live city yet (set VICE_VAULT or LIVE.vault in web/lib/config.ts). Nothing to do.");
    return;
  }
  const dry = process.env.DRY_RUN === "1";
  const pk = process.env.KEEPER_PRIVATE_KEY;
  if (!pk && !dry) throw new Error("KEEPER_PRIVATE_KEY is not set (add it as a repository secret).");
  const account = pk ? privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`) : null;
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = account ? createWalletClient({ chain, transport: http(), account }) : null;

  const v = { address: vault, abi: vaultAbi };
  const [oracle, income, escrow] = await Promise.all([
    pub.readContract({ ...v, functionName: "oracle" }),
    pub.readContract({ ...v, functionName: "income" }),
    pub.readContract({ ...v, functionName: "feeEscrow" }),
  ]);
  const o = { address: oracle, abi: oracleAbi };
  if (account) {
    const gas = await pub.getBalance({ address: account.address });
    log(`keeper ${account.address} has ${formatUnits(gas, 18)} HYPE for gas`);
    if (gas < 10n ** 16n) log("WARNING: keeper is low on HYPE; top it up.");
  }

  /** Simulate, then send only if the call would succeed (and `want` says it is useful). */
  async function act(label, target, functionName, want = () => true) {
    try {
      const sim = await pub.simulateContract({ address: target.address, abi: target.abi, functionName, account: account?.address ?? vault });
      if (!want(sim.result)) {
        log(`${label}: nothing to do`);
        return;
      }
      if (dry || !wallet) {
        log(`${label}: would send (dry run)`, sim.result ?? "");
        return;
      }
      // Swaps through Volta's hook are easy to under-estimate: send 30% more gas than estimated.
      const est = await pub.estimateContractGas({ address: target.address, abi: target.abi, functionName, account });
      // Sign locally with the keeper's own key (public RPCs don't sign for anyone).
      const hash = await wallet.writeContract({ ...sim.request, account, gas: (est * 13n) / 10n });
      const r = await pub.waitForTransactionReceipt({ hash });
      log(`${label}: ${r.status} ${hash}`);
    } catch (e) {
      log(`${label}: skipped (${(e.shortMessage || e.message || String(e)).split("\n")[0]})`);
    }
  }

  const block = await pub.getBlock();
  const now = Number(block.timestamp);

  // 1. Oracle reference.
  const updatedAt = Number(await pub.readContract({ ...o, functionName: "hypeUsdUpdatedAt" }));
  if (now >= updatedAt + 300) await act("poke oracle", o, "poke");

  // 2. Creator fees.
  const waiting = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "balances", args: [vault, income] });
  log(`creator fees waiting in Volta's escrow: ${formatUnits(waiting, 18)} VOLTA`);
  if (waiting > 0n) await act("collect creator fees", v, "collectCreatorFees");

  // 3. Settlement.
  const [weekEnd, ebEnd, ebDone] = await Promise.all([
    pub.readContract({ ...v, functionName: "weekEnd" }),
    pub.readContract({ ...v, functionName: "earlyBirdEnd" }),
    pub.readContract({ ...v, functionName: "earlyBirdFinalized" }),
  ]);
  if (now >= Number(weekEnd) || (!ebDone && now >= Number(ebEnd))) await act("settle", v, "settle");

  // 4. Buy (only while the scheduler is active; it rests after 24h without buys).
  const active = await pub.readContract({ ...v, functionName: "schedulerActive" });
  const paused = Number(await pub.readContract({ ...v, functionName: "pausedUntil" }));
  if (!active) log("buy: scheduler resting (24h without buys); anyone can restart it with requestBuy()");
  else if (paused > now) log(`buy: paused after a rejected order until ${new Date(paused * 1000).toISOString()}`);
  else await act("buy", v, "requestBuy", (bought) => bought === true);

  // 5. Ops share.
  const [opsFunds, voltaUsd] = await Promise.all([
    pub.readContract({ ...v, functionName: "opsFunds" }),
    pub.readContract({ ...o, functionName: "incomeUsd" }),
  ]);
  const opsUsd = (Number(formatUnits(opsFunds, 18)) * Number(formatUnits(voltaUsd, 18)));
  log(`ops share waiting: ${formatUnits(opsFunds, 18)} VOLTA (~$${opsUsd.toFixed(2)})`);
  if (opsUsd >= OPS_MIN_USD) await act("pay ops", v, "payOps");
}

main().catch((e) => {
  console.error(new Date().toISOString(), "keeper failed:", e.shortMessage || e.message || e);
  process.exit(1);
});
