// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ViceOracle} from "../../src/volta/ViceOracle.sol";
import {VoltaSwapAdapter} from "../../src/volta/VoltaSwapAdapter.sol";
import {
    IPoolManager,
    IVoltaCreatorNFT,
    IVoltaOracle,
    IVoltaPositionManager,
    IVoltaPriceCalculator
} from "../../src/volta/VoltaInterfaces.sol";
import {ISwapAdapter} from "../../src/interfaces/ISwapAdapter.sol";
import {IViceOracle} from "../../src/interfaces/IViceOracle.sol";
import {IVicePricing} from "../../src/interfaces/IVicePricing.sol";
import {IViceVault} from "../../src/interfaces/IViceVault.sol";
import {VicePricing} from "../../src/VicePricing.sol";
import {ViceNFT} from "../../src/ViceNFT.sol";
import {ViceVault, IFeeEscrow, IViceNFTView, IWETH} from "../../src/ViceVault.sol";

/// Runs the real oracle, swap adapter and a whole city against a copy of live Elysium.
/// Skipped unless ELYSIUM_RPC is set:  ELYSIUM_RPC=https://rpc.elysium.kinetiq.xyz forge test --match-path 'test/fork/*'
///
/// SENT stands in for $VICE: like $VICE it is a Volta token paired with $VOLTA whose creator
/// takes 100% of the creator split, so its creator NFT, fees and pool behave the same way.
contract VoltaForkTest is Test {
    IPoolManager constant PM = IPoolManager(0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1);
    IVoltaPositionManager constant VPM = IVoltaPositionManager(0x3aB88DDc3CF2A012af88B60828edb4553697E5dC);
    IVoltaOracle constant VORACLE = IVoltaOracle(0xa2A5eBE297a141160ca5c513c74fD43cB2c09B2e);
    IVoltaPriceCalculator constant USDC_CALC = IVoltaPriceCalculator(0x0D673fF1c868e9Ff867C88DBb010E16be7D129b9);
    IVoltaPriceCalculator constant VOLTA_CALC = IVoltaPriceCalculator(0x5912279cA42210199B5fc99656754926e3F3A1A2);
    IVoltaPriceCalculator constant SENT_CALC = IVoltaPriceCalculator(0x2195b10bde969807Df2B361E5740b93784405647);
    IVoltaPriceCalculator constant VOID_CALC = IVoltaPriceCalculator(0x6bdb2E284fE00CA5B658955D7c3624d8Ff9dd6C8);
    IVoltaCreatorNFT constant CREATOR_NFT = IVoltaCreatorNFT(0xac466Ee5CEdD012eB750DBDA0B935F8B997402c7);
    address constant FEE_ESCROW = 0x3D36Beb546E451584736957F97E7EE9D2aCbD9a5;
    address constant VOLTA = 0x0f79931689Af199e7CF868ed1107bBA2C83c68f7;
    address constant SENT = 0xA713a15b85Cab304F9e2fbc649440B5e3AB8a8D4;
    address constant VOID = 0xD31B21Cb80E431AC996269deC31A40fCf048B77f;

    ViceOracle oracle;
    VoltaSwapAdapter adapter;
    address me = makeAddr("player");

    function setUp() public {
        string memory rpc = vm.envOr("ELYSIUM_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        address[] memory toks = new address[](4);
        toks[0] = SENT; // stand-in for $VICE
        toks[1] = VOLTA;
        toks[2] = VOID;
        toks[3] = SENT;
        oracle = new ViceOracle(PM, VPM, VORACLE, USDC_CALC, 6, SENT, VOLTA, toks);
        adapter = new VoltaSwapAdapter(PM, VPM);
        vm.deal(me, 1_000 ether);
    }

    function _close(uint256 a, uint256 b, uint256 bps, string memory what) internal pure {
        uint256 d = a > b ? a - b : b - a;
        require(d * 10_000 <= b * bps, what);
    }

    // ─────────── oracle ───────────

    function test_oracleMatchesVoltaCalculators() public view {
        uint256 hype = oracle.hypeUsd();
        console2.log("HYPE usd", hype);
        assertGt(hype, 1e18);
        // Spot prices agree with Volta's own calculators (HYPE price per token).
        _close(oracle.usdSpot(VOLTA), (hype * 1e18) / VOLTA_CALC.ethToPairedToken(1e18), 30, "VOLTA spot");
        _close(oracle.usdSpot(SENT), (hype * 1e18) / SENT_CALC.ethToPairedToken(1e18), 30, "SENT spot");
        _close(oracle.usdSpot(VOID), (hype * 1e18) / VOID_CALC.ethToPairedToken(1e18), 30, "VOID spot");
        // TWAPs exist and sit near spot on a quiet chain.
        _close(oracle.usdTwap(VOLTA), oracle.usdSpot(VOLTA), 1000, "VOLTA twap");
        _close(oracle.usdTwap(SENT), oracle.usdSpot(SENT), 1000, "SENT twap");
        _close(oracle.usdTwap(VOID), oracle.usdSpot(VOID), 1000, "VOID twap");
        console2.log("VOLTA usd", oracle.incomeUsd());
        console2.log("SENT usd", oracle.usdTwap(SENT));
        console2.log("VOID usd", oracle.usdTwap(VOID));
        // Buying SENT with VOLTA pays the SENT pool fee; VOID pays the VOLTA and VOID pool fees.
        assertEq(oracle.routeKeepBps(VOLTA, SENT), 10_000 - VPM.currentSwapFee(oracle.poolIdOf(SENT), true));
        assertLt(oracle.routeKeepBps(VOLTA, VOID), oracle.routeKeepBps(VOLTA, SENT));
        assertGt(oracle.tokenUsd(SENT), oracle.usdTwap(SENT));
    }

    function test_pokeIsClamped() public {
        uint256 h0 = oracle.hypeUsd();
        vm.expectRevert(ViceOracle.TooSoon.selector);
        oracle.poke();
        // A wildly different pool price only moves the reference 2% per poke.
        vm.mockCall(address(USDC_CALC), abi.encodeWithSelector(IVoltaPriceCalculator.ethToPairedToken.selector), abi.encode(uint256(1_000_000e6)));
        vm.warp(block.timestamp + 5 minutes);
        assertEq(oracle.poke(), (h0 * 10_200) / 10_000);
        vm.clearMockedCalls();
    }

    // ─────────── swaps ───────────

    function _buyVolta(uint256 hypeIn) internal returns (uint256 got) {
        vm.prank(me);
        got = adapter.swap{value: hypeIn}(address(0), VOLTA, hypeIn, 1, me);
    }

    function test_adapterSwapsWithinOracleBand() public {
        uint256 v = _buyVolta(1 ether);
        assertEq(IERC20(VOLTA).balanceOf(me), v);
        uint256 usdIn = (v / 4) * oracle.incomeUsd() / 1e18;
        console2.log("VOLTA bought for 1 HYPE", v);
        vm.startPrank(me);
        IERC20(VOLTA).approve(address(adapter), type(uint256).max);
        uint256 s = adapter.swap(VOLTA, SENT, v / 4, 1, me);
        uint256 d = adapter.swap(VOLTA, VOID, v / 4, 1, me);
        vm.stopPrank();
        // Value received vs the oracle's fee-adjusted reference: within 4% (small orders).
        uint256 expS = (usdIn * 1e18) / oracle.tokenUsd(SENT);
        uint256 expD = (usdIn * 1e18) / oracle.tokenUsd(VOID);
        console2.log("SENT got / expected", s, expS);
        console2.log("VOID got / expected", d, expD);
        assertGe(s, (expS * 9_600) / 10_000);
        assertGe(d, (expD * 9_600) / 10_000);
        assertEq(IERC20(SENT).balanceOf(address(adapter)) + IERC20(VOID).balanceOf(address(adapter)), 0);
    }

    function test_adapterEnforcesMinOut() public {
        uint256 v = _buyVolta(0.2 ether);
        vm.startPrank(me);
        IERC20(VOLTA).approve(address(adapter), v);
        vm.expectRevert();
        adapter.swap(VOLTA, SENT, v, type(uint128).max, me);
        vm.stopPrank();
    }

    // ─────────── a whole city on live pools ───────────

    VicePricing pricing;
    ViceNFT nft;
    ViceVault vault;
    address ops = makeAddr("ops");

    function _deployCity() internal {
        // Deploy the city exactly as the launch page does, with SENT standing in for $VICE.
        pricing = new VicePricing(
            address(this), IViceOracle(address(oracle)), block.timestamp, 300, 40e18, [uint256(52e18), 68e18, 88e18, 120e18]
        );
        nft = new ViceNFT(IERC20(SENT), IVicePricing(address(pricing)), address(this), 4);
        IERC20[] memory tokens = new IERC20[](3);
        tokens[0] = IERC20(VOLTA);
        tokens[1] = IERC20(SENT);
        tokens[2] = IERC20(VOID);
        ISwapAdapter[] memory adapters = new ISwapAdapter[](3);
        for (uint256 i; i < 3; ++i) adapters[i] = ISwapAdapter(address(adapter));
        uint256 vpu = 1e36 / oracle.incomeUsd(); // VOLTA per $1
        vault = new ViceVault(
            ViceVault.Setup({
                owner: address(this),
                nft: IViceNFTView(address(nft)),
                earlyBirdEnd: block.timestamp + 6 hours,
                income: IERC20(VOLTA),
                feeEscrow: IFeeEscrow(FEE_ESCROW),
                oracle: IViceOracle(address(oracle)),
                ops: ops,
                weth: IWETH(address(0)),
                districts: 4,
                initialToken: 0,
                cityTokens: [uint8(1), 0, 254, 2]
            }),
            tokens,
            adapters,
            ViceVault.BuyParams({
                minOrder: uint128(5 * vpu),
                maxOrder: uint128(150 * vpu),
                minInterval: 10 minutes,
                rejectPause: 6 hours,
                maxDeviationBps: 400
            })
        );
        pricing.setNft(address(nft));
        nft.setVault(IViceVault(address(vault)));

        // The creator NFT moves into the vault: from now on the creator fee is the city tax.
        uint256 cid = CREATOR_NFT.tokenId(SENT);
        address creator = CREATOR_NFT.ownerOf(cid);
        vm.prank(creator);
        CREATOR_NFT.safeTransferFrom(creator, address(vault), cid);
        assertEq(CREATOR_NFT.ownerOf(cid), address(vault));
    }

    function _buildFour() internal returns (uint256 v) {
        // Players build: they need "VICE" (SENT here) to burn.
        v = _buyVolta(40 ether);
        vm.startPrank(me);
        IERC20(VOLTA).approve(address(adapter), type(uint256).max);
        adapter.swap(VOLTA, SENT, v / 2, 1, me);
        IERC20(SENT).approve(address(nft), type(uint256).max);
        (uint256 cost,) = pricing.quote(1);
        console2.log("early-bird build burns (stand-in VICE)", cost);
        nft.mint(0, 0, 0, (cost * 102) / 100);
        nft.mint(1, 1, 1, type(uint256).max);
        nft.mint(2, 2, 1, type(uint256).max);
        nft.mint(3, 0, 2, type(uint256).max);
        vm.stopPrank();
        assertEq(nft.totalResidents(), 4);
    }

    function _trade(uint256 v) internal returns (uint256 credited) {
        // $VICE trading (SENT here): every trade pays the pool fee; the creator part is
        // credited to the vault in Volta's FeeEscrow, in VOLTA.
        uint256 before = IFeeEscrow(FEE_ESCROW).balances(address(vault), VOLTA);
        vm.startPrank(me);
        for (uint256 i; i < 6; ++i) {
            uint256 s = adapter.swap(VOLTA, SENT, v / 20, 1, me);
            IERC20(SENT).approve(address(adapter), s);
            adapter.swap(SENT, VOLTA, s, 1, me);
        }
        vm.stopPrank();
        credited = IFeeEscrow(FEE_ESCROW).balances(address(vault), VOLTA) - before;
        console2.log("creator fees credited to the vault (VOLTA)", credited);
        assertGt(credited, 0);
    }

    function test_fullCityOnLivePools() public {
        _deployCity();
        uint256 v = _buildFour();
        uint256 credited = _trade(v);

        // Anyone collects them into the vault; it splits 70 / 15 / 15.
        // (It also collects the fees paid by the players' own purchases above.)
        uint256 got = vault.collectCreatorFees();
        assertGe(got, credited);
        assertEq(vault.totalTax(), got);
        assertEq(IFeeEscrow(FEE_ESCROW).balances(address(vault), VOLTA), 0);

        // Let the 10-minute TWAPs settle after all that trading, then the keeper buys.
        vm.warp(block.timestamp + 20 minutes);
        vm.roll(block.number + 600);
        uint256 g0 = gasleft();
        bool bought = vault.requestBuy();
        console2.log("requestBuy gas (3 tokens, 2 swaps)", g0 - gasleft());
        console2.log("bought", bought);
        assertTrue(bought, "buy executed within the 4% band");
        assertGt(vault.heldRewards(1), 0, "SENT bought for Brickell");
        assertGt(vault.heldRewards(0), 0, "VOLTA kept for Downtown and Wynwood");
        assertGt(vault.heldRewards(2), 0, "VOID bought for Miami Beach");

        // Early bird ends; pools are shared; residents claim real tokens.
        vm.warp(block.timestamp + 6 hours);
        vault.settle();
        uint256 s0 = IERC20(SENT).balanceOf(me);
        uint256 d0 = IERC20(VOID).balanceOf(me);
        uint256[] memory ids = new uint256[](4);
        for (uint256 i; i < 4; ++i) ids[i] = i + 1;
        vm.prank(me);
        vault.claimMany(ids);
        assertGt(IERC20(SENT).balanceOf(me), s0);
        assertGt(IERC20(VOID).balanceOf(me), d0);
        console2.log("pending USD after claim", vault.pendingUsd(1));
        console2.log("claimed USD #1", vault.claimedUsd(1));

        // Ops share goes to the ops wallet only.
        vault.payOps();
        assertGt(IERC20(VOLTA).balanceOf(ops), 0);
    }
}
