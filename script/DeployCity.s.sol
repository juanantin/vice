// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ViceOracle} from "../src/volta/ViceOracle.sol";
import {VoltaSwapAdapter} from "../src/volta/VoltaSwapAdapter.sol";
import {IPoolManager, IVoltaOracle, IVoltaPositionManager, IVoltaPriceCalculator} from "../src/volta/VoltaInterfaces.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {IViceOracle} from "../src/interfaces/IViceOracle.sol";
import {IVicePricing} from "../src/interfaces/IVicePricing.sol";
import {IViceVault} from "../src/interfaces/IViceVault.sol";
import {VicePricing} from "../src/VicePricing.sol";
import {ViceNFT} from "../src/ViceNFT.sol";
import {ViceVault, IFeeEscrow, IViceNFTView, IWETH} from "../src/ViceVault.sol";

/// Same deployment as the /launch page, from the command line (an alternative for a developer;
/// the launch page is the main path). Sending Volta's creator NFT to the vault and the
/// timelock's acceptance of the pricing contract stay manual steps.
///
///   VICE_TOKEN=0x… OPS=0x… ADMIN=0x… START=<unix> [MIN_ORDER_USD=20 MAX_ORDER_USD=150] \
///   forge script script/DeployCity.s.sol --rpc-url https://rpc.elysium.kinetiq.xyz --broadcast \
///     --ledger   (or --interactive; never put a private key in a file)
contract DeployCity is Script {
    IPoolManager constant PM = IPoolManager(0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1);
    IVoltaPositionManager constant VPM = IVoltaPositionManager(0x3aB88DDc3CF2A012af88B60828edb4553697E5dC);
    IVoltaOracle constant VORACLE = IVoltaOracle(0xa2A5eBE297a141160ca5c513c74fD43cB2c09B2e);
    IVoltaPriceCalculator constant USDC_CALC = IVoltaPriceCalculator(0x0D673fF1c868e9Ff867C88DBb010E16be7D129b9);
    address constant FEE_ESCROW = 0x3D36Beb546E451584736957F97E7EE9D2aCbD9a5;
    address constant VOLTA = 0x0f79931689Af199e7CF868ed1107bBA2C83c68f7;
    address constant SENT = 0xA713a15b85Cab304F9e2fbc649440B5e3AB8a8D4;
    address constant VOID = 0xD31B21Cb80E431AC996269deC31A40fCf048B77f;

    struct Out {
        ViceOracle oracle;
        VoltaSwapAdapter adapter;
        VicePricing pricing;
        ViceNFT nft;
        TimelockController timelock;
        ViceVault vault;
    }

    function run() external returns (Out memory o) {
        address vice = vm.envAddress("VICE_TOKEN");
        address ops = vm.envAddress("OPS");
        address admin = vm.envAddress("ADMIN");
        uint256 start = vm.envUint("START");
        uint256 minUsd = vm.envOr("MIN_ORDER_USD", uint256(20));
        uint256 maxUsd = vm.envOr("MAX_ORDER_USD", uint256(150));

        vm.startBroadcast();
        address me = msg.sender;
        address[] memory toks = new address[](4);
        toks[0] = vice;
        toks[1] = VOLTA;
        toks[2] = SENT;
        toks[3] = VOID;
        o.oracle = new ViceOracle(PM, VPM, VORACLE, USDC_CALC, 6, vice, VOLTA, toks);
        o.adapter = new VoltaSwapAdapter(PM, VPM);
        o.pricing = new VicePricing(
            me, IViceOracle(address(o.oracle)), start, 300, 40e18, [uint256(52e18), 68e18, 88e18, 120e18]
        );
        o.nft = new ViceNFT(IERC20(vice), IVicePricing(address(o.pricing)), me, 4);
        address[] memory list = new address[](1);
        list[0] = admin;
        o.timelock = new TimelockController(48 hours, list, list, address(0));
        o.vault = _vault(o, ops, start, minUsd, maxUsd);
        o.pricing.setNft(address(o.nft));
        o.nft.setVault(IViceVault(address(o.vault)));
        o.pricing.transferOwnership(address(o.timelock));
        vm.stopBroadcast();

        console2.log("oracle  ", address(o.oracle));
        console2.log("adapter ", address(o.adapter));
        console2.log("pricing ", address(o.pricing));
        console2.log("nft     ", address(o.nft));
        console2.log("timelock", address(o.timelock));
        console2.log("vault   ", address(o.vault));
    }

    function _vault(Out memory o, address ops, uint256 start, uint256 minUsd, uint256 maxUsd)
        internal
        returns (ViceVault)
    {
        IERC20[] memory tokens = new IERC20[](3);
        tokens[0] = IERC20(VOLTA);
        tokens[1] = IERC20(SENT);
        tokens[2] = IERC20(VOID);
        ISwapAdapter[] memory adapters = new ISwapAdapter[](3);
        for (uint256 i; i < 3; ++i) adapters[i] = ISwapAdapter(address(o.adapter));
        uint256 voltaPerUsd = 1e36 / o.oracle.incomeUsd();
        return new ViceVault(
            ViceVault.Setup({
                owner: address(o.timelock),
                nft: IViceNFTView(address(o.nft)),
                earlyBirdEnd: start + 6 hours,
                income: IERC20(VOLTA),
                feeEscrow: IFeeEscrow(FEE_ESCROW),
                oracle: IViceOracle(address(o.oracle)),
                ops: ops,
                weth: IWETH(address(0)),
                districts: 4,
                initialToken: 0,
                // Brickell SENT, Downtown VOLTA, Wynwood follows the vote, Miami Beach VOID.
                cityTokens: [uint8(1), 0, 254, 2]
            }),
            tokens,
            adapters,
            ViceVault.BuyParams({
                minOrder: uint128(minUsd * voltaPerUsd),
                maxOrder: uint128(maxUsd * voltaPerUsd),
                minInterval: 10 minutes,
                rejectPause: 6 hours,
                maxDeviationBps: 400
            })
        );
    }
}
