"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect } from "wagmi";
import { GAME } from "../lib/config";

// Phone browsers (Safari, Chrome) have no wallet inside, so "Connect wallet" can't connect there.
// Instead we offer to reopen this exact page inside a wallet app's own browser.

const listeners = new Set<(open: boolean) => void>();
function setSheet(open: boolean) {
  listeners.forEach((l) => l(open));
}

/** Is a browser wallet (extension or wallet-app browser) present on this page? */
export function hasWallet() {
  return typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
}

/** Connect with the browser wallet, or explain how to get one when there is none. */
export function useConnectWallet() {
  const { connect, connectors, isPending } = useConnect();
  const go = () => {
    if (!hasWallet() || !connectors[0]) return setSheet(true);
    connect({ connector: connectors[0] });
  };
  return { connectWallet: go, isPending };
}

const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export default function WalletSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    listeners.add(setOpen);
    return () => void listeners.delete(setOpen);
  }, []);
  if (!open) return null;
  const href = window.location.href;
  const bare = href.replace(/^https?:\/\//, "");
  const phone = isPhone();
  const apps = [
    { name: "MetaMask", url: `https://metamask.app.link/dapp/${bare}` },
    { name: "Coinbase Wallet", url: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(href)}` },
    { name: "Trust Wallet", url: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(href)}` },
  ];
  // Rendered on <body> so it sits above every card on the map.
  return createPortal(
    <div className="lab-dialog" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="lab-panel preview-notice">
        <div className="sheet-head">
          <h2>{phone ? "Open in your wallet" : "No wallet found"}</h2>
          <button className="close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="sheet-body">
          {phone ? (
            <>
              <p>
                Phone browsers can&apos;t talk to a wallet. Open {GAME.name} inside your wallet app&apos;s browser and connect
                there:
              </p>
              {apps.map((a) => (
                <a key={a.name} className="btn primary wide" href={a.url}>
                  Open in {a.name}
                </a>
              ))}
              <p className="muted small">
                Other wallets (Rabby, OKX…): open the app, go to its browser tab and type <b>{window.location.host}</b>.
              </p>
            </>
          ) : (
            <>
              <p>
                Install a browser wallet such as <a href="https://rabby.io" target="_blank" rel="noreferrer">Rabby</a> or{" "}
                <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a>, add the Elysium network, then reload
                this page.
              </p>
              <button className="btn primary wide" onClick={() => setOpen(false)}>OK</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
