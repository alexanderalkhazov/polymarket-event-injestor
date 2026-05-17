"use client"

import { useEffect, useState } from "react"
import { SectionLabel } from "@/components/ui/SectionLabel"
import { Skeleton } from "@/components/ui/Skeleton"
import { BacktestStats } from "@/components/strategy/BacktestStats"
import { SignalList } from "@/components/strategy/SignalList"
import { MacroGrid } from "@/components/strategy/MacroGrid"
import { SizingBreakdown } from "@/components/strategy/SizingBreakdown"
import { ConfirmFooter } from "@/components/strategy/ConfirmFooter"
import { showToast } from "@/components/ui/Toast"
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
  avg_return_pct: number | null
  max_drawdown_pct: number | null
  sample_size: number | null
  sharpe: number | null
  risk_note: string | null
  hold_days: number | null
  stop_loss_pct: number | null
  expected_return_pct: number | null
}

interface StrategyDetailProps {
  strategy: Strategy
  onClose: () => void
  onDismiss: () => void
  onExecuted: () => void
  onRestore: () => void
}

export function StrategyDetail({ strategy: s, onClose, onDismiss, onExecuted, onRestore }: StrategyDetailProps) {
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)

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

  const handleRestore = async () => {
    setRestoring(true)
    try {
      await fetch("/api/strategies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, status: "pending" }),
      })
      showToast("Strategy restored to pending")
      onRestore()
    } catch {
      showToast("Failed to restore")
    } finally {
      setRestoring(false)
    }
  }

  const isPending = s.status === "pending"
  const isDismissed = s.status === "dismissed"
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
        borderBottom: "1px solid var(--border)", padding: "14px 20px", flexShrink: 0,
        borderTop: `2px solid ${accentColor}`,
        display: "flex", alignItems: "flex-start", gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-dm-mono)", fontSize: 15, fontWeight: 700, marginBottom: 3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {(s.tickers ?? []).join(" / ")}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                background: s.action === "buy" ? "var(--green-bg)" : s.action === "sell" ? "var(--red-bg)" : "var(--amber-bg)",
                color: accentColor,
                borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 700,
              }}
            >
              {s.action?.toUpperCase()}
            </span>
            <span>{Math.round((s.confidence ?? 0) * 100)}% confidence</span>
            {isExecuted && <span style={{ color: "var(--green)", fontWeight: 600 }}>EXECUTED</span>}
            {isDismissed && <span style={{ color: "var(--dim)" }}>DISMISSED</span>}
          </div>
        </div>
        {/* close button */}
        <button
          onClick={onClose}
          title="Close"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--dim)", fontSize: 18, lineHeight: 1,
            padding: "2px 4px", borderRadius: 6,
            flexShrink: 0, marginTop: -2,
          }}
        >
          ✕
        </button>
      </div>

      {/* scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* thesis */}
        <div>
          <SectionLabel>Thesis</SectionLabel>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: 0, marginBottom: detail?.risk_note ? 10 : 0 }}>
            {s.thesis || s.summary}
          </p>
          {detail?.risk_note && (
            <div style={{
              marginTop: 10,
              background: "var(--amber-bg)", border: "1px solid rgba(217,119,6,0.22)",
              borderRadius: 8, padding: "8px 12px",
              fontSize: 12, color: "var(--amber)", lineHeight: 1.5,
            }}>
              ⚠ {detail.risk_note}
            </div>
          )}
        </div>

        {/* quick stats: hold days + stop + expected return */}
        {(s.hold_days || s.stop_loss_pct || s.expected_return_pct) && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            background: "var(--bg2)", borderRadius: 10,
            border: "1px solid var(--border)", overflow: "hidden",
          }}>
            {[
              {
                label: "HOLD",
                value: s.hold_days != null ? `${s.hold_days}d` : "—",
                color: "var(--text)",
              },
              {
                label: "STOP LOSS",
                value: s.stop_loss_pct != null ? `−${Math.round(s.stop_loss_pct * 100)}%` : "—",
                color: s.stop_loss_pct != null ? "var(--red)" : "var(--muted)",
              },
              {
                label: "EXP RET",
                value: s.expected_return_pct != null && s.expected_return_pct !== 0
                  ? `${s.expected_return_pct > 0 ? "+" : ""}${s.expected_return_pct}%`
                  : "—",
                color: s.expected_return_pct != null && s.expected_return_pct > 0
                  ? "var(--green)"
                  : s.expected_return_pct != null && s.expected_return_pct < 0
                    ? "var(--red)"
                    : "var(--muted)",
              },
            ].map((stat, i, arr) => (
              <div key={stat.label} style={{
                padding: "10px 14px",
                borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--dim)", marginBottom: 4 }}>
                  {stat.label}
                </div>
                <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 14, fontWeight: 700, color: stat.color }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* backtest stats */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={14} width={120} />
            <Skeleton height={60} />
          </div>
        ) : detail ? (
          <BacktestStats
            winRate={detail.win_rate}
            avgReturn={detail.avg_return_pct}
            sampleSize={detail.sample_size}
            maxDrawdown={detail.max_drawdown_pct}
            sharpe={detail.sharpe ?? null}
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

      {/* footer */}
      {isPending && (
        <ConfirmFooter
          strategyId={s.id}
          isPaper={true}
          expiresAt={s.expires_at}
          onDismiss={onDismiss}
          onExecuted={onExecuted}
        />
      )}

      {isDismissed && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "14px 20px", flexShrink: 0 }}>
          <button
            onClick={handleRestore}
            disabled={restoring}
            style={{
              width: "100%", background: "var(--bg2)",
              border: "1px solid var(--border2)", borderRadius: 8,
              padding: "10px", color: "var(--text)", cursor: "pointer",
              fontSize: 13, fontWeight: 600, opacity: restoring ? 0.5 : 1,
            }}
          >
            {restoring ? "Restoring…" : "↩ Restore to pending"}
          </button>
        </div>
      )}
    </div>
  )
}
