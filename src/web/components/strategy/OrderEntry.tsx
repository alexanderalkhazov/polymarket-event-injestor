"use client"

import { useCountdown } from "@/hooks/useCountdown"
import type { Strategy } from "@/hooks/useStrategyStream"

interface DetailData {
  sizing_pct?: number | null
  stop_loss_pct?: number | null
  expected_return_pct?: number | null
}

interface OrderEntryProps {
  strategy: Strategy
  detail: DetailData | null
  onDismiss: () => void
  onExecuted: () => void
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.1em", color: "var(--dim)", marginBottom: 4,
    }}>
      {children}
    </div>
  )
}

function Mono({ children, color, size }: { children: React.ReactNode; color?: string; size?: number }) {
  return (
    <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: size ?? 13, fontWeight: 600, color: color ?? "var(--text)" }}>
      {children}
    </span>
  )
}

export function OrderEntry({ strategy: s, detail, onDismiss }: OrderEntryProps) {
  const timeLeft   = useCountdown(s.expires_at)
  const ticker     = (s.tickers ?? [])[0] ?? "—"
  const action     = s.action ?? "buy"
  const isBuy      = action !== "sell"
  const slPct      = detail?.stop_loss_pct ?? null
  const tpPct      = detail?.expected_return_pct ?? null
  const sizingPct  = s.sizing_pct ?? detail?.sizing_pct ?? 0.03

  const handleDismiss = async () => {
    try {
      await fetch("/api/strategies", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, status: "dismissed" }),
      })
    } catch { /* best-effort */ }
    onDismiss()
  }

  return (
    <div style={{ padding: "14px 20px", background: "var(--bg1)" }}>
      {/* Status banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "rgba(5,150,105,0.08)",
        border: "1px solid rgba(5,150,105,0.2)",
        borderRadius: 10, padding: "9px 14px", marginBottom: 14,
      }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>
            Fully automated — system is managing this trade
          </div>
          <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>
            Entry, exit, and position sizing are handled automatically. No action required.
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 14, flexWrap: "wrap",
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          color: isBuy ? "var(--green)" : "var(--red)",
          background: isBuy ? "var(--green-bg)" : "var(--red-bg)",
          border: `1px solid ${isBuy ? "rgba(5,150,105,0.25)" : "rgba(220,38,38,0.25)"}`,
          borderRadius: 8, padding: "3px 10px",
        }}>
          {isBuy ? "▲ LONG" : "▼ SHORT"}
        </span>
        <Mono size={14}>{ticker}</Mono>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "var(--dim)" }}>Expires</span>
          <Mono color="var(--amber)" size={11}>{timeLeft}</Mono>
        </div>
      </div>

      {/* Exit plan */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        background: "var(--bg0)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden", marginBottom: 14,
      }}>
        {[
          {
            label: "Size",
            value: `${(sizingPct * 100).toFixed(1)}%`,
            hint: "of equity",
            color: "var(--text)" as string,
          },
          {
            label: "Stop Loss",
            value: slPct != null ? `${(slPct * 100).toFixed(1)}%` : "—",
            hint: "auto exit at loss",
            color: "var(--red)" as string,
          },
          {
            label: "Take Profit",
            value: tpPct != null ? `+${(tpPct * 100).toFixed(1)}%` : "—",
            hint: "auto exit at gain",
            color: "var(--green)" as string,
          },
        ].map(({ label, value, hint, color }, i, arr) => (
          <div
            key={label}
            style={{
              padding: "8px 10px",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <Label>{label}</Label>
            <Mono size={13} color={value === "—" ? "var(--dim)" : color}>{value}</Mono>
            <div style={{ fontSize: 9, color: "var(--dim)", marginTop: 2 }}>{hint}</div>
          </div>
        ))}
      </div>

      {/* Dismiss */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleDismiss}
          style={{
            background: "var(--bg2)",
            border: "1px solid var(--border2)", borderRadius: 10,
            padding: "8px 20px", color: "var(--muted)",
            cursor: "pointer", fontSize: 13, fontWeight: 500,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
