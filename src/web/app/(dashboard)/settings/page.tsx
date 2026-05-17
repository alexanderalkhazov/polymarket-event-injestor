"use client"

import { useState, useEffect } from "react"
import { Topbar } from "@/components/layout/Topbar"
import { RiskSelector } from "@/components/settings/RiskSelector"
import { CategoryCatalog } from "@/components/settings/CategoryCatalog"
import { AlpacaConnect } from "@/components/settings/AlpacaConnect"
import { showToast } from "@/components/ui/Toast"

type SectionId = "risk" | "markets" | "alpaca"

const NAV_ITEMS: { id: SectionId; icon: string; label: string }[] = [
  { id: "risk",    icon: "⚖️",  label: "Risk Profile" },
  { id: "markets", icon: "📊",  label: "Markets" },
  { id: "alpaca",  icon: "🔗",  label: "Alpaca" },
]

interface SectionHeaderProps {
  title: string
  description: string
}
function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
        {description}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("risk")
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

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── Sidebar ── */}
        <nav style={{
          width: 180,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          padding: "20px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          height: "100%",
        }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 8,
                  border: "none", cursor: "pointer",
                  textAlign: "left", width: "100%",
                  background: isActive ? "var(--bg2)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--muted)",
                  fontWeight: isActive ? 600 : 400,
                  fontSize: 13,
                  transition: "background 0.12s, color 0.12s",
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

          {activeSection === "risk" && (
            <section>
              <SectionHeader
                title="Risk Profile"
                description="Controls position sizing for all auto-generated strategies. You can change this at any time."
              />
              <RiskSelector value={riskLevel} onChange={setRiskLevel} />
              <button
                onClick={saveRisk}
                style={{
                  marginTop: 20, background: "var(--green)", border: "none",
                  borderRadius: 8, padding: "10px 24px", color: "#fff",
                  cursor: "pointer", fontWeight: 600, fontSize: 13,
                }}
              >
                Save risk profile
              </button>
            </section>
          )}

          {activeSection === "markets" && (
            <section>
              <SectionHeader
                title="Watched Markets"
                description="Pick the subcategories you want signals for. Subscriptions resolve automatically — no ticker management needed."
              />
              <CategoryCatalog
                initialCategories={activeCategories}
                onChange={setActiveCategories}
              />
            </section>
          )}

          {activeSection === "alpaca" && (
            <section>
              <SectionHeader
                title="Alpaca Connection"
                description="Connect your Alpaca account to execute trades directly from the strategy inbox."
              />
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
          )}

        </div>
      </div>
    </div>
  )
}
