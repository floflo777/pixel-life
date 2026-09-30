# Pixel Life contracts (spec)

> **Not deployed. Not audited.** Nothing in this folder has been deployed to Robinhood Chain (4663) or any other
> network, and no deployment script exists. The code has been tested only locally (unit and fuzz tests with mocks,
> plus an optional test against an in-memory local fork of mainnet). Deploying needs a security review first, then
> answers from the RF team (below), then explicit authorization from the owner.

Foundry project for the real-RF ("live") mode described in `docs/design/architecture.md` §1.5, with prices from
`docs/design/tokenomics/tokenomics.md`. It follows the FriendSDK contract conventions
(`node_modules/@rarefriends/friendsdk/contracts/AGENTS.md`, `COMMANDMENTS.md`): custom errors, constants over
immutables, no owner, no pause, no upgrade, no withdraw, existing protocol contracts reached only through interfaces,
and test doubles only in `test/`.

| Contract                  | Status               | What it does                                                                                                                                                                                                          |
| ------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/PixelLifeSink.sol`   | live-ready spec      | `regrow` / `mend`, paid by a Friend's canonical wallet (ERC-6551 TBA) through `execute`. 50 % burned with `RF.burn`, 50 % sent to `streamSink` (Regrow) or to the target Friend's TBA (Mend).                         |
| `src/StreamForwarder.sol` | live-ready spec      | The intended `streamSink`. It collects the Regrow stream half, and anyone can push the whole balance into `ActivationManager.fund(RF, amount)`.                                                                       |
| `src/GoldPixelMarket.sol` | spec level (roadmap) | Fixed-price RF listings for Gold Leaves with the 5 % fee (2 % burned, 2 % to the origin Friend's TBA, 1 % to the creator). The fully backed Gold Leaf wrapper is described in the file header. It is not implemented. |

## Build and test

```sh
npm ci                      # at the repo root: OpenZeppelin + forge-std come from the vendored FriendSDK 0.1.4
cd contracts
forge build
forge test                  # 22 tests; fuzz runs = 1024
forge fmt --check
PIXELLIFE_FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract MainnetFork   # optional
```

The fork test runs against an **in-memory local fork**. It deploys nothing and sends no transactions to chain 4663.
It checks, against the real contracts, that `RF.burn` lowers `totalSupply`, that a transfer to `0x0` reverts, that
the real Friend #7730's TBA can pay `regrow` through `execute`, and that `StreamForwarder.forward()` reaches the real
ActivationManager's `fund`.

## PixelLifeSink

- `regrow(tokenId, pixels, quoteId)`. `msg.sender` must be `Generations.tokenBoundAccount(tokenId)`, and the Friend
  must be hardwired (generation ≥ 1). It costs `pixels × 0.5 RF`: half is burned and half goes to `streamSink`.
- `mend(payerTokenId, targetTokenId, pixels, quoteId)`. `msg.sender` must be the payer Friend's TBA, and both
  Friends must be hardwired and different. It costs `pixels × 1 RF`: half is burned and half goes to
  `tokenBoundAccount(targetTokenId)` in the same call.
- `pixels` is 1..256 (a 16 × 16 sprite). Prices are `constant`, so a new price means a new deployment. Mend = 2 ×
  Regrow, which closes the alt self-Mend discount (tokenomics §0 note 1).
- The contract has no storage. It holds RF only inside a call, and the tests assert its balance is 0 after every
  call. There is no function that moves RF anywhere except the split. RF sent to it by mistake stays there.
- Order: checks, then the event, then interactions (pull, burn, forward). The only external contracts are RF (a plain
  OpenZeppelin ERC20 with no hooks) and Generations (view calls).
- `quoteId` is the server's quote, which names the specific pixels (tokenomics §5.3). It appears in the event and is
  **not stored**: paying the same quote twice only hurts the payer. The server credits each quote once and books any
  surplus as pixel credit. This drops the draft splitter's `usedQuote` mapping (Commandments II and III).

`PixelSplitter.sol`'s `spend(DECOR)` and `flush()` (edge sweep) are **not** included, because the T11 brief scopes
this contract to Regrow and Mend. The weekly Seed Pack edge can go
`ChanceGame.withdrawSurplus(team) → RF.burn(half) + StreamForwarder` without a new contract, or through a follow-up
`flush()`.

### Live-mode runbook

The steps up to "Deploy" are paperwork. Nothing is broadcast without the owner's explicit authorization.

1. **RF team sign-off** on the open questions below, especially Q1 (sanctioned use of `ActivationManager.fund`).
2. **Review / audit** of `PixelLifeSink` and `StreamForwarder`, and of this commit hash.
3. **Deploy** (owner-authorized, by hand, key prompted locally as in the FriendSDK deploy script; never in CI):
   1. `StreamForwarder(RF, Generations)`
   2. `PixelLifeSink(RF, Generations, streamSink = StreamForwarder)`

   Constants: RF `0x0779369854d3EcdEA927206718FFD7730C67B71f`, Generations
   `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D`, chain 4663. Verify the source on the explorer.

4. **Server configuration:** `ECONOMY_MODE=live`, `PIXEL_LIFE_SINK=<address>`, `PIXEL_LIFE_SINK_FROM_BLOCK=<deploy block>`,
   and the confirmation depth.
5. **Client flow**, one wallet signature per step and the same pattern as the SDK's `buy`:
   1. `POST /api/quote` returns `{quoteId, pixels, total}` and locks the pixels for 15 min.
   2. The owner signs `TBA.execute(RF, 0, approve(sink, total), 0)`. An exact approval is recommended. An unlimited
      approval saves a signature but is the owner's choice.
   3. The owner signs `TBA.execute(sink, 0, regrow(tokenId, pixels, quoteId), 0)`, or the equivalent `mend(...)`.
   4. The client posts the tx hash. The server fetches the receipt, checks that `receipt.to` is the TBA, the log
      emitter is the sink, and the chain is 4663, then waits for N confirmations and credits the pixels.
6. **Indexer:** a cron job scans `Regrew`/`Mended` logs from the sink since `chain_cursor('pixel_life_sink')`, so
   payments whose client never posted the hash are still credited. Credit is idempotent on `(tx_hash, log_index)`.
7. **Stream top-up:** anyone, for example a weekly cron job, calls `StreamForwarder.forward()`. It is permissionless
   and can only send RF into `ActivationManager.fund`.
8. **Kill switch:** there is no on-chain pause by design. To stop live payments, set `ECONOMY_MODE=sim`, which stops
   issuing quotes. A payment made without a quote is still credited as pixel credit. To change prices, deploy a new
   sink and point the server at it. The old sink stays callable, but it is harmless because every payment is split
   correctly.

### Event schema for the indexer (1:1 with `rf_ledger`)

```solidity
event Regrew(uint256 indexed tokenId, bytes32 indexed quoteId,
             uint256 pixels, uint256 total, uint256 burned, uint256 streamed);
event Mended(uint256 indexed payerTokenId, uint256 indexed targetTokenId, bytes32 indexed quoteId,
             address targetWallet, uint256 pixels, uint256 total, uint256 burned, uint256 toTarget);
```

| `rf_ledger` column | `Regrew`                                                   | `Mended`        |
| ------------------ | ---------------------------------------------------------- | --------------- |
| `id`               | `live:4663:<txHash>:<logIndex>`                            | same            |
| `kind`             | `'regrow'`                                                 | `'mend'`        |
| `mode`             | `'live'`                                                   | `'live'`        |
| `payer_token`      | `tokenId`                                                  | `payerTokenId`  |
| `target_token`     | `tokenId`                                                  | `targetTokenId` |
| `pixels`           | `pixels`                                                   | `pixels`        |
| `total`            | `total` (base units, decimal string)                       | `total`         |
| `burn`             | `burned`                                                   | `burned`        |
| `stream`           | `streamed`                                                 | `'0'`           |
| `to_target`        | `'0'`                                                      | `toTarget`      |
| `tx_hash`          | `txHash`                                                   | `txHash`        |
| `block`            | `blockNumber`                                              | `blockNumber`   |
| `created_at`       | block timestamp                                            | block timestamp |
| (quote match)      | `quoteId` topic, which the server matches to its quote row | same            |

Invariants the indexer may assert: `burn + stream + to_target == total`, `burn == total / 2`,
`total == pixels × price(kind)`. The fuzz tests prove these hold on-chain.

**Schema gap (for T7/server owner):** `rf_ledger.tx_hash` is `UNIQUE`, but one transaction can emit several sink
events (for example a smart-account owner batching two `execute` calls). Add `log_index` and make
`UNIQUE(tx_hash, log_index)` the idempotency key.

Gold market events (roadmap, `P2 market_fills`): `Listed(leafId, seller, price)`, `Cancelled(leafId, seller)`, and
`Sold(leafId, originFriendId, buyer, seller, price, burned, toOrigin, toCreator)`. The seller's proceeds are
`price − burned − toOrigin − toCreator`.

## RF burn semantics (checked, read-only)

The brief asked whether RF exposes `burn()`. It does. It was checked on 2026-09-30 with `eth_call` against
`https://rpc.mainnet.chain.robinhood.com` and on a local fork. Nothing was sent.

- RF (`RareFriends` / `RAREFRIENDS`) has the OpenZeppelin `ERC20Burnable` selectors `burn(uint256)` (`0x42966c68`)
  and `burnFrom(address,uint256)` (`0x79cc6790`). `burn(1)` from a holder succeeds. From an empty account it reverts
  with `ERC20InsufficientBalance`. On the fork, `burn` lowered `totalSupply` by exactly the amount.
- `transfer(0x0, x)` **reverts** with `ERC20InvalidReceiver(0x0)`. So the protocol's "burn to 0x0" is `burn()`, which
  emits `Transfer(from, 0x0)`. It is not a transfer. The ActivationManager's bytecode also contains the `burn`
  selector.
- `0x…dEaD` already holds about 49.9 RF of plain transfers, which do not reduce `totalSupply`.

The contracts therefore always burn with `RF.burn`, so there is no dEaD or 0x0 constructor option. `MockRF` copies
this behaviour: OpenZeppelin ERC20, where transfer to 0x0 reverts, plus public `burn`/`burnFrom`.

## Capability gaps and questions for the RF team

**Q1. Stream entry point: found, needs sign-off.** The brief's premise was that no public "add to stream" function
exists. The deployed ActivationManager (`0xd4a35e…f283ac`; its EIP-1967 implementation slot is empty) does have one:
`fund(address asset, uint256 amount)` (selector `0x7b1837de`, a verified signature in the 4byte DB). Evidence:

- `eth_call`: it is permissionless. An unrelated caller got only `ERC20InsufficientAllowance(AM, 0, amount)`.
  A non-RF asset reverts `InvalidAsset()`.
- A local anvil fork, impersonating an RF holder: `approve` then `fund(RF, 1 RF)` succeeded. It emitted
  `Funded(asset, funder, amount)` and pulled 1 RF into the manager with no burn. `streams(RF)` showed a higher
  per-second rate with the period end unchanged. This was a local fork only.
- `Generations.activationManager()` names the current manager, so `StreamForwarder` follows a migration without an
  admin.

Questions for the RF team:

- (a) Is `fund(RF, amount)` intended for third-party contracts such as game sinks?
- (b) What are the exact semantics? Is the amount spread over the remaining period of the current 7-day stream,
  and what happens at the weekly reset?
- (c) Is there a minimum amount or any rate-limit, so we know how often to call `forward()`?
- (d) Should the stream half be burned 50/50 again on the way in, the way activation fees are? We do not do that.

If (a) is "no", swap `streamSink` for an RF-team-designated address at deploy time. The sink is stateless, so
redeploying it is cheap.

**Q2. Public burn.** It is confirmed as above. We ask the RF team to confirm that `burn` is the canonical burn
accounting, meaning their "burned" metrics are driven by `Transfer(x, 0x0)` or `totalSupply`.

**Q3. FriendSDK `report()` bridge.** The SDK frame bridge allows only
`read/canBuy/buy/play/settle/redeem` (`frame-bridge.ts`), so a sandboxed venue cannot hand run results to its host.
We propose an additive message:

- `report({ kind: string, payload: JSON ≤ 4 KB })`, sent from the child to the host.
- The host validates `event.source`, rate-limits it and passes it to a `onReport(ctx, payload)` prop of
  `ConnectedGameHost`, with `ctx = { friendId, walletAddress, chainId }` taken from the gate. This is the same
  pattern as our `previewClient` patch.
- It has no on-chain effect and needs no RF promise. Results stay advisory until the server replays them.

This lets third-party venues feed the shared Bits faucet without any side-channel `postMessage`.

**Q4. `redeemTo(recipient, data)` in a future ChanceGame.** This would reduce the Gold Leaf wrap from three steps
(`prepare → redeem → wrap`) to one atomic call. See the header of `GoldPixelMarket.sol`.

**Q5. Edge sweep.** Is a weekly `withdrawSurplus → burn half → StreamForwarder` by the Seed Pack deployer acceptable,
or does the RF team want the sweep on-chain (a trustless `flush()`)?

## Test coverage

- `PixelLifeSink.t.sol` (13 tests):
  - Happy paths with exact events.
  - Only the canonical TBA can pay: not the NFT owner directly, not another Friend's wallet, and not a stranger
    driving the TBA.
  - Generation-0 payer or target, pixel bounds, self-Mend, missing allowance or balance.
  - An NFT transfer moves the payment right to the new owner.
  - Fuzz tests of the split for Regrow and Mend over 1..256 px.
  - A fuzzed sequence of 8 mixed payments conserves RF: supply delta = Σ burned, sink balance is always 0, and wallet
    spend = burned + streamed + paid to targets.
- `StreamForwarder.t.sol` (4 tests): any caller forwards the whole balance, with the allowance back to 0 afterwards.
  It follows a manager migration. If the stream call reverts, the RF stays.
- `GoldPixelMarket.t.sol` (5 tests):
  - The fee constants.
  - List, cancel, the escrow and the auth errors.
  - Front-run protection against a cancel and relist at a higher price.
  - A fuzz test of the sale split: the sum equals the price, each fee equals its bps, and the market keeps 0 RF.
- `MainnetFork.t.sol`: optional, local fork only (see above).

Mocks (`test/Mocks.sol`):

- `MockRF`: the burn semantics above.
- `MockERC6551Registry`: CREATE2 accounts keyed by (chain, NFT, id), with a fixed implementation and salt 0.
- `MockFriendWallet`: an ERC-6551 `execute` restricted to the NFT owner.
- `MockGenerations`: owner, generation, TBA and `activationManager`.
- `MockActivationManager`: `fund` as observed on the fork.
- `MockGoldLeaf`.
