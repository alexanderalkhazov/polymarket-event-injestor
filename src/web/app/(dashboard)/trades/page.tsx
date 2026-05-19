"use client"

import useSWR from "swr"
import { Topbar } from "@/components/layout/Topbar"
import { AccountSummary } from "@/components/trades/AccountSummary"
import { PositionsTable } from "@/components/trades/PositionsTable"
import { ClosedTradesTable } from "@/components/trades/ClosedTradesTable"
import { AlpacaOrdersTable } from "@/components/trades/AlpacaOrdersTable"
import { Skeleton } from "@/components/ui/Skeleton"
import { useTradesStream } from "@/hooks/useTradesStream"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function TradesPage() {
  // Real-time positions + account via SSE (updates every 3s)
  const { account, positions: livePositions, connected, refresh } = useTradesStream()

  // SWR for orders + closed trades (static-ish data, 30s is fine)
  const { data, isLoading, mutate } = useSWR("/api/trades", fetcher, { refreshInterval: 30000 })

  const trades       = data?.trades ?? []
  const alpacaOrders = data?.alpacaOrders ?? []
  const hasAlpaca    = data?.hasAlpaca ?? false

  // Use live positions from SSE; fall back to REST positions on first load
  const positions = livePositions.length > 0 ? livePositions : (data?.positions ?? [])

  const onMutate = () => {
    mutate()
    refresh()   // reconnect SSE to pick up immediate state after an action
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        title="Trades"
        subtitle={
          connected
            ? "Live · updates every 3s"
            : "Connecting…"
        }
      />

      {/* Account summary — receives live data from SSE */}
      <AccountSummary liveAccount={account} liveConnected={connected} />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {isLoading && !data ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={200} />
            <Skeleton height={200} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
            <PositionsTable positions={positions} onMutate={onMutate} />
            {hasAlpaca && <AlpacaOrdersTable orders={alpacaOrders} onMutate={onMutate} />}
            <ClosedTradesTable trades={trades} />
          </div>
        )}
      </div>
    </div>
  )
}
