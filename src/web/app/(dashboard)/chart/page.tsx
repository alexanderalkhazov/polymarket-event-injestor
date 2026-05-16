"use client"

import { useState } from "react"
import useSWR from "swr"
import { Topbar } from "@/components/layout/Topbar"
import { PriceChart } from "@/components/chart/PriceChart"
import { IndicatorPanel } from "@/components/chart/IndicatorPanel"
import { TickerDetail } from "@/components/chart/TickerDetail"
import { Skeleton } from "@/components/ui/Skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const DEFAULT_TICKERS = ["AAPL", "TSLA", "NVDA", "AMZN", "SPY"]

export default function ChartPage() {
  const [ticker, setTicker] = useState("AAPL")

  const { data, isLoading } = useSWR(`/api/history/${ticker}`, fetcher, { refreshInterval: 60000 })

  const ohlcv = data?.ohlcv ?? []
  const technicals = data?.technicals ?? []
  const signals = data?.signals ?? []
  const opportunities = data?.opportunities ?? []

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Price Chart" />

      {/* ticker selector */}
      <div style={{
        display: "flex", gap: 8, padding: "10px 16px",
        borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap",
      }}>
        {DEFAULT_TICKERS.map((t) => (
          <button
            key={t}
            onClick={() => setTicker(t)}
            style={{
              fontFamily: "var(--font-dm-mono)", fontSize: 12,
              padding: "4px 12px", borderRadius: 6, cursor: "pointer",
              background: ticker === t ? "var(--bg3)" : "transparent",
              border: ticker === t ? "1px solid var(--border)" : "1px solid transparent",
              color: ticker === t ? "var(--text)" : "var(--muted)",
              fontWeight: ticker === t ? 600 : 400,
            }}
          >
            {t}
          </button>
        ))}
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Custom…"
          style={{
            fontFamily: "var(--font-dm-mono)", fontSize: 12,
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 10px", color: "var(--text)",
            width: 90, outline: "none",
          }}
        />
      </div>

      {/* main content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {/* chart + indicators */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
          {isLoading ? (
            <>
              <Skeleton height={300} />
              <Skeleton height={80} />
              <Skeleton height={80} />
            </>
          ) : (
            <>
              <PriceChart data={ohlcv} />
              <IndicatorPanel data={technicals} />
            </>
          )}
        </div>

        {/* right panel */}
        <div style={{
          width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)",
          overflowY: "auto", padding: "16px",
        }}>
          {isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Skeleton height={24} width={80} />
              <Skeleton height={36} />
              <Skeleton height={36} />
              <Skeleton height={36} />
            </div>
          ) : (
            <TickerDetail ticker={ticker} signals={signals} opportunities={opportunities} />
          )}
        </div>
      </div>
    </div>
  )
}
