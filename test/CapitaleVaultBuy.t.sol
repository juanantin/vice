// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {CapitaleVault, IFeeEscrow} from "../src/CapitaleVault.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";

/// Tax split, buy rules, rejection and pauses, ops payout, one token per city.
contract CapitaleVaultBuyTest is BaseTest {
    function setUp() public override {
        super.setUp();
        goPublic();
        build(alice, BRICKELL); // #1, earns SENT
    }

    function test_taxSplit70_15_15() public {
        payTax(1 ether);
        vault.settle();
        assertEq(vault.residentsFunds(), 0.7 ether);
        assertEq(vault.streetFunds(), 0.15 ether);
        assertEq(vault.opsFunds(), 0.15 ether);
        assertEq(vault.totalTax(), 1 ether);
    }

    function test_taxSplitNoDust(uint96 amount) public {
        payTax(amount);
        vault.settle();
        assertEq(vault.residentsFunds() + vault.streetFunds() + vault.opsFunds(), amount);
    }

    function test_payOpsAnyone() public {
        payTax(1 ether);
        vm.prank(bob);
        vault.payOps();
        assertEq(volta.balanceOf(opsSafe), 0.15 ether);
        assertEq(vault.opsFunds(), 0);
        vm.expectRevert(CapitaleVault.NothingToPay.selector);
        vault.payOps();
    }

    function test_buyBelowMinimumSkipped() public {
        payTax(0.1 ether); // 0.07 residents' share < 0.1 minimum (the street share waits for Sunday)
        assertFalse(vault.requestBuy());
        assertEq(vault.totalPurchases(), 0);
        payTax(0.1 ether); // 0.14
        assertTrue(vault.requestBuy());
        assertEq(vault.totalPurchases(), 1);
    }

    function test_buyCappedAtMaxOrderAndRemainderWaits() public {
        payTax(1 ether); // 0.7 residents' share
        vm.prank(bob); // anyone can trigger
        assertTrue(vault.requestBuy());
        assertEq(vault.residentsFunds(), 0.1 ether);
        assertEq(vault.streetFunds(), 0.15 ether); // waits for the deadline
        assertEq(rewards[SENT_IDX].balanceOf(address(vault)), fill(SENT_IDX, 0.6 ether));
        // Interval: next order no sooner than 10 minutes.
        vm.warp(block.timestamp + 10 minutes - 1);
        assertFalse(vault.requestBuy());
        vm.warp(block.timestamp + 1);
        assertTrue(vault.requestBuy());
        assertEq(vault.residentsFunds(), 0);
    }

    function test_residentsBoughtNowStreetAfterTheDeadline() public {
        payTax(0.2 ether); // 0.14 residents + 0.03 street
        assertTrue(vault.requestBuy());
        assertEq(vault.pending(1, SENT_IDX), fill(SENT_IDX, 0.14 ether));
        assertEq(vault.streetFunds(), 0.03 ether);
        vm.warp(FIRST_DEADLINE);
        vault.settle(); // Brickell won the race: its prize waits to be bought in SENT
        assertEq(vault.streetFunds(), 0);
        assertEq(vault.cityStreetFunds(BRICKELL), 0.03 ether);
        assertFalse(vault.requestBuy()); // 0.03 alone is below the minimum order
        payTax(0.1 ether); // +0.07 residents: 0.1 to buy
        assertTrue(vault.requestBuy());
        assertEq(vault.cityStreetTotal(), 0);
        assertEq(vault.pending(1, SENT_IDX), fill(SENT_IDX, 0.24 ether));
        assertEq(vault.totalBoughtUsd(), 720e18); // 0.24 income * $3,000
    }

    function test_eachCityEarnsItsOwnToken() public {
        build(bob, DOWNTOWN); // #2 VOLTA
        build(carol, WYNWOOD); // #3 follows the vote: SENT in week 0
        build(carol, MIAMI_BEACH); // #4 VOID
        payTax(0.2 ether); // 0.14 residents: 0.035 per building
        assertTrue(vault.requestBuy());
        assertEq(vault.pending(1, SENT_IDX), fill(SENT_IDX, 0.035 ether));
        assertEq(vault.pending(2, VOLTA_IDX), 0.035 ether);
        assertEq(vault.pending(3, SENT_IDX), fill(SENT_IDX, 0.035 ether));
        assertEq(vault.pending(4, VOID_IDX), fill(VOID_IDX, 0.035 ether));
        // Nothing in the other tokens.
        assertEq(vault.pending(1, VOID_IDX) + vault.pending(1, VOLTA_IDX), 0);
        assertEq(vault.pending(2, SENT_IDX) + vault.pending(2, VOID_IDX), 0);
        assertEq(vault.pending(4, SENT_IDX) + vault.pending(4, VOLTA_IDX), 0);
        // Same value for every building: 0.035 income * $3,000.
        for (uint256 id = 1; id <= 4; ++id) {
            assertEq(vault.pendingUsd(id), 105e18);
        }
        // Brickell and Wynwood share one SENT swap: three tokens bought in this order.
        assertEq(vault.totalPurchases(), 3);
        uint8[] memory ct = vault.cityTokens();
        assertEq(ct.length, 4);
        assertEq(ct[BRICKELL], SENT_IDX);
        assertEq(ct[DOWNTOWN], VOLTA_IDX);
        assertEq(ct[WYNWOOD], SENT_IDX);
        assertEq(ct[MIAMI_BEACH], VOID_IDX);
    }

    function test_splitByBuildingCount() public {
        build(alice, BRICKELL); // Brickell 2
        build(bob, DOWNTOWN); // Downtown 1
        payTax(0.3 ether); // 0.21 residents: 0.14 Brickell, 0.07 Downtown
        assertTrue(vault.requestBuy());
        assertEq(vault.pending(1, SENT_IDX), fill(SENT_IDX, 0.07 ether));
        assertEq(vault.pending(2, SENT_IDX), fill(SENT_IDX, 0.07 ether));
        assertEq(vault.pending(3, VOLTA_IDX), 0.07 ether);
        assertEq(vault.pendingUsd(1), vault.pendingUsd(3));
    }

    function test_voteCityFollowsTheVote() public {
        build(bob, WYNWOOD); // #2
        assertEq(vault.tokenOfCity(WYNWOOD), SENT_IDX);
        vm.prank(alice);
        vault.vote(ids1(1), VOID_IDX); // a Brickell building votes too: the vote is city-wide
        vm.warp(FIRST_DEADLINE);
        payTax(0.2 ether);
        assertTrue(vault.requestBuy()); // settles first
        assertEq(vault.tokenOfCity(WYNWOOD), VOID_IDX);
        assertEq(vault.tokenOfCity(BRICKELL), SENT_IDX); // fixed cities do not change
        assertGt(vault.pending(2, VOID_IDX), 0);
        assertEq(vault.pending(2, SENT_IDX), 0);
        assertGt(vault.pending(1, SENT_IDX), 0);
        assertEq(vault.pending(1, VOID_IDX), 0);
    }

    function test_rejectionKeepsIncomeAndPauses6h() public {
        payTax(1 ether);
        adapter.setQuality(9_500); // 5% worse than reference > 4% allowed
        vm.expectEmit(false, false, false, false, address(vault));
        emit CapitaleVault.BuyRejected(0, 0, 0, 0, "");
        assertFalse(vault.requestBuy());
        assertEq(vault.residentsFunds() + vault.streetFunds(), 0.85 ether);
        assertEq(vaultIncome(), 1 ether);
        assertEq(vault.pausedUntil(), block.timestamp + 6 hours);

        adapter.setQuality(10_000);
        vm.warp(block.timestamp + 6 hours - 1);
        assertFalse(vault.requestBuy());
        vm.warp(block.timestamp + 1);
        assertTrue(vault.requestBuy());
    }

    function test_oneBadTokenRejectsTheWholeOrder() public {
        build(bob, DOWNTOWN); // VOLTA needs no swap
        payTax(1 ether);
        adapter.setQuality(9_500); // the SENT swap fails the check
        assertFalse(vault.requestBuy());
        assertEq(vault.heldRewards(VOLTA_IDX), 0); // Downtown's part was not bought either
        assertEq(vault.residentsFunds(), 0.7 ether);
    }

    function test_withinDeviationAccepted() public {
        payTax(1 ether);
        adapter.setQuality(9_601);
        assertTrue(vault.requestBuy());
    }

    function test_adapterIgnoringMinOutStillRejected() public {
        payTax(1 ether);
        adapter.setHonourMinOut(false);
        adapter.setQuality(5_000);
        assertFalse(vault.requestBuy());
        assertEq(rewards[SENT_IDX].balanceOf(address(vault)), 0);
        assertEq(vault.residentsFunds() + vault.streetFunds(), 0.85 ether);
    }

    function test_brokenOrMissingAdapterRejected() public {
        payTax(1 ether);
        adapter.setBroken(true);
        assertFalse(vault.requestBuy());
        vm.warp(block.timestamp + 6 hours);
        vm.prank(admin);
        vault.setAdapter(SENT_IDX, ISwapAdapter(address(0)));
        assertFalse(vault.requestBuy());
        assertEq(vaultIncome(), 1 ether);
    }

    function test_decimalsHandled() public {
        build(carol, MIAMI_BEACH); // VOID (test copy) has 6 decimals
        payTax(0.2 ether); // 0.07 per building
        assertTrue(vault.requestBuy());
        assertEq(rewards[VOID_IDX].balanceOf(address(vault)), fill(VOID_IDX, 0.07 ether));
        assertEq(fill(VOID_IDX, 0.07 ether), 105e6); // 0.07 * $3000 / $2
    }

    function test_doubleVoltaConfig() public {
        // The alternative setup: Wynwood earns VOLTA like Downtown instead of following the vote.
        CapitaleVault v2 = deployVaultWith(
            allTokens(), allRoutes(), 4, IFeeEscrow(address(0)), [SENT_IDX, VOLTA_IDX, VOLTA_IDX, VOID_IDX]
        );
        vm.startPrank(address(nft));
        v2.onMint(1, DOWNTOWN, false);
        v2.onMint(2, WYNWOOD, false);
        vm.stopPrank();
        volta.mint(address(v2), 0.2 ether);
        assertTrue(v2.requestBuy());
        assertEq(v2.totalPurchases(), 1); // one VOLTA allocation for both cities
        assertEq(v2.pending(1, VOLTA_IDX), 0.07 ether);
        assertEq(v2.pending(2, VOLTA_IDX), 0.07 ether);
    }

    function test_badCityTokenRejected() public {
        IFeeEscrow noEscrow = IFeeEscrow(address(0));
        vm.expectRevert(CapitaleVault.BadToken.selector);
        deployVaultWith(allTokens(), allRoutes(), 4, noEscrow, [SENT_IDX, VOLTA_IDX, 3, VOID_IDX]);
        // Cities beyond the deploy count are ignored.
        deployVaultWith(allTokens(), allRoutes(), 2, noEscrow, [SENT_IDX, VOLTA_IDX, 9, 9]);
    }

    function test_noBuildingsResidentsFundsWait() public {
        CapitaleVault v2 = deployVault(allTokens(), allRoutes(), 4, IFeeEscrow(address(0)));
        volta.mint(address(v2), 1 ether);
        assertFalse(v2.requestBuy()); // nobody to receive them yet
        assertEq(v2.residentsFunds(), 0.7 ether);
    }

    function test_schedulerIdleAfter24hAndRestartedByRequest() public {
        assertTrue(vault.schedulerActive());
        vm.warp(block.timestamp + 24 hours + 1);
        assertFalse(vault.schedulerActive());
        vm.prank(carol);
        vault.requestBuy(); // nothing to buy, but restarts the scheduler
        assertTrue(vault.schedulerActive());
    }

    function test_executeBuyOnlySelf() public {
        vm.expectRevert(CapitaleVault.NotSelf.selector);
        vault.executeBuy(1, 1, 1, 0);
    }

    function test_refundedIncomeBecomesTax() public {
        payTax(1 ether);
        vault.settle();
        // Income sent directly (e.g. a router refund) is treated as new tax, never lost.
        payTax(0.1 ether);
        vault.settle();
        assertEq(vault.totalTax(), 1.1 ether);
    }
}
