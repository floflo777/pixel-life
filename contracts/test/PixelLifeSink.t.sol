// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test, Vm } from "forge-std/Test.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { PixelLifeSink } from "../src/PixelLifeSink.sol";
import { StreamForwarder } from "../src/StreamForwarder.sol";
import { MockRF, MockERC6551Registry, MockFriendWallet, MockGenerations } from "./Mocks.sol";

contract PixelLifeSinkTest is Test {
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant ALICE_FRIEND = 1;
    uint256 private constant BOB_FRIEND = 2;
    uint256 private constant GEN0_FRIEND = 3;
    bytes32 private constant QUOTE = keccak256("quote-1");

    MockRF private rf;
    MockGenerations private generations;
    StreamForwarder private forwarder;
    PixelLifeSink private sink;
    // Cached so helpers make no external call between vm.expectRevert and the action.
    mapping(uint256 friendId => address) private _wallets;

    event Regrew(
        uint256 indexed tokenId,
        bytes32 indexed quoteId,
        uint256 pixels,
        uint256 total,
        uint256 burned,
        uint256 streamed
    );
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

    function setUp() public {
        rf = new MockRF();
        generations = new MockGenerations(address(rf), new MockERC6551Registry());
        generations.mint(ALICE, ALICE_FRIEND, 1);
        generations.mint(BOB, BOB_FRIEND, 2);
        generations.mint(ALICE, GEN0_FRIEND, 0);
        forwarder = new StreamForwarder(address(rf), address(generations));
        sink = new PixelLifeSink(address(rf), address(generations), address(forwarder));
        for (uint256 id = 1; id <= 3; ++id) {
            _wallets[id] = generations.tokenBoundAccount(id);
            rf.mint(_wallet(id), 1000 ether);
            _execute(
                generations.ownerOf(id),
                id,
                address(rf),
                abi.encodeCall(rf.approve, (address(sink), type(uint256).max))
            );
        }
    }

    function testConstants() public view {
        assertEq(sink.REGROW_PRICE(), 0.5 ether);
        assertEq(sink.MEND_PRICE(), 2 * sink.REGROW_PRICE());
        assertEq(sink.MAX_PIXELS(), 256);
    }

    function testInvalidConfigurationRejected() public {
        vm.expectRevert(PixelLifeSink.InvalidConfiguration.selector);
        new PixelLifeSink(address(0xBEEF), address(generations), address(forwarder));
        vm.expectRevert(PixelLifeSink.InvalidConfiguration.selector);
        new PixelLifeSink(address(rf), address(0xBEEF), address(forwarder));
        vm.expectRevert(PixelLifeSink.InvalidConfiguration.selector);
        new PixelLifeSink(address(rf), address(generations), address(0));
        MockRF other = new MockRF();
        vm.expectRevert(PixelLifeSink.InvalidConfiguration.selector);
        new PixelLifeSink(address(other), address(generations), address(forwarder));
    }

    function testRegrowBurnsHalfAndStreamsHalf() public {
        address wallet = _wallet(ALICE_FRIEND);
        uint256 supply = rf.totalSupply();
        vm.expectEmit(address(sink));
        emit Regrew(ALICE_FRIEND, QUOTE, 3, 1.5 ether, 0.75 ether, 0.75 ether);
        _regrow(ALICE, ALICE_FRIEND, 3, QUOTE);
        assertEq(rf.balanceOf(wallet), 1000 ether - 1.5 ether);
        assertEq(rf.balanceOf(address(forwarder)), 0.75 ether);
        assertEq(supply - rf.totalSupply(), 0.75 ether);
        assertEq(rf.balanceOf(address(sink)), 0);
    }

    function testMendPaysTargetWallet() public {
        address payer = _wallet(ALICE_FRIEND);
        address target = _wallet(BOB_FRIEND);
        uint256 supply = rf.totalSupply();
        vm.expectEmit(address(sink));
        emit Mended(ALICE_FRIEND, BOB_FRIEND, QUOTE, target, 3, 3 ether, 1.5 ether, 1.5 ether);
        _mend(ALICE, ALICE_FRIEND, BOB_FRIEND, 3, QUOTE);
        assertEq(rf.balanceOf(payer), 1000 ether - 3 ether);
        assertEq(rf.balanceOf(target), 1000 ether + 1.5 ether);
        assertEq(supply - rf.totalSupply(), 1.5 ether);
        assertEq(rf.balanceOf(address(forwarder)), 0);
        assertEq(rf.balanceOf(address(sink)), 0);
    }

    function testOnlyCanonicalWalletPays() public {
        // The NFT owner calling directly is not the payer: RF must come from the Friend wallet.
        vm.prank(ALICE);
        vm.expectRevert(PixelLifeSink.NotFriendWallet.selector);
        sink.regrow(ALICE_FRIEND, 1, QUOTE);
        // A Friend wallet cannot pay on behalf of another Friend.
        vm.expectRevert(PixelLifeSink.NotFriendWallet.selector);
        _regrow(BOB, BOB_FRIEND, 1, QUOTE, ALICE_FRIEND);
        vm.expectRevert(PixelLifeSink.NotFriendWallet.selector);
        _execute(
            BOB,
            BOB_FRIEND,
            address(sink),
            abi.encodeCall(sink.mend, (ALICE_FRIEND, BOB_FRIEND, 1, QUOTE))
        );
        // Nobody but the NFT owner can drive a Friend wallet.
        MockFriendWallet aliceWallet = MockFriendWallet(_wallet(ALICE_FRIEND));
        vm.prank(BOB);
        vm.expectRevert(MockFriendWallet.NotOwner.selector);
        aliceWallet.execute(
            address(sink), 0, abi.encodeCall(sink.regrow, (ALICE_FRIEND, 1, QUOTE)), 0
        );
    }

    function testGenerationZeroCannotPayOrBeMended() public {
        vm.expectRevert(PixelLifeSink.InvalidFriend.selector);
        _regrow(ALICE, GEN0_FRIEND, 1, QUOTE);
        vm.expectRevert(PixelLifeSink.InvalidFriend.selector);
        _mend(ALICE, GEN0_FRIEND, BOB_FRIEND, 1, QUOTE);
        vm.expectRevert(PixelLifeSink.InvalidFriend.selector);
        _mend(ALICE, ALICE_FRIEND, GEN0_FRIEND, 1, QUOTE);
        vm.expectRevert(PixelLifeSink.InvalidFriend.selector);
        _mend(ALICE, ALICE_FRIEND, 999, 1, QUOTE);
    }

    function testPixelBoundsAndSelfMend() public {
        vm.expectRevert(PixelLifeSink.InvalidPixels.selector);
        _regrow(ALICE, ALICE_FRIEND, 0, QUOTE);
        vm.expectRevert(PixelLifeSink.InvalidPixels.selector);
        _regrow(ALICE, ALICE_FRIEND, 257, QUOTE);
        vm.expectRevert(PixelLifeSink.InvalidPixels.selector);
        _mend(ALICE, ALICE_FRIEND, BOB_FRIEND, 257, QUOTE);
        vm.expectRevert(PixelLifeSink.SelfMend.selector);
        _mend(ALICE, ALICE_FRIEND, ALICE_FRIEND, 1, QUOTE);
        _regrow(ALICE, ALICE_FRIEND, 256, QUOTE);
    }

    function testUnfundedOrUnapprovedWalletReverts() public {
        address wallet = _wallet(BOB_FRIEND);
        _execute(BOB, BOB_FRIEND, address(rf), abi.encodeCall(rf.approve, (address(sink), 0)));
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(sink), 0, 0.5 ether
            )
        );
        _regrow(BOB, BOB_FRIEND, 1, QUOTE);
        _execute(
            BOB,
            BOB_FRIEND,
            address(rf),
            abi.encodeCall(rf.approve, (address(sink), type(uint256).max))
        );
        _execute(BOB, BOB_FRIEND, address(rf), abi.encodeCall(rf.transfer, (BOB, 999.5 ether)));
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, wallet, 0.5 ether, 1 ether
            )
        );
        _mend(BOB, BOB_FRIEND, ALICE_FRIEND, 1, QUOTE);
    }

    function testNFTTransferMovesPaymentRightWithTheFriend() public {
        vm.prank(ALICE);
        generations.transfer(ALICE_FRIEND, BOB);
        vm.expectRevert(MockFriendWallet.NotOwner.selector);
        _regrow(ALICE, ALICE_FRIEND, 1, QUOTE);
        _regrow(BOB, ALICE_FRIEND, 1, QUOTE);
    }

    function testQuoteIsNotStoredSoTheServerDedupesByLog() public {
        // Paying one quote twice is the payer's choice; the server credits once per quote and
        // books any surplus as pixel credit (tokenomics.md §5.3).
        _regrow(ALICE, ALICE_FRIEND, 1, QUOTE);
        _regrow(ALICE, ALICE_FRIEND, 1, QUOTE);
        assertEq(rf.balanceOf(address(forwarder)), 0.5 ether);
    }

    function testFuzzRegrowSplit(uint256 pixels) public {
        pixels = bound(pixels, 1, 256);
        _assertRegrowSplit(pixels);
    }

    function testFuzzMendSplit(uint256 pixels) public {
        pixels = bound(pixels, 1, 256);
        address payer = _wallet(BOB_FRIEND);
        address target = _wallet(ALICE_FRIEND);
        uint256 supply = rf.totalSupply();
        uint256 payerBefore = rf.balanceOf(payer);
        uint256 targetBefore = rf.balanceOf(target);
        vm.recordLogs();
        _mend(BOB, BOB_FRIEND, ALICE_FRIEND, pixels, QUOTE);
        (uint256 total, uint256 burned, uint256 toTarget) = _lastMend();
        assertEq(total, pixels * 1 ether);
        assertEq(burned + toTarget, total);
        assertEq(burned, total / 2);
        assertEq(payerBefore - rf.balanceOf(payer), total);
        assertEq(rf.balanceOf(target) - targetBefore, toTarget);
        assertEq(supply - rf.totalSupply(), burned);
        assertEq(rf.balanceOf(address(sink)), 0);
        assertEq(rf.balanceOf(address(forwarder)), 0);
    }

    /// Any sequence of payments: supply falls by exactly the burned sum, the sink never keeps
    /// RF, and payer spend = burned + streamed + paid to targets.
    function testFuzzSequenceConservesRF(uint256[8] calldata actions) public {
        uint256 supply = rf.totalSupply();
        uint256 walletsBefore = _walletSum();
        uint256 expectedBurn;
        uint256 expectedStream;
        for (uint256 i; i < actions.length; ++i) {
            uint256 pixels = bound(actions[i] >> 8, 1, 64);
            if (actions[i] & 1 == 0) {
                uint256 id = actions[i] & 2 == 0 ? ALICE_FRIEND : BOB_FRIEND;
                _regrow(generations.ownerOf(id), id, pixels, bytes32(i));
                expectedBurn += pixels * 0.25 ether;
                expectedStream += pixels * 0.25 ether;
            } else {
                (uint256 from, uint256 to) =
                    actions[i] & 2 == 0 ? (ALICE_FRIEND, BOB_FRIEND) : (BOB_FRIEND, ALICE_FRIEND);
                _mend(generations.ownerOf(from), from, to, pixels, bytes32(i));
                expectedBurn += pixels * 0.5 ether;
            }
            assertEq(rf.balanceOf(address(sink)), 0);
        }
        assertEq(supply - rf.totalSupply(), expectedBurn);
        assertEq(rf.balanceOf(address(forwarder)), expectedStream);
        assertEq(walletsBefore - _walletSum(), expectedBurn + expectedStream);
    }

    function _assertRegrowSplit(uint256 pixels) private {
        address wallet = _wallet(ALICE_FRIEND);
        uint256 supply = rf.totalSupply();
        uint256 before = rf.balanceOf(wallet);
        uint256 streamBefore = rf.balanceOf(address(forwarder));
        vm.recordLogs();
        _regrow(ALICE, ALICE_FRIEND, pixels, QUOTE);
        (uint256 total, uint256 burned, uint256 streamed) = _lastRegrow();
        assertEq(total, pixels * 0.5 ether);
        assertEq(burned + streamed, total);
        assertEq(burned, total / 2);
        assertEq(before - rf.balanceOf(wallet), total);
        assertEq(rf.balanceOf(address(forwarder)) - streamBefore, streamed);
        assertEq(supply - rf.totalSupply(), burned);
        assertEq(rf.balanceOf(address(sink)), 0);
    }

    function _lastRegrow() private returns (uint256 total, uint256 burned, uint256 streamed) {
        bytes memory data = _lastLog(Regrew.selector);
        (, total, burned, streamed) = abi.decode(data, (uint256, uint256, uint256, uint256));
    }

    function _lastMend() private returns (uint256 total, uint256 burned, uint256 toTarget) {
        bytes memory data = _lastLog(Mended.selector);
        (,, total, burned, toTarget) =
            abi.decode(data, (address, uint256, uint256, uint256, uint256));
    }

    function _lastLog(bytes32 topic) private returns (bytes memory data) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].emitter == address(sink) && logs[i - 1].topics[0] == topic) {
                return logs[i - 1].data;
            }
        }
        revert("event not found");
    }

    function _walletSum() private view returns (uint256) {
        return rf.balanceOf(_wallet(ALICE_FRIEND)) + rf.balanceOf(_wallet(BOB_FRIEND));
    }

    function _regrow(address owner, uint256 friendId, uint256 pixels, bytes32 quoteId) private {
        _regrow(owner, friendId, pixels, quoteId, friendId);
    }

    function _regrow(
        address owner,
        uint256 walletFriendId,
        uint256 pixels,
        bytes32 quoteId,
        uint256 friendId
    ) private {
        _execute(
            owner,
            walletFriendId,
            address(sink),
            abi.encodeCall(sink.regrow, (friendId, pixels, quoteId))
        );
    }

    function _mend(address owner, uint256 from, uint256 to, uint256 pixels, bytes32 quoteId)
        private
    {
        _execute(owner, from, address(sink), abi.encodeCall(sink.mend, (from, to, pixels, quoteId)));
    }

    function _execute(address owner, uint256 friendId, address target, bytes memory data) private {
        MockFriendWallet wallet = MockFriendWallet(_wallet(friendId));
        vm.prank(owner);
        wallet.execute(target, 0, data, 0);
    }

    function _wallet(uint256 friendId) private view returns (address) {
        return _wallets[friendId];
    }
}
