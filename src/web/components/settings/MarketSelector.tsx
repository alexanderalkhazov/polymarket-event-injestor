"use client"

const MARKETS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "GOOGL", "SPY",
  "QQQ", "AMD", "INTC", "NFLX", "BABA", "COIN", "PLTR", "SOFI",
]

interface MarketSelectorProps {
  selected: string[]
  onChange: (v: string[]) => void
}

export function MarketSelector({ selected, onChange }: MarketSelectorProps) {
  const toggle = (ticker: string) => {
    if (selected.includes(ticker)) {
      onChange(selected.filter((t) => t !== ticker))
    } else {
      onChange([...selected, ticker])
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {MARKETS.map((t) => {
        const active = selected.includes(t)
        return (
          <button
            key={t}
            onClick={() => toggle(t)}
            style={{
              fontFamily: "var(--font-dm-mono)", fontSize: 12, fontWeight: active ? 600 : 400,
              padding: "6px 14px", borderRadius: 20, cursor: "pointer",
              background: active ? "var(--bg3)" : "transparent",
              border: `1px solid ${active ? "var(--text)" : "var(--border)"}`,
              color: active ? "var(--text)" : "var(--muted)",
              transition: "all 0.1s",
            }}
          >
            {t}
          </button>
        )
      })}
    </div>
  )
}
