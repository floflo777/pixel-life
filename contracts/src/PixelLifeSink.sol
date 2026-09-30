// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

// NOT DEPLOYED. NOT AUDITED. See ../README.md before any use.

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev RF's public OpenZeppelin `ERC20Burnable.burn` (selector 0x42966c68, checked read-only
/// against mainnet: see README "RF burn semantics").
interface IRFBurnable {
    function burn(uint256 amount) external;
}

/// @dev The existing Generations collection, typed for the calls made here only.
interface ISinkGenerations {
    function token() external view returns (address);
    function generation(uint256 friendId) external view returns (uint8);
    function tokenBoundAccount(uint256 friendId) external view returns (address);
}

/// @notice Pixel Life's RF sinks. A hardwired Friend's canonical wallet pays, and the payment is
/// split in the same call: half burned, half forwarded to the stream sink (Regrow) or to the
/// mended Friend's canonical wallet (Mend).
/// @dev No owner, admin, pause, upgrade or withdraw; prices are constants. The contract holds
/// RF only inside a call, and keeps no storage: the server credits pixels once per
/// (tx hash, log index) from the events, which map 1:1 to `rf_ledger` rows.
contract PixelLifeSink {
    using SafeERC20 for IERC20;

    // tokenomics.md §0: Mend = 2 x Regrow, so self-Mend through an alt is never cheaper.
    uint256 public constant REGROW_PRICE = 0.5 ether;
    uint256 public constant MEND_PRICE = 1 ether;
    // A Friend sprite is at most 16 x 16.
    uint256 public constant MAX_PIXELS = 256;

    IERC20 public immutable rf;
    ISinkGenerations public immutable generations;
    // Protocol active-Friends stream entry, or StreamEscrow until the RF team provides one.
    address public immutable streamSink;

    error InvalidConfiguration();
    error InvalidPixels();
    error InvalidFriend();
    error NotFriendWallet();
    error SelfMend();

    /// @dev rf_ledger: kind 'regrow', payer_token = target_token = tokenId, to_target = 0.
    event Regrew(
        uint256 indexed tokenId,
        bytes32 indexed quoteId,
        uint256 pixels,
        uint256 total,
        uint256 burned,
        uint256 streamed
    );
    /// @dev rf_ledger: kind 'mend', stream = 0, to_target paid to `targetWallet`.
    event Mended(
        uint256 indexed payerTokenId,
        uint256 indexed targetTokenId,
        bytes32 indexed quoteId,
        address targetWallet,
        uint256 pixels,
        uint256 total,
        uint256 burned,
        uint256 toTarget
    );

    constructor(address rf_, address generations_, address streamSink_) {
        if (
            rf_.code.length == 0 || generations_.code.length == 0 || streamSink_ == address(0)
                || ISinkGenerations(generations_).token() != rf_
        ) revert InvalidConfiguration();
        rf = IERC20(rf_);
        generations = ISinkGenerations(generations_);
        streamSink = streamSink_;
    }

    /// @notice The Friend's canonical wallet pays to regrow `pixels` of its own missing pixels.
    /// @param quoteId The server quote naming which pixels; echoed in the event, not stored.
    function regrow(uint256 tokenId, uint256 pixels, bytes32 quoteId) external {
        _checkPayer(tokenId);
        uint256 total = _total(pixels, REGROW_PRICE);
        uint256 burned = total / 2;
        uint256 streamed = total - burned;
        emit Regrew(tokenId, quoteId, pixels, total, burned, streamed);

        _collectAndBurn(total, burned);
        rf.safeTransfer(streamSink, streamed);
    }

    /// @notice The payer Friend's canonical wallet pays to mend another hardwired Friend; half of
    /// the payment goes into that Friend's canonical wallet.
    /// @param quoteId The server quote naming which pixels; echoed in the event, not stored.
    function mend(uint256 payerTokenId, uint256 targetTokenId, uint256 pixels, bytes32 quoteId)
        external
    {
        // The ledger books a Mend as a gift between two Friends; paying yourself is a Regrow.
        if (payerTokenId == targetTokenId) revert SelfMend();
        _checkPayer(payerTokenId);
        if (generations.generation(targetTokenId) == 0) revert InvalidFriend();
        address targetWallet = generations.tokenBoundAccount(targetTokenId);
        uint256 total = _total(pixels, MEND_PRICE);
        uint256 burned = total / 2;
        uint256 toTarget = total - burned;
        emit Mended(
            payerTokenId, targetTokenId, quoteId, targetWallet, pixels, total, burned, toTarget
        );

        _collectAndBurn(total, burned);
        rf.safeTransfer(targetWallet, toTarget);
    }

    function _checkPayer(uint256 tokenId) private view {
        if (generations.generation(tokenId) == 0) revert InvalidFriend();
        if (msg.sender != generations.tokenBoundAccount(tokenId)) revert NotFriendWallet();
    }

    function _total(uint256 pixels, uint256 price) private pure returns (uint256) {
        if (pixels == 0 || pixels > MAX_PIXELS) revert InvalidPixels();
        return pixels * price;
    }

    function _collectAndBurn(uint256 total, uint256 burned) private {
        rf.safeTransferFrom(msg.sender, address(this), total);
        IRFBurnable(address(rf)).burn(burned);
    }
}
