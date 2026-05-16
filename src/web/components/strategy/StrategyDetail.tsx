"use client"

import { useEffect, useState } from "react"
import { SectionLabel } from "@/components/ui/SectionLabel"
import { Skeleton } from "@/components/ui/Skeleton"
import { BacktestStats } from "@/components/strategy/BacktestStats"
import { SignalList } from "@/components/strategy/SignalList"
import { MacroGrid } from "@/components/strategy/MacroGrid"
import { SizingBreakdown } from "@/components/strategy/SizingBreakdown"
import { ConfirmFooter } from "@/components/strategy/ConfirmFooter"
import type { Strategy } from "@/hooks/useStrategyStream"

interface Signal {
  id: string
  source: string
  type: string
  symbol: string
  score: number
}

interface MacroRow { series_id: string; value: number }

interface DetailData {
  signals: Signal[]
  macro: MacroRow[]
  win_rate: number | null
  avg_return: number | null
  sample_size: number | null
  max_drawdown: number | null
}

interface StrategyDetailProps {
  strategy: Strategy
  onDismiss: () => void
  onExecuted: () => void
}

export function StrategyDetail({ strategy: s, onDismiss, onExecuted }: StrategyDetailProps) {
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    fetch(`/api/strategies?id=${s.id}`)
      .then((r) => r.json())
      .then((data) => {
        setDetail(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [s.id])

  const isPending = s.status === "pending"
  const isExecuted = s.status === "executed"
  const accentColor =
    s.action === "buy" ? "var(--green)" : s.action === "sell" ? "var(--red)" : "var(--amber)"

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--bg1)", borderLeft: "1px solid var(--border)",
    }}>
      {/* header */}
      <div style={{
        borderBottom: "1px solid var(--border)", padding: "16px 20px", flexShrink: 0,
        borderTop: `2px solid ${accentColor}`,
      }}>
        <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
          {(s.tickers ?? []).join(" / ")}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {s.action.toUpperCase()} · {Math.round((s.confidence ?? 0) * 100)}% confidence
          {isExecuted && (
            <span style={{ marginLeft: 8, color: "var(--green)", fontWeight: 600 }}>· EXECUTED</span>
          )}
        </div>
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* thesis */}
        <div>
          <SectionLabel>Thesis</SectionLabel>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
            {s.thesis || s.summary}
          </p>
        </div>

        {/* backtest stats */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={14} width={120} />
            <Skeleton height={60} />
          </div>
        ) : detail ? (
          <BacktestStats
            winRate={detail.win_rate}
            avgReturn={detail.avg_return}
            sampleSize={detail.sample_size}
            maxDrawdown={detail.max_drawdown}
          />
        ) : null}

        {/* signal list */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton height={14} width={140} />
            <Skeleton height={32} />
            <Skeleton height={32} />
          </div>
        ) : detail?.signals?.length ? (
          <SignalList signals={detail.signals} />
        ) : null}

        {/* sizing breakdown — only for pending */}
        {isPending && (
          <SizingBreakdown
            accountEquity={100000}
            riskLevel="moderate"
            expectedReturnPct={s.expected_return_pct}
            stopLossPct={s.stop_loss_pct}
            ticker={(s.tickers ?? [])[0] ?? ""}
          />
        )}

        {/* macro grid */}
        {detail?.macro?.length ? <MacroGrid macro={detail.macro} /> : null}
      </div>

      {/* confirm footer — only for pending */}
      {isPending && (
        <ConfirmFooter
          strategyId={s.id}
          isPaper={true}
          expiresAt={s.expires_at}
          onDismiss={onDismiss}
          onExecuted={onExecuted}
        />
      )}
    </div>
  )
}
