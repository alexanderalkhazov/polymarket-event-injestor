"use client"

import { SectionLabel } from "@/components/ui/SectionLabel"
import { SourceChip } from "@/components/ui/Badge"

interface SignalRow {
  id: string
  source: string
  type: string
  score: number
  created_at: string
}

interface OpportunityRow {
  id: string
  action: string
  confidence: number
  expected_return_pct: number | null
  created_at: string
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export function TickerDetail({
  ticker,
  signals,
  opportunities,
}: {
  ticker: string
  signals: SignalRow[]
  opportunities: OpportunityRow[]
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 16, fontWeight: 700 }}>{ticker}</div>

      {opportunities.length > 0 && (
        <div>
          <SectionLabel>Recent opportunities</SectionLabel>
          {opportunities.slice(0, 5).map((o) => (
            <div key={o.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 0", borderBottom: "1px solid var(--border)",
            }}>
              <span style={{
                fontFamily: "var(--font-dm-mono)", fontSize: 10, padding: "2px 6px",
                borderRadius: 4,
                background: o.action === "buy" ? "rgba(0,200,100,0.1)" : "rgba(255,60,80,0.1)",
                color: o.action === "buy" ? "var(--green)" : "var(--red)",
                textTransform: "uppercase",
              }}>
                {o.action}
              </span>
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--muted)", flex: 1 }}>
                {Math.round(o.confidence * 100)}% conf
                {o.expected_return_pct != null && ` · +${o.expected_return_pct}%`}
              </span>
              <span style={{ fontSize: 10, color: "var(--dim)", fontFamily: "var(--font-dm-mono)" }}>
                {relTime(o.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {signals.length > 0 && (
        <div>
          <SectionLabel>Recent signals</SectionLabel>
          {signals.slice(0, 8).map((s) => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 0", borderBottom: "1px solid var(--border)",
            }}>
              <SourceChip source={s.source} />
              <span style={{ fontSize: 11, color: "var(--muted)", flex: 1 }}>
                {(s.type ?? "").replace(/_/g, " ")}
              </span>
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
                {Number(s.score ?? 0).toFixed(3)}
              </span>
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
                {relTime(s.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
