import { SectionLabel } from "@/components/ui/SectionLabel"

interface MacroRow { series_id: string; value: number }

const LABELS: Record<string, string> = {
  FEDFUNDS: "FED FUNDS", CPIAUCSL: "CPI YoY", DCOILWTICO: "WTI CRUDE",
  DGS10: "10Y YIELD", VIXCLS: "VIX", DTWEXBGS: "USD INDEX",
}

export function MacroGrid({ macro }: { macro: MacroRow[] }) {
  if (!macro?.length) return null
  return (
    <div>
      <SectionLabel>Macro context</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px 0" }}>
        {macro.map((m) => (
          <div key={m.series_id}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dim)" }}>
              {LABELS[m.series_id] ?? m.series_id}
            </div>
            <div style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11 }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
