// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TEST ONLY. Stand-ins for $VICE, $VOLTA (income + reward), SENT, VOID, the price feed,
// the swap route and Volta's FeeEscrow, so the whole city can be exercised end to end.
// Test tokens have no value. Never wire these into a real city.

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IViceOracle} from "../interfaces/IViceOracle.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

/// @notice Free-to-mint test token. `faucet()` gives anyone a fixed amount.
contract TestToken is ERC20 {
    uint8 private immutable _dec;
    uint256 public immutable faucetAmount;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
    {
        _dec = decimals_;
        faucetAmount = faucetAmount_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function faucet() external {
        _mint(msg.sender, faucetAmount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Price feed whose prices the tester sets by hand (stands in for Volta's pool TWAPs).
contract TestOracle is IViceOracle, Ownable {
    uint256 public spot;
    uint256 public twap;
    uint256 public incomePrice;
    mapping(address => uint256) public price;

    event PricesSet();

    constructor(address owner_) Ownable(owner_) {}

    function setVice(uint256 spot_, uint256 twap_) external onlyOwner {
        spot = spot_;
        twap = twap_;
        emit PricesSet();
    }

    function setIncomeUsd(uint256 p) external onlyOwner {
        incomePrice = p;
        emit PricesSet();
    }

    function setTokenUsd(address token, uint256 p) external onlyOwner {
        price[token] = p;
        emit PricesSet();
    }

    function viceUsdSpot() external view returns (uint256) {
        require(spot != 0, "no price");
        return spot;
    }

    function viceUsdTwap() external view returns (uint256) {
        require(twap != 0, "no price");
        return twap;
    }

    function incomeUsd() external view returns (uint256) {
        require(incomePrice != 0, "no price");
        return incomePrice;
    }

    function tokenUsd(address token) external view returns (uint256) {
        require(price[token] != 0, "no price");
        return price[token];
    }
}

/// @notice "Buys" a reward token by taking the income token and minting the reward at the
///         oracle price. `qualityBps` below 10000 simulates a bad fill (4% rejection, 6h pause).
contract TestSwapAdapter is ISwapAdapter, Ownable {
    TestOracle public immutable oracle;
    uint256 public qualityBps = 10_000;

    constructor(TestOracle oracle_, address owner_) Ownable(owner_) {
        oracle = oracle_;
    }

    function setQuality(uint256 q) external onlyOwner {
        require(q > 0 && q <= 20_000, "bad quality");
        qualityBps = q;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 out)
    {
        if (tokenIn == address(0)) require(msg.value == amountIn, "value");
        else IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint8 dIn = tokenIn == address(0) ? 18 : TestToken(tokenIn).decimals();
        uint8 dOut = TestToken(tokenOut).decimals();
        out = (amountIn * oracle.incomeUsd() * (10 ** dOut)) / (oracle.tokenUsd(tokenOut) * (10 ** dIn));
        out = (out * qualityBps) / 10_000;
        require(out >= minOut, "slippage");
        TestToken(tokenOut).mint(recipient, out);
    }
}

/// @notice Stand-in for Volta's FeeEscrow. `simulateTrading` credits a recipient (the vault)
///         with creator fees in the test income token, as $VICE trading would.
contract TestFeeEscrow {
    TestToken public immutable token;
    mapping(address => mapping(address => uint256)) public balances;

    event Deposit(address indexed recipient, uint256 amount);

    constructor(TestToken token_) {
        token = token_;
    }

    function simulateTrading(address recipient, uint256 creatorFees) external {
        token.mint(address(this), creatorFees);
        balances[recipient][address(token)] += creatorFees;
        emit Deposit(recipient, creatorFees);
    }

    function withdrawFees(address token_, address recipient, bool) external {
        uint256 amt = balances[msg.sender][token_];
        balances[msg.sender][token_] = 0;
        if (amt != 0) IERC20(token_).transfer(recipient, amt);
    }
}

/// @notice Deploys every test stand-in in one transaction, with realistic starting prices.
///         Reward tokens: tVOLTA (also the income), tSENT, tVOID.
contract TestKit {
    TestToken public immutable vice;
    TestToken public immutable volta;
    TestToken[3] public rewards;
    TestOracle public immutable oracle;
    TestSwapAdapter public immutable adapter;
    TestFeeEscrow public immutable feeEscrow;

    constructor() {
        vice = new TestToken("VICE (test)", "tVICE", 18, 1_000_000e18);
        volta = new TestToken("Volta (test)", "tVOLTA", 18, 100_000e18);
        rewards[0] = volta;
        rewards[1] = new TestToken("Sent.family (test)", "tSENT", 18, 0);
        rewards[2] = new TestToken("voidcash (test)", "tVOID", 18, 0);
        oracle = new TestOracle(address(this));
        oracle.setVice(0.001e18, 0.001e18); // $0.001
        oracle.setIncomeUsd(0.02e18); // $0.02 per VOLTA
        oracle.setTokenUsd(address(volta), 0.02e18);
        oracle.setTokenUsd(address(rewards[1]), 0.005e18);
        oracle.setTokenUsd(address(rewards[2]), 0.0008e18);
        oracle.transferOwnership(msg.sender);
        adapter = new TestSwapAdapter(oracle, msg.sender);
        feeEscrow = new TestFeeEscrow(volta);
    }

    function rewardTokens() external view returns (TestToken[3] memory) {
        return rewards;
    }
}
