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
  const isDropped = s.status === "dismissed" || s.status === "expired"
  const isExecuted = s.status === "executed"

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg1)",
        border: `1px solid ${selected ? accentColor : "var(--border)"}`,
        borderTop: `2px solid ${accentColor}`,
        borderRadius: 10, padding: "14px", cursor: isDropped ? "default" : "pointer",
        opacity: isDropped ? 0.45 : 1,
        transition: "border-color 0.1s, background 0.1s",
        background: selected ? "var(--bg2)" : "var(--bg1)",
      } as React.CSSProperties}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <ActionBadge action={s.action} />
        <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600 }}>
          {(s.tickers ?? []).join(" / ")}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--muted)" }}>
          conf {Math.round((s.confidence ?? 0) * 100)}%
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
        {s.summary}
      </p>

      {!isExecuted && s.expected_return_pct != null && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          borderTop: "1px solid var(--border)", paddingTop: 8, gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>Exp. Return</div>
            <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: "var(--green)" }}>
              +{s.expected_return_pct}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>Win Rate</div>
            <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12 }}>
              {s.win_rate != null ? `${Math.round(s.win_rate * 100)}%` : "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>Stop</div>
            <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: "var(--red)" }}>
              {s.stop_loss_pct != null ? `−${Math.round(s.stop_loss_pct * 100)}%` : "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>Hold</div>
            <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: "var(--muted)" }}>
              {s.hold_days != null ? `${s.hold_days}d` : "—"}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        {(s.sources ?? ["polymarket", "news", "analytics"].slice(0, 1)).map((src: string) => (
          <SourceChip key={src} source={src} />
        ))}
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
          {relTime(s.created_at)}
        </span>
      </div>
    </div>
  )
}
