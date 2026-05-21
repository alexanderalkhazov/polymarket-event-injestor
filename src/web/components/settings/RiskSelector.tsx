"use client"

const RISK_OPTIONS = [
  {
    key: "conservative",
    label: "Conservative",
    sub: "1% per trade",
    desc: "Lower risk, smaller positions. Capital preservation priority.",
    color: "var(--blue)",
  },
  {
    key: "moderate",
    label: "Moderate",
    sub: "3% per trade",
    desc: "Balanced risk/reward. Standard allocation for most traders.",
    color: "var(--amber)",
  },
  {
    key: "aggressive",
    label: "Aggressive",
    sub: "6% per trade",
    desc: "Higher risk, larger positions. Requires strong conviction.",
    color: "var(--red)",
  },
]

interface RiskSelectorProps {
  value: string
  onChange: (v: string) => void
}

export function RiskSelector({ value, onChange }: RiskSelectorProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      {RISK_OPTIONS.map((opt) => {
        const selected = value === opt.key
        return (
          <div
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              border: `1px solid ${selected ? opt.color : "var(--border)"}`,
              borderTop: `2px solid ${opt.color}`,
              borderRadius: 10, padding: "14px 16px", cursor: "pointer",
              background: selected ? "var(--bg2)" : "var(--bg1)",
              transition: "all 0.1s",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{opt.label}</div>
            <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: opt.color, marginBottom: 8 }}>
              {opt.sub}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{opt.desc}</div>
          </div>
        )
      })}
    </div>
  )
}
