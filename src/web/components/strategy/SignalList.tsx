import { SectionLabel } from "@/components/ui/SectionLabel"
import { SourceChip } from "@/components/ui/Badge"

interface Signal {
  id: string
  source: string
  type: string
  symbol: string
  score: number
}

interface SignalListProps { signals: Signal[] }

export function SignalList({ signals }: SignalListProps) {
  if (!signals?.length) return null
  return (
    <div>
      <SectionLabel>Contributing signals</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {signals.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SourceChip source={s.source} />
            <span style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
              {(s.type ?? "").replace(/_/g, " ")} · {s.symbol}
            </span>
            <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)" }}>
              {Number(s.score ?? 0).toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
