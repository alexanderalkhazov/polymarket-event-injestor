"use client"

import { useEffect, useState } from "react"

export interface Strategy {
  id: string
  status: string
  action: string
  tickers: string[]
  summary: string
  thesis: string
  confidence: number
  expected_return_pct: number | null
  hold_days: number | null
  stop_loss_pct: number | null
  win_rate: number | null
  avg_return_pct: number | null
  max_drawdown_pct: number | null
  sample_size: number | null
  sizing_pct: number | null
  rationale: string
  expires_at: string
  created_at: string
}

export function useStrategyStream(): { strategies: Strategy[]; connected: boolean; loaded: boolean } {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [connected, setConnected] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Initial load from DB
  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((data: Strategy[]) => {
        if (Array.isArray(data)) setStrategies(data.slice(0, 100))
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  // Real-time SSE for new strategies
  useEffect(() => {
    let es: EventSource
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      es = new EventSource("/api/strategies/stream")

      es.onopen = () => setConnected(true)

      es.onmessage = (e) => {
        try {
          const s: Strategy = JSON.parse(e.data)
          setStrategies((prev) => {
            if (prev.some((p) => p.id === s.id)) return prev
            return [s, ...prev].slice(0, 100)
          })
        } catch {
          // ignore heartbeat comments / parse errors
        }
      }

      es.onerror = () => {
        setConnected(false)
        es.close()
        retry = setTimeout(connect, 5000)
      }
    }

    connect()
    return () => {
      setConnected(false)
      es?.close()
      clearTimeout(retry)
    }
  }, [])

  return { strategies, connected, loaded }
}
