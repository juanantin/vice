// The city's social feed. Every real city event (a buy, a new hideout, a level
// up, an invite) becomes a post, like a phone feed in the city. Purely cosmetic.

import { useSyncExternalStore } from "react";
import { DISTRICTS, GAME, LIVE, TICKER, TOKENS, VOTE_CITIES, cityToken } from "./config";

const VOTE_NAMES = () => VOTE_CITIES().map((d) => d.city).join(" and ");
import { getCity, onCityEvent, type CityEvent } from "./store";

export interface Post {
  id: number;
  at: number;
  handle: string;
  /** City colour for the avatar ring, or null for the news account. */
  city: number | null;
  kind: "score" | "build" | "level" | "invite" | "news";
  text: string;
  /** Token colour for score posts. */
  token?: number;
}

const NEWS = GAME.news;
let posts: Post[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let started = false;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function push(p: Omit<Post, "id" | "at">, at = Date.now()) {
  posts = [{ ...p, id: nextId++, at }, ...posts].slice(0, 40);
  listeners.forEach((l) => l());
}

export function postFromEvent(e: CityEvent): Omit<Post, "id" | "at"> | null {
  const cur = getCity().currentToken;
  switch (e.type) {
    case "bought": {
      const cities = DISTRICTS.filter((d) => cityToken(d, cur) === e.token);
      const lead = cities[0];
      return {
        handle: lead?.handle ?? NEWS,
        city: lead?.id ?? null,
        kind: "score",
        token: e.token,
        text: `Just pulled a ${fmt(e.tokens)} ${TOKENS[e.token].token} score. ${e.buildings === 1 ? "All for 1 hideout" : `Split ${fmt(e.buildings)} ways`}${
          cities.length > 1 ? ` with ${cities.slice(1).map((d) => d.crew).join(" and ")}` : ""
        }.`,
      };
    }
    case "built": {
      const d = DISTRICTS[e.building.district];
      return { handle: d.handle, city: d.id, kind: "build", text: `New face in ${d.city}. Hideout #${fmt(e.building.id)} just opened its doors.` };
    }
    case "levelUp": {
      const d = DISTRICTS[e.building.district];
      return { handle: NEWS, city: null, kind: "level", text: `Hideout #${fmt(e.building.id)} in ${d.city} just added a floor. Rep level ${e.from + 1}.` };
    }
    case "voted": {
      const d = e.district === null ? null : DISTRICTS[e.district];
      return {
        handle: d?.handle ?? NEWS,
        city: d?.id ?? null,
        kind: "news",
        text: `${e.count === 1 ? "A hideout" : `${fmt(e.count)} hideouts`}${d ? ` in ${d.city}` : ""} just voted ${TOKENS[e.token].token} for ${VOTE_NAMES()}'s next job.`,
      };
    }
    case "taxIn":
      return { handle: NEWS, city: null, kind: "news", text: `The vault just collected ${fmt(e.amount)} VOLTA of city tax from ${TICKER} trading.` };
    case "weekClosed":
      return {
        handle: NEWS,
        city: null,
        kind: "news",
        text: `Week closed. ${VOTE_NAMES()} now runs on ${TOKENS[e.token].token}.${e.winners.length ? ` Turf race: ${e.winners.map((w) => DISTRICTS[w].city).join(" & ")} took the street pool.` : ""}`,
      };
    case "invited": {
      const d = DISTRICTS[e.building.district];
      return { handle: d.handle, city: d.id, kind: "invite", text: `#${fmt(e.building.id)} keeps bringing friends to ${d.city}. Fireworks tonight.` };
    }
    default:
      return null;
  }
}

/** Starts listening to city events (once) and seeds a few posts so the feed is never empty. */
export function startFeed() {
  if (started) return;
  started = true;
  const now = Date.now();
  // The real city only shows real events; the sample posts are for the preview.
  const seed: Omit<Post, "id" | "at">[] = LIVE.vault
    ? [{ handle: NEWS, city: null, kind: "news", text: "Miami is open. Pick a district, open a hideout, take the turf." }]
    : [
    { handle: NEWS, city: null, kind: "news", text: "Turf war update: Brickell leads the week on new recruits. Wynwood two behind." },
    { handle: DISTRICTS[3].handle, city: 3, kind: "score", token: 2, text: "Just pulled a 114,210 VOID score on Ocean Drive. Split 224 ways." },
    { handle: DISTRICTS[2].handle, city: 2, kind: "news", text: "Wynwood paints with whatever the city votes for. Get your vote in before Sunday." },
    { handle: DISTRICTS[1].handle, city: 1, kind: "score", token: 0, text: "Downtown keeps it simple: straight VOLTA, no swaps, no questions." },
  ];
  seed.forEach((p, i) => push(p, now - (i + 1) * 7 * 60_000));
  onCityEvent((e) => {
    if (e.type === "history") {
      // The real city's recent history replaces the welcome post.
      if (e.events.length) {
        posts = [];
        for (const h of e.events) {
          const p = postFromEvent(h.event);
          if (p) push(p, h.at);
        }
      }
      return;
    }
    const p = postFromEvent(e);
    if (p) push(p);
  });
}

export function useFeed(): Post[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => posts,
    () => posts,
  );
}

export function ago(at: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
