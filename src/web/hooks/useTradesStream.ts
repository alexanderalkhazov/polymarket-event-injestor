"use client"

import { useEffect, useRef, useState, useCallback } from "react"

export interface LivePosition {
  symbol: string
  side: string
  qty: number
  avg_entry_price: number
  current_price: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
}

export interface LiveAccount {
  equity: number
  cash: number
  buying_power: number
  unrealized_pl: number
  last_equity: number   // yesterday's closing equity — used for daily return calc
}

interface StreamState {
  account: LiveAccount | null
  positions: LivePosition[]
  connected: boolean
  ts: number | null
}

export function useTradesStream(): StreamState & { refresh: () => void } {
  const [state, setState] = useState<StreamState>({
    account: null,
    positions: [],
    connected: false,
    ts: null,
  })
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current)
    if (esRef.current) { esRef.current.close(); esRef.current = null }

    const es = new EventSource("/api/trades/stream")
    esRef.current = es

    es.onopen = () => setState((s) => ({ ...s, connected: true }))

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { account: LiveAccount; positions: LivePosition[]; ts: number }
        setState({ account: parsed.account, positions: parsed.positions, connected: true, ts: parsed.ts })
      } catch { /* ignore malformed frame */ }
    }

    es.onerror = () => {
      setState((s) => ({ ...s, connected: false }))
      es.close()
      esRef.current = null
      retryRef.current = setTimeout(connect, 5000)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      esRef.current?.close()
    }
  }, [connect])

  return { ...state, refresh: connect }
}
