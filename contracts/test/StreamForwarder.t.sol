// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { StreamForwarder } from "../src/StreamForwarder.sol";
import { MockRF, MockERC6551Registry, MockGenerations, MockActivationManager } from "./Mocks.sol";

contract StreamForwarderTest is Test {
    MockRF private rf;
    MockGenerations private generations;
    MockActivationManager private manager;
    StreamForwarder private forwarder;

    event Funded(address indexed asset, address indexed funder, uint256 amount);

    function setUp() public {
        rf = new MockRF();
        generations = new MockGenerations(address(rf), new MockERC6551Registry());
        manager = new MockActivationManager(rf);
        generations.setActivationManager(address(manager));
        forwarder = new StreamForwarder(address(rf), address(generations));
        rf.mint(address(forwarder), 10 ether);
    }

    function testInvalidConfigurationRejected() public {
        vm.expectRevert(StreamForwarder.InvalidConfiguration.selector);
        new StreamForwarder(address(0xBEEF), address(generations));
        vm.expectRevert(StreamForwarder.InvalidConfiguration.selector);
        new StreamForwarder(address(rf), address(0xBEEF));
    }

    function testFuzzAnyoneFundsTheStreamWithTheWholeBalance(address caller, uint96 extra) public {
        rf.mint(address(forwarder), extra);
        uint256 amount = 10 ether + uint256(extra);
        vm.expectEmit(address(manager));
        emit Funded(address(rf), address(forwarder), amount);
        vm.prank(caller);
        forwarder.forward();
        assertEq(manager.funded(), amount);
        assertEq(rf.balanceOf(address(manager)), amount);
        assertEq(rf.balanceOf(address(forwarder)), 0);
        assertEq(rf.allowance(address(forwarder), address(manager)), 0);
    }

    function testFollowsAProtocolMigration() public {
        MockActivationManager next = new MockActivationManager(rf);
        generations.setActivationManager(address(next));
        forwarder.forward();
        assertEq(rf.balanceOf(address(next)), 10 ether);
        assertEq(rf.balanceOf(address(manager)), 0);
    }

    function testRevertingStreamKeepsTheRF() public {
        generations.setActivationManager(address(0));
        vm.expectRevert();
        forwarder.forward();
        assertEq(rf.balanceOf(address(forwarder)), 10 ether);
    }
}
