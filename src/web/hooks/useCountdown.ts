"use client"

import { useState, useEffect } from "react"

export function useCountdown(expiresAt: string): string {
  const [timeLeft, setTimeLeft] = useState("")

  useEffect(() => {
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now()
      if (ms <= 0) { setTimeLeft("Expired"); return }
      const h = Math.floor(ms / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      const s = Math.floor((ms % 60000) / 1000)
      setTimeLeft(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return timeLeft
}
