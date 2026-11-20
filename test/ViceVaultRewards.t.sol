// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {ViceVault} from "../src/ViceVault.sol";

/// Dividends, early-bird pool, claims (incl. a failing token), height levels.
contract ViceVaultRewardsTest is BaseTest {
    function _buy(uint256 eth) internal {
        payTax(eth);
        vm.warp(block.timestamp + 10 minutes);
        require(vault.requestBuy(), "buy failed");
    }

    /// Tokens the residents' 70% of `tax` buys when it all goes to one city on token `t`.
    function _residentsOut(uint8 t, uint256 tax) internal view returns (uint256) {
        return fill(t, tax * 7000 / 10_000);
    }

    function test_splitEquallyAmongExistingBuildings() public {
        goPublic();
        build(alice, BRICKELL);
        build(bob, BRICKELL);
        _buy(0.2 ether);
        uint256 res = _residentsOut(0, 0.2 ether);
        assertEq(vault.pending(1, 0), res / 2);
        assertEq(vault.pending(2, 0), res / 2);
        // A later building gets nothing from earlier purchases.
        build(carol, 0);
        assertEq(vault.pending(3, 0), 0);
        _buy(0.2 ether);
        assertEq(vault.pending(3, 0), res / 3);
        assertApproxEqAbs(vault.pending(1, 0), res / 2 + res / 3, 1);
    }

    function test_voteCityChangesTokenFixedCitiesDoNot() public {
        goPublic();
        build(alice, BRICKELL); // SENT
        build(alice, DOWNTOWN); // VOLTA
        build(alice, WYNWOOD); // follows the vote
        build(alice, MIAMI_BEACH); // VOID
        _buy(0.2 ether); // week 0: Wynwood on SENT
        vm.prank(alice);
        vault.voteAll(VOID_IDX);
        vm.warp(vault.weekEnd());
        _buy(0.2 ether); // week 1: Wynwood on VOID
        assertGt(vault.pending(3, SENT_IDX), 0);
        assertGt(vault.pending(3, VOID_IDX), 0);
        assertEq(vault.pending(3, VOLTA_IDX), 0);
        assertEq(vault.pending(1, VOID_IDX) + vault.pending(1, VOLTA_IDX), 0);
        assertEq(vault.pending(2, SENT_IDX) + vault.pending(2, VOID_IDX), 0);
        assertEq(vault.pending(4, SENT_IDX) + vault.pending(4, VOLTA_IDX), 0);
        // Every building has earned the same value (week 0's street race was a 4-way tie).
        for (uint256 id = 2; id <= 4; ++id) {
            assertApproxEqAbs(vault.pendingUsd(id), vault.pendingUsd(1), 1e9);
        }
        uint256[] memory p = vault.pendingAll(3);
        assertEq(p.length, 3);
        vm.prank(alice);
        vault.claim(3);
        assertEq(rewards[SENT_IDX].balanceOf(alice), p[SENT_IDX]);
        assertEq(rewards[VOID_IDX].balanceOf(alice), p[VOID_IDX]);
    }

    function test_mayorGetsNothing() public {
        goPublic();
        build(alice, 0);
        _buy(0.2 ether);
        assertEq(vault.pending(0, 0), 0);
        vm.prank(mayor);
        vm.expectRevert(ViceVault.MayorExcluded.selector);
        vault.claim(0);
    }

    function test_noBuildingsFundsWait() public {
        goPublic();
        payTax(0.2 ether);
        vm.warp(block.timestamp + 10 minutes);
        assertFalse(vault.requestBuy()); // nobody to receive them: the income waits
        build(alice, BRICKELL);
        _buy(0.2 ether);
        assertEq(vault.pending(1, SENT_IDX), _residentsOut(SENT_IDX, 0.4 ether));
    }

    function test_earlyBirdPoolPerCity() public {
        vm.warp(START);
        build(alice, BRICKELL); // early bird
        build(bob, DOWNTOWN); // early bird
        _buy(0.2 ether); // during early bird: each city's part goes to its early-bird pool
        assertEq(vault.earlyBirdPool(BRICKELL, SENT_IDX), fill(SENT_IDX, 0.07 ether));
        assertEq(vault.earlyBirdPool(DOWNTOWN, VOLTA_IDX), 0.07 ether);
        assertEq(vault.pending(1, SENT_IDX), 0);

        goPublic();
        build(carol, BRICKELL); // not early bird, built after the window: settles the pools first
        assertTrue(vault.earlyBirdFinalized());
        assertEq(vault.pending(1, SENT_IDX), fill(SENT_IDX, 0.07 ether));
        assertEq(vault.pending(2, VOLTA_IDX), 0.07 ether);
        assertEq(vault.pending(3, SENT_IDX), 0);
    }

    function test_laterEarlyBirdsShareThePool() public {
        vm.warp(START);
        build(alice, BRICKELL);
        _buy(0.2 ether); // bought while alice was the only early bird
        build(bob, BRICKELL); // still early bird: shares the pool when the window closes
        goPublic();
        vault.settle();
        uint256 res = _residentsOut(SENT_IDX, 0.2 ether);
        assertEq(vault.pending(1, SENT_IDX), res / 2);
        assertEq(vault.pending(2, SENT_IDX), res / 2);
    }

    function test_claimPaysAllTokens() public {
        goPublic();
        build(alice, WYNWOOD); // follows the vote: earns each token in turn
        for (uint8 t; t < 3; ++t) {
            vm.prank(alice);
            vault.vote(ids1(1), t);
            vm.warp(vault.weekEnd());
            _buy(0.2 ether); // settles first, so it buys token t
        }
        uint256[] memory p = vault.pendingAll(1);
        assertEq(p.length, 3);
        vm.prank(alice);
        vault.claim(1);
        for (uint8 t; t < 3; ++t) {
            assertGt(p[t], 0);
            assertEq(rewards[t].balanceOf(alice), p[t]);
            assertEq(vault.pending(1, t), 0);
        }
    }

    function test_claimSkipsFailingTokenAndKeepsItClaimable() public {
        goPublic();
        build(alice, WYNWOOD);
        _buy(0.2 ether); // SENT
        vm.prank(alice);
        vault.vote(ids1(1), 1);
        vm.warp(vault.weekEnd());
        _buy(0.2 ether); // VOID
        uint256 p0 = vault.pending(1, 0);
        uint256 p1 = vault.pending(1, 1);

        rewards[0].setPaused(true);
        vm.prank(alice);
        vault.claim(1);
        assertEq(rewards[0].balanceOf(alice), 0);
        assertEq(rewards[1].balanceOf(alice), p1);
        assertEq(vault.pending(1, 0), p0); // still claimable

        rewards[0].setPaused(false);
        vm.prank(alice);
        vault.claim(1);
        assertEq(rewards[0].balanceOf(alice), p0);
    }

    function test_claimManyAndOwnership() public {
        goPublic();
        build(alice, BRICKELL);
        build(alice, BRICKELL);
        build(bob, BRICKELL);
        _buy(0.2 ether);
        uint256 each = vault.pending(1, 0);
        vm.prank(alice);
        vault.claimMany(ids2(1, 2));
        assertEq(rewards[0].balanceOf(alice), 2 * each);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ViceVault.NotBuildingOwner.selector, 3));
        vault.claim(3);
    }

    function test_rewardsFollowTheNft() public {
        goPublic();
        build(alice, 0);
        _buy(0.2 ether);
        uint256 p = vault.pending(1, 0);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ViceVault.NotBuildingOwner.selector, 1));
        vault.claim(1);
        vm.prank(bob);
        vault.claim(1);
        assertEq(rewards[0].balanceOf(bob), p);
    }

    function test_pendingUsdAtPurchaseTimeValue() public {
        goPublic();
        build(alice, 0);
        _buy(0.2 ether); // residents' 0.14 income * $3000 = $420
        uint256 expected = 420e18;
        assertEq(vault.pendingUsd(1), expected);
        // Later price moves do not change purchase-time value.
        oracle.setTokenUsd(address(rewards[0]), 5e18);
        assertApproxEqAbs(vault.pendingUsd(1), expected, 1);
    }

    function test_levels() public view {
        assertEq(vault.levelForUsd(0), 1);
        assertEq(vault.levelForUsd(5e18 - 1), 1);
        assertEq(vault.levelForUsd(5e18), 2);
        assertEq(vault.levelForUsd(20e18), 3);
        assertEq(vault.levelForUsd(50e18), 4);
        assertEq(vault.levelForUsd(100e18), 5);
        assertEq(vault.levelForUsd(150e18 - 1), 5);
        assertEq(vault.levelForUsd(150e18), 6);
        assertEq(vault.levelForUsd(1_100e18), 25);
    }

    function test_heightGrowsWithClaimsAndFollowsNft() public {
        goPublic();
        build(alice, 0);
        _buy(0.2 ether); // ~$420 to the only building
        assertEq(vault.levelOf(1), 1); // pending does not count, only claimed
        vm.prank(alice);
        vault.claim(1);
        uint256 usd = vault.claimedUsd(1);
        assertApproxEqAbs(usd, 420e18, 1);
        assertEq(vault.levelOf(1), 5 + (usd - 100e18) / 50e18);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        assertEq(vault.levelOf(1), 5 + (usd - 100e18) / 50e18);
    }

    function testFuzz_dividendsNeverExceedPurchases(uint8 nBuildings, uint96 tax) public {
        goPublic();
        nBuildings = uint8(bound(nBuildings, 1, 40));
        tax = uint96(bound(tax, 0.2 ether, 50 ether));
        for (uint256 i; i < nBuildings; ++i) {
            build(i % 2 == 0 ? alice : bob, uint8(i % 4));
        }
        payTax(tax);
        vm.warp(vault.weekEnd());
        vault.settle(); // the street prize goes to the winners too
        for (uint256 k; k < 200 && vault.residentsFunds() + vault.cityStreetTotal() >= 0.1 ether; ++k) {
            vm.warp(block.timestamp + 10 minutes);
            vault.requestBuy();
        }
        for (uint8 t; t < 3; ++t) {
            uint256 sum;
            for (uint256 id = 1; id <= nBuildings; ++id) {
                sum += vault.pending(id, t);
            }
            assertLe(sum + vault.carry(t), vault.heldRewards(t));
            // Only rounding dust stays behind (a few wei per order).
            assertApproxEqAbs(sum + vault.carry(t), vault.heldRewards(t), 2_000);
            assertLe(vault.carry(t), 2_000);
        }
    }
}
