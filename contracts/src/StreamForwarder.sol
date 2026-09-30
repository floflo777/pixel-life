// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

// NOT DEPLOYED. NOT AUDITED. See ../README.md before any use.

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Generations' pointer to the current ActivationManager, typed for this call only.
interface IStreamGenerations {
    function activationManager() external view returns (address);
}

/// @dev ActivationManager's permissionless stream top-up (selector 0x7b1837de). It pulls
/// `amount` of `asset` from the caller and emits `Funded(asset, funder, amount)`.
interface IActivationManagerFund {
    function fund(address asset, uint256 amount) external;
}

/// @notice The Regrow stream half accumulates here; anyone may push the whole balance into the
/// protocol's active-Friends RF stream.
/// @dev No owner, admin or withdraw: RF can only leave through `fund` on the ActivationManager
/// that Generations currently names, so a protocol migration is followed without an admin.
/// PixelLifeSink transfers here rather than calling `fund` itself, so Regrow keeps working if
/// the stream entry ever reverts, and many small payments become one top-up.
contract StreamForwarder {
    using SafeERC20 for IERC20;

    IERC20 public immutable rf;
    IStreamGenerations public immutable generations;

    error InvalidConfiguration();

    constructor(address rf_, address generations_) {
        if (rf_.code.length == 0 || generations_.code.length == 0) revert InvalidConfiguration();
        rf = IERC20(rf_);
        generations = IStreamGenerations(generations_);
    }

    /// @notice Push every RF held here into the active-Friends stream.
    function forward() external {
        address manager = generations.activationManager();
        uint256 amount = rf.balanceOf(address(this));
        rf.forceApprove(manager, amount);
        IActivationManagerFund(manager).fund(address(rf), amount);
    }
}
