"use client"

import { ActionBadge, SourceChip } from "@/components/ui/Badge"
import type { Strategy } from "@/hooks/useStrategyStream"

interface StrategyCardProps {
  strategy: Strategy & { sources?: string[] }
  selected: boolean
  onClick: () => void
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)}h ago`
}

export function StrategyCard({ strategy: s, selected, onClick }: StrategyCardProps) {
  const accentColor =
    s.action === "buy" ? "var(--green)" : s.action === "sell" ? "var(--red)" : "var(--amber)"
  const accentBg =
    s.action === "buy" ? "var(--green-bg)" : s.action === "sell" ? "var(--red-bg)" : "var(--amber-bg)"
  const isDismissed = s.status === "dismissed"
  const isExpired = s.status === "expired"

  const winRate = s.win_rate ?? null
  const stopLoss = s.stop_loss_pct ?? null
  // prefer historical backtest avg, fall back to Claude's prediction
  const avgRet = s.avg_return_pct ?? s.expected_return_pct ?? null
  const hasAnyStat = winRate !== null || stopLoss !== null || avgRet !== null

  const wrPct = winRate !== null ? Math.round(winRate * 100) : null
  const wrColor =
    wrPct === null ? "var(--muted)" : wrPct >= 60 ? "var(--green)" : wrPct >= 45 ? "var(--amber)" : "var(--red)"

  const confidence = s.confidence ?? 0

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg1)",
        borderRadius: 16,
        boxShadow: selected
          ? `0 0 0 2px ${accentColor}, var(--shadow-card)`
          : "var(--shadow-card)",
        padding: "18px 20px",
        cursor: "pointer",
        opacity: isExpired ? 0.35 : isDismissed ? 0.55 : 1,
        transition: "box-shadow 0.15s",
        borderLeft: `4px solid ${accentColor}`,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        {/* Icon avatar */}
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: accentBg,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 17, color: accentColor }}>
            {s.action === "buy" ? "↑" : s.action === "sell" ? "↓" : "◉"}
          </span>
        </div>

        {/* Ticker + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-dm-mono)", fontSize: 17, fontWeight: 700,
            color: "var(--text)", lineHeight: 1.2,
          }}>
            {(s.tickers ?? []).join(" / ") || "—"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {Math.round(confidence * 100)}% confidence · {relTime(s.created_at)}
          </div>
        </div>

        {/* Right badges */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {isDismissed && (
            <span style={{
              fontSize: 10, color: "var(--dim)", fontWeight: 600,
              letterSpacing: "0.05em", textTransform: "uppercase",
            }}>
              dismissed
            </span>
          )}
          {isExpired && (
            <span style={{
              fontSize: 10, color: "var(--dim)", fontWeight: 600,
              letterSpacing: "0.05em", textTransform: "uppercase",
            }}>
              expired
            </span>
          )}
          <ActionBadge action={s.action} />
        </div>
      </div>

      {/* Summary */}
      <p style={{
        fontSize: 14, color: "var(--text)", lineHeight: 1.5,
        marginBottom: 14,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {s.summary}
      </p>

      {/* Stats row — only if at least one stat is non-null */}
      {hasAnyStat ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 0,
          background: "var(--bg2)",
          borderRadius: 10,
          overflow: "hidden",
          marginBottom: 14,
          border: "1px solid var(--border)",
        }}>
          {[
            {
              label: "WIN RATE",
              value: wrPct !== null ? `${wrPct}%` : "—",
              color: wrColor,
            },
            {
              label: "AVG RET",
              value: avgRet != null && avgRet !== 0
                ? `${avgRet > 0 ? "+" : ""}${Number(avgRet).toFixed(1)}%`
                : "—",
              color: avgRet != null && avgRet > 0
                ? "var(--green)"
                : avgRet != null && avgRet < 0
                  ? "var(--red)"
                  : "var(--muted)",
            },
            {
              label: "STOP",
              value: stopLoss !== null ? `−${Math.round(stopLoss * 100)}%` : "—",
              color: stopLoss !== null ? "var(--red)" : "var(--muted)",
            },
          ].map((stat, i, arr) => (
            <div key={stat.label} style={{
              padding: "10px 12px",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div style={{
                fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em",
                color: "var(--dim)", marginBottom: 4,
              }}>
                {stat.label}
              </div>
              <div style={{
                fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 700,
                color: stat.color,
              }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Confidence progress bar when no stats available */
        <div style={{ marginBottom: 14 }}>
          <div style={{
            height: 3, borderRadius: 2,
            background: "var(--bg3)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: `${Math.round(confidence * 100)}%`,
              background: accentColor,
              borderRadius: 2,
              transition: "width 0.4s ease",
            }} />
          </div>
        </div>
      )}

      {/* Sources */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {(s.sources ?? []).map((src: string) => (
          <SourceChip key={src} source={src} />
        ))}
      </div>
    </div>
  )
}
