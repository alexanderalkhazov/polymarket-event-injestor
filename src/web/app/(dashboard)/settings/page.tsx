"use client"

import { useState } from "react"
import { Topbar } from "@/components/layout/Topbar"
import { RiskSelector } from "@/components/settings/RiskSelector"
import { MarketSelector } from "@/components/settings/MarketSelector"
import { AlpacaConnect } from "@/components/settings/AlpacaConnect"
import { SubscriptionManager } from "@/components/settings/SubscriptionManager"
import { showToast } from "@/components/ui/Toast"

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const [riskLevel, setRiskLevel] = useState("moderate")
  const [markets, setMarkets] = useState<string[]>(["AAPL", "TSLA", "NVDA"])

  const saveProfile = async () => {
    const res = await fetch("/api/strategies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_level: riskLevel, markets }),
    })
    if (res.ok) showToast("Profile saved")
    else showToast("Failed to save profile")
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Settings" />

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 32 }}>

        <section>
          <SectionHeading>Risk profile</SectionHeading>
          <RiskSelector value={riskLevel} onChange={setRiskLevel} />
        </section>

        <section>
          <SectionHeading>Watched markets</SectionHeading>
          <MarketSelector selected={markets} onChange={setMarkets} />
        </section>

        <div>
          <button
            onClick={saveProfile}
            style={{
              background: "var(--green)", border: "none", borderRadius: 8,
              padding: "10px 24px", color: "#000", cursor: "pointer", fontWeight: 600, fontSize: 13,
            }}
          >
            Save profile
          </button>
        </div>

        <section>
          <SectionHeading>Alpaca connection</SectionHeading>
          <div style={{ maxWidth: 480 }}>
            <AlpacaConnect
              keyId=""
              secretKey=""
              isPaper={true}
              onSave={() => {}}
            />
          </div>
        </section>

        <section>
          <SectionHeading>Signal subscriptions</SectionHeading>
          <SubscriptionManager />
        </section>
      </div>
    </div>
  )
}
