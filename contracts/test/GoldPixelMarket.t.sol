// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { Test } from "forge-std/Test.sol";
import { GoldPixelMarket } from "../src/GoldPixelMarket.sol";
import { MockRF, MockERC6551Registry, MockGenerations, MockGoldLeaf } from "./Mocks.sol";

contract GoldPixelMarketTest is Test {
    address private constant SELLER = address(0x5E11);
    address private constant BUYER = address(0xB111);
    address private constant CREATOR = address(0xC0DE);
    address private constant ORIGIN_OWNER = address(0x0A1);
    uint256 private constant ORIGIN_FRIEND = 7;
    uint256 private constant LEAF = 1;

    MockRF private rf;
    MockGenerations private generations;
    MockGoldLeaf private leaf;
    GoldPixelMarket private market;
    address private originWallet;

    function setUp() public {
        rf = new MockRF();
        generations = new MockGenerations(address(rf), new MockERC6551Registry());
        generations.mint(ORIGIN_OWNER, ORIGIN_FRIEND, 1);
        originWallet = generations.tokenBoundAccount(ORIGIN_FRIEND);
        leaf = new MockGoldLeaf();
        market = new GoldPixelMarket(address(rf), address(generations), address(leaf), CREATOR);
        leaf.mint(SELLER, LEAF, ORIGIN_FRIEND);
        vm.prank(SELLER);
        leaf.setApprovalForAll(address(market), true);
        rf.mint(BUYER, 1_000_000 ether);
        vm.prank(BUYER);
        rf.approve(address(market), type(uint256).max);
    }

    function testFeeConstantsMatchTokenomics() public view {
        assertEq(market.BURN_BPS() + market.ORIGIN_BPS() + market.CREATOR_BPS(), 500);
        (uint256 burned, uint256 toOrigin, uint256 toCreator, uint256 toSeller) =
            market.fees(55 ether);
        assertEq(burned, 1.1 ether);
        assertEq(toOrigin, 1.1 ether);
        assertEq(toCreator, 0.55 ether);
        assertEq(toSeller, 52.25 ether);
    }

    function testInvalidConfigurationRejected() public {
        vm.expectRevert(GoldPixelMarket.InvalidConfiguration.selector);
        new GoldPixelMarket(address(rf), address(generations), address(leaf), address(0));
        vm.expectRevert(GoldPixelMarket.InvalidConfiguration.selector);
        new GoldPixelMarket(address(rf), address(generations), address(0xBEEF), CREATOR);
        MockRF other = new MockRF();
        vm.expectRevert(GoldPixelMarket.InvalidConfiguration.selector);
        new GoldPixelMarket(address(other), address(generations), address(leaf), CREATOR);
    }

    function testListEscrowsAndCancelReturns() public {
        vm.prank(BUYER);
        vm.expectRevert(GoldPixelMarket.NotLeafOwner.selector);
        market.list(LEAF, 50 ether);
        vm.startPrank(SELLER);
        vm.expectRevert(GoldPixelMarket.InvalidPrice.selector);
        market.list(LEAF, 0);
        market.list(LEAF, 50 ether);
        assertEq(leaf.ownerOf(LEAF), address(market));
        vm.stopPrank();
        vm.prank(BUYER);
        vm.expectRevert(GoldPixelMarket.NotSeller.selector);
        market.cancel(LEAF);
        vm.prank(SELLER);
        market.cancel(LEAF);
        assertEq(leaf.ownerOf(LEAF), SELLER);
        vm.prank(BUYER);
        vm.expectRevert(GoldPixelMarket.NotListed.selector);
        market.buy(LEAF, 50 ether);
    }

    function testBuyerIsProtectedFromARelistAtAHigherPrice() public {
        vm.startPrank(SELLER);
        market.list(LEAF, 50 ether);
        market.cancel(LEAF);
        market.list(LEAF, 500 ether);
        vm.stopPrank();
        vm.prank(BUYER);
        vm.expectRevert(GoldPixelMarket.PriceChanged.selector);
        market.buy(LEAF, 50 ether);
    }

    function testFuzzSaleSplit(uint256 price) public {
        price = bound(price, 1, 1_000_000 ether);
        vm.prank(SELLER);
        market.list(LEAF, price);
        uint256 supply = rf.totalSupply();
        vm.prank(BUYER);
        market.buy(LEAF, price);

        uint256 burned = supply - rf.totalSupply();
        uint256 toOrigin = rf.balanceOf(originWallet);
        uint256 toCreator = rf.balanceOf(CREATOR);
        uint256 toSeller = rf.balanceOf(SELLER);
        assertEq(burned + toOrigin + toCreator + toSeller, price);
        assertEq(1_000_000 ether - rf.balanceOf(BUYER), price);
        assertEq(burned, price * 200 / 10_000);
        assertEq(toOrigin, price * 200 / 10_000);
        assertEq(toCreator, price * 100 / 10_000);
        assertGe(toSeller, price * 9500 / 10_000);
        assertEq(rf.balanceOf(address(market)), 0);
        assertEq(leaf.ownerOf(LEAF), BUYER);
        (address seller,) = market.listings(LEAF);
        assertEq(seller, address(0));
    }
}
