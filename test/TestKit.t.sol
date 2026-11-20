// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestKit, TestToken, TestSwapAdapter} from "../src/testnet/TestKit.sol";
import {ViceNFT} from "../src/ViceNFT.sol";
import {VicePricing} from "../src/VicePricing.sol";
import {ViceVault, IViceNFTView, IFeeEscrow, IWETH} from "../src/ViceVault.sol";
import {IViceOracle} from "../src/interfaces/IViceOracle.sol";
import {IVicePricing} from "../src/interfaces/IVicePricing.sol";
import {IViceVault} from "../src/interfaces/IViceVault.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";

/// The exact deploy sequence the website's "Deploy test city" button runs, end to end:
/// $VICE trading credits creator fees (in VOLTA) to the escrow, the vault collects them,
/// buys VOLTA / SENT / VOID and buildings claim them.
contract TestKitTest is Test {
    address juan = makeAddr("juan");

    function test_fullTestFlow() public {
        vm.warp(1_793_613_600);
        vm.startPrank(juan);
        TestKit kit = new TestKit();
        VicePricing pricing = new VicePricing(
            juan, IViceOracle(address(kit.oracle())), block.timestamp, 300, 40e18, [uint256(52e18), 68e18, 88e18, 120e18]
        );
        ViceNFT nft = new ViceNFT(IERC20(address(kit.vice())), IVicePricing(address(pricing)), juan, 4);
        TestToken[3] memory r = kit.rewardTokens();
        IERC20[] memory toks = new IERC20[](3);
        ISwapAdapter[] memory routes = new ISwapAdapter[](3);
        for (uint256 i; i < 3; ++i) {
            toks[i] = IERC20(address(r[i]));
            routes[i] = ISwapAdapter(address(kit.adapter()));
        }
        ViceVault vault = new ViceVault(
            ViceVault.Setup({
                owner: juan,
                nft: IViceNFTView(address(nft)),
                earlyBirdEnd: pricing.earlyBirdEnd(),
                income: IERC20(address(kit.volta())),
                feeEscrow: IFeeEscrow(address(kit.feeEscrow())),
                oracle: IViceOracle(address(kit.oracle())),
                ops: juan,
                weth: IWETH(address(0)),
                districts: 4,
                initialToken: 1, // the vote city starts on SENT
                // Brickell SENT, Downtown VOLTA, Wynwood follows the vote, Miami Beach VOID (kit order: VOLTA, SENT, VOID).
                cityTokens: [uint8(1), 0, 254, 2]
            }),
            toks,
            routes,
            ViceVault.BuyParams({minOrder: 10e18, maxOrder: 1_000e18, minInterval: 10 minutes, rejectPause: 6 hours, maxDeviationBps: 400})
        );
        pricing.setNft(address(nft));
        nft.setVault(IViceVault(address(vault)));

        kit.vice().faucet();
        kit.vice().approve(address(nft), type(uint256).max);
        assertEq(nft.mint(2, 1, 0, type(uint256).max), 1); // a Wynwood building
        vm.stopPrank();

        // $VICE trades; Volta credits the creator share to the vault; anyone collects it.
        kit.feeEscrow().simulateTrading(address(vault), 100e18);
        assertEq(vault.collectCreatorFees(), 100e18);
        assertEq(vault.totalTax(), 100e18);
        assertTrue(vault.requestBuy());
        vm.warp(block.timestamp + 6 hours);
        vault.settle();
        assertGt(vault.pending(1, 1), 0);

        // Wynwood follows the vote. Week 2 buys VOLTA itself: no swap, set aside 1:1 for buildings.
        // Fees collected right at the deadline still count for the week that ended (settlement
        // is lazy), so Wynwood's street prize is 15% of both payments: 70 + 30 = 100.
        vm.prank(juan);
        vault.vote(_ids(1), 0);
        vm.warp(vault.weekEnd());
        kit.feeEscrow().simulateTrading(address(vault), 100e18);
        vault.collectCreatorFees();
        assertTrue(vault.requestBuy());
        assertEq(vault.heldRewards(0), 100e18);

        vm.prank(juan);
        vault.claim(1);
        assertGt(r[1].balanceOf(juan), 0);
        assertEq(r[0].balanceOf(juan), 100e18); // residents' 70 + the 30 street prize, all to the one building

        // A bad fill on a swapped token is rejected and pauses buying.
        vm.prank(juan);
        vault.vote(_ids(1), 2);
        vm.warp(vault.weekEnd());
        TestSwapAdapter adapter = kit.adapter();
        vm.prank(juan);
        adapter.setQuality(9_000);
        kit.feeEscrow().simulateTrading(address(vault), 100e18);
        vault.collectCreatorFees();
        assertFalse(vault.requestBuy());
        assertGt(vault.pausedUntil(), block.timestamp);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }
}
