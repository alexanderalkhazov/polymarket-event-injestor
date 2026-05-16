"use client"

import { SourceChip } from "@/components/ui/Badge"
import { PipelineSteps } from "@/components/correlator/PipelineSteps"

interface Signal {
  id: string
  source: string
  type: string
  symbol: string
  score: number
  status: string
  pipeline_step: number
  created_at: string
}

interface SignalTableProps {
  signals: Signal[]
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

const STATUS_COLOR: Record<string, string> = {
  active: "var(--green)",
  dropped: "var(--red)",
  processed: "var(--muted)",
  processing: "var(--amber)",
}

export function SignalTable({ signals }: SignalTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Source", "Type", "Symbol", "Score", "Pipeline", "Status", "Time"].map((h) => (
              <th key={h} style={{
                padding: "6px 10px", textAlign: "left",
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                color: "var(--dim)", fontWeight: 500,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => {
            const dropped = s.status === "dropped"
            return (
              <tr key={s.id} style={{
                borderBottom: "1px solid var(--border)",
                opacity: dropped ? 0.45 : 1,
              }}>
                <td style={{ padding: "8px 10px" }}>
                  <SourceChip source={s.source} />
                </td>
                <td style={{ padding: "8px 10px", color: "var(--muted)" }}>
                  {(s.type ?? "").replace(/_/g, " ")}
                </td>
                <td style={{ padding: "8px 10px", fontFamily: "var(--font-dm-mono)", fontWeight: 600 }}>
                  {s.symbol}
                </td>
                <td style={{ padding: "8px 10px", fontFamily: "var(--font-dm-mono)", color: "var(--dim)" }}>
                  {Number(s.score ?? 0).toFixed(3)}
                </td>
                <td style={{ padding: "8px 10px", minWidth: 140 }}>
                  <PipelineSteps currentStep={s.pipeline_step ?? 0} status={dropped ? "failed" : "done"} />
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <span style={{
                    fontSize: 10, fontFamily: "var(--font-dm-mono)",
                    color: STATUS_COLOR[s.status] ?? "var(--muted)",
                  }}>
                    {s.status}
                  </span>
                </td>
                <td style={{ padding: "8px 10px", fontFamily: "var(--font-dm-mono)", fontSize: 10, color: "var(--dim)" }}>
                  {relTime(s.created_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {signals.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: "var(--muted)" }}>
          No signals yet. Waiting for data sources.
        </div>
      )}
    </div>
  )
}
