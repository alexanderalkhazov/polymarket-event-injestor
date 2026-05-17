"use client"

import useSWR from "swr"
import { Topbar } from "@/components/layout/Topbar"
import { AccountSummary } from "@/components/trades/AccountSummary"
import { PositionsTable } from "@/components/trades/PositionsTable"
import { ClosedTradesTable } from "@/components/trades/ClosedTradesTable"
import { AlpacaOrdersTable } from "@/components/trades/AlpacaOrdersTable"
import { Skeleton } from "@/components/ui/Skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function TradesPage() {
  const { data, isLoading } = useSWR("/api/trades", fetcher, { refreshInterval: 30000 })

  const positions = data?.positions ?? []
  const trades = data?.trades ?? []
  const alpacaOrders = data?.alpacaOrders ?? []
  const hasAlpaca = data?.hasAlpaca ?? false

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Trades" subtitle="Positions, orders & history" />
      <AccountSummary />

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={200} />
            <Skeleton height={200} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
            <PositionsTable positions={positions} />
            {hasAlpaca && <AlpacaOrdersTable orders={alpacaOrders} />}
            <ClosedTradesTable trades={trades} />
          </div>
        )}
      </div>
    </div>
  )
}
