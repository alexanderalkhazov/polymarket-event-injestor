"use client"

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts"

interface OHLCVRow {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface BacktestMarker {
  ts: string
  label: string
}

function CandleBar(props: {
  x?: number; y?: number; width?: number; height?: number;
  open?: number; close?: number; low?: number; high?: number;
  payload?: OHLCVRow
}) {
  const { x = 0, y = 0, width = 0, payload } = props
  if (!payload) return null
  const { open, close, high, low } = payload
  const isUp = close >= open
  const color = isUp ? "var(--green)" : "var(--red)"
  const bodyH = Math.abs(close - open)
  // these will be provided by recharts as pixel values via the custom bar shape
  return (
    <g>
      <rect x={x + width * 0.2} y={y} width={width * 0.6} height={Math.max(bodyH, 1)} fill={color} />
    </g>
  )
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function PriceChart({ data, markers }: { data: OHLCVRow[]; markers?: BacktestMarker[] }) {
  if (!data?.length) return (
    <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dim)" }}>
      No price data
    </div>
  )

  const chartData = data.map((row) => ({
    ...row,
    mid: (row.high + row.low) / 2,
    dateLabel: formatDate(row.ts),
  }))

  const markerDates = new Set((markers ?? []).map((m) => m.ts.slice(0, 10)))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fontSize: 10, fill: "var(--dim)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="price"
          domain={["auto", "auto"]}
          tick={{ fontSize: 10, fill: "var(--dim)" }}
          tickLine={false}
          axisLine={false}
          width={55}
        />
        <YAxis
          yAxisId="vol"
          orientation="right"
          tick={{ fontSize: 9, fill: "var(--dim)" }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
          formatter={(v: unknown, name: string) => [v != null ? Number(v).toFixed(2) : "—", name]}
        />
        <Bar yAxisId="vol" dataKey="volume" opacity={0.25}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.close >= entry.open ? "var(--green)" : "var(--red)"} />
          ))}
        </Bar>
        <Line
          yAxisId="price"
          type="monotone"
          dataKey="close"
          stroke="var(--text)"
          strokeWidth={1.5}
          dot={false}
        />
        {chartData.map((entry, i) =>
          markerDates.has(entry.ts?.slice(0, 10)) ? (
            <Line
              key={`marker-${i}`}
              yAxisId="price"
              dataKey="high"
              stroke="var(--amber)"
              strokeDasharray="4 4"
              dot={false}
            />
          ) : null
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
