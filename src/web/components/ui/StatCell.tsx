interface StatCellProps {
  label: string
  value: string | number | null | undefined
  color?: string
  large?: boolean
}

export function StatCell({ label, value, color, large }: StatCellProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)", fontWeight: 600 }}>
        {label}
      </span>
      <span style={{
        fontFamily: "var(--font-dm-mono)",
        fontSize: large ? 16 : 12,
        fontWeight: large ? 600 : 400,
        color: color ?? "var(--text)",
      }}>
        {value ?? "—"}
      </span>
    </div>
  )
}
