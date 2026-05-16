"use client"

import { SourceChip } from "@/components/ui/Badge"

interface SourceStatus {
  source: string
  last_seen: string | null
  count_24h: number
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / 1440)}d ago`
}

export function SourceHealth({ sources }: { sources: SourceStatus[] }) {
  return (
    <div style={{
      display: "flex", gap: 12, padding: "10px 0",
      borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap",
    }}>
      {sources.map((s) => {
        const stale = s.last_seen
          ? Date.now() - new Date(s.last_seen).getTime() > 30 * 60 * 1000
          : true

        return (
          <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: stale ? "var(--red)" : "var(--green)",
              flexShrink: 0,
            }} />
            <SourceChip source={s.source} />
            <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
              {s.last_seen ? relTime(s.last_seen) : "—"} · {s.count_24h} today
            </span>
          </div>
        )
      })}
    </div>
  )
}
