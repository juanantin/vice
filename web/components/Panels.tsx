"use client";

import { ink } from "../lib/theme";
import { useEffect, useMemo, useState } from "react";
import { DISTRICTS, DistrictId, EARLY_BIRD_UNITS, GAME, MAX_BUILDINGS, TICKER, TIERS, TOKENS, VOTE_CITIES, cityToken, levelForUsd, usdForNextLevel } from "../lib/config";
import { formatCountdown } from "../lib/romeTime";
import { approve, buildMine, claim, focus, getCity, quoteBuild, useCity, vote } from "../lib/store";
import { describeError, testActions } from "../lib/chain";
import { Sun } from "./Logo";

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtT = (n: number) =>
  n.toLocaleString("en-US", { notation: n >= 100_000 ? "compact" : "standard", maximumFractionDigits: n >= 100 ? 0 : 2 });
const usd = (n: number) => `$${fmt(n, n < 100 ? 2 : 0)}`;

export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The weekly deadline (Sunday 20:00 Rome time in the contracts) shown in Miami time. */
function miamiTime(unix: number) {
  return new Date(unix * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Runs an action: a real wallet transaction on testnet, a short fake delay in preview. */
function useTx(): [string | null, (label: string, fn: () => unknown) => void, string | null] {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (label: string, fn: () => unknown) => {
    setPending(label);
    setError(null);
    const preview = getCity().mode === "preview";
    (async () => {
      if (preview) await new Promise((r) => setTimeout(r, 1100));
      await fn();
    })()
      .catch((e) => setError(describeError(e)))
      .finally(() => setPending(null));
  };
  return [pending, run, error];
}

function TxError({ error }: { error: string | null }) {
  return error ? <p className="err-box">{error}</p> : null;
}

// ─────────── Build ───────────

export function BuildTab() {
  const city = useCity();
  const [district, setDistrict] = useState<DistrictId | null>(null);
  const [style, setStyle] = useState<0 | 1 | 2 | null>(null);
  const [inviter, setInviter] = useState("");
  const [pending, run, error] = useTx();
  const [done, setDone] = useState<number | null>(null);
  const q = quoteBuild();
  const maxBurn = Math.ceil(q.tokens * 1.02);
  const testnet = city.mode === "testnet";
  const maxBurnWei = testnet && city.chain?.quote ? (city.chain.quote.tokensWei * 102n) / 100n : BigInt(maxBurn) * 10n ** 18n;
  const unavailable = testnet ? (!city.chain ? "Loading the city from Elysium…" : city.chain.quoteError) : null;
  const short = testnet && !!city.chain?.quote && city.chain.viceWei < city.chain.quote.tokensWei;
  const full = city.buildings.length >= MAX_BUILDINGS;
  const invNum = parseInt(inviter, 10);
  const invOk = !inviter || (invNum > 0 && invNum < q.id);

  if (done) {
    return (
      <div className="tab">
        <div className="success">
          <div className="big">Hideout #{done} is open!</div>
          <p>It earns a share of every purchase from now on. Claim to make it grow.</p>
          <div className="row">
            <button className="btn" onClick={() => focus(done)}>Show on map</button>
            <button className="btn ghost" onClick={() => { setDone(null); setDistrict(null); setStyle(null); setInviter(""); }}>Build another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab">
      <div className="price-card">
        <div>
          <div className="muted">Next building</div>
          <div className="big">#{fmt(q.id)}</div>
        </div>
        <div>
          <div className="muted">Price</div>
          <div className="big">{usd(q.usd)}</div>
        </div>
        <div>
          <div className="muted">Burn</div>
          <div className="big">{fmt(q.tokens)}</div>
          <div className="muted small">{TICKER}</div>
        </div>
      </div>
      {testnet && city.me && (
        <p className="muted small">
          Your wallet ({city.me.slice(0, 6)}…{city.me.slice(-4)}) holds <b>{fmt(city.viceBalance)} {TICKER}</b>
          {city.chain?.quote ? (city.chain.viceWei >= city.chain.quote.tokensWei ? " · enough for this hideout" : " · not enough for this hideout yet") : ""}.
        </p>
      )}
      {testnet && !city.me && <p className="muted small">Connect your wallet to see your {TICKER} and build.</p>}

      <h3><span className="step">1</span> Choose a district</h3>
      <div className="district-grid">
        {DISTRICTS.map((d) => (
          <button key={d.id} className={`district-btn ${district === d.id ? "on" : ""}`} style={{ ["--c" as string]: ink(d), ["--cl" as string]: d.light }} onClick={() => { setDistrict(d.id); setStyle(null); }}>
            <span className="dt">{d.city}</span>
            <span className="dc">{d.landmark}</span>
            <span className="dk" style={{ ["--t" as string]: ink(TOKENS[cityToken(d, city.currentToken)]) }}>
              Earns {d.earns === "vote" ? `the vote's pick (${TOKENS[city.currentToken].token} now)` : TOKENS[d.earns].token}
            </span>
            <span className="dn">{fmt(city.districtCount[d.id] ?? 0)} built · {city.newBuilds[d.id] ?? 0} this week</span>
          </button>
        ))}
      </div>
      <p className="muted small">Each district earns one token: {DISTRICTS.map((d) => `${d.city} ${d.earns === "vote" ? "whichever token the weekly vote picks" : TOKENS[d.earns].token}`).join(", ")}. Every {GAME.building} gets the same value from each purchase, whatever its district. Your district also decides where your {GAME.building} stands and your crew in the weekly turf race.</p>

      {district !== null && (
        <>
          <h3><span className="step">2</span> Choose a style <span className="muted small">(permanent)</span></h3>
          <div className="style-grid">
            {DISTRICTS[district].styles.map((name, i) => (
              <button key={name} className={`style-btn ${style === i ? "on" : ""}`} style={{ ["--c" as string]: ink(DISTRICTS[district]) }} onClick={() => setStyle(i as 0 | 1 | 2)}>
                <StyleIcon district={district} style={i} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {style !== null && district !== null && (
        <>
          <h3><span className="step">3</span> Invited by <span className="muted small">(optional building number)</span></h3>
          <input className="input" inputMode="numeric" placeholder="e.g. 42" value={inviter} onChange={(e) => setInviter(e.target.value.replace(/\D/g, ""))} />
          <p className="muted small">Invites are decorations only: flags, neon signs and fireworks on the inviter's building. Nobody earns from invites.</p>
          {!invOk && <p className="warn small">That building doesn't exist yet.</p>}

          <h3><span className="step">4</span> Build</h3>
          <div className="row">
            <button className="btn" disabled={city.approved || !!pending} onClick={() => run("approve", approve)}>
              {city.approved ? "Approved" : pending === "approve" ? "Confirm in wallet…" : `Approve ${TICKER}`}
            </button>
            <button className="btn primary" disabled={!city.approved || !invOk || full || !!pending || !!unavailable || short} onClick={() => run("build", async () => {
              const id = await buildMine(district, style, invNum || 0, maxBurnWei);
              if (id) {
                setDone(id);
                setTimeout(() => focus(id), 600);
              }
            })}>
              {pending === "build" ? "Moving in…" : `Move in (max ${fmt(maxBurn)})`}
            </button>
          </div>
          <p className="muted small">Approve once. The build reverts if the burn would be above your max (quote + 2%). Tokens go to the burn address.</p>
          {unavailable && <p className="warn small">{unavailable}</p>}
          {short && <p className="warn small">Not enough {TICKER} in your wallet for this build. Buy some on Volta first.</p>}
          <TxError error={error} />
        </>
      )}
      {!testnet && <p className="preview-note">Preview mode: no wallet, nothing is sent on-chain.</p>}
    </div>
  );
}

function StyleIcon({ style }: { district: number; style: number }) {
  // Line icons in the district's ink (set by CSS via currentColor): tower, deco block, pool low-rise.
  if (style === 0) {
    return (
      <svg viewBox="0 0 40 44" width="44" height="48" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="13" y="8" width="14" height="32" />
        <path d="M13 13 H27 M13 18 H27 M13 23 H27 M13 28 H27 M13 33 H27" opacity="0.6" />
        <path d="M20 8 V2" />
        <path d="M2 40 H38" opacity="0.5" />
      </svg>
    );
  }
  if (style === 1) {
    return (
      <svg viewBox="0 0 40 44" width="44" height="48" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="8" y="16" width="24" height="24" />
        <path d="M12 16 V12 H28 V16 M17 12 V4 H21 V12" />
        <path d="M8 24 H32 M8 32 H32" opacity="0.7" />
        <path d="M2 40 H38" opacity="0.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 44" width="44" height="48" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="6" y="24" width="28" height="16" />
      <path d="M10 24 Q14 21 18 24" opacity="0.8" />
      <path d="M28 24 Q27 16 29 10 M29 10 Q24 9 22 12 M29 10 Q34 9 36 12 M29 10 Q29 6 32 5" />
      <path d="M11 30 h5 M20 30 h5 M11 35 h5 M20 35 h5" opacity="0.7" />
      <path d="M2 40 H38" opacity="0.5" />
    </svg>
  );
}

// ─────────── My hideouts ───────────

export function MyPalazzoTab() {
  const city = useCity();
  const mine = useMemo(() => city.buildings.filter((b) => b.owner === city.me), [city.buildings, city.me]);
  const [pending, run, error] = useTx();
  const totalPending = mine.reduce((s, b) => s + b.pendingUsd, 0);
  const totalTokens = TOKENS.map((t) => mine.reduce((s, b) => s + (b.pendingTokens?.[t.id] ?? 0), 0));
  const unvoted = mine.filter((b) => b.votedWeek !== city.week).length;

  if (mine.length === 0) {
    return (
      <div className="tab">
        <p>You don&apos;t own a {GAME.building} yet. Open <b>Move in</b> to put one on the map.</p>
      </div>
    );
  }
  return (
    <div className="tab">
      <div className="price-card">
        <div>
          <div className="muted">Buildings</div>
          <div className="big">{mine.length}</div>
        </div>
        <div>
          <div className="muted">Pending</div>
          <div className="big">{usd(totalPending)}</div>
        </div>
        <div>
          <div className="muted">Votes left</div>
          <div className="big">{unvoted}</div>
        </div>
      </div>
      <button className="btn primary wide" disabled={totalPending <= 0 || !!pending} onClick={() => run("all", () => claim(mine.map((b) => b.id)))}>
        {pending === "all" ? "Claiming…" : `Claim all (${usd(totalPending)})`}
      </button>
      {city.chain && ((!city.chain.isEarlyBird && !city.chain.earlyBirdFinalized) || city.chain.blockTime >= city.weekEnd) && (
        <div className="ok-box">
          Rewards are waiting to be paid out (early bird ended or the week closed).{" "}
          <button className="btn small" disabled={!!pending} onClick={() => run("settle", () => testActions.settle())}>
            {pending === "settle" ? "…" : "Settle now"}
          </button>
        </div>
      )}
      <div className="token-row">
        {TOKENS.map((t) => (
          <span key={t.id} style={{ ["--c" as string]: ink(t) }}>
            <i className="dot" /> <b>{fmtT(totalTokens[t.id])}</b> {t.token}
          </span>
        ))}
      </div>
      <p className="muted small">One claim pays VOLTA, SENT and VOID together. Claiming is what makes your building taller.</p>
      <TxError error={error} />
      <div className="list">
        {mine.map((b) => {
          const D = DISTRICTS[b.district];
          const lvl = levelForUsd(b.claimedUsd);
          const lo = usdForNextLevel(lvl - 1);
          const hi = usdForNextLevel(lvl);
          const pct = Math.min(100, ((b.claimedUsd - lo) / (hi - lo)) * 100);
          return (
            <div key={b.id} className="pal-card" style={{ ["--c" as string]: ink(D) }}>
              <button className="pal-head" onClick={() => focus(b.id)}>
                <span className="lvl">L{lvl}</span>
                <span>
                  <b>#{b.id}</b> {D.city} · {D.styles[b.style]}
                  <span className="muted small block">{D.crew} · plot {b.plot + 1}</span>
                </span>
              </button>
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              <div className="muted small">{usd(b.claimedUsd)} claimed · next floor at {usd(hi)}</div>
              <div className="token-row small-row">
                {TOKENS.map((t) => (
                  <span key={t.id} style={{ ["--c" as string]: ink(t) }}>
                    <i className="dot" /> {fmtT(b.pendingTokens?.[t.id] ?? 0)} {t.token}
                  </span>
                ))}
              </div>
              <div className="pal-foot">
                <span>Pending <b>{usd(b.pendingUsd)}</b></span>
                <span className={b.votedWeek === city.week ? "ok" : "warn"}>{b.votedWeek === city.week ? "Voted" : "Not voted"}</span>
                <button className="btn small" disabled={b.pendingUsd <= 0 || !!pending} onClick={() => run(`c${b.id}`, () => claim([b.id]))}>
                  {pending === `c${b.id}` ? "…" : "Claim"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── Town Hall ───────────

export function TownHallTab() {
  const city = useCity();
  const now = useNow();
  const [pending, run, error] = useTx();
  const [voted, setVoted] = useState<string | null>(null);
  const total = city.votes.reduce((a, b) => a + b, 0);
  const max = Math.max(...city.votes);
  const leaders = city.votes.filter((v) => v === max && v > 0).length;
  const mineUnvoted = city.buildings.filter((b) => b.owner === city.me && b.votedWeek !== city.week).map((b) => b.id);
  return (
    <div className="tab">
      <div className="countdown">
        <div className="muted">Vote closes in</div>
        <div className="big mono">{formatCountdown(city.weekEnd - now)}</div>
        <div className="muted small">Every Sunday, {miamiTime(city.weekEnd)} Miami time</div>
      </div>
      <p>Each {GAME.building}, in any district, has one vote per week. The vote picks the token {VOTE_CITIES().map((d) => d.city).join(" and ")} earns next week; the other districts keep their own token. A tie or no votes keeps the current token.</p>
      <div className="votes">
        {TOKENS.map((d) => {
          const v = city.votes[d.id] ?? 0;
          const pct = total ? (v / total) * 100 : 0;
          return (
            <div key={d.id} className="vote-row" style={{ ["--c" as string]: ink(d) }}>
              <div className="vote-label">
                <b>{d.token}</b> <span className="muted small">{d.symbol}</span>
                {city.currentToken === d.id && <span className="tag">{VOTE_CITIES().map((c) => c.city.toUpperCase()).join(" + ")} NOW</span>}
                {v === max && v > 0 && leaders === 1 && <span className="tag lead">LEADING</span>}
              </div>
              <div className="bar big"><i style={{ width: `${pct}%` }} /><span>{fmt(v)} · {pct.toFixed(0)}%</span></div>
              <button className="btn small" disabled={!mineUnvoted.length || !!pending} onClick={() => run(`v${d.id}`, async () => { const n = mineUnvoted.length; await vote(mineUnvoted, d.id); setVoted(`Voted! ${n} hideout${n === 1 ? "" : "s"} backing ${d.token} for next week.`); })}>
                {pending === `v${d.id}` ? "…" : `Vote all (${mineUnvoted.length})`}
              </button>
            </div>
          );
        })}
      </div>
      {voted && <p className="ok-box">{voted}</p>}
      <TxError error={error} />
      <p className="muted small">The Mayor&apos;s building does not vote. A building that already voted this week can&apos;t vote again after being sold, until next week.</p>
    </div>
  );
}

// ─────────── Rankings ───────────

export function RankingsTab() {
  const city = useCity();
  const now = useNow();
  const max = Math.max(1, ...city.newBuilds);
  const tallest = useMemo(() => [...city.buildings].sort((a, b) => b.claimedUsd - a.claimedUsd).slice(0, 10), [city.buildings]);
  const inviters = useMemo(() => [...city.buildings].filter((b) => b.invites > 0).sort((a, b) => b.invites - a.invites).slice(0, 5), [city.buildings]);
  return (
    <div className="tab">
      <h3>Turf race · this week</h3>
      <p className="muted small">The district with the most new {GAME.buildings} wins this week&apos;s 15% street pool (bought in that district&apos;s token), shared by all its {GAME.buildings}. Ends in {formatCountdown(city.weekEnd - now)}.</p>
      <div className="votes">
        {DISTRICTS.map((d) => (
          <div key={d.id} className="vote-row" style={{ ["--c" as string]: ink(d) }}>
            <div className="vote-label">
              <b>{d.city}</b> <span className="muted small">{d.landmark}</span>
              {city.newBuilds[d.id] === max && <span className="tag lead">LEADING</span>}
            </div>
            <div className="bar big"><i style={{ width: `${(city.newBuilds[d.id] / max) * 100}%` }} /><span>{city.newBuilds[d.id]} new</span></div>
          </div>
        ))}
      </div>
      <h3>Tallest hideouts</h3>
      <ol className="rank">
        {tallest.map((b, i) => (
          <li key={b.id} onClick={() => focus(b.id)}>
            <span className="pos">{i + 1}</span>
            <span className="dot" style={{ background: ink(DISTRICTS[b.district]) }} />
            <span>#{b.id} · {DISTRICTS[b.district].city}</span>
            <b>L{levelForUsd(b.claimedUsd)}</b>
            <span className="muted small">{usd(b.claimedUsd)}</span>
          </li>
        ))}
      </ol>
      <h3>Most invites </h3>
      <ol className="rank">
        {inviters.map((b, i) => (
          <li key={b.id} onClick={() => focus(b.id)}>
            <span className="pos">{i + 1}</span>
            <span className="dot" style={{ background: ink(DISTRICTS[b.district]) }} />
            <span>#{b.id} · {DISTRICTS[b.district].city}</span>
            <b>{b.invites}</b>
            <span className="muted small">invites</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─────────── Treasury ───────────

export function TreasuryTab() {
  const city = useCity();
  const now = useNow();
  const [pending, run, error] = useTx();
  const [msg, setMsg] = useState<string | null>(null);
  const onChain = city.mode === "testnet" && !!city.chain;
  return (
    <div className="tab">
      {onChain && (
        <div className="ok-box">
          <p className="small">
            The keeper does this every 15 minutes, but anyone can push the city along: collect the trading fees Volta
            holds for the vault, or start a buy (the vault's rules still decide size, timing and price).
          </p>
          <div className="row">
            <button className="btn small" disabled={!!pending} onClick={() => run("collect", async () => { await testActions.collectFees(); setMsg("Fees collected into the vault."); })}>
              {pending === "collect" ? "…" : "Collect fees"}
            </button>
            <button className="btn small" disabled={!!pending} onClick={() => run("buy", async () => setMsg(await testActions.requestBuy()))}>
              {pending === "buy" ? "…" : "Buy now"}
            </button>
          </div>
          {msg && <p className="small">{msg}</p>}
          <TxError error={error} />
        </div>
      )}
      <div className="stat-grid">
        <div><span className="muted">Total city tax</span><b>{fmt(city.totalTax)} VOLTA</b></div>
        <div><span className="muted">Purchases</span><b>{fmt(city.totalPurchases)}</b></div>
        <div><span className="muted">Bought for residents</span><b>{usd(city.totalBoughtUsd)}</b></div>
        <div><span className="muted">Paid to ops</span><b>{fmt(city.opsPaid)} VOLTA</b></div>
      </div>
      <h3>Where the tax goes</h3>
      <div className="split">
        <i style={{ flex: 70, background: "#80e3ba" }}>70% residents</i>
        <i style={{ flex: 15, background: "#d9b45a" }}>15% street</i>
        <i style={{ flex: 15, background: "#94b7a7" }}>15% ops</i>
      </div>
      <p className="muted small">{TICKER} trades on Volta, paired with $VOLTA. The creator share of its trading fee is paid to the vault in VOLTA. 70% buys each district&apos;s token for its residents and 15% the turf race winner&apos;s (VOLTA itself is simply kept); 15% stays in VOLTA for operations (2-of-3 multisig).</p>
      <h3>Waiting to buy</h3>
      <div className="stat-grid">
        <div><span className="muted">Residents</span><b>{fmt(city.residentsFunds)} VOLTA</b></div>
        <div><span className="muted">Street pool</span><b>{fmt(city.streetFunds)} VOLTA</b></div>
        <div><span className="muted">Ops</span><b>{fmt(city.opsFunds)} VOLTA</b></div>
      </div>
      <h3>Buy rules</h3>
      <ul className="rules">
        <li>Buys once enough VOLTA is waiting (a minimum order), capped per order so each buy stays small next to the token&apos;s pool.</li>
        <li>One order at a time, at least <b>10 minutes</b> apart; the keeper checks every hour.</li>
        <li>Price checked against the pool&apos;s average price on Volta. More than <b>4%</b> off: order rejected, the VOLTA stays, buying pauses <b>6 hours</b>.</li>
        <li>Nothing bought for 24h: the keeper rests. <b>Anyone</b> can restart it with requestBuy().</li>
      </ul>
      <h3>Holdings</h3>
      <table className="table">
        <tbody>
          {TOKENS.map((d) => (
            <tr key={d.id}>
              <td><span className="dot" style={{ background: ink(d) }} /> {d.token}</td>
              <td className="num">{fmt(city.holdings[d.id], city.holdings[d.id] < 10_000 ? 2 : 0)}</td>
              <td className="num muted">{usd(city.holdings[d.id] * city.tokenUsd[d.id])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Recent purchases</h3>
      <table className="table">
        <tbody>
          {city.purchases.slice(0, 10).map((p, i) => (
            <tr key={i}>
              <td className="muted small">{Math.max(1, Math.round((now - p.at) / 60))} min ago</td>
              <td>{TOKENS[p.token].token}</td>
              <td className="num">{fmt(p.amount)} VOLTA</td>
              <td className="num muted">{usd(p.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Contracts</h3>
      <ul className="rules">
        <li>ViceVault, ViceNFT, VicePricing: addresses after deploy.</li>
        <li>No withdrawal function. Settings change only through a public <b>48-hour</b> timelock.</li>
      </ul>
    </div>
  );
}

// ─────────── The Mayor ───────────

export function SindacoTab() {
  const city = useCity();
  return (
    <div className="tab">
      <div className="sindaco-hero">
        <Sun size={72} />
        <div>
          <div className="big">The Mayor</div>
          <div className="muted">City Hall on Watson Island · building #0</div>
        </div>
      </div>
      <p>Welcome to {GAME.name}! The Mayor&apos;s hall stands on Watson Island, in the middle of the bay between the mainland and the beach. Every district grows outward from its landmark: Brickell&apos;s towers, Downtown&apos;s Freedom Tower, Wynwood&apos;s murals and Ocean Drive.</p>
      <ul className="rules">
        <li>Building #0 is minted at launch. It earns <b>no</b> rewards and has <b>no</b> vote.</li>
        <li>The team runs the keeper and receives only the 15% ops share. It cannot touch the vault.</li>
        <li>{fmt(city.buildings.length)} of {fmt(MAX_BUILDINGS)} {GAME.buildings} open. When the city is full, building closes forever.</li>
      </ul>
      <h3>Prices</h3>
      <table className="table">
        <tbody>
          <tr><td>Early bird · first {EARLY_BIRD_UNITS}, 6 hours</td><td className="num">$40</td></tr>
          {TIERS.map((t, i) => (
            <tr key={t.upTo}><td>#{i === 0 ? 1 : TIERS[i - 1].upTo + 1} – #{fmt(t.upTo)}</td><td className="num">${t.usd}</td></tr>
          ))}
        </tbody>
      </table>
      <h3>Links</h3>
      <ul className="rules">
        <li>X / Telegram: announced at launch.</li>
        <li>Contracts are open source; their ABIs are published at launch (Elysium explorers cannot verify contracts yet).</li>
      </ul>
      <p className="muted small">{GAME.name} is an experimental game. Reward tokens can lose value. Contracts are not audited. Nothing here is financial advice.</p>
    </div>
  );
}
