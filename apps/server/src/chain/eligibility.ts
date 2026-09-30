import { readGenerationEligibility, type GenerationDeployment } from "@rarefriends/friendsdk/identity";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import type { ServerConfig } from "../config.js";
import { HttpError } from "../http/errors.js";

/**
 * The chain reads the server needs: the SDK eligibility reads plus signature verification.
 * A real viem PublicClient satisfies it; tests may point one at @pl/mock-rpc or stub it.
 */
export type ChainClient = Pick<PublicClient, "readContract" | "getChainId" | "getBlockNumber" | "verifyMessage">;

/** Creates the production client: plain HTTP to `RPC_URL`, bounded timeout, one retry. */
export function createChainClient(config: Pick<ServerConfig, "rpcUrl">): ChainClient {
  return createPublicClient({ transport: http(config.rpcUrl, { timeout: 8_000, retryCount: 1 }) });
}

/** The Generations deployment the server checks against (defaults to Robinhood mainnet, configurable for tests). */
export function deploymentFromConfig(
  config: Pick<ServerConfig, "chainId" | "generationsAddress">,
): GenerationDeployment {
  return { chainId: config.chainId, generations: config.generationsAddress };
}

const TBA_ABI = parseAbi(["function tokenBoundAccount(uint256 tokenId) view returns (address)"]);

/** Why a Friend was refused. `not_owner` also covers unminted/burned tokens (ownerOf reverts). */
export type EligibilityDenial = "not_owner" | "not_hardwired";

/** Result of {@link checkFriendEligibility}: all reads happened at `blockNumber`. */
export type EligibilityResult =
  | {
      readonly ok: true;
      readonly tokenId: bigint;
      readonly owner: Address;
      readonly tba: Address;
      readonly generation: number;
      readonly blockNumber: bigint;
    }
  | { readonly ok: false; readonly reason: EligibilityDenial; readonly blockNumber: bigint | null };

const RPC = { reason: "rpc_error" } as const;

const isRevert = (error: unknown) =>
  error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) !== null;

/**
 * Server-side fresh-block gate (architecture §1.6 step 4), the same sequence as the SDK host
 * (`game-host.tsx:159-165`): `readGenerationEligibility` at a fresh block, then `tokenBoundAccount`
 * at that same block. Denials are returned; infrastructure failures throw HttpError 503 `rpc_error`.
 */
export async function checkFriendEligibility(
  client: ChainClient,
  deployment: GenerationDeployment,
  tokenId: bigint,
  player: Address,
): Promise<EligibilityResult> {
  let result: Awaited<ReturnType<typeof readGenerationEligibility>>;
  try {
    result = await readGenerationEligibility(client, tokenId, player, deployment);
  } catch (error) {
    if (isRevert(error)) return { ok: false, reason: "not_owner", blockNumber: null };
    throw new HttpError(503, "internal", "Could not verify Friend ownership on chain. Try again.", RPC);
  }
  if (!result.ownedByPlayer) return { ok: false, reason: "not_owner", blockNumber: result.blockNumber };
  if (!result.hardwired) return { ok: false, reason: "not_hardwired", blockNumber: result.blockNumber };
  let tba: Address;
  try {
    tba = await client.readContract({
      address: deployment.generations,
      abi: TBA_ABI,
      functionName: "tokenBoundAccount",
      args: [tokenId],
      blockNumber: result.blockNumber,
    });
  } catch {
    throw new HttpError(503, "internal", "Could not read the Friend wallet on chain. Try again.", RPC);
  }
  if (!isAddress(tba) || tba.toLowerCase() === zeroAddress) {
    throw new HttpError(503, "internal", "Invalid canonical Friend wallet.", RPC);
  }
  return {
    ok: true,
    tokenId,
    owner: result.owner,
    tba,
    generation: result.generation,
    blockNumber: result.blockNumber,
  };
}
