"use client"

import useSWR from "swr"
import { Topbar } from "@/components/layout/Topbar"
import { AccountSummary } from "@/components/trades/AccountSummary"
import { PositionsTable } from "@/components/trades/PositionsTable"
import { ClosedTradesTable } from "@/components/trades/ClosedTradesTable"
import { Skeleton } from "@/components/ui/Skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function TradesPage() {
  const { data, isLoading } = useSWR("/api/trades", fetcher, { refreshInterval: 30000 })

  const positions = data?.positions ?? []
  const trades = data?.trades ?? []

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Trades" />
      <AccountSummary />

      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={200} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <PositionsTable positions={positions} />
            <ClosedTradesTable trades={trades} />
          </div>
        )}
      </div>
    </div>
  )
}
