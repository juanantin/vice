"use client";

import { useEffect, useRef, useState } from "react";
import { CityScene } from "../lib/scene";
import { DISTRICTS, GAME, TOKENS, cityToken, levelForUsd } from "../lib/config";
import { DISTRICT_PLACES, LAND_LABELS, MAP_ATTRIBUTION, PLACES, SEA_LABELS } from "../lib/plots";
import { getCity, onCityEvent, useCity } from "../lib/store";
import { applyArtTheme } from "../lib/art";
import { ink, useTheme } from "../lib/theme";

const fmtTokens = (n: number) =>
  n.toLocaleString("en-US", { notation: n >= 100_000 ? "compact" : "standard", maximumFractionDigits: n >= 100 ? 0 : 2 });

export default function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const banners = useRef<(HTMLDivElement | null)[]>([]);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [toast, setToast] = useState<{ key: number; token: number; tokens: number; buildings: number } | null>(null);
  const city = useCity();
  const theme = useTheme();
  // Camera kept across theme switches (the map is redrawn in the other palette).
  const camera = useRef<{ x: number; y: number; s: number } | null>(null);

  const placeBanners = () => {
    const sc = sceneRef.current;
    if (!sc) return;
    const keys = [...DISTRICT_PLACES, "mayor"] as const;
    keys.forEach((k, i) => {
      const el = banners.current[i];
      if (!el) return;
      const [x, y] = sc.worldToScreen(PLACES[k]);
      // just above each landmark
      const lift = { brickell: 150, downtown: 310, wynwood: 200, miamibeach: 230, mayor: 240 }[k];
      const s = Math.max(0.55, Math.min(1.15, sc.scale * 2.2));
      // Brickell sits right under Downtown: its banner goes to the west, beside the towers.
      const dx = k === "brickell" ? -260 : k === "mayor" ? 70 : 0;
      el.style.transform = `translate(${x + dx * sc.scale}px, ${y - lift * sc.scale}px) translate(-50%, -100%) scale(${s})`;
    });
    // Water and neighbourhood names.
    [...SEA_LABELS, ...LAND_LABELS].forEach(([, p], i) => {
      const el = labels.current[i];
      if (!el) return;
      const [x, y] = sc.worldToScreen(p);
      const s = Math.max(0.6, Math.min(1.3, sc.scale * 2.6));
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
    });
  };

  useEffect(() => {
    applyArtTheme(theme);
    setReady(false);
    const scene = new CityScene({ onSelect: setSelected, onCamera: placeBanners });
    sceneRef.current = scene;
    let alive = true;
    scene.init(host.current!).then(() => {
      if (!alive) return;
      scene.sync(getCity().buildings, false);
      if (camera.current) scene.setCamera(camera.current);
      placeBanners();
      setReady(true);
    });
    const off = onCityEvent((e) => {
      if (e.type === "invited") scene.burstAt(e.building.id);
      if (e.type === "bought") {
        const cur = getCity().currentToken;
        const cities = DISTRICTS.filter((d) => cityToken(d, cur) === e.token).map((d) => d.id);
        scene.celebrate(parseInt(ink(TOKENS[e.token]).slice(1), 16), cities);
        setToast({ key: Date.now(), token: e.token, tokens: e.tokens, buildings: e.buildings });
      }
      if (e.type === "focus") {
        scene.flyTo(e.id);
        scene.select(e.id);
        setSelected(e.id);
      }
    });
    const onResize = () => placeBanners();
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      camera.current = scene.getCamera();
      off();
      window.removeEventListener("resize", onResize);
      scene.destroy();
      sceneRef.current = null;
    };
  }, [theme]);

  const shownMode = useRef(city.mode);
  useEffect(() => {
    if (!ready) return;
    const sc = sceneRef.current;
    if (!sc) return;
    if (shownMode.current !== city.mode) {
      shownMode.current = city.mode;
      sc.reset();
      setSelected(null);
      sc.sync(city.buildings, false);
      return;
    }
    sc.sync(city.buildings, true);
  }, [city.buildings, city.mode, ready]);

  // The city winning this week's street race (most new buildings; none on a tie).
  const top = Math.max(0, ...city.newBuilds);
  const leader = top > 0 && city.newBuilds.filter((n) => n === top).length === 1 ? city.newBuilds.indexOf(top) : -1;
  const sel = selected ? city.buildings[selected - 1] : null;
  const d = sel ? DISTRICTS[sel.district] : null;

  return (
    <div className="map">
      <div ref={host} className="map-canvas" />
      <div className="map-overlay">
        {SEA_LABELS.map(([name], i) => (
          <span key={name} ref={(el) => { labels.current[i] = el; }} className="sea-label">{name}</span>
        ))}
        {LAND_LABELS.map(([name], i) => (
          <span key={name} ref={(el) => { labels.current[SEA_LABELS.length + i] = el; }} className="land-label">{name}</span>
        ))}
        {DISTRICTS.map((D, i) => (
          <div key={D.city} ref={(el) => { banners.current[i] = el; }} className="banner" style={{ ["--c" as string]: ink(D), ["--cd" as string]: D.dark }}>
            {leader === D.id && <span className="this-week">TURF LEADER</span>}
            <span className="banner-token">{D.city.toUpperCase()}</span>
            <span className="banner-crew">{D.crew}</span>
            <span className="banner-city">{city.districtCount[D.id]?.toLocaleString() ?? 0} {GAME.buildings}</span>
            {/* The token this district earns; Wynwood's is picked by the weekly vote. */}
            <span className="banner-tokens" aria-label={`Earns ${TOKENS[cityToken(D, city.currentToken)].token}`}>
              {D.earns === "vote" && <em>vote</em>}
              <i className="on" style={{ ["--t" as string]: ink(TOKENS[cityToken(D, city.currentToken)]) }}>
                {TOKENS[cityToken(D, city.currentToken)].token}
              </i>
            </span>
          </div>
        ))}
        <div ref={(el) => { banners.current[DISTRICTS.length] = el; }} className="banner mayor-banner">
          <span className="banner-token">THE MAYOR</span>
          <span className="banner-city">#0</span>
        </div>
      </div>
      {!ready && <div className="map-loading">Lighting up Miami…</div>}
      <div className="map-credit">{MAP_ATTRIBUTION}</div>
      {toast && (
        <div key={toast.key} className="buy-toast" style={{ ["--c" as string]: ink(TOKENS[toast.token]) }} onAnimationEnd={() => setToast(null)}>
          <span className="kicker">The score</span>
          <b>
            {Math.round(toast.tokens).toLocaleString()} {TOKENS[toast.token].token}
          </b>
          <span className="kicker">
            split {toast.buildings.toLocaleString()} ways in{" "}
            {DISTRICTS.filter((d) => cityToken(d, city.currentToken) === toast.token).map((d) => d.city).join(" and ")}
          </span>
        </div>
      )}
      {sel && d && (
        <div className="building-card" style={{ ["--c" as string]: ink(d) }}>
          <button className="close" onClick={() => { setSelected(null); sceneRef.current?.select(null); }} aria-label="Close">×</button>
          <div className="bc-title">Hideout #{sel.id}</div>
          <div className="bc-sub">{d.crew} · {d.city} · {d.styles[sel.style]}</div>
          <div className="bc-earns">
            Earns {TOKENS[cityToken(d, city.currentToken)].token}
            {d.earns === "vote" ? " this week (picked by the vote)" : ""}
          </div>
          <div className="bc-grid">
            <span>Level</span><b>L{levelForUsd(sel.claimedUsd)}</b>
            <span>Claimed</span><b>${sel.claimedUsd.toFixed(2)}</b>
            <span>Pending</span><b>${sel.pendingUsd.toFixed(2)}</b>
            {TOKENS.map((t) => (
              <span key={`l${t.id}`} className="bc-token" style={{ ["--c" as string]: ink(t) }}>
                <i className="dot" /> {t.token}
              </span>
            )).flatMap((label, i) => [label, <b key={`v${i}`}>{fmtTokens(sel.pendingTokens?.[i] ?? 0)}</b>])}
            <span>Invites</span><b>{sel.invites}{sel.invites >= 2 ? " " : ""}</b>
            <span>Plot</span><b>{d.city} #{sel.plot + 1}</b>
            <span>Owner</span><b>{sel.owner === city.me ? "You" : sel.owner.length > 20 ? `${sel.owner.slice(0, 6)}…${sel.owner.slice(-4)}` : sel.owner}</b>
          </div>
        </div>
      )}
    </div>
  );
}
