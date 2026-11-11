# Manual test walkthrough (Mezo testnet)

Written 10 Nov 2026 with BTC at **73,965**. Prices below are estimates; the site always shows the live quote, so small
differences are normal. If BTC has moved a lot, shift the strikes by the same amount (the at-the-money strike is the one
nearest the current price).

- Site: https://piton.surge.sh/dashboard
- Pool: `0x21F83eEcF5561AB721ec4f8E96279EC1BFCb8221` (about 2,500 MUSD)
- Network: Mezo Testnet, chain id 31611, RPC `https://rpc.test.mezo.org`

## Before you start
- Borrow about **500 MUSD** at https://testnet.mezo.org with your test-BTC account. That covers everything with room to
  spare: the most you have locked at once is about 250 MUSD, and premiums are a few MUSD each.
- Keep a little test BTC for gas.
- Open the site, click **Connect wallet**, switch to Mezo Testnet if asked. Your MUSD should show in the Wallet panel.

Pool limits these numbers are built around:
- The pool holds about 2,500 MUSD.
- It only sells strikes within ±30% of spot (about 51,800 to 96,200).
- One option can lock at most about 625 MUSD (25% of the pool).
- Each step needs 2 to 3 wallet signatures.

## Step 1: Deposit into the pool (starts the 1-hour lock)
Do this first so the lock has run out by Step 9.
- **Do:** Pool panel → Deposit → **100** → Deposit MUSD (2 signatures).
- **Expect:**
  - You get about 100 yMUSD.
  - "Your deposit lock" counts down from about 1h 00m.
  - The Withdraw tab says "Your deposit is locked for another …" and the button is greyed out.

## Step 2: Look around the market header and option chain
- **Market header** (strip under the top bar): BTC index, 24h change and high/low, 24h volume, open interest with
  put/call ratio, pool IV (mid/ask) next to Deribit's DVOL, pool size and utilisation, and whether the pool is selling.
- **Chain toolbar:** switch prices between MUSD, BTC and % of spot; show calls, puts or both; strike range ±10/20/30%;
  "Columns" to add mark, IV, greeks (Δ, Γ, Θ, vega), open interest and 24h volume. Choices are remembered.
- IV is the volatility implied by the ask. Far from the money it is high because of the pool's 5%-a-year minimum
  price on locked collateral, not because of a pricing error.
- **Do:** pick the expiry tab about a day away (labelled 08:00 tomorrow or the day after).
- **Expect:**
  - Strikes 60,000 to 88,000 in steps of 2,000, with 74,000 marked ATM.
  - A small green dot next to each pool price.
  - The 74,000 put ask is roughly 700 to 1,200 MUSD per BTC, depending on time to expiry.
- **Also:** click "How it works" in the Pool panel. It shows the pool's rules and track record.

## Step 3: Buy a put from the pool
- **Do:** click the Ask on the **74,000 Put** row → Trade panel: Buy → Market → Size **0.005**. Leave auto-exercise ticked.
- **Check the detail strip** at the top of the Trade panel: mark, ask IV, mid IV, delta/gamma/theta/vega, last trade,
  24h volume, open interest, and a countdown to expiry that ticks every second.
- **Try the inputs:** switch Size to MUSD (0.005 BTC shows as about 370 MUSD notional) and back; switch Price to % spot;
  click 25% next to "Spend" (sets the size that spends about a quarter of your MUSD). Then set Size back to 0.005.
- **Expect before signing:**
  - A green "Fills now: the pool sells at … MUSD for this size" box.
  - "You pay" about 3.5 to 6 MUSD (price per BTC × 0.005).
  - Max loss equals what you pay.
  - Max gain is about 370 minus what you pay (collateral 74,000 × 0.005 = 370).
  - Break-even is about 74,000 minus (what you pay ÷ 0.005), roughly 72,900 to 73,300.
  - A payoff chart.
- **Confirm** (3 signatures: approve, buy, auto-exercise).
- **Expect after signing:**
  - Toast: "Bought from the pool. Auto-exercise is on…".
  - Positions shows a Long row with **Auto on**, a P&L a little below zero (the pool's spread), and a **Sell back** button.
  - Pool panel: open options +1, Locked about +370.
  - The **Recent trades** tab shows your trade.

**Keep this option open until Step 9.**

## Step 4: Sell back (close early) on a second option
- **Do:** buy another **74,000 Put**, Size **0.003**, the same way. Then in Positions click **Sell back** (the button shows the bid).
- **Expect:**
  - The bid is about 75 to 85% of what you paid. Buying and selling straight back always loses a little.
  - The row moves to History as **"Sold back"**.
  - Pool Locked drops by about 222.

## Step 5: The pool refuses an order that is too big
The pool is now about 2,200 MUSD, so one option may lock at most about 550 MUSD (25%).
- **Do:** 74,000 Put → Buy → Market → Size **0.01** (collateral 740, above the limit).
- **Expect before signing:** a yellow box "The pool won't sell this itself: this option needs 740 MUSD of collateral;
  one option may use at most 25% of the pool (about 550 MUSD). Try a smaller size". Then Confirm anyway.
- **Expect after signing:**
  - Toast: "Not filled by the pool: your order is a resting bid…".
  - Your premium (about 7 to 12 MUSD) is held.
  - The order shows in the order book under the Trade panel and in the **All orders** tab.
- **Then:** Positions → **Cancel**. The premium comes back in full.

## Step 6: Strike too far from spot (just look)
- **Do:**
  1. Select any put. The address bar shows something like `?i=P-74000-1794470400`.
  2. Change `74000` to `50000` (32% below spot) and reload.
- **Expect:** a yellow box saying "strike is 32% from the current price; the pool only sells within 30%", and that the
  order would rest as a bid. No need to submit.

## Step 7: Limit bid below the pool price
- **Do:** **76,000 Call** → Buy → Limit → Size **0.002**, Price **100** (MUSD per BTC, so 0.20 MUSD total) → Confirm.
- **Expect:**
  - Before signing: "Rests on the book as a bid: your price is below the pool's (…)".
  - After signing: your bid shows in the order book.
- **Then:** cancel it in Positions (0.20 MUSD back).

## Step 8: Sell (write) a put with MUSD collateral
- **Do:** **72,000 Put** → Sell → Size **0.002**, Price **600** → MUSD margin (not Trove) → Confirm.
- **Expect:**
  - Before signing: "You lock 144 MUSD" (72,000 × 0.002), "You receive (after 2% fee) 1.18 MUSD", max loss about 142.8.
  - After signing: it shows as an ask in the book; nobody fills it.
- **Then:** cancel it in Positions. The 144 MUSD comes back.
- **Optional:** repeat with **Trove margin** and Size **0.001**. This adds about 72 MUSD of debt to your Trove; after you
  cancel, the 72 MUSD comes back to your wallet and you repay the Trove yourself.

## Step 9: Withdraw with the exit fee (after the 1-hour lock)
- **Do:** check the lock says "unlocked" and the Step 3 option is still open → Withdraw **50** yMUSD.
- **Expect:**
  - "Exit fee now 0.25%".
  - Estimate about 49.87 MUSD (fee about 0.125).
  - The rest of your yMUSD stays in the pool.

## Step 10: Exercise an in-the-money option
- **Do:** **76,000 Put** (in the money by about 2,035) → Buy → Market → Size **0.002**, **untick** auto-exercise → Confirm.
  Then Positions → **Exercise**.
- **Expect:**
  - You pay at least 4.15 MUSD.
  - Exercising pays about 4.07 MUSD (2,035 × 0.002).
  - You get back less than you paid. That is deliberate: the pool never sells below what you could exercise for straight away.

## Step 11: Auto-exercise (needs the keeper running)
**Tell me before this step.** The keeper is not running anywhere yet, so it has to be started first.
- **Do:** earliest expiry tab (about 1 to 2 hours away) → **76,000 Put**, Size **0.002**, auto-exercise ticked. Wait until expiry.
- **Expect:**
  - If BTC is still below 76,000, the keeper exercises it in the last 5 minutes.
  - You receive about 99.5% of the exercise value; the keeper keeps 0.5%.
  - The row moves to History as "Exercised".

## Money summary
| Step | MUSD spent for good | MUSD locked and returned |
|---|---|---|
| 1 / 9 | about 0.13 (exit fee) | 100 deposit (50 stays in the pool after Step 9) |
| 3 | 3.5 to 6 (premium, unless it wins) | – |
| 4 | about 1 (round-trip spread) | – |
| 5, 7 | 0 | 7 to 12, 0.2 |
| 8 | 0 | 144 |
| 10, 11 | about 0.1 to 1 each | – |

Total spent for good: about 10 to 15 MUSD. Everything else comes back.

## Reporting back
For each step, reply "worked" or describe what you saw instead. A screenshot or the transaction link from the toast
helps. The circuit breaker cannot be tested by hand (it needs a 5% move in 10 minutes); the automated tests cover it.
