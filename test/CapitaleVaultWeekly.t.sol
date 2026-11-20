// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CapitaleVault, IFeeEscrow} from "../src/CapitaleVault.sol";
import {ICapitaleOracle} from "../src/interfaces/ICapitaleOracle.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";

/// Weekly vote, transfer lock, street competition, lazy settlement and rollover, permissions.
contract CapitaleVaultWeeklyTest is BaseTest {
    function setUp() public override {
        super.setUp();
        goPublic();
    }

    /// Pays `tax` now; its 15% street share waits for the deadline.
    function _payStreet(uint256 tax) internal {
        payTax(tax);
        vault.settle();
    }

    // ─────────── votes ───────────

    function test_firstDeadlineIsSunday20Rome() public view {
        assertEq(vault.weekEnd(), FIRST_DEADLINE);
    }

    function test_onePerBuildingPerWeek() public {
        build(alice, 0);
        build(alice, 1);
        vm.startPrank(alice);
        vault.vote(ids2(1, 2), 1);
        vm.expectRevert(abi.encodeWithSelector(CapitaleVault.AlreadyVoted.selector, 1));
        vault.vote(ids1(1), 0);
        vm.stopPrank();
        assertEq(vault.votesOf(0)[1], 2);
        assertEq(vault.votesOf(0).length, 3);
        assertTrue(vault.hasVoted(1));
        // Next week the building can vote again.
        vm.warp(FIRST_DEADLINE);
        vm.prank(alice);
        vault.vote(ids1(1), 0);
        assertEq(vault.votesOf(1)[0], 1);
    }

    function test_duplicateIdsInOneCallRejected() public {
        build(alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CapitaleVault.AlreadyVoted.selector, 1));
        vault.vote(ids2(1, 1), 1);
    }

    function test_mayorAndNonOwnerCannotVote() public {
        build(alice, 0);
        vm.prank(mayor);
        vm.expectRevert(CapitaleVault.MayorExcluded.selector);
        vault.vote(ids1(0), 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CapitaleVault.NotBuildingOwner.selector, 1));
        vault.vote(ids1(1), 1);
        vm.prank(alice);
        vm.expectRevert(CapitaleVault.BadToken.selector);
        vault.vote(ids1(1), 3); // only SENT (0), VOID (1) and VOLTA (2)
    }

    function test_voteAllSkipsVotedAndMayor() public {
        build(alice, 0);
        build(alice, 1);
        build(alice, 0);
        vm.prank(mayor);
        nft.transferFrom(mayor, alice, 0); // even holding the Mayor, it never votes
        vm.startPrank(alice);
        vault.vote(ids1(2), 0);
        assertEq(vault.voteAll(1), 2);
        assertEq(vault.voteAll(1), 0);
        vm.stopPrank();
        assertEq(vault.votesOf(0)[1], 2);
        assertEq(vault.votesOf(0)[0], 1);
    }

    function test_transferLockWithinWeek() public {
        build(alice, 0);
        vm.prank(alice);
        vault.vote(ids1(1), 1);
        vm.prank(alice);
        nft.transferFrom(alice, bob, 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CapitaleVault.AlreadyVoted.selector, 1));
        vault.vote(ids1(1), 0);
        vm.prank(bob);
        assertEq(vault.voteAll(0), 0);
        vm.warp(FIRST_DEADLINE);
        vm.prank(bob);
        vault.vote(ids1(1), 0);
    }

    function test_mostVotesPicksNextWeekToken() public {
        build(alice, 0);
        build(alice, 0);
        build(bob, 1);
        vm.prank(alice);
        vault.voteAll(1); // 2 votes STONKEX
        vm.prank(bob);
        vault.voteAll(0); // 1 vote STOCKIFY
        assertEq(vault.currentToken(), 0); // unchanged until the deadline
        vm.warp(FIRST_DEADLINE - 1);
        vault.settle();
        assertEq(vault.currentToken(), 0);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        assertEq(vault.currentToken(), 1);
        assertEq(vault.week(), 1);
    }

    function test_tieOrNoVotesKeepsToken() public {
        build(alice, 0);
        build(bob, 0);
        vm.prank(alice);
        vault.voteAll(1);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        assertEq(vault.currentToken(), 1); // STONKEX won week 0
        vm.prank(alice);
        vault.voteAll(1);
        vm.prank(bob);
        vault.voteAll(0);
        vm.warp(vault.weekEnd());
        vault.settle();
        assertEq(vault.currentToken(), 1); // 1-1 tie: unchanged (not reset to the first token)
        vm.warp(vault.weekEnd());
        vault.settle();
        assertEq(vault.currentToken(), 1); // no votes: unchanged
    }

    // ─────────── street competition ───────────

    function test_districtWithMostNewBuildingsWins() public {
        build(alice, BRICKELL);
        build(alice, DOWNTOWN);
        build(bob, DOWNTOWN);
        _payStreet(0.2 ether);
        assertEq(vault.streetFunds(), 0.03 ether);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        // Downtown built 2 this week vs Brickell 1: Downtown wins the whole street share.
        assertEq(vault.cityStreetFunds(DOWNTOWN), 0.03 ether);
        assertEq(vault.cityStreetFunds(BRICKELL), 0);
        assertEq(vault.streetFunds(), 0);
        // The next order buys it in Downtown's token (VOLTA) for Downtown's two buildings, on top of
        // the residents' share (0.14 split by count: 1/3 Brickell, 2/3 Downtown).
        assertTrue(vault.requestBuy());
        assertApproxEqAbs(vault.pending(2, VOLTA_IDX), 0.015 ether + uint256(0.14 ether) / 3, 2);
        assertEq(vault.pending(2, VOLTA_IDX), vault.pending(3, VOLTA_IDX));
        assertApproxEqAbs(vault.pending(1, SENT_IDX), fill(SENT_IDX, uint256(0.14 ether) / 3), 6);
    }

    function test_streetPrizeBoughtInWinnersToken() public {
        build(alice, MIAMI_BEACH);
        _payStreet(0.2 ether);
        vm.warp(FIRST_DEADLINE);
        assertTrue(vault.requestBuy()); // settles, then buys residents' 0.14 + the 0.03 prize
        assertEq(vault.pending(1, VOID_IDX), fill(VOID_IDX, 0.17 ether));
        assertEq(vault.cityStreetTotal(), 0);
    }

    function test_onlyThisWeeksNewBuildingsCount() public {
        buildMany(alice, DOWNTOWN, 3); // Downtown: 3 in week 0
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        build(bob, BRICKELL); // week 1: Brickell 1 new, Downtown 0 new
        _payStreet(0.2 ether);
        vm.warp(vault.weekEnd());
        vault.settle();
        assertEq(vault.cityStreetFunds(BRICKELL), 0.03 ether);
        assertEq(vault.cityStreetFunds(DOWNTOWN), 0);
    }

    function test_tiedDistrictsShareByBuildingCount() public {
        build(alice, BRICKELL);
        build(bob, DOWNTOWN);
        build(carol, DOWNTOWN); // Downtown 2 new
        build(alice, BRICKELL); // Brickell 2 new: a tie
        _payStreet(0.2 ether);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        assertEq(vault.cityStreetFunds(BRICKELL), 0.015 ether);
        assertEq(vault.cityStreetFunds(DOWNTOWN), 0.015 ether);
    }

    function test_tieWithDifferentSizesStillEqualPerBuilding() public {
        buildMany(alice, BRICKELL, 2); // week 0
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        build(alice, BRICKELL); // week 1: Brickell 1 new (3 total)
        build(bob, DOWNTOWN); // week 1: Downtown 1 new (1 total) -> tie
        _payStreet(0.2 ether);
        vm.warp(vault.weekEnd());
        vault.settle();
        // Shared among the 4 buildings of the tied cities: 3/4 Brickell, 1/4 Downtown.
        assertEq(vault.cityStreetFunds(BRICKELL), 0.0225 ether);
        assertEq(vault.cityStreetFunds(DOWNTOWN), 0.0075 ether);
    }

    function test_nobodyBuiltAllBuiltDistrictsShare() public {
        build(alice, BRICKELL);
        build(bob, DOWNTOWN);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        _payStreet(0.2 ether); // week 1, nobody builds
        vm.warp(vault.weekEnd());
        vault.settle();
        assertEq(vault.cityStreetFunds(BRICKELL), 0.015 ether);
        assertEq(vault.cityStreetFunds(DOWNTOWN), 0.015 ether);
        assertEq(vault.cityStreetFunds(WYNWOOD), 0); // never built
    }

    function test_noResidentsStreetShareRollsOver() public {
        _payStreet(0.2 ether);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        assertEq(vault.streetFunds(), 0.03 ether); // nobody to win it
        build(alice, DOWNTOWN);
        vm.warp(vault.weekEnd());
        vault.settle();
        assertEq(vault.streetFunds(), 0);
        assertEq(vault.cityStreetFunds(DOWNTOWN), 0.03 ether);
    }

    function test_afterCityCompleteSharedCityWide() public {
        vm.warp(START);
        buildMany(alice, BRICKELL, 300);
        goPublic();
        buildMany(alice, BRICKELL, 2000);
        buildMany(bob, DOWNTOWN, 700);
        assertEq(vault.residents(), 3000);
        _payStreet(1 ether);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        // Brickell had 2,300 new this week, but the competition is over: everybody shares.
        assertEq(vault.cityStreetFunds(BRICKELL), uint256(0.15 ether) * 2300 / 3000);
        assertEq(vault.cityStreetFunds(DOWNTOWN), uint256(0.15 ether) * 700 / 3000);
    }

    // ─────────── settlement ───────────

    function test_settleIsLazyOnVoteBuildBuyClaim() public {
        build(alice, 0);
        vm.warp(FIRST_DEADLINE);
        assertEq(vault.week(), 0);
        vm.prank(alice);
        vault.vote(ids1(1), 1);
        assertEq(vault.week(), 1);

        vm.warp(vault.weekEnd());
        build(bob, 1);
        assertEq(vault.week(), 2);

        vm.warp(vault.weekEnd());
        vault.requestBuy();
        assertEq(vault.week(), 3);

        vm.warp(vault.weekEnd());
        vm.prank(alice);
        vault.claim(1);
        assertEq(vault.week(), 4);
    }

    function test_settleCatchesUpManyWeeks() public {
        build(alice, 0);
        vm.warp(FIRST_DEADLINE + 10 weeks + 1 days);
        vm.prank(carol); // anyone
        vault.settle();
        assertEq(vault.week(), 11);
        assertGt(vault.weekEnd(), block.timestamp);
    }

    function test_unspentTaxRollsOver() public {
        build(alice, BRICKELL);
        payTax(0.05 ether); // below the minimum order all week
        vault.settle();
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        // 0.035 residents' share + 0.0075 street prize won by Brickell, both still unspent.
        assertEq(vault.residentsFunds() + vault.cityStreetTotal(), 0.0425 ether);
        payTax(0.1 ether);
        assertTrue(vault.requestBuy());
        assertEq(vault.residentsFunds() + vault.cityStreetTotal(), 0);
        assertEq(vault.streetFunds(), 0.015 ether); // this week's street share waits
    }

    // ─────────── permissions ───────────

    function test_adminFunctionsOnlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(err);
        vault.setOracle(ICapitaleOracle(address(1)));
        vm.expectRevert(err);
        vault.setAdapter(0, ISwapAdapter(address(1)));
        vm.expectRevert(err);
        vault.setBuyParams(defaultParams());
        vm.expectRevert(err);
        vault.setOps(alice);
        vm.stopPrank();
    }

    function test_vaultCountBounds() public {
        assertEq(vault.districts(), 4);
        assertEq(vault.tokenCount(), 3);
        IERC20[] memory none = new IERC20[](0);
        ISwapAdapter[] memory noRoutes = new ISwapAdapter[](0);
        IFeeEscrow noEscrow = IFeeEscrow(address(0));
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        deployVault(none, noRoutes, 4, noEscrow); // no reward token
        IERC20[] memory toks = allTokens();
        ISwapAdapter[] memory routes = allRoutes();
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        deployVault(toks, noRoutes, 4, noEscrow); // tokens without swap routes
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        deployVault(toks, routes, 0, noEscrow); // no city
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        deployVault(toks, routes, 5, noEscrow); // too many cities
    }

    // ─────────── four cities, three tokens ───────────

    function test_streetRaceBetweenFourCities() public {
        build(alice, WYNWOOD);
        build(bob, MIAMI_BEACH);
        build(carol, MIAMI_BEACH); // Miami Beach: 2 new this week, wins
        build(alice, BRICKELL);
        _payStreet(0.2 ether);
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        assertEq(vault.cityStreetFunds(MIAMI_BEACH), 0.03 ether);
        assertEq(vault.cityStreetFunds(WYNWOOD) + vault.cityStreetFunds(BRICKELL), 0);
        assertEq(vault.newBuildsOf(0).length, 4);
        assertEq(vault.votesOf(0).length, 3);
    }

    function test_votesOnlyForTheThreeTokens() public {
        build(alice, 3); // a Miami Beach building votes like any other
        vm.startPrank(alice);
        vm.expectRevert(CapitaleVault.BadToken.selector);
        vault.vote(ids1(1), 3);
        vm.expectRevert(CapitaleVault.BadToken.selector);
        vault.voteAll(4);
        vault.vote(ids1(1), 1);
        vm.stopPrank();
        vm.warp(FIRST_DEADLINE);
        vault.settle();
        assertEq(vault.currentToken(), 1);
    }

    function test_onMintOnlyNft() public {
        vm.expectRevert(CapitaleVault.NotNft.selector);
        vault.onMint(5, 0, false);
    }

    function test_badBuyParamsRejected() public {
        CapitaleVault.BuyParams memory p = defaultParams();
        p.maxDeviationBps = 2_000;
        vm.prank(admin);
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        vault.setBuyParams(p);
        p = defaultParams();
        p.maxOrder = 0.01 ether;
        vm.prank(admin);
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        vault.setBuyParams(p);
    }

    function test_ownerCannotTakeFunds() public {
        // The owner's only levers are config; a malicious adapter still cannot get ETH out
        // because a fill below the oracle reference is rejected and the ETH stays.
        build(alice, 0);
        payTax(1 ether);
        adapter.setHonourMinOut(false);
        adapter.setQuality(0);
        vm.prank(admin);
        vault.requestBuy();
        assertEq(vaultIncome(), 1 ether);
    }
}
