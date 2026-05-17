"use client"

import { ActionBadge, SourceChip } from "@/components/ui/Badge"
import type { Strategy } from "@/hooks/useStrategyStream"

interface StrategyCardProps {
  strategy: Strategy & {
    win_rate?: number | null
    max_drawdown_pct?: number | null
    sources?: string[]
  }
  selected: boolean
  onClick: () => void
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export function StrategyCard({ strategy: s, selected, onClick }: StrategyCardProps) {
  const accentColor =
    s.action === "buy" ? "var(--green)" : s.action === "sell" ? "var(--red)" : "var(--amber)"
  const accentBg =
    s.action === "buy" ? "var(--green-bg)" : s.action === "sell" ? "var(--red-bg)" : "var(--amber-bg)"
  const isDropped = s.status === "dismissed" || s.status === "expired"

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg1)",
        borderRadius: 14,
        boxShadow: selected
          ? `0 0 0 2px ${accentColor}, var(--shadow-card)`
          : "var(--shadow-card)",
        padding: "20px 22px",
        cursor: isDropped ? "default" : "pointer",
        opacity: isDropped ? 0.45 : 1,
        transition: "box-shadow 0.15s",
        borderLeft: `4px solid ${accentColor}`,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: accentBg,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 16, color: accentColor }}>
            {s.action === "buy" ? "↑" : s.action === "sell" ? "↓" : "◉"}
          </span>
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {(s.tickers ?? []).join(" / ")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
            {Math.round((s.confidence ?? 0) * 100)}% confidence · {relTime(s.created_at)}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <ActionBadge action={s.action} />
        </div>
      </div>

      {/* Summary */}
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
        {s.summary}
      </p>

      {/* Stats */}
      {s.expected_return_pct != null && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          background: "var(--bg2)",
          borderRadius: 10,
          overflow: "hidden",
          marginBottom: 14,
        }}>
          {[
            { label: "Exp. Return", value: `+${s.expected_return_pct}%`, color: "var(--green)" },
            { label: "Win Rate", value: s.win_rate != null ? `${Math.round(s.win_rate * 100)}%` : "—" },
            { label: "Stop Loss", value: s.stop_loss_pct != null ? `−${Math.round(s.stop_loss_pct * 100)}%` : "—", color: "var(--red)" },
            { label: "Hold", value: s.hold_days != null ? `${s.hold_days}d` : "—", color: "var(--muted)" },
          ].map((stat, i, arr) => (
            <div key={stat.label} style={{
              padding: "10px 14px",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--dim)", marginBottom: 4 }}>
                {stat.label}
              </div>
              <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 14, fontWeight: 700, color: stat.color ?? "var(--text)" }}>
                {stat.value}
              </div>
            </div>
          ))}
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
