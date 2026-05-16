"use client"

import useSWR from "swr"
import { Topbar } from "@/components/layout/Topbar"
import { BacktestTable } from "@/components/backtests/BacktestTable"
import { Skeleton } from "@/components/ui/Skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function BacktestsPage() {
  const { data, isLoading } = useSWR("/api/backtests", fetcher, { refreshInterval: 60000 })

  const results = data?.results ?? []
  const passRate = results.length
    ? Math.round((results.filter((r: { drop_reason: string | null }) => !r.drop_reason).length / results.length) * 100)
    : 0

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Backtest Results" />

      <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: "Total", value: results.length },
            { label: "Passed", value: results.filter((r: { drop_reason: string | null }) => !r.drop_reason).length },
            { label: "Pass rate", value: `${passRate}%` },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
                {s.label}
              </div>
              <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 14, fontWeight: 600 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...Array(5)].map((_, i) => <Skeleton key={i} height={44} />)}
          </div>
        ) : (
          <BacktestTable results={results} />
        )}
      </div>
    </div>
  )
}
