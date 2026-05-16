"use client"

const STEPS = [
  "Fetch signal",
  "Time-window gate",
  "Backtest validate",
  "Embed signal",
  "Semantic search",
  "Macro snapshot",
  "Claude reasoning",
  "Fan-out to users",
]

type StepStatus = "done" | "running" | "failed" | "pending"

interface PipelineStepsProps {
  currentStep: number
  status: StepStatus
}

export function PipelineSteps({ currentStep, status }: PipelineStepsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 0" }}>
      {STEPS.map((label, i) => {
        let dotColor = "var(--border)"
        let textColor = "var(--dim)"
        if (i < currentStep) { dotColor = "var(--green)"; textColor = "var(--muted)" }
        if (i === currentStep) {
          dotColor = status === "failed" ? "var(--red)" : status === "running" ? "var(--amber)" : "var(--green)"
          textColor = "var(--text)"
        }

        return (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: textColor }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}
