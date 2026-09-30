# Judges' FAQ

Short answers, each with a way to check it. Paths are relative to the repository root.

## Why can I play without a wallet? Doesn't the SDK require the ownership gate?

The gate is never bypassed. It guards everything tied to a Friend you own: your own Friend's scars, the (simulated) RF ledger, Regrow, Mend and the Seed Pack Booth.

- **Guests never enter the FriendSDK runtime.** "Play now" runs the hub and the Pixel Life venue in our own page with a _loaned_ real Friend. Its canonical sprite is read with the SDK's `createFriendReader` at build time and shown as "on loan · #id". Guests have no RF, cannot Regrow, Mend or open packs, and their scars live only in their browser.
- **Owners go through the SDK unchanged:** `createFriendWalletSession` → `readOwnedFriends` → `readGenerationEligibility` + `tokenBoundAccount` at a fresh block, then our server repeats the eligibility check before it stores anything.
- **The Seed Pack Booth is a stock SDK game** mounted with `ConnectedGameHost`, so the SDK's own gate runs again before its iframe mounts. There is no guest path into it.

Why: the rules allow a custom stack where the SDK does not fit ("Projects without FriendSDK"), and the organizer's comments on entries have been about access ("any way i can try this singleplayer?", "No playable Friends found"). A shared hub and a physics venue also need a backend the sandboxed child cannot authenticate to.

If the organizers consider the guest path out of bounds, tell us and we will switch it off; the owner path does not depend on it.

Check: DECISIONS D-11, `docs/design/architecture.md` §1.3; `apps/web` identity code; try "Play now" with no wallet, then try the Seed Pack door as a guest (it asks for your own Friend).

## Is any of the RF real?

No. Every RF amount in the preview is simulated, labelled SIMULATED, and kept in our server ledger (default `ECONOMY_MODE=sim`). We report no on-chain activity: none was produced, and build-time or simulated activity would not be meaningful for Token Activity anyway.

What we submit for Token Activity is a design that is ready to run on real RF:

- Every Regrow and Mend is split in one call: 50 % `RF.burn` (lowers `totalSupply`), 50 % to the protocol's reward stream (Regrow) or to the target Friend's wallet (Mend).
- The contracts exist, are tested, and were exercised against a local fork of mainnet. They are not deployed and not audited.
- Once live, every burn is an `RF.burn` inside a `Regrew` / `Mended` event, so anyone can count it on chain.

Check: `contracts/README.md`, `cd contracts && forge test`.

## How does Regrow reach the protocol's reward stream?

The deployed ActivationManager exposes `fund(address asset, uint256 amount)` (selector `0x7b1837de`). An `eth_call` showed that anyone can call it, and on a local anvil fork `fund(RF, 1 RF)` succeeded and raised the stream's per-second rate. `StreamForwarder` collects the Regrow stream half and anyone can push it into `fund`. We have not had the RF team confirm that third-party contracts are meant to use it. That is open question Q1. If the answer is no, the stream half goes to an address they designate.

Check: `PIXELLIFE_FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract MainnetFork` (in-memory fork; deploys nothing, broadcasts nothing).

## Can Mend be farmed?

Mend costs 2 × Regrow (1.0 vs 0.5 RF/px). Mending your own Friend from a second wallet therefore costs exactly the Regrow price, and more of it is burned. A Friend can receive at most 24 px/day from Mends, and the hub's Mend board lists one Friend per owner. Play pays no RF, so bots have nothing to extract.

Check: `packages/shared/src/economy.ts` (`ECON`, module-load invariant `mend >= 2 × regrow`); `PixelLifeSink` enforces both prices as constants; `docs/design/tokenomics/tokenomics.md` §9.

## Is the Seed Pack backed?

Yes, by the SDK's own rules: each pack reserves the 45 RF top prize at purchase, and a purchase is refused unless the stake covers it. Outcome weights sum to 10,000 bps; EV 4.48 RF per 5 RF pack (RTP 89.6 %).

Check: `node --experimental-strip-types docs/design/tokenomics/sim/verify-game.mts` parses `game.json` with the SDK's `parseChanceGame` and walks a buy / settle / redeem. `npm run sdk:check -w @pl/seed-pack`.

## Why patch FriendSDK?

The SDK preview ledger lives in memory and resets on reload, so a Gold Pixel would disappear. The patch (~15 lines) adds an optional `previewClient` factory to `ConnectedGameHost`. It is called only after the gate passes, with the verified wallet. Everything else in the SDK is byte-for-byte. Without the patch the booth falls back to the stock ledger.

Check: `patches/@rarefriends+friendsdk+0.1.4.patch`, `apps/seed-pack/tests/preview-client-patch.test.tsx`.

## Is the Friend's artwork preserved?

The voxel body is the Friend's canonical frame 0 from the on-chain registry, one voxel per pixel, with the front face locked toward the camera. Missing pixels are exactly the scars; nothing else is redrawn. Gold, stitches and halos are layers on top.

Check: `packages/shared/src/bitmap.ts`, `packages/shared/src/friend.ts`; compare a Friend in-game with its sprite from the registry.

## Can a community FriendSDK game become a venue?

Yes, with no change to the game. `SdkFrameVenue` in `packages/venue-kit` takes a built SDK game directory and its `game.json`; the hub mounts it with `ConnectedGameHost`. The Seed Pack Booth uses exactly this path.

Check: `packages/venue-kit/src/contract.ts`, `apps/seed-pack`.

## What is not done

See "Known issues and limitations" in the submission README. In short: no contract deployed; RF-team sign-off needed on `fund`; the Gold Pixel market is spec level and simulated; ‹TBD from final checks›.
