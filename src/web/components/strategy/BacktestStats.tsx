import { StatCell } from "@/components/ui/StatCell"
import { SectionLabel } from "@/components/ui/SectionLabel"

interface BacktestStatsProps {
  winRate: number | null
  avgReturn: number | null
  sampleSize: number | null
  maxDrawdown: number | null
}

export function BacktestStats({ winRate, avgReturn, sampleSize, maxDrawdown }: BacktestStatsProps) {
  const wr = winRate ? Math.round(winRate * 100) : null
  const wrColor = wr === null ? "var(--muted)" : wr >= 60 ? "var(--green)" : wr >= 45 ? "var(--amber)" : "var(--red)"

  return (
    <div>
      <SectionLabel>Backtest results</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 12 }}>
        <StatCell label="Win rate" value={wr !== null ? `${wr}%` : null} color={wrColor} />
        <StatCell label="Avg return" value={avgReturn !== null ? `${avgReturn > 0 ? "+" : ""}${avgReturn}%` : null} color="var(--green)" />
        <StatCell label="Sample size" value={sampleSize} color="var(--muted)" />
        <StatCell label="Max drawdown" value={maxDrawdown !== null ? `${maxDrawdown}%` : null} color="var(--red)" />
      </div>
      <div style={{
        borderLeft: "2px solid var(--amber)", paddingLeft: 10,
        fontSize: 11, color: "var(--muted)", lineHeight: 1.5,
      }}>
        Historical results do not guarantee future returns. This is a base rate, not a prediction.
      </div>
    </div>
  )
}
