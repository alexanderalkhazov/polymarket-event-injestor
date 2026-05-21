"use client"

import { useEffect, useState } from "react"
import { OrderEntry } from "@/components/strategy/OrderEntry"
import { showToast } from "@/components/ui/Toast"
import type { Strategy } from "@/hooks/useStrategyStream"

interface DetailData {
  signals: unknown[]
  macro: unknown[]
  win_rate: number | null
  avg_return_pct: number | null
  max_drawdown_pct: number | null
  sample_size: number | null
  sharpe: number | null
  risk_note: string | null
  hold_days: number | null
  stop_loss_pct: number | null
  expected_return_pct: number | null
  sizing_pct: number | null
}

interface StrategyDetailProps {
  strategy: Strategy
  assetNames?: Record<string, string>
  onClose: () => void
  onDismiss: () => void
  onExecuted: () => void
  onRestore: () => void
}

function Stat({
  label, value, color, hint, tooltip,
}: {
  label: string
  value: string
  color?: string
  hint?: string
  tooltip?: string
}) {
  return (
    <div
      title={tooltip}
      style={{ display: "flex", flexDirection: "column", gap: 2, cursor: tooltip ? "help" : undefined }}
    >
      <div style={{
        fontSize: 9, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.1em", color: "var(--dim)",
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {label}
        {tooltip && (
          <span style={{ fontSize: 9, color: "var(--dim)", opacity: 0.6 }}>?</span>
        )}
      </div>
      <div style={{
        fontFamily: "var(--font-dm-mono)", fontSize: 15, fontWeight: 700,
        color: color ?? "var(--text)",
      }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: "var(--dim)", lineHeight: 1.3, marginTop: 1 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function StrategyDetail({ strategy: s, assetNames = {}, onClose, onDismiss, onExecuted, onRestore }: StrategyDetailProps) {
  const [detail, setDetail]   = useState<DetailData | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!s?.id) return
    setDetail(null)
    fetch(`/api/strategies?id=${s.id}`)
      .then((r) => r.json())
      .then((data) => { if (data && !data.error) setDetail(data) })
      .catch(() => {})
  }, [s?.id])

  if (!s) return null

  const action      = s.action ?? "buy"
  const tickers     = s.tickers ?? []
  const confidence  = Math.round((s.confidence ?? 0) * 100)
  const isPending   = s.status === "pending"
  const isDismissed = s.status === "dismissed"
  const isExecuted  = s.status === "executed"

  const accentColor = action === "buy" ? "var(--green)" : action === "sell" ? "var(--red)" : "var(--amber)"
  const accentBg    = action === "buy" ? "var(--green-bg)" : action === "sell" ? "var(--red-bg)" : "var(--amber-bg)"

  const winRate  = detail?.win_rate  ?? null
  const sample   = detail?.sample_size ?? null
  const avgRet   = detail?.avg_return_pct ?? s.expected_return_pct ?? null
  const sharpe   = detail?.sharpe ?? null
  const holdDays = detail?.hold_days ?? s.hold_days ?? null
  const riskNote = detail?.risk_note ?? null
  const thesis   = s.thesis ?? s.summary ?? ""

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

  return (
    <div style={{
      background: "var(--bg1)",
      borderRadius: 18,
      border: "1px solid var(--border)",
      boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.3)",
      overflow: "hidden",
    }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{
        padding: "16px 20px 12px",
        background: "var(--bg2)",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {/* Primary ticker + name + action badge */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Ticker row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
              <span style={{
                fontFamily: "var(--font-dm-mono)", fontSize: 22, fontWeight: 700,
                color: "var(--text)", letterSpacing: "-0.02em", flexShrink: 0,
              }}>
                {tickers[0] || "—"}
              </span>
              <span style={{
                background: accentBg, color: accentColor,
                borderRadius: 6, padding: "3px 9px",
                fontSize: 11, fontWeight: 700,
                fontFamily: "var(--font-dm-mono)", letterSpacing: "0.07em",
                flexShrink: 0,
              }}>
                {action.toUpperCase()}
              </span>
              {isExecuted && (
                <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700 }}>✓ EXECUTED</span>
              )}
              {isDismissed && (
                <span style={{ fontSize: 11, color: "var(--dim)", fontWeight: 600 }}>DISMISSED</span>
              )}
            </div>
            {/* Full name */}
            {(() => {
              const name = assetNames[tickers[0]]
              return name && name !== tickers[0] ? (
                <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400, marginBottom: tickers.length > 1 ? 4 : 0 }}>
                  {name}
                </div>
              ) : null
            })()}
            {/* Related tickers */}
            {tickers.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "var(--dim)" }}>signal from</span>
                {tickers.slice(1).map((t) => (
                  <span key={t} style={{
                    fontFamily: "var(--font-dm-mono)", fontSize: 10,
                    color: "var(--dim)", background: "var(--bg0)",
                    border: "1px solid var(--border)", borderRadius: 4,
                    padding: "1px 5px",
                  }}>
                    {t}{assetNames[t] && assetNames[t] !== t ? ` · ${assetNames[t]}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Confidence + close */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div
              title="How strongly the AI model rates this setup. Above 80% is high conviction."
              style={{ textAlign: "right", cursor: "help" }}
            >
              <div style={{ fontSize: 9, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                AI Confidence
              </div>
              <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 16, fontWeight: 700, color: accentColor }}>
                {confidence}%
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "var(--bg3)", border: "1px solid var(--border)",
                borderRadius: 8, width: 30, height: 30,
                cursor: "pointer", color: "var(--muted)", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.1s",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Confidence bar */}
        <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${confidence}%`,
            background: `linear-gradient(90deg, ${accentColor}99, ${accentColor})`,
            borderRadius: 2,
          }} />
        </div>
      </div>

      {/* ── Thesis ──────────────────────────────────────────────── */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--dim)", marginBottom: 6 }}>
          AI Thesis
        </div>
        <p style={{
          fontSize: 13, color: "var(--muted)", lineHeight: 1.65, margin: 0,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {thesis || "No thesis available."}
        </p>
        {riskNote && (
          <div style={{
            marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start",
            background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.2)",
            borderRadius: 8, padding: "8px 12px",
          }}>
            <span style={{ flexShrink: 0, fontSize: 12, marginTop: 1 }}>⚠</span>
            <span style={{ fontSize: 12, color: "var(--amber)", lineHeight: 1.5 }}>
              <strong>Risk: </strong>{riskNote}
            </span>
          </div>
        )}
      </div>

      {/* ── Stats row — only render cells that have data ─────────── */}
      {(() => {
        const cells: { label: string; value: string; color?: string; hint: string; tooltip: string }[] = []

        if (winRate != null) cells.push({
          label: "Win Rate",
          value: `${(winRate * 100).toFixed(1)}%`,
          color: winRate >= 0.5 ? "var(--green)" : "var(--red)",
          hint: winRate >= 0.5 ? "Positive edge" : "Below 50%",
          tooltip: "% of similar historical setups that were profitable. Above 50% is positive edge.",
        })
        if (sample != null) cells.push({
          label: "Sample",
          value: `${sample}`,
          color: sample < 10 ? "var(--amber)" : undefined,
          hint: sample < 10 ? "Low confidence" : sample < 30 ? "Moderate" : "Sufficient",
          tooltip: "Number of similar past setups found. Under 10 = low statistical confidence.",
        })
        if (avgRet != null) cells.push({
          label: "Exp Return",
          value: `${avgRet > 0 ? "+" : ""}${Number(avgRet).toFixed(1)}%`,
          color: avgRet > 0 ? "var(--green)" : "var(--red)",
          hint: "Avg across past setups",
          tooltip: "Average % gain/loss across all similar past setups. Past performance varies.",
        })
        if (holdDays != null) cells.push({
          label: "Hold",
          value: `${holdDays}d`,
          hint: "Optimal hold period",
          tooltip: "Recommended holding period in trading days.",
        })
        if (sharpe != null) cells.push({
          label: "Sharpe",
          value: Number(sharpe).toFixed(2),
          color: sharpe > 1 ? "var(--green)" : sharpe < 0 ? "var(--red)" : undefined,
          hint: sharpe > 1 ? "Good risk-adj." : sharpe < 0 ? "Negative" : "Moderate",
          tooltip: "Risk-adjusted return (return ÷ volatility). Above 1.0 is good; above 2.0 is excellent.",
        })

        if (cells.length === 0) return null

        return (
          <div style={{
            display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
            background: "var(--bg0)", borderBottom: "1px solid var(--border)",
            padding: "12px 20px", gap: 0,
          }}>
            {cells.map((c) => (
              <Stat key={c.label} {...c} />
            ))}
          </div>
        )
      })()}

      {/* ── Order entry or status footer ────────────────────────── */}
      {isPending && (
        <OrderEntry
          strategy={s}
          detail={detail}
          onDismiss={onDismiss}
          onExecuted={onExecuted}
        />
      )}

      {isDismissed && (
        <div style={{ padding: "14px 20px" }}>
          <button
            onClick={handleRestore}
            disabled={restoring}
            style={{
              width: "100%", background: "var(--bg2)",
              border: "1px solid var(--border2)", borderRadius: 10,
              padding: "11px", color: "var(--text)",
              cursor: restoring ? "not-allowed" : "pointer",
              fontSize: 13, fontWeight: 600,
              opacity: restoring ? 0.5 : 1,
            }}
          >
            {restoring ? "Restoring…" : "↩ Restore to pending"}
          </button>
        </div>
      )}

      {isExecuted && (
        <div style={{ padding: "14px 20px", textAlign: "center" }}>
          <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>
            ✓ Order was submitted via Alpaca
          </span>
        </div>
      )}
    </div>
  )
}
