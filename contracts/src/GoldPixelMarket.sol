// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

// SPEC-LEVEL. NOT DEPLOYED. NOT AUDITED. Roadmap (tokenomics.md §6, phase 1); the MVP simulates
// this market off-chain. See ../README.md before any use.

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IRFBurnable, ISinkGenerations } from "./PixelLifeSink.sol";

/*
 * Gold Leaf: the fully backed wrapper this market trades (design notes, not implemented).
 *
 * A Gold Pixel is ChanceGame outcome 4, an ERC-1155 whose transfers revert
 * (FriendBoundInventory), redeemable forever for 45 RF. The only way to take it out of a Friend
 * is ChanceGame.redeem, which burns it and pays 45 RF into the Friend's canonical wallet (TBA).
 * The Leaf vault turns that RF back into a tradeable, 1:1 backed ERC-721 without an SDK change:
 *
 *   1. TBA   -> vault.prepare(friendId)      snapshot b0 = ChanceGame.balanceOf(TBA, 4)
 *   2. owner -> ChanceGame.redeem(friendId, 4, k)   45k RF lands in the TBA
 *   3. TBA   -> vault.wrap(friendId)         requires balanceOf(TBA, 4) == b0 - k', pulls
 *                                            45 * k' RF from the TBA, mints k' Leaves carrying
 *                                            originFriendId = friendId ("grown by #id")
 *   unwrap(leafId): burns the Leaf, pays exactly 45 RF to the caller.
 *
 * Invariants: vault RF balance == 45 RF x Leaf supply; no admin, no withdraw, no lending of the
 * backing. A Gold exists as the ERC-1155 or as a Leaf, never both (wrapping needs the redeem).
 * Step 3 only proves the balance fell by k' since the snapshot; because transfers revert, redeem
 * is the only way it can fall. A cleaner path is an RF-team `redeemTo(recipient, data)` in a
 * future ChanceGame, which would make the vault a single call.
 *
 * Perk rule (server): a Leaf counts toward the Sunlit perk only while held by a Friend's TBA,
 * using the minimum balance over the interval. A listed Leaf is escrowed here, so listing ends
 * the seller's perk.
 *
 * Market: fixed-price RF asks, one per Leaf. A buy pays price P from the buyer:
 *   2 % burned, 2 % to the origin Friend's TBA, 1 % to the game creator, the rest to the seller.
 * The practical floor is 45 RF because anyone can unwrap for 45. Bids and a fungible gLEAF pool
 * (phase 2, Uniswap v4 hook) are out of scope.
 */

/// @dev The Gold Leaf vault, typed for the calls made here only.
interface IGoldLeaf {
    function ownerOf(uint256 leafId) external view returns (address);
    function originFriendId(uint256 leafId) external view returns (uint256);
    function transferFrom(address from, address to, uint256 leafId) external;
}

/// @notice Fixed-price RF listings for Gold Leaves with a 5 % fee: 2 % burned, 2 % royalty to
/// the Friend that grew the Gold, 1 % to the game creator.
/// @dev No owner, admin, pause or withdraw. Fees are constants. Listed Leaves are escrowed
/// here and only the seller (cancel) or a buyer paying the listed price can take them out.
contract GoldPixelMarket {
    using SafeERC20 for IERC20;

    uint256 public constant BURN_BPS = 200;
    uint256 public constant ORIGIN_BPS = 200;
    uint256 public constant CREATOR_BPS = 100;

    struct Listing {
        address seller;
        uint256 price;
    }

    IERC20 public immutable rf;
    ISinkGenerations public immutable generations;
    IGoldLeaf public immutable leaf;
    address public immutable creator;

    mapping(uint256 leafId => Listing) public listings;

    error InvalidConfiguration();
    error InvalidPrice();
    error NotLeafOwner();
    error NotSeller();
    error NotListed();
    error PriceChanged();

    event Listed(uint256 indexed leafId, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed leafId, address indexed seller);
    event Sold(
        uint256 indexed leafId,
        uint256 indexed originFriendId,
        address indexed buyer,
        address seller,
        uint256 price,
        uint256 burned,
        uint256 toOrigin,
        uint256 toCreator
    );

    constructor(address rf_, address generations_, address leaf_, address creator_) {
        if (
            rf_.code.length == 0 || generations_.code.length == 0 || leaf_.code.length == 0
                || creator_ == address(0) || ISinkGenerations(generations_).token() != rf_
        ) revert InvalidConfiguration();
        rf = IERC20(rf_);
        generations = ISinkGenerations(generations_);
        leaf = IGoldLeaf(leaf_);
        creator = creator_;
    }

    /// @notice Escrow a Leaf and ask `price` RF for it. The market must be approved for the Leaf.
    function list(uint256 leafId, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        if (leaf.ownerOf(leafId) != msg.sender) revert NotLeafOwner();
        listings[leafId] = Listing({ seller: msg.sender, price: price });
        emit Listed(leafId, msg.sender, price);
        leaf.transferFrom(msg.sender, address(this), leafId);
    }

    function cancel(uint256 leafId) external {
        if (listings[leafId].seller != msg.sender) revert NotSeller();
        delete listings[leafId];
        emit Cancelled(leafId, msg.sender);
        leaf.transferFrom(address(this), msg.sender, leafId);
    }

    /// @notice Buy at the listed price. `expectedPrice` stops a seller from cancelling and
    /// relisting higher in front of the buyer's transaction.
    function buy(uint256 leafId, uint256 expectedPrice) external {
        Listing memory listing = listings[leafId];
        if (listing.seller == address(0)) revert NotListed();
        if (listing.price != expectedPrice) revert PriceChanged();
        (uint256 burned, uint256 toOrigin, uint256 toCreator, uint256 toSeller) =
            fees(listing.price);
        uint256 originFriendId = leaf.originFriendId(leafId);
        address originWallet = generations.tokenBoundAccount(originFriendId);
        delete listings[leafId];
        emit Sold(
            leafId,
            originFriendId,
            msg.sender,
            listing.seller,
            listing.price,
            burned,
            toOrigin,
            toCreator
        );

        rf.safeTransferFrom(msg.sender, address(this), burned);
        IRFBurnable(address(rf)).burn(burned);
        rf.safeTransferFrom(msg.sender, originWallet, toOrigin);
        rf.safeTransferFrom(msg.sender, creator, toCreator);
        rf.safeTransferFrom(msg.sender, listing.seller, toSeller);
        leaf.transferFrom(address(this), msg.sender, leafId);
    }

    /// @notice Fee split of a sale; rounding down on each fee leaves the dust to the seller.
    function fees(uint256 price)
        public
        pure
        returns (uint256 burned, uint256 toOrigin, uint256 toCreator, uint256 toSeller)
    {
        burned = price * BURN_BPS / 10_000;
        toOrigin = price * ORIGIN_BPS / 10_000;
        toCreator = price * CREATOR_BPS / 10_000;
        toSeller = price - burned - toOrigin - toCreator;
    }
}
