// Volta and Uniswap v4 contracts on Elysium (from volta.family/docs, checked on chain Nov 2026),
// and the minimal ABIs the launch page needs.

import { parseAbi } from "viem";

export const VOLTA = {
  poolManager: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1",
  positionManager: "0x3aB88DDc3CF2A012af88B60828edb4553697E5dC",
  oracle: "0xa2A5eBE297a141160ca5c513c74fD43cB2c09B2e",
  feeEscrow: "0x3D36Beb546E451584736957F97E7EE9D2aCbD9a5",
  creatorNft: "0xac466Ee5CEdD012eB750DBDA0B935F8B997402c7",
  usdcCalculator: "0x0D673fF1c868e9Ff867C88DBb010E16be7D129b9",
  usdcDecimals: 6,
  volta: "0x0f79931689Af199e7CF868ed1107bBA2C83c68f7",
  sent: "0xA713a15b85Cab304F9e2fbc649440B5e3AB8a8D4",
  void: "0xD31B21Cb80E431AC996269deC31A40fCf048B77f",
} as const;

export const positionManagerAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct CreatorSplit { uint24 creator; uint24 buyback; uint24 holders; }",
  "struct PoolFees { uint24 swapFee; uint24 antiSnipeStartFee; uint32 antiSnipeDuration; uint64 tradingOpensAt; CreatorSplit creatorSplit; }",
  "function poolKey(address token) view returns (PoolKey)",
  "function poolFees(bytes32 poolId) view returns (PoolFees)",
  "function currentSwapFee(bytes32 poolId, bool isBuy) view returns (uint24)",
]);

export const creatorNftAbi = parseAbi([
  "function tokenId(address memecoin) view returns (uint256)",
  "function ownerOf(uint256 id) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 id)",
]);

export const feeEscrowAbi = parseAbi(["function balances(address recipient, address token) view returns (uint256)"]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
