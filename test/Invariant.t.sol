// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {Test} from "forge-std/Test.sol";
import {ViceNFT} from "../src/ViceNFT.sol";
import {ViceVault} from "../src/ViceVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockSwapAdapter} from "./mocks/MockSwapAdapter.sol";

contract Handler is Test {
    ViceNFT internal nft;
    ViceVault internal vault;
    MockERC20 internal vice;
    MockSwapAdapter internal adapter;
    address[3] internal users = [address(0xA11CE), address(0xB0B), address(0xCA401)];
    uint256[3] public claimed;
    MockERC20 internal volta;

    constructor(ViceNFT nft_, ViceVault vault_, MockERC20 vice_, MockSwapAdapter adapter_, MockERC20 volta_) {
        volta = volta_;
        nft = nft_;
        vault = vault_;
        vice = vice_;
        adapter = adapter_;
        for (uint256 i; i < 3; ++i) {
            vice.mint(users[i], 1e30);
            vm.prank(users[i]);
            vice.approve(address(nft), type(uint256).max);
        }
    }

    function buildOne(uint256 u, uint8 d, uint8 s) external {
        if (nft.totalResidents() >= 3000) return;
        vm.prank(users[u % 3]);
        try nft.mint(d % 4, s % 3, 0, type(uint256).max) {} catch {}
    }

    function pay(uint256 amt) external {
        amt = bound(amt, 0, 5 ether);
        volta.mint(address(vault), amt); // creator fees in VOLTA
    }

    function buy(uint256 quality) external {
        adapter.setQuality(bound(quality, 9_000, 11_000));
        vault.requestBuy();
    }

    function voteAll(uint256 u, uint8 t) external {
        vm.prank(users[u % 3]);
        vault.voteAll(t % 3); // VOLTA (identity buy) included
    }

    function claimAll(uint256 u) external {
        address who = users[u % 3];
        uint256 n = nft.balanceOf(who);
        if (n == 0) return;
        uint256[] memory ids = new uint256[](n);
        uint256 k;
        for (uint256 i; i < n; ++i) {
            uint256 id = nft.tokenOfOwnerByIndex(who, i);
            if (id != 0) ids[k++] = id;
        }
        assembly {
            mstore(ids, k)
        }
        if (k == 0) return;
        uint256[3] memory before;
        for (uint256 t; t < 3; ++t) {
            before[t] = MockERC20(address(vault.tokens(t))).balanceOf(who);
        }
        vm.prank(who);
        vault.claimMany(ids);
        for (uint256 t; t < 3; ++t) {
            claimed[t] += MockERC20(address(vault.tokens(t))).balanceOf(who) - before[t];
        }
    }

    function transfer(uint256 from, uint256 to, uint256 idx) external {
        address f = users[from % 3];
        uint256 n = nft.balanceOf(f);
        if (n == 0) return;
        uint256 id = nft.tokenOfOwnerByIndex(f, idx % n);
        vm.prank(f);
        nft.transferFrom(f, users[to % 3], id);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 4 days));
    }

    function settle() external {
        vault.settle();
    }
}

contract InvariantTest is BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        vm.warp(START);
        handler = new Handler(nft, vault, vice, adapter, volta);
        targetContract(address(handler));
    }

    /// Reward tokens owed to buildings never exceed what the vault keeps aside for them, and
    /// what it keeps aside is really there (for VOLTA, on top of the unspent income).
    function invariant_solvent() public view {
        uint256 n = nft.totalResidents();
        for (uint8 t; t < 3; ++t) {
            uint256 owed = vault.carry(t);
            for (uint8 d; d < 4; ++d) {
                owed += vault.earlyBirdPool(d, t);
            }
            for (uint256 id = 1; id <= n; ++id) {
                owed += vault.pending(id, t);
            }
            assertLe(owed, vault.heldRewards(t));
            assertLe(vault.heldRewards(t), rewards[t].balanceOf(address(vault)));
        }
    }

    /// Everything bought is either still set aside in the vault or was claimed by an owner.
    function invariant_conservation() public view {
        for (uint8 t; t < 3; ++t) {
            assertEq(vault.heldRewards(t) + handler.claimed(t), vault.totalBought(t));
            if (t != VOLTA_IDX) assertEq(rewards[t].balanceOf(address(vault)), vault.heldRewards(t));
        }
    }

    function invariant_incomeBucketsBacked() public view {
        assertLe(
            vault.residentsFunds() + vault.streetFunds() + vault.opsFunds() + vault.cityStreetTotal(), vaultIncome()
        );
        uint256 sum;
        for (uint256 d; d < 4; ++d) {
            sum += vault.cityStreetFunds(d);
        }
        assertEq(sum, vault.cityStreetTotal());
    }

    function invariant_countsConsistent() public view {
        uint256 sum;
        for (uint256 d; d < 4; ++d) {
            sum += nft.districtCount(d);
            assertEq(nft.districtCount(d), vault.districtResidents(d));
        }
        assertEq(sum, nft.totalResidents());
        assertEq(vault.residents(), nft.totalResidents());
        assertEq(nft.totalSupply(), nft.totalResidents() + 1);
        assertLe(nft.totalResidents(), 3000);
    }

    function invariant_votesBounded() public view {
        uint256[] memory v = vault.votesOf(vault.week());
        assertEq(v.length, 3);
        assertLe(v[0] + v[1] + v[2], vault.residents());
    }

    function invariant_mayorNeverEarns() public view {
        for (uint8 t; t < 3; ++t) {
            assertEq(vault.pending(0, t), 0);
        }
        assertEq(vault.claimedUsd(0), 0);
    }
}
