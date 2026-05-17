import { LiveDot } from "@/components/ui/LiveDot"
import { Pill } from "@/components/ui/Pill"

interface TopbarProps {
  title: string
  subtitle?: string
  live?: boolean
  paperMode?: boolean
  right?: React.ReactNode
}

export function Topbar({ title, subtitle, live, paperMode, right }: TopbarProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "0 28px", height: 62, flexShrink: 0,
      background: "var(--bg1)",
      borderBottom: "1px solid var(--border)",
    }}>
      {live && <LiveDot />}
      <div>
        <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em", color: "var(--text)" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 1 }}>{subtitle}</div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {paperMode !== undefined && (
        <Pill color={paperMode ? "var(--green)" : "var(--amber)"}>
          {paperMode ? "PAPER MODE" : "LIVE MODE"}
        </Pill>
      )}
      {right}
    </div>
  )
}
