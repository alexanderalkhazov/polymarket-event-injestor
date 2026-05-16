"use client"

import { useState } from "react"
import useSWR from "swr"
import { showToast } from "@/components/ui/Toast"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Subscription {
  id: string
  symbol: string
  source: string
  threshold: number
}

export function SubscriptionManager() {
  const { data, mutate } = useSWR("/api/subscriptions", fetcher)
  const subs: Subscription[] = data?.subscriptions ?? []

  const [symbol, setSymbol] = useState("")
  const [source, setSource] = useState("news")
  const [adding, setAdding] = useState(false)

  const handleAdd = async () => {
    if (!symbol.trim()) return
    setAdding(true)
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: symbol.toUpperCase(), source }),
    })
    if (res.ok) {
      showToast(`Subscribed to ${symbol.toUpperCase()} on ${source}`)
      setSymbol("")
      mutate()
    } else {
      showToast("Failed to add subscription")
    }
    setAdding(false)
  }

  const handleRemove = async (id: string, sym: string) => {
    await fetch("/api/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    showToast(`Removed ${sym}`)
    mutate()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol, e.g. AAPL"
          style={{
            flex: 1, background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px", color: "var(--text)",
            fontFamily: "var(--font-dm-mono)", fontSize: 12, outline: "none",
          }}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          style={{
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 12px", color: "var(--text)",
            fontSize: 12, outline: "none",
          }}
        >
          <option value="news">News</option>
          <option value="analytics">Analytics</option>
          <option value="polymarket">Polymarket</option>
        </select>
        <button
          onClick={handleAdd}
          disabled={adding}
          style={{
            background: "var(--green)", border: "none", borderRadius: 8,
            padding: "8px 16px", color: "#000", cursor: "pointer", fontWeight: 600, fontSize: 13,
          }}
        >
          Add
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Symbol", "Source", "Threshold", ""].map((h, i) => (
              <th key={i} style={{
                padding: "5px 8px", textAlign: "left",
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em",
                color: "var(--dim)", fontWeight: 500,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subs.map((s) => (
            <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", fontWeight: 700 }}>{s.symbol}</td>
              <td style={{ padding: "8px", color: "var(--muted)" }}>{s.source}</td>
              <td style={{ padding: "8px", fontFamily: "var(--font-dm-mono)", color: "var(--dim)" }}>{s.threshold}</td>
              <td style={{ padding: "8px", textAlign: "right" }}>
                <button
                  onClick={() => handleRemove(s.id, s.symbol)}
                  style={{
                    background: "transparent", border: "1px solid var(--border)",
                    borderRadius: 4, padding: "3px 8px", cursor: "pointer",
                    fontSize: 11, color: "var(--red)",
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {subs.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: "20px 8px", textAlign: "center", color: "var(--muted)" }}>
                No subscriptions yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
