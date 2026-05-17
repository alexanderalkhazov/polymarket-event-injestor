"use client"

import { useState, useEffect } from "react"
import { Topbar } from "@/components/layout/Topbar"
import { RiskSelector } from "@/components/settings/RiskSelector"
import { MarketCategorySelector } from "@/components/settings/MarketCategorySelector"
import { AlpacaConnect } from "@/components/settings/AlpacaConnect"
import { showToast } from "@/components/ui/Toast"

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 600, marginBottom: 12,
      borderBottom: "1px solid var(--border)", paddingBottom: 6,
    }}>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const [riskLevel, setRiskLevel] = useState("moderate")
  const [activeCategories, setActiveCategories] = useState<string[]>([])
  const [alpacaKeyId, setAlpacaKeyId] = useState("")
  const [isPaper, setIsPaper] = useState(true)

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => setActiveCategories(d.categories ?? []))
      .catch(() => {})
    fetch("/api/user")
      .then((r) => r.json())
      .then((d) => {
        if (d.risk_level) setRiskLevel(d.risk_level)
        if (d.alpaca_key_id) setAlpacaKeyId(d.alpaca_key_id)
        setIsPaper(d.is_paper ?? true)
      })
      .catch(() => {})
  }, [])

  const saveRisk = async () => {
    const res = await fetch("/api/strategies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_level: riskLevel }),
    })
    if (res.ok) showToast("Risk profile saved")
    else showToast("Failed to save")
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Settings" />

      <div style={{
        flex: 1, overflowY: "auto", padding: "20px 24px",
        display: "flex", flexDirection: "column", gap: 32,
      }}>

        <section>
          <SectionHeading>Risk profile</SectionHeading>
          <RiskSelector value={riskLevel} onChange={setRiskLevel} />
          <button
            onClick={saveRisk}
            style={{
              marginTop: 14, background: "var(--green)", border: "none",
              borderRadius: 8, padding: "9px 22px", color: "#000",
              cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}
          >
            Save risk profile
          </button>
        </section>

        <section>
          <SectionHeading>Watched markets</SectionHeading>
          <p style={{ fontSize: 12, color: "var(--dim)", marginBottom: 14, lineHeight: 1.5 }}>
            Select market categories. Subscriptions update automatically — no individual ticker management needed.
          </p>
          <MarketCategorySelector
            initialCategories={activeCategories}
            onChange={setActiveCategories}
          />
        </section>

        <section>
          <SectionHeading>Alpaca connection</SectionHeading>
          <div style={{ maxWidth: 480 }}>
            <AlpacaConnect
              keyId={alpacaKeyId}
              secretKey=""
              isPaper={isPaper}
              onSave={async (keyId, secretKey, paper) => {
                setAlpacaKeyId(keyId)
                setIsPaper(paper)
                await fetch("/api/user", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ alpaca_key_id: keyId, alpaca_secret: secretKey || undefined, is_paper: paper }),
                })
              }}
            />
          </div>
        </section>

      </div>
    </div>
  )
}
