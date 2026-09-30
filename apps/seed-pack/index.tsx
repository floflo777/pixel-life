"use client";

import "@rarefriends/friendsdk/reveal.css";
import "./style.css";
import { SeedPackBooth } from "./src/booth";

/** FriendSDK CLI entry: the runtime mounts this inside its sandboxed child via `GameSession`. */
export default SeedPackBooth;
