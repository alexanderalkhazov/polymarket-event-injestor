import { SourceChip } from "@/components/ui/Badge"

interface Signal { id: string; source: string; type: string; symbol: string; score: number }

const TYPE_LABEL: Record<string, string> = {
  volume_spike: "Volume spike",
  momentum: "Momentum",
  rsi_extreme: "RSI extreme",
  options_unusual: "Options unusual",
  conviction_shift: "Conviction shift",
  hotness: "News hotness",
}

export function SignalList({ signals }: { signals: Signal[] }) {
  if (!signals?.length) return null
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {signals.map((sig) => {
        const score = Number(sig.score ?? 0)
        const scorePct = Math.min(score * 100, 100)
        return (
          <div key={sig.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 9, padding: "9px 12px",
          }}>
            <SourceChip source={sig.source} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
                {TYPE_LABEL[sig.type] ?? sig.type?.replace(/_/g, " ") ?? "Signal"}
              </div>
              <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "var(--font-dm-mono)" }}>
                {sig.symbol}
              </div>
            </div>
            {/* Score bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <div style={{ width: 48, height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${scorePct}%`,
                  background: scorePct >= 70 ? "var(--green)" : scorePct >= 45 ? "var(--amber)" : "var(--red)",
                  borderRadius: 2,
                }} />
              </div>
              <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)", width: 36, textAlign: "right" }}>
                {score.toFixed(3)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
