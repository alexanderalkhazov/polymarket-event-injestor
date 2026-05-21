interface SectionLabelProps { children: React.ReactNode }

export function SectionLabel({ children }: SectionLabelProps) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 700, color: "var(--text)",
      letterSpacing: "-0.01em", marginBottom: 10,
    }}>
      {children}
    </div>
  )
}
