interface PillProps { children: React.ReactNode; color?: string }

export function Pill({ children, color }: PillProps) {
  return (
    <span style={{
      fontFamily: "var(--font-dm-mono)", fontSize: 10, padding: "2px 7px",
      borderRadius: 4, border: `1px solid ${color ?? "var(--border2)"}`,
      color: color ?? "var(--muted)", letterSpacing: "0.05em",
    }}>
      {children}
    </span>
  )
}
