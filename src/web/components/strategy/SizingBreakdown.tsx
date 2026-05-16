"use client"

import { SectionLabel } from "@/components/ui/SectionLabel"

interface SizingBreakdownProps {
  accountEquity: number
  riskLevel: string
  expectedReturnPct: number | null
  stopLossPct: number | null
  ticker: string
  currentPrice?: number | null
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function SizingBreakdown({
  accountEquity,
  riskLevel,
  expectedReturnPct,
  stopLossPct,
  ticker,
  currentPrice,
}: SizingBreakdownProps) {
  const RISK_PCT: Record<string, number> = { conservative: 0.01, moderate: 0.03, aggressive: 0.06 }
  const riskPct = RISK_PCT[riskLevel] ?? 0.03
  const riskDollars = accountEquity * riskPct
  const stopFrac = stopLossPct != null ? stopLossPct / 100 : null
  const shares = stopFrac && currentPrice ? Math.floor(riskDollars / (currentPrice * stopFrac)) : null
  const positionSize = shares && currentPrice ? shares * currentPrice : null
  const tp = currentPrice && expectedReturnPct != null ? currentPrice * (1 + expectedReturnPct / 100) : null
  const sl = currentPrice && stopLossPct != null ? currentPrice * (1 - stopLossPct / 100) : null
  const rr = expectedReturnPct != null && stopLossPct != null ? (expectedReturnPct / stopLossPct).toFixed(1) : null

  return (
    <div>
      <SectionLabel>Position sizing</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Row label="Account equity" value={`$${fmt(accountEquity)}`} />
        <Row label="Risk allocation" value={`${(riskPct * 100).toFixed(0)}% → $${fmt(riskDollars)}`} sub={riskLevel} />
        {positionSize != null && <Row label="Position size" value={`$${fmt(positionSize)}`} />}
        {shares != null && <Row label={`${ticker} shares`} value={String(shares)} />}
        {sl != null && <Row label="Stop loss" value={`$${fmt(sl)}`} color="var(--red)" />}
        {tp != null && <Row label="Take profit" value={`$${fmt(tp)}`} color="var(--green)" />}
        {rr != null && <Row label="R / R ratio" value={`1 : ${rr}`} color="var(--amber)" />}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 11, color: "var(--dim)", flex: 1 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: color ?? "var(--text)" }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "capitalize" }}>{sub}</span>
      )}
    </div>
  )
}
