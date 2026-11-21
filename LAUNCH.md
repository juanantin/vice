# Launching VICE — step by step

Everything below is done from your own wallet. Nobody, including Claude, ever needs your
private keys or seed phrase. Contracts are **not audited** (your decision); test with small
amounts first if you can.

## The day before

1. **Your launch wallet** (MetaMask, Rabby…) on Elysium with about **2 HYPE** for gas
   (bridge at volta.family/bridge). This wallet launches $VICE, deploys the city and is the
   timelock admin.
2. **Ops wallet** (receives the 15% ops share). A 2-of-3 Safe is best (Safe's contracts exist on
   Elysium; if the Safe app doesn't list Elysium yet, use a separate wallet you control).
3. **Keeper wallet**: create a **new, empty** wallet just for the keeper and send it ~1 HYPE.
   In GitHub → `juanantin/vice` → Settings → Secrets and variables → Actions → *New repository
   secret*: name `KEEPER_PRIVATE_KEY`, value = that wallet's private key. That secret is the only
   place it goes. The keeper wallet has no special rights; it only pays gas.
4. **Website**: import `juanantin/vice` in Vercel (root directory = repo root), add your domain.

## Launch day

1. **Launch $VICE on volta.family**
   - Quote asset: **$VOLTA**
   - Creator split: **100% creator** (0% buyback, 0% holders)
   - Swap fee: your choice (1–5%). The city tax is 70% of it.
   - Anti-snipe: optional
   - **Scheduled opening: about 2 hours later.** The city must be ready (and the creator NFT in
     the vault) before anyone can trade, otherwise the first fees go to your wallet instead.
   - Dev buy: the minimum is fine.
   - Creator: your launch wallet.
2. **Open `https://<your site>/launch`** and connect the launch wallet.
   - Paste the $VICE address → *Check the token on Volta* (must show ✓).
   - Ops wallet, admin (your wallet), **building opens = the trading opening time**, buy sizes
     ($20 / $150 are good for today's pools).
   - Press **Run** on each step in order (one wallet confirmation each, about 11). You can close
     the page and come back; it remembers where you are.
   - The step *Send Volta's creator NFT to the vault* is **irreversible**: type `SEND` to enable
     it. Do it before trading opens.
   - Press **Check everything**: all lines should show ✓ (the price line shows "not open yet"
     until the start time).
3. **Put the city on the site**: the launch page shows a small `LIVE = { … }` snippet. Send it to
   Claude (or paste it into `web/lib/config.ts`) and push to `main`; Vercel redeploys and the
   site switches from the preview to the real city.
4. **Start the keeper**: GitHub → Settings → Secrets and variables → Actions → *Variables* →
   `VICE_VAULT` = the vault address. Then Actions → *keeper* → *Run workflow* once and read the
   log. After that it runs every 15 minutes by itself.

## 48 hours later

Open `/launch` again and press **Finish: timelock takes the prices**. From then on every
setting change (oracle, swap route, buy sizes, prices) is public for 48 hours before it happens.

## What runs the city

| What | Who | How often |
|---|---|---|
| Collect creator fees from Volta's escrow | keeper (anyone can) | every 15 min if any |
| Update the HYPE/USD reference | keeper (anyone can) | every 15 min |
| Buy SENT / VOID / keep VOLTA | keeper (anyone can) | when ≥ the smallest buy is waiting, 10 min apart |
| Close the week (Sunday 20:00 Rome = 2 PM Miami) | keeper or the next player action | weekly |
| Pay the ops share | keeper (anyone can) | once it's worth $25 |

Watch the keeper's log on the Actions tab now and then, and keep ~1 HYPE in the keeper wallet
(the log warns when it runs low). GitHub pauses scheduled jobs in repos with no commits for 60
days; *Run workflow* or any commit wakes it up.

## Good to know

- Prices come from Volta's own pools (10-minute averages); HYPE in USD comes from the HYPE/USDC
  pool through a reference that moves at most 2% per 5 minutes, so it can't be pushed around.
- During the 6-hour early bird the build price follows drops at once and rises after 60 s
  (Stockopolis rule). After that it's the lower of spot and the 10-minute average.
- A buy that would fill more than 4% worse than the average price (after Volta's fees) is
  refused and buying pauses for 6 hours; the VOLTA stays in the vault.
- If anything about the setup must change after launch, it goes through the 48h timelock from
  your admin wallet.
