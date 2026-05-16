"use client"

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts"
import { SectionLabel } from "@/components/ui/SectionLabel"

interface TechRow {
  ts: string
  rsi: number | null
  macd: number | null
  macd_signal: number | null
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function IndicatorPanel({ data }: { data: TechRow[] }) {
  if (!data?.length) return null

  const chartData = data.map((r) => ({ ...r, dateLabel: formatDate(r.ts) }))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* RSI */}
      <div>
        <SectionLabel>RSI (14)</SectionLabel>
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 9, fill: "var(--dim)" }} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "var(--dim)" }} tickLine={false} axisLine={false} width={28} />
            <ReferenceLine y={70} stroke="var(--red)" strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="var(--green)" strokeDasharray="3 3" />
            <Tooltip contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 10 }} />
            <Line type="monotone" dataKey="rsi" stroke="var(--amber)" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* MACD */}
      <div>
        <SectionLabel>MACD</SectionLabel>
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="dateLabel" tick={{ fontSize: 9, fill: "var(--dim)" }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "var(--dim)" }} tickLine={false} axisLine={false} width={36} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Tooltip contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 10 }} />
            <Line type="monotone" dataKey="macd" stroke="var(--blue)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="macd_signal" stroke="var(--amber)" strokeWidth={1} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
