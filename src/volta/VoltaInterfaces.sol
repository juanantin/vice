// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Minimal interfaces for Uniswap v4 (as deployed on Elysium) and Volta's contracts, written from
// their published ABIs (volta.family/docs). Only what VICE needs.

/// Uniswap v4 pool key. Currencies are sorted; address(0) is the native coin (HYPE).
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    /// Negative = exact input, positive = exact output.
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    /// Returns a packed BalanceDelta: amount0 in the high 128 bits, amount1 in the low 128 bits,
    /// from the caller's point of view (negative = the caller owes, positive = owed to the caller).
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
    function extsload(bytes32 slot) external view returns (bytes32);
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

/// Volta's PositionManager (the Uniswap v4 hook every Volta pool uses).
interface IVoltaPositionManager {
    function poolKey(address token) external view returns (PoolKey memory);
    /// Swap fee in basis points for buying (`isBuy`) or selling the pool's launched token.
    function currentSwapFee(bytes32 poolId, bool isBuy) external view returns (uint24);
}

/// Volta's price-observation oracle (10-minute TWAP window).
interface IVoltaOracle {
    function twapTick(bytes32 poolId, int24 currentTick) external view returns (int24);
}

/// Volta's price calculators: how much of their token one HYPE buys (spot).
interface IVoltaPriceCalculator {
    function ethToPairedToken(uint256 ethAmount) external view returns (uint256);
}

/// Volta's creator NFT: one per launch, its holder receives the creator fee share.
interface IVoltaCreatorNFT {
    function tokenId(address memecoin) external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 id) external;
}

library PoolIdLib {
    function toId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}
