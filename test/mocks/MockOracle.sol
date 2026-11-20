// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IViceOracle} from "../../src/interfaces/IViceOracle.sol";

contract MockOracle is IViceOracle {
    uint256 public spot;
    uint256 public twap;
    uint256 public income;
    mapping(address => uint256) public price;

    function setVice(uint256 spot_, uint256 twap_) external {
        spot = spot_;
        twap = twap_;
    }

    function setIncomeUsd(uint256 p) external {
        income = p;
    }

    function setTokenUsd(address t, uint256 p) external {
        price[t] = p;
    }

    function viceUsdSpot() external view returns (uint256) {
        require(spot != 0, "no spot");
        return spot;
    }

    function viceUsdTwap() external view returns (uint256) {
        require(twap != 0, "no twap");
        return twap;
    }

    function incomeUsd() external view returns (uint256) {
        require(income != 0, "no income price");
        return income;
    }

    function tokenUsd(address t) external view returns (uint256) {
        require(price[t] != 0, "no price");
        return price[t];
    }
}
