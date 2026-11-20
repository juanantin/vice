// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CapitaleVault, ICapitaleNFTView, IFeeEscrow, IWETH} from "../src/CapitaleVault.sol";
import {ICapitaleOracle} from "../src/interfaces/ICapitaleOracle.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {MockFeeEscrow} from "./mocks/MockFeeEscrow.sol";
import {MockCreatorNFT} from "./mocks/MockCreatorNFT.sol";

/// Volta-specific behaviour: income in $VOLTA (also a reward token), creator fees from the
/// FeeEscrow, the creator NFT held by the vault, and the ERC-20 swap path.
contract CapitaleVaultVoltaTest is BaseTest {
    function setUp() public override {
        super.setUp();
        goPublic();
    }

    function test_buyingVoltaIsAOneToOneAllocation() public {
        build(alice, DOWNTOWN); // Downtown earns VOLTA
        adapter.setBroken(true); // no swap route is used for VOLTA
        payTax(1 ether);
        assertTrue(vault.requestBuy());
        assertEq(vault.heldRewards(VOLTA_IDX), 0.6 ether); // capped at the max order
        assertEq(vault.totalBought(VOLTA_IDX), 0.6 ether);
        assertEq(vault.pending(1, VOLTA_IDX), 0.6 ether);
        // USD value at purchase time: 0.6 income * $3,000.
        assertEq(vault.totalBoughtUsd(), 1800e18);
    }

    function test_heldVoltaIsNeverCountedAsNewTax() public {
        build(alice, DOWNTOWN);
        payTax(1 ether);
        vault.requestBuy();
        uint256 tax = vault.totalTax();
        vm.warp(block.timestamp + 1 days);
        vault.settle();
        vault.settle();
        assertEq(vault.totalTax(), tax);
        assertEq(vault.residentsFunds() + vault.streetFunds(), 0.25 ether);
        // Claiming VOLTA rewards does not disturb the unspent income either.
        vm.prank(alice);
        vault.claim(1);
        assertGt(volta.balanceOf(alice), 0);
        vault.settle();
        assertEq(vault.totalTax(), tax);
        assertEq(
            vaultIncome(), vault.residentsFunds() + vault.streetFunds() + vault.opsFunds() + vault.cityStreetTotal()
        );
    }

    function test_opsPaidInVolta() public {
        payTax(1 ether);
        vm.prank(bob);
        vault.payOps();
        assertEq(volta.balanceOf(opsSafe), 0.15 ether);
    }

    function test_swapAllowanceIsExactAndReset() public {
        build(alice, BRICKELL); // SENT is swapped
        payTax(1 ether);
        adapter.setTakeMore(true); // tries to pull 1 wei more than approved: the fill fails
        assertFalse(vault.requestBuy());
        assertEq(vault.residentsFunds() + vault.streetFunds(), 0.85 ether);
        assertEq(volta.allowance(address(vault), address(adapter)), 0);
        vm.warp(block.timestamp + 6 hours);
        adapter.setTakeMore(false);
        assertTrue(vault.requestBuy());
        assertEq(volta.allowance(address(vault), address(adapter)), 0);
    }

    function test_collectCreatorFeesFromEscrow() public {
        MockFeeEscrow escrow = new MockFeeEscrow();
        CapitaleVault v2 = deployVault(allTokens(), allRoutes(), 4, IFeeEscrow(address(escrow)));
        escrow.credit(volta, address(v2), 50e18);
        vm.prank(carol); // anyone can trigger it
        assertEq(v2.collectCreatorFees(), 50e18);
        assertEq(v2.totalTax(), 50e18);
        assertEq(v2.residentsFunds(), 35e18);
        assertEq(v2.collectCreatorFees(), 0); // nothing left to collect
    }

    function test_collectWithoutEscrowReverts() public {
        vm.expectRevert(CapitaleVault.BadConfig.selector);
        vault.collectCreatorFees();
    }

    function test_vaultHoldsTheCreatorNft() public {
        MockCreatorNFT creator = new MockCreatorNFT();
        creator.mint(address(this), 7);
        creator.safeTransferFrom(address(this), address(vault), 7);
        assertEq(creator.ownerOf(7), address(vault));
    }

    function test_nativeIncomeStillWorks() public {
        CapitaleVault v2 = new CapitaleVault(
            CapitaleVault.Setup({
                owner: admin,
                nft: ICapitaleNFTView(address(nft)),
                earlyBirdEnd: START + 6 hours,
                income: IERC20(address(0)),
                feeEscrow: IFeeEscrow(address(0)),
                oracle: ICapitaleOracle(address(oracle)),
                ops: opsSafe,
                weth: IWETH(address(0)),
                districts: 4,
                initialToken: 0,
                cityTokens: [SENT_IDX, VOLTA_IDX, 254, VOID_IDX]
            }),
            allTokens(),
            allRoutes(),
            defaultParams()
        );
        assertEq(v2.incomeRewardIndex(), v2.NO_TOKEN());
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(v2).call{value: 1 ether}("");
        assertTrue(ok);
        v2.settle();
        assertEq(v2.residentsFunds(), 0.7 ether);
        vm.prank(address(nft));
        v2.onMint(1, BRICKELL, false); // a building to receive the SENT bought with native income
        assertTrue(v2.requestBuy());
        assertEq(address(v2).balance, 0.4 ether);
    }
}
