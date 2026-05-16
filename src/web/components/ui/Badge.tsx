"use client"

const ACTION_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  buy:   { bg: "var(--green-bg)",  color: "var(--green)",  border: "var(--green)" },
  sell:  { bg: "var(--red-bg)",    color: "var(--red)",    border: "var(--red)" },
  watch: { bg: "var(--amber-bg)",  color: "var(--amber)",  border: "var(--amber)" },
}

const SOURCE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  polymarket: { bg: "var(--purple-bg)", color: "var(--purple)", border: "var(--purple)" },
  news:       { bg: "var(--blue-bg)",   color: "var(--blue)",   border: "var(--blue)" },
  analytics:  { bg: "var(--blue-bg)",   color: "var(--blue)",   border: "var(--blue)" },
}

const SOURCE_LABELS: Record<string, string> = {
  polymarket: "POLY",
  news: "NEWS",
  analytics: "ANA",
}

interface ActionBadgeProps { action: string }
export function ActionBadge({ action }: ActionBadgeProps) {
  const c = ACTION_COLORS[action.toLowerCase()] ?? ACTION_COLORS.watch
  return (
    <span style={{
      fontFamily: "var(--font-dm-mono)", fontSize: 10, padding: "2px 6px",
      borderRadius: 4, background: c.bg, color: c.color,
      border: `1px solid ${c.border}`, textTransform: "uppercase", letterSpacing: "0.06em",
    }}>
      {action.toUpperCase()}
    </span>
  )
}

interface SourceChipProps { source: string }
export function SourceChip({ source }: SourceChipProps) {
  const c = SOURCE_COLORS[source.toLowerCase()] ?? SOURCE_COLORS.analytics
  return (
    <span style={{
      fontFamily: "var(--font-dm-mono)", fontSize: 10, padding: "2px 6px",
      borderRadius: 4, background: c.bg, color: c.color,
      border: `1px solid ${c.border}`, letterSpacing: "0.06em",
    }}>
      {SOURCE_LABELS[source.toLowerCase()] ?? source.toUpperCase()}
    </span>
  )
}

interface StatusBadgeProps { status: string }
export function StatusBadge({ status }: StatusBadgeProps) {
  const colors: Record<string, string> = {
    escalated: "var(--green)", dropped: "var(--red)",
    watching: "var(--amber)", pending: "var(--amber)",
    executed: "var(--green)", dismissed: "var(--muted)",
  }
  const color = colors[status.toLowerCase()] ?? "var(--muted)"
  return (
    <span style={{
      fontFamily: "var(--font-dm-mono)", fontSize: 10, padding: "2px 6px",
      borderRadius: 4, color, border: `1px solid ${color}`,
      background: "transparent", letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      {status.toUpperCase()}
    </span>
  )
}
