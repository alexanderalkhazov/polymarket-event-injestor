interface SectionLabelProps { children: React.ReactNode }

export function SectionLabel({ children }: SectionLabelProps) {
  return (
    <div style={{
      fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
      color: "var(--dim)", fontWeight: 600, marginBottom: 8,
    }}>
      {children}
    </div>
  )
}
