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
  sample_size: number | null
  rationale: string
  expires_at: string
  created_at: string
}

export function useStrategyStream(): { strategies: Strategy[]; connected: boolean } {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let es: EventSource
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      es = new EventSource("/api/strategies/stream")

      es.onopen = () => setConnected(true)

      es.onmessage = (e) => {
        try {
          const s: Strategy = JSON.parse(e.data)
          setStrategies((prev) => [s, ...prev].slice(0, 100))
        } catch {
          // ignore parse errors (e.g. heartbeat comments)
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

  return { strategies, connected }
}
