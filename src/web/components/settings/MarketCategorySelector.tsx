"use client"

import { useState, useEffect } from "react"

const CATEGORIES = [
  { id: "oil_energy",  label: "Oil & Energy",  symbols: "USO, XOM, XLE, LNG" },
  { id: "us_equities", label: "US Equities",   symbols: "SPY, QQQ, AAPL, MSFT, NVDA" },
  { id: "crypto",      label: "Crypto",         symbols: "BTC-USD, ETH-USD, SOL-USD" },
  { id: "rates_macro", label: "Rates & Macro",  symbols: "TLT, GLD, SLV" },
  { id: "commodities", label: "Commodities",    symbols: "GLD, SLV, UNG, WEAT" },
  { id: "fx",          label: "FX",             symbols: "Coming soon" },
] as const

interface Props {
  initialCategories?: string[]
  onChange?: (categories: string[]) => void
}

export function MarketCategorySelector({ initialCategories = [], onChange }: Props) {
  const [active, setActive] = useState<Set<string>>(new Set(initialCategories))
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    setActive(new Set(initialCategories))
  }, [initialCategories])

  const toggle = async (id: string) => {
    if (id === "fx") return // placeholder
    setLoading(id)
    const isActive = active.has(id)
    try {
      if (isActive) {
        await fetch(`/api/categories?category=${id}`, { method: "DELETE" })
      } else {
        await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: id }),
        })
      }
      const next = new Set(active)
      if (isActive) next.delete(id)
      else next.add(id)
      setActive(next)
      onChange?.(Array.from(next))
    } catch {
      // ignore
    } finally {
      setLoading(null)
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
      {CATEGORIES.map((cat) => {
        const isActive = active.has(cat.id)
        const isLoading = loading === cat.id
        const isDisabled = cat.id === "fx"
        return (
          <button
            key={cat.id}
            onClick={() => toggle(cat.id)}
            disabled={isDisabled || isLoading}
            style={{
              border: `1px solid ${isActive ? "var(--green)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "14px 16px",
              textAlign: "left",
              cursor: isDisabled ? "not-allowed" : "pointer",
              background: isActive ? "rgba(0,200,100,0.06)" : "var(--bg1)",
              opacity: isDisabled ? 0.4 : 1,
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: isActive ? "var(--green)" : "var(--border)",
                transition: "background 0.15s",
              }} />
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)" }}>
                {cat.label}
              </span>
              {isLoading && (
                <span style={{ fontSize: 11, color: "var(--dim)", marginLeft: "auto" }}>
                  saving…
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--dim)", fontFamily: "var(--font-mono)" }}>
              {cat.symbols}
            </div>
          </button>
        )
      })}
    </div>
  )
}
