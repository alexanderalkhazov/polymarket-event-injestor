"use client"

import { useEffect, useState } from "react"

interface ToastItem { id: number; message: string }

let _listeners: ((msg: string) => void)[] = []
export function showToast(msg: string) {
  _listeners.forEach((fn) => fn(msg))
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const handler = (msg: string) => {
      const id = Date.now()
      setToasts((prev) => [...prev, { id, message: msg }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
    }
    _listeners.push(handler)
    return () => { _listeners = _listeners.filter((fn) => fn !== handler) }
  }, [])

  if (!toasts.length) return null

  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: "var(--bg1)", border: "1px solid var(--border2)",
          borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "var(--text)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
        }}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
