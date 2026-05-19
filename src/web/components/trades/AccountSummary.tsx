"use client"

import useSWR from "swr"
import Link from "next/link"
import type { LiveAccount } from "@/hooks/useTradesStream"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: "var(--bg1)", borderRadius: 14,
      boxShadow: "var(--shadow-card)", padding: "22px 24px",
    }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 26, fontWeight: 700, color: color ?? "var(--text)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  )
}

interface AccountSummaryProps {
  /** Live data from SSE stream. When provided, SWR polling is skipped. */
  liveAccount?: LiveAccount | null
  liveConnected?: boolean
}

export function AccountSummary({ liveAccount, liveConnected }: AccountSummaryProps) {
  // Only poll when SSE is not providing data
  const { data: swrData, isLoading } = useSWR(
    liveAccount == null ? "/api/trades?type=account" : null,
    fetcher,
    { refreshInterval: 30000 },
  )

  const data = liveAccount != null
    ? {
        connected: liveConnected ?? true,
        is_paper: true,
        equity: liveAccount.equity,
        cash: liveAccount.cash,
        buying_power: liveAccount.buying_power,
        unrealized_pl: liveAccount.unrealized_pl,
        last_equity: liveAccount.last_equity,
      }
    : swrData

  const loading = liveAccount == null && isLoading

  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, padding: "20px 28px 0", flexShrink: 0 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ background: "var(--bg1)", borderRadius: 14, boxShadow: "var(--shadow-card)", padding: "22px 24px" }}>
            <div className="skeleton" style={{ height: 11, width: 70, marginBottom: 14 }} />
            <div className="skeleton" style={{ height: 30, width: 120 }} />
          </div>
        ))}
      </div>
    )
  }

  if (!data || data.connected === false) {
    return (
      <div style={{ padding: "20px 28px 0", flexShrink: 0 }}>
        <div style={{
          background: "var(--bg1)", borderRadius: 14, boxShadow: "var(--shadow-card)",
          padding: "20px 24px", display: "flex", alignItems: "center", gap: 16,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: "var(--amber-bg)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
          }}>
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Alpaca not connected</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>
              Connect your Alpaca API keys in Settings to view portfolio data and execute trades.
            </div>
          </div>
          <Link href="/settings" style={{ marginLeft: "auto", flexShrink: 0 }}>
            <button style={{
              background: "var(--primary)", border: "none", borderRadius: 9,
              padding: "10px 20px", color: "#fff", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
            }}>
              Connect Alpaca
            </button>
          </Link>
        </div>
      </div>
    )
  }

  const equity      = data.equity ?? 0
  const cash        = data.cash ?? 0
  const buyingPower = data.buying_power ?? 0
  const pl          = data.unrealized_pl ?? 0
  // Daily return: how much the account moved since yesterday's close
  const lastEquity  = data.last_equity ?? equity
  const dailyPl     = equity - lastEquity
  const dailyPct    = lastEquity > 0 ? (dailyPl / lastEquity) * 100 : 0

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, padding: "20px 28px 0", flexShrink: 0 }}>
      <StatCard label="Portfolio Value" value={`$${fmt(equity)}`} />
      <StatCard label="Cash" value={`$${fmt(cash)}`} />
      <StatCard label="Buying Power" value={`$${fmt(buyingPower)}`} />
      <StatCard
        label="Unrealized P/L"
        value={`${pl >= 0 ? "+" : "−"}$${fmt(Math.abs(pl))}`}
        sub={pl !== 0 ? "open positions" : "no open positions"}
        color={pl !== 0 ? (pl >= 0 ? "var(--green)" : "var(--red)") : undefined}
      />
      <StatCard
        label="Today's Return"
        value={`${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(2)}%`}
        sub={`${dailyPl >= 0 ? "+" : "−"}$${fmt(Math.abs(dailyPl))} vs yesterday`}
        color={dailyPl >= 0 ? "var(--green)" : "var(--red)"}
      />
    </div>
  )
}
