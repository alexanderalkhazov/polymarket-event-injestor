import { StatCell } from "@/components/ui/StatCell"
import { SectionLabel } from "@/components/ui/SectionLabel"

interface BacktestStatsProps {
  winRate: number | null
  avgReturn: number | null
  sampleSize: number | null
  maxDrawdown: number | null
  sharpe?: number | null
}

export function BacktestStats({ winRate, avgReturn, sampleSize, maxDrawdown, sharpe }: BacktestStatsProps) {
  const allNull = winRate === null && avgReturn === null && sampleSize === null && maxDrawdown === null
  const someNull = !allNull && (winRate === null || avgReturn === null || sampleSize === null || maxDrawdown === null)

  const wr = winRate !== null ? Math.round(winRate * 100) : null
  const wrColor =
    wr === null ? "var(--muted)" : wr >= 60 ? "var(--green)" : wr >= 45 ? "var(--amber)" : "var(--red)"

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <SectionLabel>Backtest results</SectionLabel>
        {someNull && (
          <span style={{
            fontSize: 10, color: "var(--amber)", fontWeight: 600,
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            partial data
          </span>
        )}
      </div>

      {allNull ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--amber-bg)",
          border: "1px solid rgba(217,119,6,0.25)",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 12,
        }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontSize: 13, color: "var(--amber)", fontWeight: 500, lineHeight: 1.4 }}>
            Signal only · No backtested setup matches this market yet.
          </span>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: 12 }}>
          <StatCell label="Win rate" value={wr !== null ? `${wr}%` : null} color={wrColor} large />
          <StatCell
            label="Avg return"
            value={avgReturn !== null ? `${avgReturn > 0 ? "+" : ""}${Number(avgReturn).toFixed(1)}%` : null}
            color={avgReturn === null ? "var(--muted)" : avgReturn > 0 ? "var(--green)" : "var(--red)"}
            large
          />
          <StatCell
            label="Sample size"
            value={sampleSize !== null ? `${sampleSize} trades` : null}
            color="var(--muted)"
          />
          <StatCell
            label="Max drawdown"
            value={maxDrawdown !== null ? `−${Math.abs(Number(maxDrawdown)).toFixed(1)}%` : null}
            color={maxDrawdown !== null ? "var(--red)" : "var(--muted)"}
          />
          {sharpe != null && (
            <StatCell
              label="Sharpe ratio"
              value={Number(sharpe).toFixed(2)}
              color={sharpe >= 1 ? "var(--green)" : sharpe >= 0.5 ? "var(--amber)" : "var(--red)"}
            />
          )}
        </div>
      )}

      <div style={{
        borderLeft: "2px solid var(--amber)", paddingLeft: 10,
        fontSize: 11, color: "var(--muted)", lineHeight: 1.5,
      }}>
        Historical results do not guarantee future returns. This is a base rate, not a prediction.
      </div>
    </div>
  )
}
