#!/usr/bin/env python3
"""Pixel Life (hub) tokenomics Monte-Carlo. Python 3 stdlib only, seeded, reproducible.

Run (from this folder):
    python3 sim.py                  # 10,000 players x 90 days + sensitivity grid (~1-2 min, uses up to 8 cores)
    python3 sim.py --no-sens        # main run only
    python3 sim.py --seed 7         # another seed
    python3 sim.py --json out.json  # also dump the daily series of the main run

All RF is simulated (float RF units). Nothing touches a chain. Rules modelled (see ../tokenomics.md):
  REGROW own Friend     regrow_price RF/px          50 % burned / 50 % protocol active-Friends stream
  MEND another Friend   mend_mult x regrow_price    50 % burned / 50 % to that Friend's ERC-6551 wallet
  SEED PACK             pack_price RF               FriendSDK ChanceGame: RF enters the stake, each pack reserves
                                                    the max prize until settled; weekly sweep of free stake above
                                                    the target -> 50 % burned / 50 % stream
  PLANT a seed          ChanceGame.redeem (RF to the Friend wallet) + REGROW paid with that RF; +plant_bonus px (pixels only)
  GOLD PIXEL (held)     free regrowth x (1 + gold_bonus * min(gold, gold_cap)), read live from the balance
  FREE REGROWTH         free_rate px/hour per Friend (pixels, never RF)
  DECOR (RF)            home-island pieces priced in RF, 50 % burned / 50 % stream; "crafted" ones also need a Bits blueprint
  BITS (soft currency)  earned per venue run with a daily soft cap; spent on the Bits catalog and island expansions;
                        account-bound, never transferable, never convertible to or from RF, cannot buy pixels
No RF is minted anywhere; pixels and Bits have no RF exit.
"""
import argparse
import json
import math
import random
from multiprocessing import Pool

# ---------------------------------------------------------------- constants
# (name, chanceBps, reward RF at pack_price 5) -- must match ../game.json
TABLE = [("Sprout", 5600, 2.0), ("Bloom", 3000, 5.0), ("Full Bloom", 1200, 8.0), ("Gold Pixel", 200, 45.0)]
GOLD = 3
FRIEND_SIZES = [82, 86, 70, 56, 92, 80, 76, 74, 52, 42, 83, 44]  # frame-0 pixel counts of 12 real Friends
RUN_LOSS_CAP = 12          # px lost in one 60 s run, max
FLOOR = 0.5                # a run never takes a Friend below 50 % of its pixels
MEND_CAP_PER_DAY = 24      # px one Friend can receive from strangers per UTC day

# Bits (soft currency)
BITS_RUN_BASE, BITS_RUN_SKILL, BITS_DAILY_BONUS = 10, 20, 50
BITS_CAP_FULL, BITS_CAP_SOFT = 250, 500      # full rate up to 250/day, 25 % rate to 500/day, then 0
CATALOG_PRICES = [150, 200, 300, 400, 600, 800, 1000, 1500, 2500]
CATALOG_START, CATALOG_DROP, CATALOG_DROP_EVERY = 40, 12, 30     # items at launch, items per monthly drop
EXPANSIONS = [1000, 2000, 4000, 8000, 16000]                   # island plots, escalating
DECOR_RF = [(2.0, 50, 0), (5.0, 30, 0), (10.0, 14, 1000), (25.0, 6, 2500)]  # (RF price, weight, Bits blueprint)

BASE = dict(
    players=10_000, days=90, seed=42,
    regrow_price=0.5, mend_mult=2.0, free_rate=0.5, pack_price=5.0,
    gold_bonus=0.25, gold_cap=2, plant_bonus=0.20,
    elasticity=1.0, pack_elasticity=1.0,
    stake0=10_000.0, sweep_target=10_000.0, sweep_every=7,
    stream_live=True,        # False = phase-1 fallback: the stream half is burned too
    bits_mult=1.0,           # scales the Bits faucet (inflation sensitivity)
    catalog_drops=True,
    crate_p=0.002,           # share of whale sessions that buy a 99-pack crate (bankroll stress)
)

# profile: share, p_active_day, sessions/day, runs/session, loss_mu px/run, wtp, RF budget/day,
#          packs/session, mend_p/session, p_hold_gold, churn/day, friends owned, bits_spend_p, decor_p/session
PROFILES = {
    "casual":        (0.38, 0.50, 1, 2, 3.0, 0.04,   3.0, 0.01, 0.005, 0.30, 0.015, 1, 0.50, 0.003),
    "regular":       (0.22, 0.85, 2, 2, 2.5, 0.15,   8.0, 0.08, 0.030, 0.60, 0.007, 1, 0.70, 0.010),
    "whale":         (0.02, 0.90, 3, 3, 3.0, 0.90, 300.0, 1.50, 0.150, 0.90, 0.005, 1, 0.90, 0.100),
    "completionist": (0.06, 0.97, 2, 2, 2.0, 0.70,  40.0, 0.15, 0.080, 0.95, 0.003, 1, 0.95, 0.030),
    "bot_farmer":    (0.03, 1.00, 3, 4, 1.0, 0.00,   0.0, 0.00, 0.000, 0.00, 0.000, 5, 0.00, 0.000),
    "alt_mender":    (0.02, 0.90, 2, 3, 2.5, 0.30,  20.0, 0.05, 0.000, 0.60, 0.005, 5, 0.50, 0.010),
    "churner":       (0.27, 0.90, 2, 3, 3.5, 0.12,   8.0, 0.05, 0.020, 0.20, 0.120, 1, 0.60, 0.005),
}
PNAMES = list(PROFILES)


class Friend:
    __slots__ = ("size", "missing", "acc", "last_t", "seeds", "gold", "wallet_in", "mend_day", "mend_today", "owner")

    def __init__(self, size, owner):
        self.size, self.missing, self.acc, self.last_t = size, 0, 0.0, 0.0
        self.seeds = [0, 0, 0]
        self.gold = 0
        self.wallet_in = 0.0
        self.mend_day, self.mend_today, self.owner = -1, 0, owner


class Player:
    __slots__ = ("prof", "friends", "alive", "ever_paid", "ever_regrow", "ever_pack", "ever_decor", "spent", "received",
                 "spent_today", "day", "bits", "bits_today", "bits_earned", "bits_spent", "items", "exp", "decor_rf")

    def __init__(self, prof, friends):
        self.prof, self.friends, self.alive = prof, friends, True
        self.ever_paid = self.ever_regrow = self.ever_pack = self.ever_decor = False
        self.spent = self.received = self.spent_today = 0.0
        self.day = -1
        self.bits = self.bits_today = self.bits_earned = self.bits_spent = 0
        self.items = self.exp = 0
        self.decor_rf = 0.0


def poisson(rng, mu):
    if mu <= 0:
        return 0
    L, k, p = math.exp(-mu), 0, 1.0
    while True:
        p *= rng.random()
        if p < L:
            return k
        k += 1


def table_for(cfg):
    s = cfg["pack_price"] / 5.0
    return [(n, w, v * s) for n, w, v in TABLE]


def pack_stats(table):
    ev = sum(w * v for _, w, v in table) / 10_000
    ex2 = sum(w * v * v for _, w, v in table) / 10_000
    return ev, math.sqrt(ex2 - ev * ev), max(v for _, _, v in table)


def catalog_size(cfg, day):
    return CATALOG_START + (CATALOG_DROP * (day // CATALOG_DROP_EVERY) if cfg["catalog_drops"] else 0)


def run(cfg):
    rng = random.Random(cfg["seed"])
    table = table_for(cfg)
    cum, a = [], 0
    for _, w, _ in table:
        a += w; cum.append(a)
    ev, sd, maxp = pack_stats(table)
    price, pk = cfg["regrow_price"], cfg["pack_price"]
    mprice = price * cfg["mend_mult"]
    live = cfg["stream_live"]
    pf_regrow = (0.5 / price) ** cfg["elasticity"]
    pf_pack = (5.0 / pk) ** cfg["pack_elasticity"]
    pf_alt = (0.5 / (mprice * 0.5)) ** cfg["elasticity"]  # alt route: pays mprice, half returns to own Friend

    players, sky = [], []
    for i in range(cfg["players"]):
        r, acc, prof = rng.random(), 0.0, PNAMES[-1]
        for n in PNAMES:
            acc += PROFILES[n][0]
            if r < acc:
                prof = n; break
        fr = [Friend(rng.choice(FRIEND_SIZES), i) for _ in range(PROFILES[prof][11])]
        players.append(Player(prof, fr))
        sky.append(fr[0])  # the Sky's Mend board lists one Friend per owner

    bank = dict(stake=cfg["stake0"], inflight=0.0, liability=0.0, min_free=cfg["stake0"], blocked=0,
                pnl=0.0, peak=0.0, max_dd=0.0, sweeps=0.0, packs=0)
    pending = []  # [settle_time, reserve, q, kept_reward, cashed_reward]

    def free():
        return bank["stake"] - bank["inflight"] - bank["liability"]

    def settle_until(t):
        if not pending:
            return
        keep = []
        for it in pending:
            st, res, q, kept, cash = it
            if st <= t:
                bank["inflight"] -= res
                bank["liability"] += kept          # kept rewards stay reserved until redeemed
                bank["stake"] -= cash              # rewards redeemed on the spot
                bank["pnl"] += q * pk - kept - cash
                bank["peak"] = max(bank["peak"], bank["pnl"])
                bank["max_dd"] = max(bank["max_dd"], bank["peak"] - bank["pnl"])
            else:
                keep.append(it)
        pending[:] = keep

    KEYS = ("regrow_rf", "plant_rf", "mend_rf", "alt_mend_rf", "pack_rf", "decor_rf", "burn", "stream", "to_friend",
            "cash_redeem", "sweep", "px_lost", "px_free", "px_paid", "px_plant", "px_mend", "runs", "bot_mend_in",
            "alt_self_return", "alt_px", "bits_minted", "bits_spent", "bits_bot")
    T = {k: 0.0 for k in KEYS}
    daily = []
    prof_spent = {n: 0.0 for n in PNAMES}
    prof_recv = {n: 0.0 for n in PNAMES}

    def split_stream(D, rf):
        D["burn"] += rf * (0.5 if live else 1.0)
        D["stream"] += rf * (0.5 if live else 0.0)

    def spend(p, rf, kind):
        p.spent += rf; p.spent_today += rf; prof_spent[p.prof] += rf
        p.ever_paid = True
        if kind == "regrow":
            p.ever_regrow = True

    def regrow_free(D, f, t):
        mult = 1.0 + cfg["gold_bonus"] * min(f.gold, cfg["gold_cap"])
        f.acc += (t - f.last_t) * cfg["free_rate"] * mult
        f.last_t = t
        if f.acc >= 1.0:
            n = int(f.acc); f.acc -= n
            g = min(n, f.missing)
            f.missing -= g; D["px_free"] += g
            if f.missing == 0:
                f.acc = 0.0  # free regrowth never banks while whole

    def plant(D, f):
        while f.missing > 0 and any(f.seeds):
            cap = [int(table[i][2] / price * (1 + cfg["plant_bonus"])) for i in range(3)]
            pick = next((i for i in range(3) if f.seeds[i] and cap[i] >= f.missing), None)
            if pick is None:
                pick = max(i for i in range(3) if f.seeds[i])
            v = table[pick][2]
            f.seeds[pick] -= 1
            bank["stake"] -= v; bank["liability"] -= v            # ChanceGame.redeem -> Friend wallet
            px = min(f.missing, cap[pick])
            paid_px = min(math.ceil(px / (1 + cfg["plant_bonus"])), int(v / price))
            rf = paid_px * price                                   # Splitter.regrow paid from that RF
            f.missing -= px
            D["px_plant"] += px; D["plant_rf"] += rf
            split_stream(D, rf)
            D["cash_redeem"] += v - rf                            # remainder stays in the Friend wallet

    def earn_bits(D, p, lost, first):
        raw = (BITS_RUN_BASE + int(BITS_RUN_SKILL * max(0.0, 1 - lost / 10)) + (BITS_DAILY_BONUS if first else 0)) * cfg["bits_mult"]
        got, b = 0.0, p.bits_today
        for _ in range(int(raw)):                     # piecewise soft cap
            rate = 1.0 if b < BITS_CAP_FULL else (0.25 if b < BITS_CAP_SOFT else 0.0)
            if rate == 0.0:
                break
            got += rate; b += rate
        got = int(got)
        p.bits += got; p.bits_today += got; p.bits_earned += got
        D["bits_minted"] += got
        if p.prof == "bot_farmer":
            D["bits_bot"] += got

    def spend_bits(D, p, day, pr):
        if pr[12] <= 0 or rng.random() > pr[12]:
            return
        for _ in range(3):                             # up to 3 purchases per session
            if p.exp < len(EXPANSIONS) and p.bits >= EXPANSIONS[p.exp] and rng.random() < 0.5:
                c = EXPANSIONS[p.exp]
                p.bits -= c; p.bits_spent += c; p.exp += 1; D["bits_spent"] += c
                continue
            if p.items < catalog_size(cfg, day):
                c = rng.choice(CATALOG_PRICES)
                if p.bits >= c:
                    p.bits -= c; p.bits_spent += c; p.items += 1; D["bits_spent"] += c
                    continue
            if p.exp < len(EXPANSIONS) and p.bits >= EXPANSIONS[p.exp] and rng.random() < 0.5:
                c = EXPANSIONS[p.exp]
                p.bits -= c; p.bits_spent += c; p.exp += 1; D["bits_spent"] += c
                continue
            break

    for day in range(cfg["days"]):
        D = {k: 0.0 for k in KEYS}
        D.update(packs=0, blocked=0, active=0, active_missing=0.0, active_friends=0, payers=0)
        events = []
        for pi, p in enumerate(players):
            if not p.alive:
                continue
            pr = PROFILES[p.prof]
            if rng.random() < pr[10]:
                p.alive = False; continue
            if rng.random() >= pr[1]:
                continue
            D["active"] += 1
            s = pr[2]
            for k in range(s):
                events.append((day * 24 + (k + rng.random()) * 24 / s, pi))
        events.sort()
        payers_today = set()
        for t, pi in events:
            settle_until(t)
            p = players[pi]
            pr = PROFILES[p.prof]
            first = p.day != day
            if first:
                p.day, p.spent_today, p.bits_today = day, 0.0, 0
            played = p.friends if p.prof == "bot_farmer" else p.friends[:1]
            for fi, f in enumerate(played):
                regrow_free(D, f, t)
                if f.missing:
                    plant(D, f)
                if f.missing and pr[5] > 0:
                    frac = f.missing / f.size
                    pf = pf_alt if p.prof == "alt_mender" else pf_regrow
                    ppay = min(1.0, pr[5] * frac / 0.25) * pf
                    if p.prof == "completionist" and frac > 0.05:
                        ppay = max(ppay, 0.8 * pf)
                    if rng.random() < min(1.0, ppay):
                        eff = mprice if p.prof == "alt_mender" else price
                        px = f.missing if p.prof in ("whale", "completionist") else \
                            min(f.missing, int(max(0.0, pr[6] - p.spent_today) / eff))
                        if px > 0:
                            if p.prof == "alt_mender":
                                rf = px * mprice                 # an alt wallet Mends the main Friend
                                f.missing -= px
                                D["alt_mend_rf"] += rf; D["alt_px"] += px; D["px_mend"] += px
                                D["burn"] += rf / 2; D["to_friend"] += rf / 2; D["alt_self_return"] += rf / 2
                                f.wallet_in += rf / 2
                                spend(p, rf, "mend"); prof_recv[p.prof] += rf / 2; p.received += rf / 2
                            else:
                                rf = px * price
                                f.missing -= px
                                D["regrow_rf"] += rf; D["px_paid"] += px
                                split_stream(D, rf)
                                spend(p, rf, "regrow")
                            payers_today.add(pi)
                for ri in range(pr[3]):
                    D["runs"] += 1
                    room = int(f.size * FLOOR) - f.missing
                    lost = min(poisson(rng, pr[4]), RUN_LOSS_CAP, max(0, room))
                    f.missing += lost
                    D["px_lost"] += lost
                    earn_bits(D, p, lost, first and fi == 0 and ri == 0)
                # result-card CTA: "regrow now" impulse after the runs (half the pre-run willingness)
                if f.missing and pr[5] > 0 and p.prof != "alt_mender":
                    ppay = min(1.0, 0.5 * pr[5] * (f.missing / f.size) / 0.25) * pf_regrow
                    if rng.random() < ppay:
                        px = f.missing if p.prof in ("whale", "completionist") else \
                            min(f.missing, int(max(0.0, pr[6] - p.spent_today) / price))
                        if px > 0:
                            rf = px * price
                            f.missing -= px
                            D["regrow_rf"] += rf; D["px_paid"] += px
                            split_stream(D, rf)
                            spend(p, rf, "regrow"); payers_today.add(pi)
                D["active_missing"] += f.missing / f.size
                D["active_friends"] += 1
                # seeds pile up while whole: redeem the excess above a small float (RF to the Friend wallet)
                sv = sum(f.seeds[i] * table[i][2] for i in range(3))
                while sv > 20 * pk / 5 and any(f.seeds):
                    i = max(j for j in range(3) if f.seeds[j])
                    v = table[i][2]
                    f.seeds[i] -= 1; sv -= v
                    bank["stake"] -= v; bank["liability"] -= v; D["cash_redeem"] += v
            # Seed Packs: one purchase transaction per session
            q = poisson(rng, pr[7] * pf_pack)
            if p.prof == "whale" and rng.random() < cfg["crate_p"]:
                q = 99                                             # stress: a whale buys a 99-pack crate
            if q:
                cap_q = 99 if p.prof == "whale" else int(max(0.0, pr[6] * 2 - p.spent_today) / pk)
                q = min(q, 99, cap_q)
            if q > 0:
                cost, reserve = q * pk, q * maxp
                if free() >= maxp and free() + cost >= reserve:   # FriendSDK canBuy rule
                    bank["stake"] += cost; bank["inflight"] += reserve
                    f = p.friends[0]
                    kept = cash = 0.0
                    for _ in range(q):
                        r = rng.randrange(10_000)
                        o = next(i for i, c in enumerate(cum) if r < c)
                        v = table[o][2]
                        if o == GOLD:
                            if rng.random() < pr[9]:
                                f.gold += 1; kept += v
                            else:
                                cash += v; D["cash_redeem"] += v
                        else:
                            f.seeds[o] += 1; kept += v
                    pending.append([t + rng.random(), reserve, q, kept, cash])
                    D["pack_rf"] += cost; D["packs"] += q; bank["packs"] += q
                    spend(p, cost, "pack"); p.ever_pack = True
                    payers_today.add(pi)
                else:
                    D["blocked"] += q; bank["blocked"] += q
            # Mend a stranger (voluntary gift)
            if pr[8] and rng.random() < pr[8]:
                best = None
                for _ in range(5):
                    c = rng.choice(sky)
                    if c.owner == pi:
                        continue
                    regrow_free(D, c, t)
                    if best is None or c.missing > best.missing:
                        best = c
                if best is not None and best.missing:
                    if best.mend_day != day:
                        best.mend_day, best.mend_today = day, 0
                    px = min(best.missing, rng.randint(2, 6), MEND_CAP_PER_DAY - best.mend_today)
                    if px > 0:
                        rf = px * mprice
                        best.missing -= px; best.mend_today += px; best.wallet_in += rf / 2
                        D["mend_rf"] += rf; D["px_mend"] += px
                        D["burn"] += rf / 2; D["to_friend"] += rf / 2
                        owner = players[best.owner]
                        owner.received += rf / 2; prof_recv[owner.prof] += rf / 2
                        if owner.prof == "bot_farmer":
                            D["bot_mend_in"] += rf / 2
                        spend(p, rf, "mend"); payers_today.add(pi)
            # RF home decor (crafted pieces also need a Bits blueprint)
            if pr[13] and rng.random() < pr[13]:
                r, acc, pick = rng.random() * 100, 0, DECOR_RF[0]
                for d_ in DECOR_RF:
                    acc += d_[1]
                    if r < acc:
                        pick = d_; break
                rfp, _, bp = pick
                if p.spent_today + rfp <= max(pr[6], rfp) and p.bits >= bp:
                    p.bits -= bp; p.bits_spent += bp; D["bits_spent"] += bp
                    D["decor_rf"] += rfp; split_stream(D, rfp)
                    p.decor_rf += rfp; p.ever_decor = True
                    spend(p, rfp, "decor"); payers_today.add(pi)
            spend_bits(D, p, day, pr)
            f0 = p.friends[0]
            if f0.gold and rng.random() < 0.005:                   # liquidity need: redeem a held Gold Pixel
                f0.gold -= 1
                v = table[GOLD][2]
                bank["stake"] -= v; bank["liability"] -= v; D["cash_redeem"] += v
        settle_until(day * 24 + 26)
        if (day + 1) % cfg["sweep_every"] == 0:
            ex = free() - cfg["sweep_target"]
            if ex > 0:
                bank["stake"] -= ex; bank["sweeps"] += ex
                D["sweep"] = ex; split_stream(D, ex)
        bank["min_free"] = min(bank["min_free"], free())
        D["stake"], D["free"], D["liability"] = bank["stake"], free(), bank["liability"]
        D["payers"] = len(payers_today)
        D["gold_held"] = sum(p.friends[0].gold for p in players)
        alive = [p for p in players if p.alive]
        D["bits_stock"] = sum(p.bits for p in players)
        D["bits_stock_alive"] = sum(p.bits for p in alive) / max(1, len(alive))
        hum = [p for p in alive if p.prof != "bot_farmer"]
        D["bits_stock_human"] = sum(p.bits for p in hum) / max(1, len(hum))
        daily.append(D)
        for k in KEYS:
            T[k] += D[k]

    n_ever = {n: [0, 0, 0, 0, 0] for n in PNAMES}
    bits_by = {n: [0, 0, 0, 0, 0, 0] for n in PNAMES}  # n, earned, spent, balance, items, expansions
    for p in players:
        c = n_ever[p.prof]
        c[0] += 1; c[1] += p.ever_paid; c[2] += p.ever_regrow; c[3] += p.ever_pack; c[4] += p.ever_decor
        b = bits_by[p.prof]
        b[0] += 1; b[1] += p.bits_earned; b[2] += p.bits_spent; b[3] += p.bits; b[4] += p.items; b[5] += p.exp
    return dict(cfg=cfg, daily=daily, T=T, bank=bank, ev=ev, sd=sd, maxp=maxp,
                held_gold=sum(p.friends[0].gold for p in players), n_ever=n_ever, bits_by=bits_by,
                prof_spent=prof_spent, prof_recv=prof_recv)


def cold_start_mc(cfg, paths=2000, packs=2000, seed=1):
    """Exact draws from launch: distribution of the worst cumulative house loss over the first `packs` packs."""
    rng = random.Random(seed)
    table = table_for(cfg)
    vals, w, pk = [v for _, _, v in table], [x for _, x, _ in table], cfg["pack_price"]
    worst = []
    for _ in range(paths):
        pnl = lo = 0.0
        for v in rng.choices(vals, weights=w, k=packs):
            pnl += pk - v
            if pnl < lo:
                lo = pnl
        worst.append(-lo)
    worst.sort()
    q = lambda x: worst[min(len(worst) - 1, int(x * len(worst)))]
    return dict(p50=q(0.5), p99=q(0.99), p999=q(0.999), max=worst[-1])


def fmt(x, nd=0):
    return f"{x:,.{nd}f}"


def summarize(res, lo=30):
    d = res["daily"]
    ss = d[lo:] if len(d) > lo else d
    avg = lambda k, rows=d: sum(r[k] for r in rows) / len(rows)
    ne = res["n_ever"].values()
    return dict(
        burn=avg("burn"), burn_ss=avg("burn", ss), stream=avg("stream"), stream_ss=avg("stream", ss),
        to_friend=avg("to_friend"), to_friend_ss=avg("to_friend", ss),
        regrow=avg("regrow_rf") + avg("plant_rf"), mend=avg("mend_rf") + avg("alt_mend_rf"), packs=avg("packs"),
        decor=avg("decor_rf"),
        pay_share=sum(c[1] for c in ne) / sum(c[0] for c in ne),
        missing_ss=sum(r["active_missing"] for r in ss) / max(1, sum(r["active_friends"] for r in ss)),
        min_free=res["bank"]["min_free"], blocked=res["bank"]["blocked"],
        bits_stock_end=d[-1]["bits_stock_human"],
        bits_ratio=res["T"]["bits_spent"] / max(1, res["T"]["bits_minted"]),
    )


def report(res):
    c, d, T, B = res["cfg"], res["daily"], res["T"], res["bank"]
    out = []
    P = out.append
    ev, sd, maxp = res["ev"], res["sd"], res["maxp"]
    n = len(d)
    s = summarize(res)
    P(f"# Pixel Life sim  seed={c['seed']}  players={c['players']:,}  days={c['days']}")
    P(f"prices: regrow {c['regrow_price']} RF/px | mend {c['regrow_price']*c['mend_mult']} RF/px | free regrowth "
      f"{c['free_rate']} px/h | seed pack {c['pack_price']} RF (EV {ev:.3f}, RTP {ev/c['pack_price']:.1%}, sd {sd:.2f}, "
      f"max prize {maxp:.0f}) | gold perk +{c['gold_bonus']:.0%}/gold, cap {c['gold_cap']} | stake0 {c['stake0']:,.0f}")
    P("")
    P("## Daily flows (sampled days)")
    P("| day | active | runs | px lost | px free | px paid+plant+mend | avg missing | regrow RF | mend RF | packs | decor RF | burned | -> stream | -> Friend wallets | stake | free stake | kept liability | gold held | Bits minted | Bits spent | Bits/alive player |")
    P("|" + "---:|" * 21)
    for i in [0, 1, 6, 13, 29, 44, 59, 74, 89]:
        if i >= n:
            continue
        r = d[i]
        P(f"| {i+1} | {r['active']:,} | {int(r['runs']):,} | {int(r['px_lost']):,} | {int(r['px_free']):,} | "
          f"{int(r['px_paid']+r['px_plant']+r['px_mend']):,} | {r['active_missing']/max(1,r['active_friends']):.1%} | "
          f"{fmt(r['regrow_rf']+r['plant_rf'])} | {fmt(r['mend_rf']+r['alt_mend_rf'])} | {r['packs']:,} | {fmt(r['decor_rf'])} | "
          f"{fmt(r['burn'])} | {fmt(r['stream'])} | {fmt(r['to_friend'])} | {fmt(r['stake'])} | {fmt(r['free'])} | "
          f"{fmt(r['liability'])} | {r['gold_held']} | {fmt(r['bits_minted'])} | {fmt(r['bits_spent'])} | {fmt(r['bits_stock_alive'])} |")
    P("")
    P("## 90-day RF totals")
    P(f"- burned: {fmt(T['burn'])} = {fmt(T['burn']/n)}/day (days 31-90: {fmt(s['burn_ss'])}/day)")
    P(f"- to the protocol active-Friends stream: {fmt(T['stream'])} = {fmt(T['stream']/n)}/day (days 31-90: {fmt(s['stream_ss'])}/day)")
    P(f"- directed to specific Friend wallets (Mend): {fmt(T['to_friend'])} = {fmt(T['to_friend']/n)}/day "
      f"(alt self-return {fmt(T['alt_self_return'])}, received by bot-owned Friends {fmt(T['bot_mend_in'])})")
    P(f"- spend: regrow {fmt(T['regrow_rf'])} + planted seeds {fmt(T['plant_rf'])} | Mend strangers {fmt(T['mend_rf'])} + alt self-Mend "
      f"{fmt(T['alt_mend_rf'])} | Seed Packs {fmt(T['pack_rf'])} ({B['packs']:,} packs) | RF decor {fmt(T['decor_rf'])}")
    P(f"- Seed Pack RF redeemed and not re-spent (cash to Friend wallets): {fmt(T['cash_redeem'])}; edge swept: {fmt(B['sweeps'])} (50/50, counted above)")
    P("")
    P("## Seed Pack bankroll (ChanceGame stake)")
    P(f"- stake: start {fmt(c['stake0'])}, end {fmt(d[-1]['stake'])}; kept-reward liability at end {fmt(d[-1]['liability'])} "
      f"(held Gold Pixels {res['held_gold']}, i.e. {fmt(res['held_gold']*maxp)} RF)")
    P(f"- minimum free stake {fmt(B['min_free'])}; purchases refused by the reserve rule: {B['blocked']} packs")
    P(f"- realized house P&L {fmt(B['pnl'])}; worst peak-to-trough drawdown {fmt(B['max_dd'])} RF")
    cs = cold_start_mc(c)
    P(f"- cold start, exact draws, first 2,000 packs x 2,000 paths: worst cumulative loss p50 {fmt(cs['p50'])}, "
      f"p99 {fmt(cs['p99'])}, p99.9 {fmt(cs['p999'])}, max {fmt(cs['max'])} RF")
    P(f"- a single 99-pack purchase needs free stake >= 99 x ({maxp:.0f} - {c['pack_price']:.0f}) = {fmt(99*(maxp-c['pack_price']))} RF")
    P("")
    P("## Who pays")
    P("| profile | players | ever paid RF | ever regrow | ever Seed Pack | ever RF decor | RF spent / player | RF received / player |")
    P("|---|---:|---:|---:|---:|---:|---:|---:|")
    tot = [0] * 5
    for nme, cnt in res["n_ever"].items():
        tot = [x + y for x, y in zip(tot, cnt)]
        k = max(1, cnt[0])
        P(f"| {nme} | {cnt[0]:,} | {cnt[1]/k:.1%} | {cnt[2]/k:.1%} | {cnt[3]/k:.1%} | {cnt[4]/k:.1%} | "
          f"{res['prof_spent'][nme]/k:.1f} | {res['prof_recv'][nme]/k:.1f} |")
    P(f"| **all** | {tot[0]:,} | **{tot[1]/tot[0]:.1%}** | {tot[2]/tot[0]:.1%} | {tot[3]/tot[0]:.1%} | {tot[4]/tot[0]:.1%} | "
      f"{sum(res['prof_spent'].values())/tot[0]:.1f} | {sum(res['prof_recv'].values())/tot[0]:.1f} |")
    P("")
    P("## Pixel balance (90 days)")
    L = max(1, T["px_lost"])
    P(f"- lost {fmt(T['px_lost'])} px -> free regrowth {fmt(T['px_free'])} ({T['px_free']/L:.1%}), paid regrow {fmt(T['px_paid'])} "
      f"({T['px_paid']/L:.1%}), planted {fmt(T['px_plant'])} ({T['px_plant']/L:.1%}), mended {fmt(T['px_mend'])} ({T['px_mend']/L:.1%})")
    P(f"- average missing share of an active Friend at session end, days 31-90: {s['missing_ss']:.1%}")
    P("")
    P("## Bits (soft currency) over 90 days")
    P(f"- minted {fmt(T['bits_minted'])}, spent {fmt(T['bits_spent'])} ({s['bits_ratio']:.1%} of minted); bots minted {fmt(T['bits_bot'])} "
      f"({T['bits_bot']/max(1,T['bits_minted']):.1%})")
    P(f"- unspent Bits per alive human player (bots excluded): day 30 {fmt(d[min(29,n-1)]['bits_stock_human'])}, day 60 "
      f"{fmt(d[min(59,n-1)]['bits_stock_human'])}, day 90 {fmt(d[-1]['bits_stock_human'])}; incl. bots day 90 {fmt(d[-1]['bits_stock_alive'])}")
    P("| profile | Bits earned / player | spent | spent share | balance at day 90 | catalog items owned | island plots |")
    P("|---|---:|---:|---:|---:|---:|---:|")
    for nme, b in res["bits_by"].items():
        k = max(1, b[0])
        P(f"| {nme} | {fmt(b[1]/k)} | {fmt(b[2]/k)} | {b[2]/max(1,b[1]):.0%} | {fmt(b[3]/k)} | {b[4]/k:.1f} / {catalog_size(c, n-1)} | {b[5]/k:.2f} / {len(EXPANSIONS)} |")
    P("")
    P("## Attack checks")
    ap = max(1, T["alt_px"])
    P(f"- alt self-Mend: paid {fmt(T['alt_mend_rf'])} RF for {fmt(T['alt_px'])} px, {fmt(T['alt_self_return'])} RF came back to their own Friend -> "
      f"net {(T['alt_mend_rf']-T['alt_self_return'])/ap:.3f} RF/px (Regrow list price {c['regrow_price']}); burned {T['alt_mend_rf']/2/ap:.3f} RF/px "
      f"(Regrow burns {c['regrow_price']*(0.5 if c['stream_live'] else 1):.3f})")
    bots = res["n_ever"]["bot_farmer"][0]
    P(f"- bot farmers ({bots} owners x 5 Friends, ~12 runs/Friend/day): RF spent 0; RF received only as voluntary stranger Mends: "
      f"{fmt(T['bot_mend_in'])} total = {T['bot_mend_in']/max(1,bots)/n:.3f} RF/owner/day; Bits earned are account-bound and have no RF exit")
    return "\n".join(out), s


SENS = [
    ("baseline", {}),
    ("regrow 0.25", dict(regrow_price=0.25)),
    ("regrow 0.75", dict(regrow_price=0.75)),
    ("regrow 1.00", dict(regrow_price=1.0)),
    ("free 0.25 px/h", dict(free_rate=0.25)),
    ("free 1.0 px/h", dict(free_rate=1.0)),
    ("free 2.0 px/h", dict(free_rate=2.0)),
    ("regrow 0.25 + free 0.25", dict(regrow_price=0.25, free_rate=0.25)),
    ("regrow 1.0 + free 1.0", dict(regrow_price=1.0, free_rate=1.0)),
    ("Mend = 1x Regrow (concept text)", dict(mend_mult=1.0)),
    ("Seed Pack 3 RF (table scaled)", dict(pack_price=3.0)),
    ("Seed Pack 8 RF (table scaled)", dict(pack_price=8.0)),
    ("Gold perk off", dict(gold_bonus=0.0)),
    ("Gold perk +50 %/gold", dict(gold_bonus=0.5)),
    ("elasticity 2, regrow 0.25", dict(elasticity=2.0, regrow_price=0.25)),
    ("elasticity 2, regrow 0.5", dict(elasticity=2.0)),
    ("elasticity 2, regrow 1.0", dict(elasticity=2.0, regrow_price=1.0)),
    ("elasticity 2, Seed Pack 8 RF", dict(pack_elasticity=2.0, pack_price=8.0)),
    ("phase 1: stream half burned", dict(stream_live=False)),
    ("stake 3,000", dict(stake0=3000.0, sweep_target=3000.0)),
    ("stake 5,000", dict(stake0=5000.0, sweep_target=5000.0)),
    ("stake 10,000, crates x10 (2 % of whale sessions)", dict(crate_p=0.02)),
    ("Bits faucet x2", dict(bits_mult=2.0)),
    ("no monthly catalog drops", dict(catalog_drops=False)),
]


def _sens_one(args):
    name, over, base, reps = args
    acc, fr = None, 0.0
    for k in range(reps):                      # average over `reps` seeds to damp path noise
        cfg = dict(base); cfg.update(over); cfg["seed"] = base["seed"] + k
        r = run(cfg)
        sm = summarize(r)
        fr += r["T"]["px_free"] / max(1, r["T"]["px_lost"]) / reps
        if acc is None:
            acc = {k2: v / reps for k2, v in sm.items()}
            acc["min_free"], acc["blocked"] = sm["min_free"], sm["blocked"]
        else:
            for k2, v in sm.items():
                if k2 == "min_free":
                    acc[k2] = min(acc[k2], v)
                elif k2 == "blocked":
                    acc[k2] += v
                else:
                    acc[k2] += v / reps
    return name, acc, fr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=BASE["seed"])
    ap.add_argument("--players", type=int, default=BASE["players"])
    ap.add_argument("--days", type=int, default=BASE["days"])
    ap.add_argument("--no-sens", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--reps", type=int, default=3, help="seeds averaged per sensitivity row")
    a = ap.parse_args()
    base = dict(BASE, seed=a.seed, players=a.players, days=a.days)
    res = run(base)
    text, _ = report(res)
    print(text)
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(dict(cfg=base, daily=res["daily"], totals=res["T"], bank=res["bank"]), fh, indent=1)
    if a.no_sens:
        return
    print(f"\n## Sensitivity (each row = mean of {a.reps} full runs, seeds {a.seed}..{a.seed+a.reps-1}; RF/day averaged over 90 days; min free stake = worst run; refused packs = sum)")
    print("| scenario | burned/day | stream/day | Friend wallets/day | regrow RF/day | Mend RF/day | packs/day | decor RF/day | ever paid | avg missing d31-90 | free px / lost px | min free stake | refused packs | Bits spent/minted | unspent Bits/human d90 |")
    print("|---|" + "---:|" * 15)
    with Pool(min(len(SENS), 12)) as pool:
        rows = pool.map(_sens_one, [(nm, o, base, a.reps) for nm, o in SENS])
    for nm, s, fr in rows:
        print(f"| {nm} | {fmt(s['burn'])} | {fmt(s['stream'])} | {fmt(s['to_friend'])} | {fmt(s['regrow'])} | {fmt(s['mend'])} | "
              f"{fmt(s['packs'])} | {fmt(s['decor'])} | {s['pay_share']:.1%} | {s['missing_ss']:.1%} | {fr:.0%} | {fmt(s['min_free'])} | "
              f"{int(s['blocked']):,} | {s['bits_ratio']:.0%} | {fmt(s['bits_stock_end'])} |")


if __name__ == "__main__":
    main()
