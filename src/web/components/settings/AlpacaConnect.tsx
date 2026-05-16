"use client"

import { useState } from "react"
import { showToast } from "@/components/ui/Toast"

interface AlpacaConnectProps {
  keyId: string
  secretKey: string
  isPaper: boolean
  onSave: (keyId: string, secretKey: string, isPaper: boolean) => void
}

export function AlpacaConnect({ keyId: initKey, secretKey: initSecret, isPaper: initPaper, onSave }: AlpacaConnectProps) {
  const [keyId, setKeyId] = useState(initKey)
  const [secretKey, setSecretKey] = useState(initSecret)
  const [isPaper, setIsPaper] = useState(initPaper)
  const [testing, setTesting] = useState(false)

  const testConnection = async () => {
    setTesting(true)
    try {
      const res = await fetch("/api/trades?type=account", {
        headers: { "x-alpaca-key": keyId, "x-alpaca-secret": secretKey, "x-alpaca-paper": String(isPaper) },
      })
      if (res.ok) {
        const data = await res.json()
        showToast(`Connected — equity $${Number(data.equity ?? 0).toLocaleString()}`)
      } else {
        showToast("Connection failed — check your keys")
      }
    } catch {
      showToast("Network error")
    } finally {
      setTesting(false)
    }
  }

  const inputStyle = {
    width: "100%", background: "var(--bg2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "10px 12px", color: "var(--text)",
    fontFamily: "var(--font-dm-mono)", fontSize: 12, outline: "none",
    boxSizing: "border-box" as const,
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>API Key ID</label>
        <input
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          placeholder="PK…"
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Secret Key</label>
        <input
          type="password"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          placeholder="••••••••••••••••"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
          <div
            onClick={() => setIsPaper(!isPaper)}
            style={{
              width: 36, height: 20, borderRadius: 10, position: "relative", cursor: "pointer",
              background: isPaper ? "var(--blue)" : "var(--border)", transition: "background 0.2s",
            }}
          >
            <div style={{
              position: "absolute", top: 3, left: isPaper ? 19 : 3,
              width: 14, height: 14, borderRadius: "50%", background: "#fff",
              transition: "left 0.2s",
            }} />
          </div>
          <span style={{ color: "var(--muted)" }}>Paper trading mode</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={testConnection}
          disabled={testing}
          style={{
            flex: 1, background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "10px", color: "var(--muted)",
            cursor: testing ? "default" : "pointer", fontSize: 13,
          }}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          onClick={() => { onSave(keyId, secretKey, isPaper); showToast("Alpaca settings saved") }}
          style={{
            flex: 2, background: "var(--blue)", border: "none",
            borderRadius: 8, padding: "10px", color: "#fff",
            cursor: "pointer", fontWeight: 600, fontSize: 13,
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
