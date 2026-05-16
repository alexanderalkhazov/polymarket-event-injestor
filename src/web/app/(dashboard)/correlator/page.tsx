"use client"

import useSWR from "swr"
import { Topbar } from "@/components/layout/Topbar"
import { SignalTable } from "@/components/correlator/SignalTable"
import { SourceHealth } from "@/components/correlator/SourceHealth"
import { StatsBar } from "@/components/correlator/StatsBar"
import { Skeleton } from "@/components/ui/Skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function CorrelatorPage() {
  const { data, isLoading } = useSWR("/api/signals", fetcher, { refreshInterval: 15000 })

  const signals = data?.signals ?? []

  const sources = ["polymarket", "news", "analytics"].map((src) => {
    const srcSignals = signals.filter((s: { source: string }) => s.source === src)
    const last = srcSignals[0]?.created_at ?? null
    return { source: src, last_seen: last, count_24h: srcSignals.length }
  })

  const processed = signals.filter((s: { status: string }) => s.status === "processed").length
  const dropped = signals.filter((s: { status: string }) => s.status === "dropped").length
  const processing = signals.filter((s: { status: string }) => s.status === "processing").length

  const stats = [
    { label: "Total signals", value: signals.length },
    { label: "Processed", value: processed },
    { label: "Dropped", value: dropped },
    { label: "In pipeline", value: processing },
    { label: "Pass rate", value: signals.length ? `${Math.round((processed / signals.length) * 100)}%` : "—" },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Signal Correlator" />

      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
        <SourceHealth sources={sources} />
        <StatsBar stats={stats} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        ) : (
          <SignalTable signals={signals} />
        )}
      </div>
    </div>
  )
}
