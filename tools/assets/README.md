# @pl/assets

Build-time asset bakes. Nothing here runs in the browser at play time except the parser in `src/loaners.ts`.

## Loaner Friends (`out/loaners.json`)

Guests play with a loaned real Friend (D-11). Its canonical art is baked here with the FriendSDK's own public artwork
reader, `createFriendReader()` from `@rarefriends/friendsdk/sprites`, which reads the public Robinhood RPC (chain 4663)
with no wallet. The SDK's gated runtime is not involved.

```sh
npm run bake:loaners -w @pl/assets                    # live registry (public RPC)
npm run bake:loaners -w @pl/assets -- --rpc <url>  # any 4663-compatible RPC, e.g. @pl/mock-rpc
```

The roster is `LOANERS` in `src/loaners.ts`: one Friend per family (the Mask one is #344030 "Mismir", the Friend of
the style frames) plus 3 spares, 12 in all. The bake:

- checks every Friend frame by frame (and its family) against `docs/design/data/friends.json`, and exits non-zero on
  any mismatch. All 12 loaners are in that file, so all 12 are verified;
- enforces the 60 KB budget (the current file is about 19 KB);
- writes Prettier-formatted, deterministic JSON, so re-baking unchanged art produces no diff.

The file is committed. Re-bake only when the roster changes.

### Format (`pl-loaners@1`)

```jsonc
{
  "format": "pl-loaners@1",
  "source": { "chainId": 4663, "registry": "0x246E…", "reader": "@rarefriends/friendsdk@0.1.4 createFriendReader" },
  "friends": [
    {
      "tokenId": "344030", "familyId": 1, "family": "Mask", "seed": 344030, "label": "Mismir",
      "masks": ["<Hex64>", "..."],   // distinct frames (idle holds repeat a lot)
      "frames": [0, 0, 1, ...]       // 64 indices into masks, in SDK order: idle[d,u,l,r]×8, walk[d,u,l,r]×8
    }
  ]
}
```

### Consuming it (web task)

`@pl/assets` exports both the JSON and a strict parser. Add `"@pl/assets": "*"` to the consumer's dependencies:

```ts
import loanersJson from "@pl/assets/loaners.json";
import { parseLoaners, type LoanerFriend } from "@pl/assets";

// Validates everything (format tag, token ids, families, 64 frame indices, Hex64 masks) and throws TypeError if not.
const loaners: LoanerFriend[] = parseLoaners(loanersJson);
const { appearance, label } = loaners[0]; // appearance: FriendAppearance from @pl/shared
// appearance feeds straight into buildFriendModel(appearance, lost, { gold, lod }) from the game package.
```

Vite inlines the JSON (about 19 KB, about 2 KB gzipped) into the guest bundle. To keep it out of the landing chunk,
import it dynamically (`await import("@pl/assets/loaners.json")`) when the guest picks "play as a guest". Label the
Friend as **Loaned** in the UI (D-11). Guest scars live in `localStorage` only.

## Voxel Friend gallery

```sh
npm run gallery -w @pl/assets        # Vite dev server for apps/game/src/friend/dev/friend-gallery.html
npm run gallery:shot -w @pl/assets -- --out apps/game/src/friend/dev/screenshots/friend-gallery.png
```

`gallery:shot` renders the page in headless Chromium using SwiftShader WebGL
(`--use-gl=swiftshader --enable-webgl --ignore-gpu-blocklist`). It fails on any page or console error, and writes the
PNG plus a `.stats.json` with triangle counts and `setLost` timings measured in the browser.
