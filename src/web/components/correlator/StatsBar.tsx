"use client"

interface StatItem { label: string; value: string | number }

export function StatsBar({ stats }: { stats: StatItem[] }) {
  return (
    <div style={{
      display: "flex", gap: 24, padding: "10px 0",
      borderBottom: "1px solid var(--border)", flexShrink: 0,
    }}>
      {stats.map((s) => (
        <div key={s.label}>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
            {s.label}
          </div>
          <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 13, fontWeight: 600 }}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  )
}
