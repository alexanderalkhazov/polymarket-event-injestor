import { LiveDot } from "@/components/ui/LiveDot"
import { Pill } from "@/components/ui/Pill"

interface TopbarProps {
  title: string
  live?: boolean
  paperMode?: boolean
  right?: React.ReactNode
}

export function Topbar({ title, live, paperMode, right }: TopbarProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "14px 20px",
      borderBottom: "1px solid var(--border)", height: 52, flexShrink: 0,
    }}>
      {live && <LiveDot />}
      <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
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
