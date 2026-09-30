// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { PixelLifeSink, ISinkGenerations, IRFBurnable } from "../src/PixelLifeSink.sol";
import { StreamForwarder, IStreamGenerations } from "../src/StreamForwarder.sol";

interface IForkFriendWallet {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

interface IForkOwnerOf {
    function ownerOf(uint256 friendId) external view returns (address);
}

/// @notice Optional local fork check of RF's real burn semantics and a Regrow/Mend paid by a
/// real Friend wallet. Set PIXELLIFE_FORK_RPC to run. Everything happens on an in-memory local
/// fork: nothing is broadcast and nothing is deployed on chain 4663.
contract MainnetForkTest is Test {
    address private constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address private constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    address private constant ACTIVATION_MANAGER = 0xD4A35e11318E3679168d409184B788bcF9F283Ac;
    // The Friend the FriendSDK fork test uses.
    uint256 private constant FRIEND_ID = 7730;

    event Funded(address indexed asset, address indexed funder, uint256 amount);

    function testMainnetForkBurnSemanticsAndRealFriendWallet() public {
        string memory rpc = vm.envOr("PIXELLIFE_FORK_RPC", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 4663);
        IERC20 rf = IERC20(RF);
        ISinkGenerations generations = ISinkGenerations(GENERATIONS);
        assertEq(generations.token(), RF);

        // RF burns through burn(): supply falls. A transfer to 0x0 reverts.
        address holder = makeAddr("fork holder");
        deal(RF, holder, 10 ether);
        uint256 supply = rf.totalSupply();
        vm.prank(holder);
        IRFBurnable(RF).burn(1 ether);
        assertEq(supply - rf.totalSupply(), 1 ether);
        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0))
        );
        assertFalse(rf.transfer(address(0), 1 ether));

        StreamForwarder forwarder = new StreamForwarder(RF, GENERATIONS);
        address streamSink = address(forwarder);
        PixelLifeSink sink = new PixelLifeSink(RF, GENERATIONS, streamSink);
        assertGt(generations.generation(FRIEND_ID), 0);
        address owner = IForkOwnerOf(GENERATIONS).ownerOf(FRIEND_ID);
        address account = generations.tokenBoundAccount(FRIEND_ID);
        IForkFriendWallet wallet = IForkFriendWallet(account);
        deal(RF, account, rf.balanceOf(account) + 10 ether);
        uint256 accountBefore = rf.balanceOf(account);
        supply = rf.totalSupply();

        vm.startPrank(owner);
        wallet.execute(RF, 0, abi.encodeCall(IERC20.approve, (address(sink), 10 ether)), 0);
        wallet.execute(
            address(sink), 0, abi.encodeCall(sink.regrow, (FRIEND_ID, 4, keccak256("fork"))), 0
        );
        vm.stopPrank();
        assertEq(accountBefore - rf.balanceOf(account), 2 ether);
        assertEq(supply - rf.totalSupply(), 1 ether);
        assertEq(rf.balanceOf(streamSink), 1 ether);
        assertEq(rf.balanceOf(address(sink)), 0);

        // The stream half reaches the real ActivationManager through its public fund().
        address manager = IStreamGenerations(GENERATIONS).activationManager();
        assertEq(manager, ACTIVATION_MANAGER);
        uint256 managerBefore = rf.balanceOf(manager);
        supply = rf.totalSupply();
        vm.expectEmit(manager);
        emit Funded(RF, streamSink, 1 ether);
        forwarder.forward();
        assertEq(rf.balanceOf(manager) - managerBefore, 1 ether);
        assertEq(rf.balanceOf(streamSink), 0);
        assertEq(rf.totalSupply(), supply);
    }
}
