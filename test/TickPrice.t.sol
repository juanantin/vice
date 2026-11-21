// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TickPrice} from "../src/volta/TickPrice.sol";

contract TickPriceHarness {
    function at(int24 t) external pure returns (uint160) {
        return TickPrice.sqrtPriceAtTick(t);
    }
}

/// The tick math must match Uniswap's TickMath exactly (known reference values).
contract TickPriceTest is Test {
    TickPriceHarness h = new TickPriceHarness();

    function test_knownValues() public view {
        assertEq(h.at(0), 2 ** 96);
        assertEq(h.at(TickPrice.MIN_TICK), TickPrice.MIN_SQRT_PRICE);
        assertEq(h.at(TickPrice.MAX_TICK), TickPrice.MAX_SQRT_PRICE);
    }

    /// Every bit of the constant table against sqrt(1.0001^tick) * 2^96 computed in Python with
    /// 80-digit decimals (relative error below 1e-9).
    function test_everyBit() public view {
        _near(1, 79232123823359799118286999567);
        _near(-1, 79224201403219477170569942573);
        _near(2, 79236085330515764027303304731);
        _near(-2, 79220240490215316061937756560);
        _near(4, 79244008939048815603706035061);
        _near(-4, 79212319258289487113226433916);
        _near(8, 79259858533276714757314932305);
        _near(-8, 79196479170490597288862688490);
        _near(16, 79291567232598584799939703904);
        _near(-16, 79164808496886665658930780291);
        _near(32, 79355022692464371645785046466);
        _near(-32, 79101505139923049997807806614);
        _near(64, 79482085999252804386437311141);
        _near(-64, 78975050245229982702767995059);
        _near(128, 79736823300114093921829183326);
        _near(-128, 78722746600537056721934508529);
        _near(256, 80248749790819932309965073892);
        _near(-256, 78220554859095770638340573243);
        _near(512, 81282483887344747381513967011);
        _near(-512, 77225761753129597550065289036);
        _near(1024, 83390072131320151908154831281);
        _near(-1024, 75273969370139069689486932537);
        _near(2048, 87770609709833776024991924138);
        _near(-2048, 71517125791179246722882903167);
        _near(4096, 97234110755111693312479820773);
        _near(-4096, 64556580881331167221767657719);
        _near(8192, 119332217159966728226237229890);
        _near(-8192, 52601903197458624361810746399);
        _near(16384, 179736315981702064433883588727);
        _near(-16384, 34923947901690145425342545398);
        _near(32768, 407748233172238350107850275304);
        _near(-32768, 15394552875315951095595078917);
        _near(65536, 2098478828474011932436660412517);
        _near(-65536, 2991262837734375505310244436);
        _near(131072, 55581415166113811149459800483533);
        _near(-131072, 112935262922445818024280873);
        _near(262144, 38992368544603139932233054999993551);
        _near(-262144, 160982827401375763736068);
        _near(524288, 19190206568837448476620805521939294697349);
        _near(-524288, 327099227039063106);
    }

    function _near(int24 t, uint256 want) internal view {
        uint256 got = h.at(t);
        uint256 diff = got > want ? got - want : want - got;
        assertLe(diff * 1e9, want, "tick constant");
    }

    function test_monotonic(int24 t) public view {
        t = int24(bound(t, TickPrice.MIN_TICK, TickPrice.MAX_TICK - 1));
        assertLt(h.at(t), h.at(t + 1));
    }

    function test_outOfRange() public {
        vm.expectRevert(abi.encodeWithSelector(TickPrice.TickOutOfRange.selector, TickPrice.MAX_TICK + 1));
        h.at(TickPrice.MAX_TICK + 1);
    }
}
