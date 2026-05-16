"use client"

import useSWR from "swr"

interface AlpacaAccount {
  equity: number
  cash: number
  unrealized_pl: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useAlpacaAccount(): { account: AlpacaAccount | null; isLoading: boolean } {
  const { data, isLoading } = useSWR("/api/trades?type=account", fetcher, { refreshInterval: 30000 })
  return { account: data ?? null, isLoading }
}
