import { createConfig, custom, fallback, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, defineChain } from "viem";

// Elysium (chain id 99901), the chain Volta runs on. Gas is paid in HYPE.
// NEXT_PUBLIC_RPC_URL can point at another node (e.g. a local test chain); the id stays 99901.
export const elysium = defineChain({
  id: 99901,
  name: "Elysium",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.elysium.kinetiq.xyz"] } },
  blockExplorers: { default: { name: "Elysium explorer", url: "https://elysium.kinetiq.xyz" } },
  // Multicall3 (standard address, deployed on Elysium): many reads travel as one call.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

// Kinetiq's public Elysium RPC (Volta closed rpc.volta.family in Nov 2026 and points to this one).
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.elysium.kinetiq.xyz";
export const CHAIN = elysium;
export const EXPLORER = "https://elysium.kinetiq.xyz";

type Eip1193 = { request: (a: { method: string; params?: unknown }) => Promise<unknown> };

/** The player's own wallet as a last-resort reader: some browsers (ad-blockers, VPNs, networks)
 *  can't reach the public RPCs, but the wallet extension always reaches its chain. Used only while
 *  the wallet is on Elysium; otherwise it steps aside so the fallback tries the next node. */
const walletReader = custom({
  async request({ method, params }) {
    const eth = typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193 }).ethereum : undefined;
    if (!eth) throw new Error("No wallet to read through");
    const id = await eth.request({ method: "eth_chainId" });
    if (Number(id) !== CHAIN.id) throw new Error("Wallet is not on Elysium");
    return eth.request({ method, params });
  },
});

const transport = fallback([
  http(RPC_URL, { batch: { batchSize: 40 }, timeout: 10_000, retryCount: 1 }),
  walletReader,
]);

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [CHAIN.id]: transport },
  ssr: false,
});

// Kinetiq's public node rate-limits each visitor per call, so reads are bundled through Multicall3:
// one page refresh is a handful of calls instead of ~40.
export const publicClient = createPublicClient({ chain: CHAIN, transport, batch: { multicall: { batchSize: 4096, wait: 20 } } });
