"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { DISTRICTS, GAME, LIVE, TICKER, VOLTA_URL, VOTE_CITIES } from "../lib/config";
import { useCity } from "../lib/store";

export type GuideTab = "feed" | "build" | "mine" | "hall" | "rank" | "treasury" | "paper" | "sindaco";

interface Step {
  key: string;
  title: string;
  text: string;
  action?: { label: string; tab?: GuideTab; href?: string; connect?: boolean };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 ? 2 : 0 })}`;

/** "Your next move": one suggestion at a time, based on where the player is in the game. */
export default function Guide({ onTab }: { onTab: (t: GuideTab) => void }) {
  const city = useCity();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("vice.guide") ?? "[]") as string[];
    } catch {
      return [];
    }
  });

  const step = useMemo<Step | null>(() => {
    if (city.mode !== "testnet") return null; // the preview explains itself
    if (!isConnected || !address) {
      return {
        key: "connect",
        title: "Your next move: connect",
        text: `Connect your wallet on Elysium to open a hideout, earn and vote.`,
        action: { label: "Connect wallet", connect: true },
      };
    }
    const c = city.chain;
    if (!c || !city.me) return null; // still loading
    const mine = city.buildings.filter((b) => b.owner === city.me);
    const quote = c.quote;
    if (mine.length === 0) {
      if (quote && c.viceWei < quote.tokensWei) {
        return {
          key: "buy",
          title: `Your next move: get ${TICKER}`,
          text: `A hideout costs ${usd(quote.usd)} right now (about ${fmt(quote.tokens)} ${TICKER}). You hold ${fmt(city.viceBalance)}. Buy the rest on Volta, then come back.`,
          action: { label: `Buy ${TICKER} on Volta`, href: `${VOLTA_URL}/token/${LIVE.vice ?? c.vice}` },
        };
      }
      return {
        key: "build",
        title: "Your next move: open a hideout",
        text: `Pick a district (${DISTRICTS.map((d) => d.city).join(", ")}). Every hideout earns a share of every purchase the city makes.`,
        action: { label: "Move in", tab: "build" },
      };
    }
    const pending = mine.reduce((s, b) => s + b.pendingUsd, 0);
    if (pending >= 0.01) {
      return {
        key: `claim-${Math.floor(pending)}`,
        title: `Your next move: collect ${usd(pending)}`,
        text: "Your hideouts have earned tokens. Claiming sends them to your wallet and makes your hideouts taller.",
        action: { label: "Claim", tab: "mine" },
      };
    }
    const unvoted = mine.filter((b) => b.votedWeek !== city.week).length;
    if (unvoted > 0) {
      const vc = VOTE_CITIES().map((d) => d.city).join(" and ");
      return {
        key: `vote-${city.week}`,
        title: "Your next move: vote",
        text: `Each hideout has one vote a week: pick the token ${vc} earns next week. ${unvoted} of yours ${unvoted === 1 ? "hasn't" : "haven't"} voted yet.`,
        action: { label: "Vote", tab: "hall" },
      };
    }
    const lead = Math.max(...city.newBuilds);
    return {
      key: `grow-${city.week}`,
      title: "Your next move: take the turf",
      text: `The district with the most new ${GAME.buildings} this week wins the street pool${lead > 0 ? "" : " (nobody has built this week yet)"}. Friends can enter your hideout number #${mine[0].id} as their inviter when they move in.`,
      action: { label: "See the race", tab: "rank" },
    };
  }, [city, isConnected, address]);

  if (!step || dismissed.includes(step.key)) return null;
  const dismiss = () => {
    const next = [...dismissed, step.key];
    setDismissed(next);
    try {
      sessionStorage.setItem("vice.guide", JSON.stringify(next));
    } catch {
      /* fine */
    }
  };
  const a = step.action;
  return (
    <aside className="guide" role="note">
      <button className="close" onClick={dismiss} aria-label="Hide this tip">×</button>
      <div className="guide-title">{step.title}</div>
      <p>{step.text}</p>
      {a &&
        (a.href ? (
          <a className="btn primary small" href={a.href} target="_blank" rel="noreferrer">{a.label}</a>
        ) : (
          <button
            className="btn primary small"
            onClick={() => {
              if (a.connect && connectors[0]) connect({ connector: connectors[0] });
              if (a.tab) onTab(a.tab);
            }}
          >
            {a.label}
          </button>
        ))}
    </aside>
  );
}
