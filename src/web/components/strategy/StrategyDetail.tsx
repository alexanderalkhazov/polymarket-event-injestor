"use client"

import { useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/Skeleton"
import { BacktestStats } from "@/components/strategy/BacktestStats"
import { SignalList } from "@/components/strategy/SignalList"
import { MacroGrid } from "@/components/strategy/MacroGrid"
import { OrderEntry } from "@/components/strategy/OrderEntry"
import { showToast } from "@/components/ui/Toast"
import type { Strategy } from "@/hooks/useStrategyStream"

interface Signal { id: string; source: string; type: string; symbol: string; score: number }
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
  sizing_pct: number | null
}

interface StrategyDetailProps {
  strategy: Strategy
  onClose: () => void
  onDismiss: () => void
  onExecuted: () => void
  onRestore: () => void
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "0 -20px" }} />
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "18px 20px" }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.1em", color: "var(--dim)", marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export function StrategyDetail({ strategy: s, onClose, onDismiss, onExecuted, onRestore }: StrategyDetailProps) {
  const [detail, setDetail]   = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    if (!s?.id) return
    setLoading(true)
    setDetail(null)
    fetch(`/api/strategies?id=${s.id}`)
      .then((r) => r.json())
      .then((data) => { if (data && !data.error) setDetail(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [s?.id])

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

  if (!s) return null

  const action      = s.action ?? "buy"
  const tickers     = s.tickers ?? []
  const confidence  = Math.round((s.confidence ?? 0) * 100)
  const isPending   = s.status === "pending"
  const isDismissed = s.status === "dismissed"
  const isExecuted  = s.status === "executed"

  const accentColor =
    action === "buy" ? "var(--green)" : action === "sell" ? "var(--red)" : "var(--amber)"
  const accentBg =
    action === "buy" ? "var(--green-bg)" : action === "sell" ? "var(--red-bg)" : "var(--amber-bg)"

  const holdDays = detail?.hold_days ?? s.hold_days ?? null
  const stopLoss = detail?.stop_loss_pct ?? s.stop_loss_pct ?? null
  const expRet   = detail?.expected_return_pct ?? s.expected_return_pct ?? null
  const thesis   = s.thesis ?? s.summary ?? ""

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--bg1)", borderLeft: "1px solid var(--border)",
    }}>
      {/* ─── Header ─── */}
      <div style={{
        padding: "16px 20px 0", flexShrink: 0,
        background: "var(--bg1)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          {/* Ticker */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--font-dm-mono)", fontSize: 20, fontWeight: 700,
              color: "var(--text)", letterSpacing: "-0.01em",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {tickers.join(" / ") || "—"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{
                background: accentBg, color: accentColor,
                borderRadius: 5, padding: "2px 8px",
                fontSize: 11, fontWeight: 700,
                fontFamily: "var(--font-dm-mono)", letterSpacing: "0.06em",
              }}>
                {action.toUpperCase()}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {confidence}% confidence
              </span>
              {isExecuted && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "var(--green)",
                  letterSpacing: "0.06em",
                }}>
                  ✓ EXECUTED
                </span>
              )}
              {isDismissed && (
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--dim)", letterSpacing: "0.06em" }}>
                  DISMISSED
                </span>
              )}
            </div>
          </div>
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              background: "var(--bg3)", border: "none", borderRadius: 8,
              width: 30, height: 30, cursor: "pointer",
              color: "var(--muted)", fontSize: 14, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "background 0.1s",
            }}
          >
            ✕
          </button>
        </div>

        {/* Confidence bar */}
        <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${confidence}%`,
            background: `linear-gradient(90deg, ${accentColor}bb, ${accentColor})`,
            borderRadius: 2, transition: "width 0.6s ease",
          }} />
        </div>
      </div>

      {/* ─── Scrollable Body ─── */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* Quick stats: hold / stop / expected return */}
        {(holdDays != null || stopLoss != null || expRet != null) && (
          <>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
              background: "var(--bg2)", margin: "0",
              borderBottom: "1px solid var(--border)",
            }}>
              {[
                {
                  label: "HOLD",
                  value: holdDays != null ? `${holdDays}d` : "—",
                  color: "var(--text)",
                },
                {
                  label: "STOP LOSS",
                  value: stopLoss != null ? `−${Math.round(stopLoss * 100)}%` : "—",
                  color: stopLoss != null ? "var(--red)" : "var(--dim)",
                },
                {
                  label: "EXP RET",
                  value: expRet != null ? `${expRet > 0 ? "+" : ""}${Number(expRet).toFixed(1)}%` : "—",
                  color: expRet != null && expRet > 0 ? "var(--green)"
                       : expRet != null && expRet < 0 ? "var(--red)"
                       : "var(--dim)",
                },
              ].map((stat, i, arr) => (
                <div key={stat.label} style={{
                  padding: "12px 16px",
                  borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{
                    fontSize: 9, textTransform: "uppercase",
                    letterSpacing: "0.09em", color: "var(--dim)", marginBottom: 4, fontWeight: 600,
                  }}>
                    {stat.label}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-dm-mono)", fontSize: 16,
                    fontWeight: 700, color: stat.color,
                  }}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Thesis */}
        <Section title="Thesis">
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, margin: 0 }}>
            {thesis}
          </p>
          {detail?.risk_note && (
            <div style={{
              marginTop: 12,
              display: "flex", gap: 10, alignItems: "flex-start",
              background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.2)",
              borderRadius: 10, padding: "10px 14px",
            }}>
              <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>⚠</span>
              <span style={{ fontSize: 12, color: "var(--amber)", lineHeight: 1.55 }}>
                {detail.risk_note}
              </span>
            </div>
          )}
        </Section>

        <Divider />

        {/* Backtest stats */}
        <Section title="Backtest results">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton height={14} width={200} />
              <Skeleton height={64} />
            </div>
          ) : detail ? (
            <BacktestStats
              winRate={detail.win_rate}
              avgReturn={detail.avg_return_pct}
              sampleSize={detail.sample_size}
              maxDrawdown={detail.max_drawdown_pct}
              sharpe={detail.sharpe}
            />
          ) : (
            <span style={{ fontSize: 12, color: "var(--dim)" }}>No backtest data available.</span>
          )}
        </Section>

        {/* Signal sources — conditional */}
        {!loading && (detail?.signals?.length ?? 0) > 0 && (
          <>
            <Divider />
            <Section title="Contributing signals">
              <SignalList signals={detail!.signals} />
            </Section>
          </>
        )}
        {loading && (
          <>
            <Divider />
            <Section title="Contributing signals">
              <Skeleton height={28} />
              <div style={{ marginTop: 6 }}><Skeleton height={28} /></div>
            </Section>
          </>
        )}

        {/* Macro context — conditional */}
        {!loading && (detail?.macro?.length ?? 0) > 0 && (
          <>
            <Divider />
            <Section title="Macro context">
              <MacroGrid macro={detail!.macro} />
            </Section>
          </>
        )}

        <div style={{ height: 20 }} />
      </div>

      {/* ─── Footer ─── */}
      {isPending && (
        <OrderEntry
          strategy={s}
          detail={detail}
          onDismiss={onDismiss}
          onExecuted={onExecuted}
        />
      )}

      {isDismissed && (
        <div style={{
          borderTop: "1px solid var(--border)", padding: "14px 20px",
          flexShrink: 0, background: "var(--bg1)",
        }}>
          <button
            onClick={handleRestore}
            disabled={restoring}
            style={{
              width: "100%", background: "var(--bg2)",
              border: "1px solid var(--border2)", borderRadius: 10,
              padding: "11px", color: "var(--text)", cursor: restoring ? "not-allowed" : "pointer",
              fontSize: 13, fontWeight: 600, opacity: restoring ? 0.5 : 1,
              transition: "opacity 0.1s",
            }}
          >
            {restoring ? "Restoring…" : "↩ Restore to pending"}
          </button>
        </div>
      )}
    </div>
  )
}
