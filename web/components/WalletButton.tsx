"use client";

import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import WalletSheet, { useConnectWallet } from "./WalletSheet";
import { useCity } from "../lib/store";
import { GAME, TICKER } from "../lib/config";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectWallet, isPending } = useConnectWallet();
  const { disconnect } = useDisconnect();
  const city = useCity();
  const [notice, setNotice] = useState(false);

  if (isConnected && address) {
    return (
      <button className="btn wallet on" onClick={() => disconnect()} title="Disconnect">
        ● {short(address)}
        {/* The token balance once the city has read this wallet. */}
        {city.mode === "testnet" && city.me === address.toLowerCase() && (
          <span className="wallet-bal">
            {city.viceBalance.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })} {TICKER}
          </span>
        )}
      </button>
    );
  }
  const doConnect = () => {
    setNotice(false);
    connectWallet();
  };
  return (
    <>
      <button
        className="btn wallet"
        disabled={isPending}
        // Before launch the site runs on sample data: explain that instead of connecting.
        onClick={() => (city.mode === "preview" ? setNotice(true) : doConnect())}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      <WalletSheet />
      {notice && (
        <div
          className="lab-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Preview mode"
          onClick={(e) => e.target === e.currentTarget && setNotice(false)}
        >
          <div className="lab-panel preview-notice">
            <div className="sheet-head">
              <h2>Preview mode</h2>
              <button className="close" onClick={() => setNotice(false)} aria-label="Close">×</button>
            </div>
            <div className="sheet-body">
              <p>
                {GAME.name} has not launched yet. You are looking at a <b>preview</b>: the hideouts, the purchases and
                the rewards on the map are sample data.
              </p>
              <p>
                Building, voting and claiming open when <b>{TICKER}</b> launches on <b>Volta</b>, on the Elysium
                chain. Until then there is nothing to connect a wallet to.
              </p>
              <button className="btn primary wide" onClick={() => setNotice(false)}>Explore the preview</button>
              <button className="link-btn" onClick={doConnect}>Connect anyway</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
