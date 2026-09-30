// Verify ../game.json with FriendSDK's own parser and preview ledger (no install needed: Node >= 22.6).
// Run: node --experimental-strip-types sim/verify-game.mts [path/to/friendsdk]
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const sdk = resolve(process.argv[2] ?? '/home/florent/Desktop/Projects/crypto/rarefriends_hackathon/tmp/vibeathon/friendsdk');
const { parseChanceGame, maximumPrize, expectedReward, outcomeForRoll, createGamePreview, RF } = await import(resolve(sdk, 'src/game.ts'));
const game = parseChanceGame(JSON.parse(readFileSync(resolve(here, '../game.json'), 'utf8')));
const fmt = (x: bigint) => (Number(x) / 1e18).toFixed(4);
const max = maximumPrize(game), ev = expectedReward(game);
console.log(`parsed: ${game.name} / ${game.consumable} / price ${fmt(game.price)} RF / outcomes ${game.outcomes.length}`);
console.log(`bps total ${game.outcomes.reduce((s: number, o: any) => s + o.chanceBps, 0)} | EV ${fmt(ev)} RF | RTP ${(Number(ev * 10000n / game.price) / 100).toFixed(2)}% | max prize ${fmt(max)} RF`);
// boundaries: every roll 0..9999 maps to exactly the published weights
const counts = new Array(game.outcomes.length).fill(0);
for (let r = 0; r < 10000; r++) counts[outcomeForRoll(game, r) - 1]++;
console.log('roll buckets', counts.join(' / '));
// preview ledger: reserve rule, settle, redeem
let roll = 9999; // force the max prize
const { client } = createGamePreview(game, { stake: 50n * RF, rfBalance: 100n * RF, friendId: 344030n, draw: () => roll });
console.log('canBuy(1) with 50 RF stake:', await client.canBuy(1n), '| canBuy(2):', await client.canBuy(2n), '(needs free + 2x5 >= 2x45)');
await client.buy(1n);
let s = await client.read();
console.log(`after buy: stake ${fmt(s.stake)} reserved ${fmt(s.reservedPlays)} free ${fmt(s.freeStake)}`);
const [play] = await client.play(1n);
const settled = await client.settle(play.id);
s = await client.read();
console.log(`settled outcome ${settled.outcomeId} (${game.outcomes[settled.outcomeId! - 1].name}); liability ${fmt(s.rewardLiability)} free ${fmt(s.freeStake)}`);
try { await client.settle(play.id); } catch (e) { console.log('re-settle rejected:', (e as Error).message); }
await client.redeem(settled.outcomeId!, 1n);
s = await client.read();
console.log(`after redeem: Friend RF ${fmt(s.rfBalance)} stake ${fmt(s.stake)} liability ${fmt(s.rewardLiability)} inventory ${s.inventory.join(',')}`);
