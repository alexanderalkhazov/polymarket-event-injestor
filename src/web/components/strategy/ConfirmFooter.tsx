"use client"

import { useState, useRef } from "react"
import { showToast } from "@/components/ui/Toast"
import { useCountdown } from "@/hooks/useCountdown"

interface ConfirmFooterProps {
  strategyId: string
  isPaper: boolean
  expiresAt: string
  onDismiss: () => void
  onExecuted: () => void
}

export function ConfirmFooter({ strategyId, isPaper, expiresAt, onDismiss, onExecuted }: ConfirmFooterProps) {
  const [countdown, setCountdown] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeLeft = useCountdown(expiresAt)

  const startHold = () => {
    setCountdown(3)
    let c = 3
    countRef.current = setInterval(() => {
      c -= 1
      setCountdown(c)
      if (c === 0) {
        clearInterval(countRef.current!)
        execute()
      }
    }, 1000)
    // cancel if user doesn't complete
    timerRef.current = setTimeout(() => { /* handled by countRef */ }, 3500)
  }

  const cancelHold = () => {
    if (countRef.current) clearInterval(countRef.current)
    setCountdown(null)
  }

  const execute = async () => {
    setCountdown(null)
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId, confirmed: true }),
      })
      if (res.ok) {
        showToast("Order submitted to Alpaca")
        onExecuted()
      } else {
        const err = await res.json()
        showToast(`Error: ${err.error}`)
      }
    } catch {
      showToast("Network error — order not submitted")
    }
  }

  const handleDismiss = async () => {
    await fetch("/api/strategies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: strategyId, status: "dismissed" }),
    })
    showToast("Strategy dismissed")
    onDismiss()
  }

  const btnColor = isPaper ? "var(--blue)" : "var(--green)"
  const btnLabel = countdown !== null
    ? `Hold to confirm (${countdown}s)...`
    : isPaper ? "Execute on Alpaca (paper)" : "Execute on Alpaca (LIVE)"

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "14px 20px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12 }}>⏱</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Strategy expires in</span>
        <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: 12, color: "var(--amber)" }}>
          {timeLeft}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <button onClick={handleDismiss} style={{
          background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8,
          padding: "10px", color: "var(--muted)", cursor: "pointer", fontSize: 13,
        }}>
          Dismiss
        </button>
        <button
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          style={{
            background: countdown !== null ? "var(--bg3)" : btnColor, border: "none",
            borderRadius: 8, padding: "10px", color: countdown !== null ? "var(--muted)" : "#000",
            cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "all 0.1s",
          }}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  )
}
