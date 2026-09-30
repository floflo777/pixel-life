# Pixel Life sim  seed=42  players=10,000  days=90
prices: regrow 0.5 RF/px | mend 1.0 RF/px | free regrowth 0.5 px/h | seed pack 5.0 RF (EV 4.480, RTP 89.6%, sd 6.15, max prize 45) | gold perk +25%/gold, cap 2 | stake0 10,000

## Daily flows (sampled days)
| day | active | runs | px lost | px free | px paid+plant+mend | avg missing | regrow RF | mend RF | packs | decor RF | burned | -> stream | -> Friend wallets | stake | free stake | kept liability | gold held | Bits minted | Bits spent | Bits/alive player |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7,136 | 47,550 | 104,795 | 31,296 | 8,996 | 10.7% | 3,812 | 1,282 | 1,785 | 427 | 2,760 | 2,120 | 641 | 16,792 | 11,035 | 5,757 | 28 | 1,189,179 | 58,800 | 118 |
| 2 | 6,836 | 46,049 | 99,464 | 65,647 | 15,013 | 13.4% | 6,524 | 1,729 | 1,709 | 386 | 4,319 | 3,455 | 864 | 20,655 | 11,990 | 8,665 | 53 | 1,140,138 | 343,050 | 203 |
| 7 | 5,759 | 40,198 | 78,809 | 65,886 | 13,045 | 15.0% | 5,659 | 1,509 | 1,619 | 340 | 7,006 | 6,252 | 754 | 27,535 | 10,000 | 17,535 | 173 | 952,493 | 677,450 | 433 |
| 14 | 4,892 | 35,762 | 64,469 | 56,678 | 9,454 | 14.7% | 4,028 | 1,262 | 1,383 | 347 | 5,776 | 5,144 | 631 | 34,497 | 10,000 | 24,497 | 309 | 804,588 | 616,500 | 664 |
| 30 | 3,942 | 31,987 | 52,799 | 47,064 | 6,284 | 15.2% | 2,590 | 1,000 | 1,531 | 335 | 1,963 | 1,463 | 500 | 50,786 | 10,855 | 39,931 | 631 | 666,770 | 512,050 | 1,200 |
| 45 | 3,398 | 30,098 | 47,991 | 42,737 | 5,620 | 16.5% | 2,317 | 890 | 1,197 | 302 | 1,754 | 1,310 | 445 | 64,179 | 11,531 | 52,648 | 903 | 593,296 | 429,500 | 1,820 |
| 60 | 3,073 | 29,113 | 45,495 | 40,313 | 5,062 | 17.2% | 2,108 | 785 | 1,174 | 297 | 1,595 | 1,202 | 392 | 76,863 | 12,970 | 63,893 | 1143 | 552,861 | 379,800 | 2,612 |
| 75 | 2,727 | 27,859 | 41,612 | 37,121 | 4,628 | 17.8% | 1,933 | 714 | 987 | 223 | 1,435 | 1,078 | 357 | 84,206 | 12,141 | 72,065 | 1326 | 505,440 | 349,950 | 3,597 |
| 90 | 2,468 | 27,067 | 39,483 | 35,316 | 4,155 | 18.6% | 1,703 | 695 | 1,169 | 280 | 1,339 | 992 | 348 | 93,570 | 13,703 | 79,867 | 1497 | 472,638 | 315,050 | 4,767 |

## 90-day RF totals
- burned: 209,062 = 2,323/day (days 31-90: 1,834/day)
- to the protocol active-Friends stream: 165,304 = 1,837/day (days 31-90: 1,433/day)
- directed to specific Friend wallets (Mend): 43,759 = 486/day (alt self-return 14,571, received by bot-owned Friends 4,676)
- spend: regrow 148,557 + planted seeds 103,640 | Mend strangers 58,376 + alt self-Mend 29,142 | Seed Packs 548,350 (109,670 packs) | RF decor 24,855
- Seed Pack RF redeemed and not re-spent (cash to Friend wallets): 307,585; edge swept: 53,555 (50/50, counted above)

## Seed Pack bankroll (ChanceGame stake)
- stake: start 10,000, end 93,570; kept-reward liability at end 79,867 (held Gold Pixels 1497, i.e. 67,365 RF)
- minimum free stake 10,000; purchases refused by the reserve rule: 0 packs
- realized house P&L 57,258; worst peak-to-trough drawdown 325 RF
- cold start, exact draws, first 2,000 packs x 2,000 paths: worst cumulative loss p50 22, p99 211, p99.9 368, max 428 RF
- a single 99-pack purchase needs free stake >= 99 x (45 - 5) = 3,960 RF

## Who pays
| profile | players | ever paid RF | ever regrow | ever Seed Pack | ever RF decor | RF spent / player | RF received / player |
|---|---:|---:|---:|---:|---:|---:|---:|
| casual | 3,828 | 40.7% | 16.4% | 21.2% | 5.5% | 2.3 | 1.2 |
| regular | 2,218 | 97.4% | 89.4% | 94.7% | 53.3% | 70.9 | 4.4 |
| whale | 215 | 99.5% | 99.1% | 99.5% | 98.1% | 2044.1 | 6.3 |
| completionist | 583 | 99.3% | 98.6% | 98.6% | 92.5% | 198.5 | 3.0 |
| bot_farmer | 310 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0 | 15.1 |
| alt_mender | 204 | 97.1% | 0.0% | 94.6% | 59.8% | 179.0 | 82.3 |
| churner | 2,642 | 70.8% | 63.8% | 39.7% | 4.0% | 19.5 | 1.9 |
| **all** | 10,000 | **65.8%** | 50.8% | 49.4% | 23.7% | 80.9 | 4.4 |

## Pixel balance (90 days)
- lost 4,744,636 px -> free regrowth 4,097,709 (86.4%), paid regrow 297,114 (6.3%), planted 215,750 (4.5%), mended 87,518 (1.8%)
- average missing share of an active Friend at session end, days 31-90: 17.1%

## Bits (soft currency) over 90 days
- minted 58,260,618, spent 40,769,800 (70.0% of minted); bots minted 13,950,000 (23.9%)
- unspent Bits per alive human player (bots excluded): day 30 371, day 60 380, day 90 415; incl. bots day 90 4,767
| profile | Bits earned / player | spent | spent share | balance at day 90 | catalog items owned | island plots |
|---|---:|---:|---:|---:|---:|---:|
| casual | 2,402 | 1,989 | 83% | 413 | 6.0 / 64 | 0.26 / 5 |
| regular | 8,416 | 8,115 | 96% | 302 | 31.1 / 64 | 0.20 / 5 |
| whale | 16,585 | 15,420 | 93% | 1,164 | 53.8 / 64 | 1.31 / 5 |
| completionist | 11,750 | 11,503 | 98% | 247 | 48.4 / 64 | 0.03 / 5 |
| bot_farmer | 45,000 | 0 | 0% | 45,000 | 0.0 / 64 | 0.00 / 5 |
| alt_mender | 12,875 | 12,423 | 96% | 452 | 37.1 / 64 | 0.87 / 5 |
| churner | 1,289 | 985 | 76% | 305 | 3.4 / 64 | 0.08 / 5 |

## Attack checks
- alt self-Mend: paid 29,142 RF for 29,142 px, 14,571 RF came back to their own Friend -> net 0.500 RF/px (Regrow list price 0.5); burned 0.500 RF/px (Regrow burns 0.250)
- bot farmers (310 owners x 5 Friends, ~12 runs/Friend/day): RF spent 0; RF received only as voluntary stranger Mends: 4,676 total = 0.168 RF/owner/day; Bits earned are account-bound and have no RF exit

## Sensitivity (each row = mean of 3 full runs, seeds 42..44; RF/day averaged over 90 days; min free stake = worst run; refused packs = sum)
| scenario | burned/day | stream/day | Friend wallets/day | regrow RF/day | Mend RF/day | packs/day | decor RF/day | ever paid | avg missing d31-90 | free px / lost px | min free stake | refused packs | Bits spent/minted | unspent Bits/human d90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 2,244 | 1,777 | 467 | 2,722 | 935 | 1,141 | 270 | 65.4% | 17.1% | 87% | 10,000 | 0 | 70% | 414 |
| regrow 0.25 | 1,608 | 1,368 | 240 | 1,918 | 479 | 1,122 | 266 | 69.3% | 16.7% | 82% | 10,000 | 0 | 70% | 406 |
| regrow 0.75 | 2,578 | 1,909 | 670 | 3,002 | 1,340 | 1,133 | 267 | 63.0% | 17.5% | 89% | 10,000 | 0 | 70% | 410 |
| regrow 1.00 | 3,124 | 2,271 | 854 | 3,722 | 1,708 | 1,152 | 271 | 61.5% | 17.6% | 90% | 9,904 | 0 | 70% | 417 |
| free 0.25 px/h | 3,889 | 3,020 | 869 | 5,232 | 1,739 | 1,129 | 256 | 67.3% | 31.0% | 69% | 10,000 | 0 | 70% | 416 |
| free 1.0 px/h | 1,429 | 1,225 | 204 | 1,648 | 408 | 1,139 | 268 | 61.8% | 7.3% | 92% | 10,000 | 0 | 70% | 418 |
| free 2.0 px/h | 1,151 | 1,037 | 114 | 1,242 | 227 | 1,136 | 272 | 60.4% | 7.0% | 94% | 10,000 | 0 | 70% | 406 |
| regrow 0.25 + free 0.25 | 2,501 | 2,061 | 440 | 3,289 | 880 | 1,139 | 263 | 72.5% | 29.3% | 63% | 9,962 | 0 | 70% | 408 |
| regrow 1.0 + free 1.0 | 1,907 | 1,493 | 414 | 2,170 | 828 | 1,139 | 270 | 58.8% | 7.5% | 95% | 10,000 | 0 | 70% | 409 |
| Mend = 1x Regrow (concept text) | 2,031 | 1,778 | 253 | 2,735 | 506 | 1,134 | 268 | 65.1% | 17.1% | 86% | 10,000 | 0 | 70% | 405 |
| Seed Pack 3 RF (table scaled) | 2,270 | 1,808 | 462 | 2,807 | 923 | 1,861 | 274 | 68.3% | 17.1% | 86% | 10,000 | 0 | 70% | 412 |
| Seed Pack 8 RF (table scaled) | 2,161 | 1,686 | 476 | 2,577 | 951 | 714 | 265 | 59.5% | 17.2% | 87% | 9,595 | 99 | 70% | 403 |
| Gold perk off | 2,307 | 1,835 | 472 | 2,865 | 944 | 1,120 | 266 | 65.0% | 17.2% | 86% | 10,000 | 0 | 70% | 410 |
| Gold perk +50 %/gold | 2,179 | 1,709 | 470 | 2,591 | 940 | 1,136 | 269 | 65.4% | 17.2% | 87% | 10,000 | 0 | 70% | 411 |
| elasticity 2, regrow 0.25 | 2,025 | 1,773 | 252 | 2,703 | 504 | 1,153 | 270 | 75.2% | 16.0% | 76% | 10,000 | 0 | 70% | 411 |
| elasticity 2, regrow 0.5 | 2,244 | 1,777 | 467 | 2,722 | 935 | 1,141 | 270 | 65.4% | 17.1% | 87% | 10,000 | 0 | 70% | 414 |
| elasticity 2, regrow 1.0 | 2,722 | 1,936 | 786 | 3,048 | 1,573 | 1,131 | 267 | 59.2% | 17.8% | 91% | 10,000 | 0 | 70% | 404 |
| elasticity 2, Seed Pack 8 RF | 2,101 | 1,614 | 487 | 2,574 | 973 | 490 | 268 | 59.5% | 17.3% | 87% | 9,946 | 495 | 70% | 410 |
| phase 1: stream half burned | 4,021 | 0 | 467 | 2,722 | 935 | 1,141 | 270 | 65.4% | 17.1% | 87% | 10,000 | 0 | 70% | 414 |
| stake 3,000 | 2,236 | 1,761 | 474 | 2,705 | 948 | 1,080 | 265 | 64.9% | 17.2% | 87% | 3,000 | 11,274 | 70% | 412 |
| stake 5,000 | 2,230 | 1,762 | 469 | 2,716 | 937 | 1,129 | 270 | 65.4% | 17.2% | 87% | 5,000 | 951 | 70% | 415 |
| stake 10,000, crates x10 (2 % of whale sessions) | 2,431 | 1,961 | 471 | 2,702 | 942 | 1,930 | 266 | 65.3% | 17.2% | 87% | 10,000 | 1,188 | 70% | 414 |
| Bits faucet x2 | 2,220 | 1,751 | 469 | 2,680 | 937 | 1,119 | 283 | 64.7% | 17.2% | 87% | 9,778 | 0 | 78% | 923 |
| no monthly catalog drops | 2,262 | 1,793 | 469 | 2,737 | 938 | 1,143 | 294 | 65.4% | 17.1% | 87% | 10,000 | 0 | 68% | 775 |
