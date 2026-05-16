"use client"

import useSWR from "swr"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function AccountSummary() {
  const { data } = useSWR("/api/trades?type=account", fetcher, { refreshInterval: 30000 })

  const equity = data?.equity ?? 0
  const cash = data?.cash ?? 0
  const pl = data?.unrealized_pl ?? 0
  const plPct = equity > 0 ? (pl / (equity - pl)) * 100 : 0

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
      gap: 20, padding: "14px 20px",
      borderBottom: "1px solid var(--border)", flexShrink: 0,
    }}>
      <div>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
          Portfolio value
        </div>
        <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 20, fontWeight: 700 }}>
          ${fmt(equity)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
          Cash
        </div>
        <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 16 }}>
          ${fmt(cash)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
          Unrealized P/L
        </div>
        <div style={{
          fontFamily: "var(--font-dm-mono)", fontSize: 16,
          color: pl >= 0 ? "var(--green)" : "var(--red)",
        }}>
          {pl >= 0 ? "+" : ""}${fmt(pl)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
          Return
        </div>
        <div style={{
          fontFamily: "var(--font-dm-mono)", fontSize: 16,
          color: plPct >= 0 ? "var(--green)" : "var(--red)",
        }}>
          {plPct >= 0 ? "+" : ""}{plPct.toFixed(2)}%
        </div>
      </div>
    </div>
  )
}
