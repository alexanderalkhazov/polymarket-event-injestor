interface MacroRow { series_id: string; value: number }

const META: Record<string, { label: string; unit?: string }> = {
  FEDFUNDS:  { label: "Fed Funds",  unit: "%" },
  CPIAUCSL:  { label: "CPI YoY",    unit: "%" },
  DCOILWTICO:{ label: "WTI Crude",  unit: "$" },
  DGS10:     { label: "10Y Yield",  unit: "%" },
  VIXCLS:    { label: "VIX",        unit: "" },
  DTWEXBGS:  { label: "USD Index",  unit: "" },
}

export function MacroGrid({ macro }: { macro: MacroRow[] }) {
  if (!macro?.length) return null
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "var(--border)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
      {macro.map((m) => {
        const meta = META[m.series_id]
        const unit = meta?.unit ?? ""
        const val  = m.value != null ? Number(m.value).toFixed(2) : "—"
        return (
          <div key={m.series_id} style={{
            background: "var(--bg2)", padding: "10px 12px",
          }}>
            <div style={{
              fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em",
              color: "var(--dim)", marginBottom: 4, fontWeight: 600,
            }}>
              {meta?.label ?? m.series_id}
            </div>
            <div style={{
              fontFamily: "var(--font-dm-mono)", fontSize: 13,
              fontWeight: 600, color: "var(--text)",
            }}>
              {unit === "$" ? `$${val}` : unit === "%" ? `${val}%` : val}
            </div>
          </div>
        )
      })}
    </div>
  )
}
