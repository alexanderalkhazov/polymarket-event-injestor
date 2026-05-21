"use client"

import type { Strategy } from "@/hooks/useStrategyStream"

interface StrategyCardProps {
  strategy: Strategy
  assetNames?: Record<string, string>
  selected: boolean
  onClick: () => void
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function StrategyCard({ strategy: s, assetNames = {}, selected, onClick }: StrategyCardProps) {
  const action = s.action ?? "buy"
  const accentColor =
    action === "buy" ? "var(--green)" : action === "sell" ? "var(--red)" : "var(--amber)"
  const accentBg =
    action === "buy" ? "var(--green-bg)" : action === "sell" ? "var(--red-bg)" : "var(--amber-bg)"

  const isDismissed = s.status === "dismissed"
  const isExpired   = s.status === "expired"
  const isExecuted  = s.status === "executed"

  const winRate = s.win_rate != null ? Math.round(s.win_rate * 100) : null
  const avgRet  = s.avg_return_pct ?? s.expected_return_pct ?? null
  const stop    = s.stop_loss_pct  != null ? Math.round(s.stop_loss_pct * 100)  : null

  const wrColor  = winRate == null ? "var(--dim)" : winRate >= 60 ? "var(--green)" : winRate >= 45 ? "var(--amber)" : "var(--red)"
  const retColor = avgRet  == null ? "var(--dim)" : avgRet > 0 ? "var(--green)" : "var(--red)"
  const conf     = Math.round((s.confidence ?? 0) * 100)

  const faded = isExpired || isDismissed

  const primaryTicker = (s.tickers ?? [])[0] ?? ""
  const relatedTickers = (s.tickers ?? []).slice(1)
  const primaryName = assetNames[primaryTicker]
  const showName = !!(primaryName && primaryName !== primaryTicker)

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? "rgba(92,106,196,0.04)" : "var(--bg1)",
        borderRadius: 14,
        border: `1px solid ${selected ? "var(--primary)" : "var(--border)"}`,
        borderLeft: `3px solid ${faded ? "var(--border2)" : accentColor}`,
        padding: "15px 17px 13px",
        cursor: "pointer",
        opacity: isExpired ? 0.28 : isDismissed ? 0.52 : 1,
        boxShadow: selected
          ? `0 0 0 3px var(--primary-dim), var(--shadow-md)`
          : "var(--shadow-sm)",
        transition: "box-shadow 0.12s, border-color 0.12s, opacity 0.12s",
      }}
    >
      {/* Row 1: Ticker + name + action badge + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{
          fontFamily: "var(--font-dm-mono)", fontSize: 15, fontWeight: 700,
          color: "var(--text)", flexShrink: 0,
        }}>
          {primaryTicker || "—"}
        </span>
        {showName && (
          <span style={{
            fontSize: 12, color: "var(--muted)", fontWeight: 400,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1,
          }}>
            {primaryName}
          </span>
        )}
        {!showName && <div style={{ flex: 1 }} />}
        <span style={{
          background: accentBg, color: accentColor,
          borderRadius: 5, padding: "2px 7px",
          fontSize: 10, fontWeight: 700,
          fontFamily: "var(--font-dm-mono)", letterSpacing: "0.06em",
          flexShrink: 0,
        }}>
          {action.toUpperCase()}
        </span>
        {isExecuted && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--green)", letterSpacing: "0.07em", flexShrink: 0 }}>
            ✓ DONE
          </span>
        )}
        {isDismissed && (
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--dim)", letterSpacing: "0.07em", flexShrink: 0 }}>
            DISMISSED
          </span>
        )}
      </div>

      {/* Related tickers */}
      {relatedTickers.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "var(--dim)" }}>signal from</span>
          {relatedTickers.map((t) => (
            <span key={t} style={{
              fontFamily: "var(--font-dm-mono)", fontSize: 10,
              color: "var(--dim)", background: "var(--bg2)",
              border: "1px solid var(--border)", borderRadius: 4,
              padding: "1px 5px",
            }}>
              {t}{assetNames[t] && assetNames[t] !== t ? ` · ${assetNames[t]}` : ""}
            </span>
          ))}
        </div>
      )}

      {/* Summary */}
      <p style={{
        fontSize: 13, lineHeight: 1.55,
        color: faded ? "var(--dim)" : "var(--muted)",
        margin: "0 0 12px",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {s.summary || "—"}
      </p>

      {/* Stats strip */}
      {(winRate != null || avgRet != null || stop != null) && (
        <div style={{
          display: "flex",
          background: "var(--bg2)", borderRadius: 8,
          border: "1px solid var(--border)",
          overflow: "hidden", marginBottom: 11,
        }}>
          {[
            { label: "WIN RATE", value: winRate != null ? `${winRate}%` : "—",          color: wrColor },
            { label: "AVG RET",  value: avgRet  != null ? `${avgRet > 0 ? "+" : ""}${Number(avgRet).toFixed(1)}%` : "—", color: retColor },
            { label: "STOP",     value: stop    != null ? `−${stop}%`   : "—",          color: stop != null ? "var(--red)" : "var(--dim)" },
          ].map(({ label, value, color }, i, arr) => (
            <div key={label} style={{
              flex: 1, padding: "7px 10px",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div style={{
                fontSize: 9, textTransform: "uppercase",
                letterSpacing: "0.08em", color: "var(--dim)", marginBottom: 3,
              }}>
                {label}
              </div>
              <div style={{
                fontFamily: "var(--font-dm-mono)", fontSize: 12, fontWeight: 600,
                color: value === "—" ? "var(--dim)" : color,
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer: confidence bar + % + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, height: 2, background: "var(--border)",
          borderRadius: 2, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: `${conf}%`,
            background: faded ? "var(--border2)" : accentColor,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }} />
        </div>
        <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>
          {conf}%
        </span>
        <span style={{ color: "var(--dim)", fontSize: 11, flexShrink: 0 }}>·</span>
        <span style={{ fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>
          {relTime(s.created_at)}
        </span>
      </div>
    </div>
  )
}
