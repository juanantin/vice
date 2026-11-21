// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {TickPrice} from "./TickPrice.sol";
import {IPoolManager, IUnlockCallback, IVoltaPositionManager, PoolKey, SwapParams} from "./VoltaInterfaces.sol";

/// @title VoltaSwapAdapter
/// @notice Swaps between Volta tokens (and HYPE) through their own Uniswap v4 pools, straight on
///         the PoolManager: the route sells `tokenIn` down its pool chain until it meets
///         `tokenOut`'s chain, then buys up to `tokenOut`. For VICE:
///           VOLTA → SENT : one swap in the VOLTA/SENT pool;
///           VOLTA → VOID : VOLTA → HYPE (VOLTA pool), then HYPE → VOID (VOID pool).
///         Exact input; reverts unless at least `minOut` reaches the recipient. Holds no funds
///         and has no owner. The vault's own 4% check (against the TWAP oracle) still applies.
contract VoltaSwapAdapter is ISwapAdapter, IUnlockCallback {
    using SafeERC20 for IERC20;

    uint256 internal constant MAX_HOPS = 4;
    uint256 internal constant MAX_DEPTH = 3;

    IPoolManager public immutable poolManager;
    IVoltaPositionManager public immutable positionManager;

    struct Hop {
        PoolKey key;
        bool zeroForOne;
    }

    error NotPoolManager();
    error BadValue();
    error BadRoute();
    error PartialFill();
    error InsufficientOutput(uint256 out, uint256 minOut);

    constructor(IPoolManager poolManager_, IVoltaPositionManager positionManager_) {
        poolManager = poolManager_;
        positionManager = positionManager_;
    }

    receive() external payable {}

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 amountOut)
    {
        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        Hop[] memory hops = route(tokenIn, tokenOut);
        amountOut = abi.decode(poolManager.unlock(abi.encode(tokenIn, tokenOut, amountIn, recipient, hops)), (uint256));
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address tokenIn, address tokenOut, uint256 amountIn, address recipient, Hop[] memory hops) =
            abi.decode(data, (address, address, uint256, address, Hop[]));
        uint256 amt = amountIn;
        for (uint256 i; i < hops.length; ++i) {
            Hop memory h = hops[i];
            int256 d = poolManager.swap(
                h.key,
                SwapParams({
                    zeroForOne: h.zeroForOne,
                    amountSpecified: -int256(amt),
                    sqrtPriceLimitX96: h.zeroForOne ? TickPrice.MIN_SQRT_PRICE + 1 : TickPrice.MAX_SQRT_PRICE - 1
                }),
                ""
            );
            int128 a0 = int128(d >> 128);
            int128 a1 = int128(d);
            (int128 paid, int128 got) = h.zeroForOne ? (a0, a1) : (a1, a0);
            if (paid != -int128(int256(amt)) || got <= 0) revert PartialFill();
            amt = uint256(int256(got));
        }
        // Pay the input, collect the output (intermediate currencies net to zero).
        if (tokenIn == address(0)) {
            poolManager.settle{value: amountIn}();
        } else {
            poolManager.sync(tokenIn);
            IERC20(tokenIn).safeTransfer(address(poolManager), amountIn);
            poolManager.settle();
        }
        poolManager.take(tokenOut, recipient, amt);
        return abi.encode(amt);
    }

    /// @notice The hops this adapter takes from `tokenIn` to `tokenOut`.
    function route(address tokenIn, address tokenOut) public view returns (Hop[] memory hops) {
        if (tokenIn == tokenOut) revert BadRoute();
        (address[] memory a, uint256 na) = _chain(tokenIn);
        (address[] memory b, uint256 nb) = _chain(tokenOut);
        uint256 ia = na;
        uint256 ib = nb;
        for (uint256 j; j < nb && ib == nb; ++j) {
            for (uint256 i; i < na; ++i) {
                if (a[i] == b[j]) {
                    ia = i;
                    ib = j;
                    break;
                }
            }
        }
        uint256 n = ia + ib;
        if (n == 0 || n > MAX_HOPS) revert BadRoute();
        hops = new Hop[](n);
        // Sell down tokenIn's chain: token → its quote.
        for (uint256 i; i < ia; ++i) {
            PoolKey memory k = positionManager.poolKey(a[i]);
            hops[i] = Hop(k, k.currency0 == a[i]);
        }
        // Buy up tokenOut's chain, from the shared quote outward: quote → token.
        for (uint256 j; j < ib; ++j) {
            address t = b[ib - 1 - j];
            PoolKey memory k = positionManager.poolKey(t);
            hops[ia + j] = Hop(k, k.currency1 == t);
        }
    }

    /// `token`, its quote, its quote's quote... down to (not including) HYPE.
    function _chain(address token) internal view returns (address[] memory path, uint256 n) {
        path = new address[](MAX_DEPTH);
        address t = token;
        while (t != address(0)) {
            if (n == MAX_DEPTH) revert BadRoute();
            PoolKey memory k = positionManager.poolKey(t);
            if (k.currency0 != t && k.currency1 != t) revert BadRoute();
            path[n++] = t;
            t = k.currency0 == t ? k.currency1 : k.currency0;
        }
    }
}
