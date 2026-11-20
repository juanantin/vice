"use client";

import { useEffect, useState } from "react";
import { DISTRICTS, GAME, TOKENS } from "../lib/config";
import { ago, startFeed, useFeed, type Post } from "../lib/feed";
import { ink } from "../lib/theme";

function Avatar({ p }: { p: Post }) {
  const D = p.city === null ? null : DISTRICTS[p.city];
  const label = D ? D.city.split(" ").map((w) => w[0]).join("").slice(0, 2).padEnd(2, D.city[1]).toUpperCase() : "TV";
  return (
    <span className="avatar" style={{ ["--c" as string]: D ? ink(D) : "var(--mint)" }}>
      {label}
    </span>
  );
}

export function PostCard({ p, now }: { p: Post; now: number }) {
  return (
    <div className={`post ${p.kind}`} style={p.token !== undefined ? { ["--t" as string]: ink(TOKENS[p.token]) } : undefined}>
      <Avatar p={p} />
      <div className="post-body">
        <div className="post-head">
          <b>{p.handle}</b>
          <span>{ago(p.at, now)}</span>
        </div>
        <p>{p.text}</p>
        {p.kind === "score" && p.token !== undefined && <span className="post-tag">SCORE · {TOKENS[p.token].token}</span>}
      </div>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The floating live feed on wide screens. */
export function FeedPanel() {
  const posts = useFeed();
  const now = useNow();
  useEffect(() => startFeed(), []);
  return (
    <aside className="feed-panel" aria-label={`${GAME.name} Live`}>
      <div className="feed-title">
        <span className="live-dot" /> {GAME.name.toUpperCase()} LIVE
      </div>
      {posts.slice(0, 4).map((p) => (
        <PostCard key={p.id} p={p} now={now} />
      ))}
    </aside>
  );
}

/** The full feed, as a tab (used on phones). */
export function FeedTab() {
  const posts = useFeed();
  const now = useNow();
  useEffect(() => startFeed(), []);
  return (
    <div className="tab feed-list">
      {posts.map((p) => (
        <PostCard key={p.id} p={p} now={now} />
      ))}
    </div>
  );
}
