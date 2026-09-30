// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.36;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Test doubles for the existing mainnet contracts' external behaviour only.

/// @dev Matches RF as observed read-only on chain 4663: OpenZeppelin ERC20 (transfer to 0x0
/// reverts with ERC20InvalidReceiver) plus ERC20Burnable's public burn/burnFrom.
contract MockRF is ERC20 {
    constructor() ERC20("Mock RF", "RF") { }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
}

/// @dev ERC-6551 registry shape: deterministic CREATE2 accounts keyed by (chain, NFT, id).
/// Implementation and salt are fixed, as in Generations (canonical registry, salt zero).
contract MockERC6551Registry {
    function createAccount(address tokenContract, uint256 tokenId) external returns (address) {
        address predicted = account(tokenContract, tokenId);
        if (predicted.code.length != 0) return predicted;
        return
            address(new MockFriendWallet{ salt: bytes32(0) }(block.chainid, tokenContract, tokenId));
    }

    function account(address tokenContract, uint256 tokenId) public view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(MockFriendWallet).creationCode,
                abi.encode(block.chainid, tokenContract, tokenId)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), bytes32(0), initCodeHash)
                    )
                )
            )
        );
    }
}

interface IOwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @dev ERC-6551 account: whoever owns the bound NFT may `execute` plain calls.
contract MockFriendWallet {
    uint256 private immutable _chainId;
    address private immutable _tokenContract;
    uint256 private immutable _tokenId;

    error NotOwner();

    constructor(uint256 chainId_, address tokenContract_, uint256 tokenId_) {
        _chainId = chainId_;
        _tokenContract = tokenContract_;
        _tokenId = tokenId_;
    }

    function token() external view returns (uint256, address, uint256) {
        return (_chainId, _tokenContract, _tokenId);
    }

    function owner() public view returns (address) {
        return IOwnerOf(_tokenContract).ownerOf(_tokenId);
    }

    function execute(address target, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (msg.sender != owner()) revert NotOwner();
        assert(operation == 0);
        bool success;
        (success, result) = target.call{ value: value }(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }
}

/// @dev Generations' read surface: owner, generation, canonical wallet per Friend, and the
/// current ActivationManager (replaceable by the protocol).
contract MockGenerations {
    address public immutable token;
    MockERC6551Registry public immutable registry;
    address public activationManager;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint8) public generation;

    constructor(address token_, MockERC6551Registry registry_) {
        token = token_;
        registry = registry_;
    }

    function mint(address owner, uint256 id, uint8 generation_) external {
        ownerOf[id] = owner;
        generation[id] = generation_;
        registry.createAccount(address(this), id);
    }

    function transfer(uint256 id, address recipient) external {
        assert(msg.sender == ownerOf[id]);
        ownerOf[id] = recipient;
    }

    function tokenBoundAccount(uint256 id) external view returns (address) {
        return registry.account(address(this), id);
    }

    function setActivationManager(address manager) external {
        activationManager = manager;
    }
}

/// @dev ActivationManager's `fund` as observed on a local mainnet fork: permissionless, pulls
/// the asset with transferFrom, reverts `InvalidAsset` for anything but RF, emits `Funded`.
contract MockActivationManager {
    using SafeERC20 for IERC20;

    IERC20 public immutable rf;
    uint256 public funded;

    error InvalidAsset();

    event Funded(address indexed asset, address indexed funder, uint256 amount);

    constructor(IERC20 rf_) {
        rf = rf_;
    }

    function fund(address asset, uint256 amount) external {
        if (asset != address(rf)) revert InvalidAsset();
        funded += amount;
        rf.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(asset, msg.sender, amount);
    }
}

/// @dev Gold Leaf vault surface used by the market: ERC-721 ownership, approval, origin.
contract MockGoldLeaf {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint256) public originFriendId;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    error NotAuthorized();

    function mint(address to, uint256 leafId, uint256 origin) external {
        ownerOf[leafId] = to;
        originFriendId[leafId] = origin;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 leafId) external {
        if (ownerOf[leafId] != from) revert NotAuthorized();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender]) revert NotAuthorized();
        ownerOf[leafId] = to;
    }
}
