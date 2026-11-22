"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import Providers from "./Providers";
import { describeError } from "../lib/chain";
import { GAME, REHEARSAL, TICKER } from "../lib/config";
import { EXPLORER } from "../lib/wagmi";
import { STEPS, TIMELOCK_DELAY, checkVice, loadLaunch, saveLaunch, verifyLaunch, type LaunchState, type TokenCheck, type Verify } from "../lib/launch";

/** The launch page (not linked from the game): deploys the real city from your own wallet. */
export default function Launch() {
  return (
    <Providers>
      <Wizard />
    </Providers>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const toLocalInput = (unix: number) => {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Wizard() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [s, setS] = useState<LaunchState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<TokenCheck | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [confirmNft, setConfirmNft] = useState("");
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => setS(loadLaunch()), []);
  useEffect(() => {
    if (s) saveLaunch(s);
  }, [s]);
  // The admin defaults to the connected wallet.
  useEffect(() => {
    if (s && address && !s.inputs.admin) setS({ ...s, inputs: { ...s.inputs, admin: address } });
  }, [address, s]);

  const inputs = s?.inputs;
  const inputProblems = useMemo(() => {
    if (!inputs) return ["Loading…"];
    const p: string[] = [];
    if (!isAddress(inputs.vice)) p.push(`${TICKER} token address`);
    if (!isAddress(inputs.ops)) p.push("Ops wallet address");
    if (!isAddress(inputs.admin)) p.push("Admin (timelock) address");
    if (!inputs.start) p.push("Building start time");
    if (!(inputs.minOrderUsd > 0 && inputs.maxOrderUsd >= inputs.minOrderUsd)) p.push("Buy sizes");
    return p;
  }, [inputs]);
  const started = !!s?.oracle;

  if (!s || !inputs) return <main className="launch"><p>Loading…</p></main>;
  const set = (patch: Partial<LaunchState["inputs"]>) => setS({ ...s, inputs: { ...inputs, ...patch } });

  const runCheck = async () => {
    setError(null);
    setBusy("check");
    try {
      const c = await checkVice(inputs.vice as Address, address ?? null);
      setCheck(c);
      if (!inputs.start && c.tradingOpensAt) set({ start: c.tradingOpensAt });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const nextIndex = STEPS.findIndex((st) => !st.done(s));
  const run = async (i: number) => {
    const st = STEPS[i];
    if (!address) return;
    setError(null);
    setBusy(st.key);
    try {
      const patch = await st.run(s, address);
      setS((cur) => (cur ? { ...cur, ...patch } : cur));
    } catch (e) {
      setError(`${st.title}: ${describeError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async () => {
    setBusy("verify");
    try {
      setVerify(await verifyLaunch(s));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const configSnippet = s.vault
    ? `export const LIVE = {\n  vault: "${s.vault}",\n  vice: "${inputs.vice}",\n};`
    : "";

  return (
    <main className="launch">
      <header className="launch-head">
        <h1>{GAME.name} · Launch</h1>
        {isConnected && address ? (
          <button className="btn small" onClick={() => disconnect()}>● {short(address)}</button>
        ) : (
          <button className="btn primary" disabled={isPending} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </header>

      {s?.inputs.vice && s.inputs.vice.toLowerCase() === REHEARSAL.vice.toLowerCase() && (
        <section className="launch-card">
          <h2>This browser still holds the $VTEST rehearsal</h2>
          <p>
            Its last step (Finish, after the 48-hour delay) can still be run below. When you&apos;re done with it, press <b>Reset</b> at the
            bottom of this page to start the real {TICKER} launch from step 1. The rehearsal city keeps running at{" "}
            <a href="/?city=rehearsal">vicetoken.city/?city=rehearsal</a>.
          </p>
        </section>
      )}

      <section className="launch-card">
        <h2>Before you start</h2>
        <ol>
          <li>Launch {TICKER} on <b>volta.family</b>: quote asset <b>$VOLTA</b>, creator split <b>100% creator</b>, and a <b>scheduled opening</b> about 2 hours later, so the city is ready before anyone can trade.</li>
          <li>Use this wallet as the creator: it receives Volta&apos;s creator NFT, which the last step sends to the vault.</li>
          <li>Keep about 1 HYPE for gas on Elysium. Every step is one confirmation in your wallet; you can close this page and come back.</li>
        </ol>
      </section>

      <section className="launch-card">
        <h2>Settings</h2>
        <label>{TICKER} token address
          <input className="input" disabled={started} value={inputs.vice} onChange={(e) => set({ vice: e.target.value.trim() as Address })} placeholder="0x…" />
        </label>
        <button className="btn small" disabled={!isAddress(inputs.vice) || busy === "check"} onClick={runCheck}>
          {busy === "check" ? "Checking…" : "Check the token on Volta"}
        </button>
        {check && (
          <div className={check.ok ? "ok-box" : "err-box"}>
            {check.problems.map((p) => <p key={p}>✗ {p}</p>)}
            {check.ok && <p>✓ Volta token paired with $VOLTA, 100% creator split.</p>}
            {check.notes.map((p) => <p key={p} className="small">{p}</p>)}
            {check.tradingOpensAt > 0 && <p className="small">Trading opens {new Date(check.tradingOpensAt * 1000).toLocaleString()}.</p>}
          </div>
        )}
        <label>Ops wallet (receives the 15% ops share; a 2-of-3 Safe is recommended)
          <input className="input" disabled={started} value={inputs.ops} onChange={(e) => set({ ops: e.target.value.trim() as Address })} placeholder="0x…" />
        </label>
        <label>Admin (proposes and executes timelocked changes; default: this wallet)
          <input className="input" disabled={started} value={inputs.admin} onChange={(e) => set({ admin: e.target.value.trim() as Address })} placeholder="0x…" />
        </label>
        <label>Building opens (your local time; the 6-hour early bird starts here; set it to the trading opening)
          <input className="input" type="datetime-local" disabled={started} value={toLocalInput(inputs.start)} onChange={(e) => set({ start: Math.floor(new Date(e.target.value).getTime() / 1000) || 0 })} />
        </label>
        <div className="row">
          <label>Smallest buy (USD)
            <input className="input" type="number" min={1} disabled={started} value={inputs.minOrderUsd} onChange={(e) => set({ minOrderUsd: Number(e.target.value) })} />
          </label>
          <label>Largest buy (USD)
            <input className="input" type="number" min={1} disabled={started} value={inputs.maxOrderUsd} onChange={(e) => set({ maxOrderUsd: Number(e.target.value) })} />
          </label>
        </div>
        <p className="muted small">Buys are converted to VOLTA at today&apos;s price. The SENT pool is thin (about $13k), so keep the largest buy near $150.</p>
        {inputProblems.length > 0 && !started && <p className="warn small">Missing: {inputProblems.join(", ")}.</p>}
      </section>

      <section className="launch-card">
        <h2>Deploy</h2>
        <ol className="launch-steps">
          {STEPS.map((st, i) => {
            const done = st.done(s);
            const blocked = st.blocked?.(s, now) ?? null;
            const isNext = i === nextIndex;
            const irreversible = st.key === "creatorNft";
            const canRun = isNext && !!address && inputProblems.length === 0 && !blocked && !busy && (!irreversible || confirmNft === "SEND");
            return (
              <li key={st.key} className={done ? "done" : isNext ? "next" : ""}>
                <div>
                  <b>{done ? "✓ " : ""}{st.title}</b>
                  <p className="muted small">{st.detail}</p>
                  {irreversible && isNext && (
                    <label className="small">Type SEND to confirm
                      <input className="input" value={confirmNft} onChange={(e) => setConfirmNft(e.target.value)} />
                    </label>
                  )}
                  {blocked && isNext && <p className="warn small">{blocked}</p>}
                </div>
                {!done && (
                  <button className={`btn small ${irreversible ? "danger" : "primary"}`} disabled={!canRun} onClick={() => run(i)}>
                    {busy === st.key ? "Confirm in wallet…" : "Run"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {error && <p className="err-box">{error}</p>}
        {s.acceptScheduled && !s.acceptDone && (
          <p className="muted small">The last step unlocks {Math.round(TIMELOCK_DELAY / 3600)} hours after the acceptance was scheduled. The game works meanwhile.</p>
        )}
      </section>

      <section className="launch-card">
        <h2>Addresses</h2>
        <table className="table">
          <tbody>
            {(["oracle", "adapter", "pricing", "nft", "timelock", "vault"] as const).map((k) =>
              s[k] ? (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="mono"><a href={`${EXPLORER}/address/${s[k]}`} target="_blank" rel="noreferrer">{s[k]}</a></td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
        <button className="btn small" disabled={!s.vault || !!busy} onClick={runVerify}>{busy === "verify" ? "Checking…" : "Check everything"}</button>
        {verify && (
          <div className={verify.ok ? "ok-box" : "warn"}>
            {verify.lines.map((l) => <p key={l.text}>{l.ok ? "✓" : "✗"} {l.text}</p>)}
          </div>
        )}
        {configSnippet && (
          <>
            <p className="small">Put the city on the site: replace <code>LIVE</code> in <code>web/lib/config.ts</code> with this (or send it to Claude), then push.</p>
            <pre className="code">{configSnippet}</pre>
          </>
        )}
      </section>

      <section className="launch-card">
        <h2>Start over</h2>
        <p className="muted small">Forget this browser&apos;s progress (contracts already deployed stay on chain).</p>
        <button className="btn small ghost" onClick={() => { if (confirm("Forget the launch progress in this browser?")) { setS({ inputs: { vice: "", ops: "", admin: address ?? "", start: 0, minOrderUsd: 20, maxOrderUsd: 150 } }); setCheck(null); setVerify(null); } }}>Reset</button>
      </section>
    </main>
  );
}
