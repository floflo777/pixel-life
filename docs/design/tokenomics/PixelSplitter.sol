// SPDX-License-Identifier: Apache-2.0
// SKETCH ONLY. Compiles (forge, solc 0.8.36); not tested, audited or deployed. Needs RF-team answers on burn() and the stream entry.
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IRFBurnable { function burn(uint256 amount) external; }
interface IGenerations { function generation(uint256 id) external view returns (uint8);
    function tokenBoundAccount(uint256 id) external view returns (address); }

/// Pixel Life payments. Every RF in is split 50 % burned / 50 % forwarded in the same call.
/// No owner, no admin, no withdraw, no upgrade, no mint. Prices are immutable: a new price = a new deployment.
contract PixelSplitter {
    using SafeERC20 for IERC20;
    IERC20 public immutable rf;
    IGenerations public immutable generations;
    address public immutable streamSink;   // protocol active-Friends stream entry; address(0) = burn it too (phase 1)
    uint256 public immutable regrowPrice;  // 0.5e18 per pixel
    uint256 public immutable mendPrice;    // 1.0e18 per pixel (= 2 x regrow: self-Mend via an alt is never cheaper)
    uint32 public constant MAX_PX = 256;   // a 16x16 sprite

    enum Kind { REGROW, DECOR, EDGE }
    mapping(bytes32 => bool) public usedQuote;  // one payment per server quote: no double pay, no double credit

    event Regrow(uint256 indexed friendId, address indexed payer, uint32 px, uint256 paid, bytes32 quoteId);
    event Mend(uint256 indexed friendId, address indexed payer, address friendWallet, uint32 px, uint256 paid, bytes32 quoteId);
    event Spend(Kind indexed kind, uint256 indexed friendId, address indexed payer, uint256 paid, bytes32 quoteId);
    event Split(uint256 burned, uint256 toStream);

    constructor(IERC20 rf_, IGenerations gen_, address streamSink_, uint256 regrow_, uint256 mend_) {
        require(mend_ >= 2 * regrow_, "mend < 2x regrow");
        (rf, generations, streamSink, regrowPrice, mendPrice) = (rf_, gen_, streamSink_, regrow_, mend_);
    }

    /// Regrow `px` missing pixels on any hardwired Friend. 50 % burned, 50 % to the protocol stream.
    function regrow(uint256 friendId, uint32 px, bytes32 quoteId) external {
        uint256 paid = _take(friendId, px, regrowPrice, quoteId);
        _split(paid);
        emit Regrow(friendId, msg.sender, px, paid, quoteId);
    }
    /// Mend `px` pixels on someone's Friend. 50 % burned, 50 % into that Friend's ERC-6551 wallet.
    function mend(uint256 friendId, uint32 px, bytes32 quoteId) external {
        uint256 paid = _take(friendId, px, mendPrice, quoteId);
        address wallet = generations.tokenBoundAccount(friendId);
        _burn(paid / 2);
        rf.safeTransfer(wallet, paid - paid / 2);
        emit Mend(friendId, msg.sender, wallet, px, paid, quoteId);
    }
    /// Home-island decor bought with RF (price checked off-chain against the published catalog).
    function spend(Kind kind, uint256 friendId, uint256 amount, bytes32 quoteId) external {
        require(kind == Kind.DECOR && amount > 0 && !usedQuote[quoteId], "bad spend");
        usedQuote[quoteId] = true;
        rf.safeTransferFrom(msg.sender, address(this), amount);
        _split(amount);
        emit Spend(kind, friendId, msg.sender, amount, quoteId);
    }
    /// Seed Pack edge: the ChanceGame team calls withdrawSurplus(recipient = this); anyone then flushes it 50/50.
    function flush() external {
        uint256 bal = rf.balanceOf(address(this));
        if (bal > 0) { _split(bal); emit Spend(Kind.EDGE, 0, msg.sender, bal, bytes32(0)); }
    }

    function _take(uint256 friendId, uint32 px, uint256 price, bytes32 quoteId) private returns (uint256 paid) {
        require(px > 0 && px <= MAX_PX && !usedQuote[quoteId], "bad quote");
        require(generations.generation(friendId) >= 1, "not hardwired");
        usedQuote[quoteId] = true;
        paid = uint256(px) * price;
        rf.safeTransferFrom(msg.sender, address(this), paid);
    }
    function _split(uint256 amount) private {
        uint256 half = streamSink == address(0) ? 0 : amount / 2;
        _burn(amount - half);
        if (half > 0) rf.safeTransfer(streamSink, half);
        emit Split(amount - half, half);
    }

    function _burn(uint256 amount) private { if (amount > 0) IRFBurnable(address(rf)).burn(amount); }
}
