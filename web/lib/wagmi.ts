import { createConfig, fallback, http } from "wagmi";
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
});

// Volta's RPC answers browsers (CORS) and batches; Kinetiq's is the backup. Both reach the same chain.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.volta.family";
const BACKUP_RPC = "https://rpc.elysium.kinetiq.xyz";
export const CHAIN = elysium;
export const EXPLORER = "https://elysium.kinetiq.xyz";

const transport = fallback([http(RPC_URL, { batch: { batchSize: 40 } }), http(BACKUP_RPC, { batch: { batchSize: 40 } })]);

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [CHAIN.id]: transport },
  ssr: false,
});

export const publicClient = createPublicClient({ chain: CHAIN, transport });
