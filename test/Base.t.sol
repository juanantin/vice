// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CapitaleNFT} from "../src/CapitaleNFT.sol";
import {CapitalePricing} from "../src/CapitalePricing.sol";
import {CapitaleVault, ICapitaleNFTView, IFeeEscrow, IWETH} from "../src/CapitaleVault.sol";
import {ICapitaleOracle} from "../src/interfaces/ICapitaleOracle.sol";
import {ICapitalePricing} from "../src/interfaces/ICapitalePricing.sol";
import {ICapitaleVault} from "../src/interfaces/ICapitaleVault.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {MockSwapAdapter} from "./mocks/MockSwapAdapter.sol";

abstract contract BaseTest is Test {
    // Monday 2026-11-02 10:00 UTC. First weekly deadline: Sunday 2026-11-08 19:00 UTC (20:00 CET).
    uint256 internal constant T0 = 1793613600;
    uint256 internal constant FIRST_DEADLINE = 1794164400;
    uint256 internal constant START = T0 + 1 hours;

    uint256 internal constant CAP_PRICE = 1e15; // $0.001
    // Test income token (stands in for $VOLTA). Its made-up price keeps the arithmetic of the
    // buy tests simple: 1 income token = $3,000.
    uint256 internal constant INCOME_USD = 3000e18;
    uint8 internal constant VOLTA_IDX = 2;
    uint8 internal constant SENT_IDX = 0;
    uint8 internal constant VOID_IDX = 1;
    // Cities: 0 Brickell (SENT), 1 Downtown (VOLTA), 2 Wynwood (follows the vote), 3 Miami Beach (VOID).
    uint8 internal constant BRICKELL = 0;
    uint8 internal constant DOWNTOWN = 1;
    uint8 internal constant WYNWOOD = 2;
    uint8 internal constant MIAMI_BEACH = 3;

    address internal admin = makeAddr("timelock");
    address internal opsSafe = makeAddr("opsSafe");
    address internal mayor = makeAddr("mayor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    MockERC20 internal capitale;
    MockERC20[3] internal rewards; // SENT, VOID, VOLTA (the income token)
    MockERC20 internal volta;
    MockOracle internal oracle;
    MockSwapAdapter internal adapter;
    CapitalePricing internal pricing;
    CapitaleNFT internal nft;
    CapitaleVault internal vault;

    uint256[3] internal tokenUsd = [uint256(0.5e18), 2e18, INCOME_USD];

    function setUp() public virtual {
        vm.warp(T0);
        capitale = new MockERC20("Capitale", "CAPITALE", 18);
        rewards[0] = new MockERC20("Sent.family", "SENT", 18);
        rewards[1] = new MockERC20("voidcash", "VOID", 6); // different decimals on purpose
        volta = new MockERC20("Volta", "VOLTA", 18);
        rewards[2] = volta;

        oracle = new MockOracle();
        oracle.setCapitale(CAP_PRICE, CAP_PRICE);
        oracle.setIncomeUsd(INCOME_USD);
        adapter = new MockSwapAdapter();
        for (uint256 i; i < 3; ++i) {
            oracle.setTokenUsd(address(rewards[i]), tokenUsd[i]);
            adapter.setPrices(INCOME_USD, address(rewards[i]), tokenUsd[i]);
        }

        pricing = new CapitalePricing(
            admin, ICapitaleOracle(address(oracle)), START, 300, 40e18, [uint256(52e18), 68e18, 88e18, 120e18]
        );
        nft = new CapitaleNFT(IERC20(address(capitale)), ICapitalePricing(address(pricing)), mayor, 4);
        vault = deployVault(allTokens(), allRoutes(), 4, IFeeEscrow(address(0)));
        nft.setVault(ICapitaleVault(address(vault)));
        vm.startPrank(admin);
        pricing.setNft(address(nft));
        vm.stopPrank();
    }

    function allTokens() internal view returns (IERC20[] memory toks) {
        toks = new IERC20[](3);
        for (uint256 i; i < 3; ++i) {
            toks[i] = IERC20(address(rewards[i]));
        }
    }

    function allRoutes() internal view returns (ISwapAdapter[] memory routes) {
        routes = new ISwapAdapter[](3);
        for (uint256 i; i < 3; ++i) {
            routes[i] = adapter;
        }
    }

    function deployVault(IERC20[] memory toks, ISwapAdapter[] memory routes, uint8 cities, IFeeEscrow escrow)
        internal
        returns (CapitaleVault)
    {
        return deployVaultWith(toks, routes, cities, escrow, [SENT_IDX, VOLTA_IDX, 254, VOID_IDX]);
    }

    function deployVaultWith(
        IERC20[] memory toks,
        ISwapAdapter[] memory routes,
        uint8 cities,
        IFeeEscrow escrow,
        uint8[4] memory cityTokens
    ) internal returns (CapitaleVault) {
        return new CapitaleVault(
            CapitaleVault.Setup({
                owner: admin,
                nft: ICapitaleNFTView(address(nft)),
                earlyBirdEnd: START + 6 hours,
                income: IERC20(address(volta)),
                feeEscrow: escrow,
                oracle: ICapitaleOracle(address(oracle)),
                ops: opsSafe,
                weth: IWETH(address(0)),
                districts: cities,
                initialToken: 0,
                cityTokens: cityTokens
            }),
            toks,
            routes,
            defaultParams()
        );
    }

    /// Income held by the vault that is not owed to buildings.
    function vaultIncome() internal view returns (uint256) {
        return volta.balanceOf(address(vault)) - vault.heldRewards(VOLTA_IDX);
    }

    function defaultParams() internal pure returns (CapitaleVault.BuyParams memory) {
        return CapitaleVault.BuyParams({
            minOrder: 0.1 ether,
            maxOrder: 0.6 ether,
            minInterval: 10 minutes,
            rejectPause: 6 hours,
            maxDeviationBps: 400
        });
    }

    // ─────────── helpers ───────────

    function build(address who, uint8 district) internal returns (uint256 id) {
        return build(who, district, 0, 0);
    }

    function build(address who, uint8 district, uint8 style, uint256 inviter) internal returns (uint256 id) {
        capitale.mint(who, 1_000_000e18);
        vm.startPrank(who);
        capitale.approve(address(nft), type(uint256).max);
        id = nft.mint(district, style, inviter, type(uint256).max);
        vm.stopPrank();
    }

    function buildMany(address who, uint8 district, uint256 n) internal {
        capitale.mint(who, n * 1_000_000e18);
        vm.startPrank(who);
        capitale.approve(address(nft), type(uint256).max);
        for (uint256 i; i < n; ++i) {
            nft.mint(district, 0, 0, type(uint256).max);
        }
        vm.stopPrank();
    }

    function payTax(uint256 amount) internal {
        volta.mint(address(vault), amount); // creator fees arriving in $VOLTA
    }

    function goPublic() internal {
        vm.warp(pricing.earlyBirdEnd());
    }

    function ids1(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function ids2(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    /// Tokens bought by an order of `eth` at the oracle price.
    function fill(uint8 t, uint256 eth) internal view returns (uint256) {
        return (eth * INCOME_USD * (10 ** rewards[t].decimals())) / (tokenUsd[t] * 1e18);
    }
}
