// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IViceOracle} from "../interfaces/IViceOracle.sol";
import {TickPrice} from "./TickPrice.sol";
import {
    IPoolManager,
    IVoltaOracle,
    IVoltaPositionManager,
    IVoltaPriceCalculator,
    PoolIdLib,
    PoolKey
} from "./VoltaInterfaces.sol";

/// @title ViceOracle
/// @notice USD prices for VICE on Elysium, read from Volta's own pools.
///
///         Every Volta token trades in one Uniswap v4 pool against its quote asset (HYPE or
///         another Volta token such as $VOLTA). A token's price is walked down that chain to HYPE:
///         $VICE → $VOLTA → HYPE, SENT → $VOLTA → HYPE, VOID → HYPE, $VOLTA → HYPE.
///         - "spot" uses each pool's current price (PoolManager slot0);
///         - "twap" uses Volta's Oracle (10-minute time-weighted tick) for each pool.
///
///         HYPE → USD comes from Volta's USDC price calculator (the HYPE/USDC pool), but only
///         through a stored reference that anyone can `poke()` at most every 5 minutes and that
///         moves at most 2% per poke. A price pushed around inside one transaction (flash swap)
///         therefore can't move building prices or buy checks; the keeper pokes it regularly.
///
///         `tokenUsd(token)` is the reference cost of buying the token with the vault's income
///         asset: the TWAP price raised by the swap fees on the route, so the vault's 4% check
///         measures slippage and price impact only, not Volta's fees.
///
///         No owner, nothing configurable after deployment. The vault and pricing contracts can
///         switch to a new oracle through their 48-hour timelock.
contract ViceOracle is IViceOracle {
    uint256 internal constant ONE = 1e18;
    uint256 internal constant Q96 = 2 ** 96;
    uint256 internal constant BPS = 10_000;
    bytes32 internal constant POOLS_SLOT = bytes32(uint256(6)); // Uniswap v4 PoolManager `_pools`

    uint256 public constant POKE_INTERVAL = 5 minutes;
    uint256 public constant MAX_STEP_BPS = 200;
    /// A token's pool chain to HYPE is at most this long (VICE → VOLTA → HYPE).
    uint256 internal constant MAX_DEPTH = 3;

    IPoolManager public immutable poolManager;
    IVoltaPositionManager public immutable positionManager;
    IVoltaOracle public immutable voltaOracle;
    IVoltaPriceCalculator public immutable usdcCalculator;
    uint8 public immutable usdcDecimals;
    address public immutable vice;
    /// The vault's income asset (buys start from it).
    address public immutable income;

    struct Leg {
        PoolKey key;
        bytes32 id;
        address quote; // address(0) = HYPE
        bool tokenIs0;
        uint8 decimals;
        bool known;
    }

    mapping(address => Leg) internal _legs;

    /// USD per HYPE (1e18), the clamped reference.
    uint256 public hypeUsd;
    uint256 public hypeUsdUpdatedAt;

    event Poked(uint256 spot, uint256 stored);

    error UnknownToken(address token);
    error BadConfig();
    error TooSoon();
    error ZeroPrice();

    /// @param tokens every Volta token priced here: $VICE, the income asset and the reward tokens.
    constructor(
        IPoolManager poolManager_,
        IVoltaPositionManager positionManager_,
        IVoltaOracle voltaOracle_,
        IVoltaPriceCalculator usdcCalculator_,
        uint8 usdcDecimals_,
        address vice_,
        address income_,
        address[] memory tokens
    ) {
        poolManager = poolManager_;
        positionManager = positionManager_;
        voltaOracle = voltaOracle_;
        usdcCalculator = usdcCalculator_;
        usdcDecimals = usdcDecimals_;
        vice = vice_;
        income = income_;
        for (uint256 i; i < tokens.length; ++i) {
            address t = tokens[i];
            PoolKey memory k = positionManager_.poolKey(t);
            if (k.currency0 != t && k.currency1 != t) revert BadConfig();
            Leg storage l = _legs[t];
            l.key = k;
            l.id = PoolIdLib.toId(k);
            l.tokenIs0 = k.currency0 == t;
            l.quote = l.tokenIs0 ? k.currency1 : k.currency0;
            l.decimals = IERC20Metadata(t).decimals();
            l.known = true;
        }
        // Every quote must itself be HYPE or a priced token, and chains must reach HYPE.
        for (uint256 i; i < tokens.length; ++i) {
            _chain(tokens[i]);
        }
        if (!_legs[vice_].known || !_legs[income_].known) revert BadConfig();
        uint256 h = _hypeUsdSpot();
        hypeUsd = h;
        hypeUsdUpdatedAt = block.timestamp;
        emit Poked(h, h);
    }

    // ─────────────────────────── HYPE reference ───────────────────────────

    /// @notice Move the HYPE/USD reference toward the pool price (at most 2% per call, at most
    ///         every 5 minutes). Anyone may call; the keeper does.
    function poke() external returns (uint256) {
        if (block.timestamp < hypeUsdUpdatedAt + POKE_INTERVAL) revert TooSoon();
        uint256 spot = _hypeUsdSpot();
        uint256 cur = hypeUsd;
        uint256 lo = (cur * (BPS - MAX_STEP_BPS)) / BPS;
        uint256 hi = (cur * (BPS + MAX_STEP_BPS)) / BPS;
        uint256 next = spot < lo ? lo : spot > hi ? hi : spot;
        hypeUsd = next;
        hypeUsdUpdatedAt = block.timestamp;
        emit Poked(spot, next);
        return next;
    }

    /// @notice HYPE/USD straight from the pool (not used for pricing; for the keeper and UI).
    function hypeUsdSpot() external view returns (uint256) {
        return _hypeUsdSpot();
    }

    function _hypeUsdSpot() internal view returns (uint256 p) {
        // USDC (in its own decimals) that one HYPE buys.
        p = usdcCalculator.ethToPairedToken(ONE) * 10 ** (18 - usdcDecimals);
        if (p == 0) revert ZeroPrice();
    }

    // ─────────────────────────── IViceOracle ───────────────────────────

    function viceUsdSpot() external view returns (uint256) {
        return _usd(vice, false);
    }

    function viceUsdTwap() external view returns (uint256) {
        return _usd(vice, true);
    }

    function incomeUsd() external view returns (uint256) {
        return _usd(income, true);
    }

    function tokenUsd(address token) external view returns (uint256) {
        uint256 p = _usd(token, true);
        uint256 keep = _routeKeepBps(income, token);
        return (p * BPS) / keep;
    }

    // ─────────────────────────── Extra views ───────────────────────────

    function usdSpot(address token) external view returns (uint256) {
        return _usd(token, false);
    }

    function usdTwap(address token) external view returns (uint256) {
        return _usd(token, true);
    }

    function poolIdOf(address token) external view returns (bytes32) {
        return _legs[token].id;
    }

    /// @notice Share of the value that survives Volta's swap fees when buying `tokenOut` with
    ///         `tokenIn`, in basis points.
    function routeKeepBps(address tokenIn, address tokenOut) external view returns (uint256) {
        return _routeKeepBps(tokenIn, tokenOut);
    }

    // ─────────────────────────── Internals ───────────────────────────

    /// USD per whole token (1e18), walking the pool chain down to HYPE.
    function _usd(address token, bool twap) internal view returns (uint256) {
        if (token == address(0)) return hypeUsd;
        Leg storage l = _legs[token];
        if (!l.known) revert UnknownToken(token);
        uint256 quoteUsd = _usd(l.quote, twap);
        uint8 qDec = l.quote == address(0) ? 18 : _legs[l.quote].decimals;
        uint256 sqrtP = twap ? TickPrice.sqrtPriceAtTick(_twapTick(l.id)) : _slot0SqrtPrice(l.id);
        // price1per0 (raw units) = sqrtP² / 2^192.
        uint256 usdPerRawQuoteTimesDec = quoteUsd; // USD per whole quote
        uint256 p;
        if (l.tokenIs0) {
            // token is currency0: one raw token = price1per0 raw quote.
            p = Math.mulDiv(Math.mulDiv(usdPerRawQuoteTimesDec, sqrtP, Q96), sqrtP, Q96);
        } else {
            // token is currency1: one raw token = 1 / price1per0 raw quote.
            p = Math.mulDiv(Math.mulDiv(usdPerRawQuoteTimesDec, Q96, sqrtP), Q96, sqrtP);
        }
        // Convert raw-unit ratio to whole-unit prices.
        if (l.decimals >= qDec) p = p * 10 ** (l.decimals - qDec);
        else p = p / 10 ** (qDec - l.decimals);
        if (p == 0) revert ZeroPrice();
        return p;
    }

    function _slot0(bytes32 id) internal view returns (uint160 sqrtP, int24 tick) {
        bytes32 slot = keccak256(abi.encodePacked(id, POOLS_SLOT));
        uint256 data = uint256(poolManager.extsload(slot));
        sqrtP = uint160(data);
        tick = int24(int256(data >> 160));
        if (sqrtP == 0) revert ZeroPrice();
    }

    function _slot0SqrtPrice(bytes32 id) internal view returns (uint256) {
        (uint160 s,) = _slot0(id);
        return s;
    }

    function _twapTick(bytes32 id) internal view returns (int24) {
        (, int24 tick) = _slot0(id);
        return voltaOracle.twapTick(id, tick);
    }

    /// Pools from `token` down to HYPE (token, its quote, ...). Reverts on an unknown link.
    function _chain(address token) internal view returns (address[] memory path, uint256 n) {
        path = new address[](MAX_DEPTH + 1);
        address t = token;
        while (t != address(0)) {
            if (!_legs[t].known || n == MAX_DEPTH) revert UnknownToken(t);
            path[n++] = t;
            t = _legs[t].quote;
        }
    }

    /// Fees on the route tokenIn → tokenOut: sell down tokenIn's chain until the shared quote,
    /// then buy up tokenOut's chain (the same route the swap adapter takes).
    function _routeKeepBps(address tokenIn, address tokenOut) internal view returns (uint256 keep) {
        keep = BPS;
        if (tokenIn == tokenOut) return keep;
        (address[] memory a, uint256 na) = _chain(tokenIn);
        (address[] memory b, uint256 nb) = _chain(tokenOut);
        // Find the first token of b's chain that also appears in a's chain (or HYPE).
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
        for (uint256 i; i < ia; ++i) {
            keep = (keep * (BPS - positionManager.currentSwapFee(_legs[a[i]].id, false))) / BPS;
        }
        for (uint256 j; j < ib; ++j) {
            keep = (keep * (BPS - positionManager.currentSwapFee(_legs[b[j]].id, true))) / BPS;
        }
    }
}
