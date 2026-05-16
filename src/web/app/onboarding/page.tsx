"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { RiskSelector } from "@/components/settings/RiskSelector"
import { MarketSelector } from "@/components/settings/MarketSelector"
import { AlpacaConnect } from "@/components/settings/AlpacaConnect"
import { showToast } from "@/components/ui/Toast"

const STEPS = ["Welcome", "Risk profile", "Markets", "Alpaca", "Done"]

function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 3, flex: 1, borderRadius: 2,
            background: i <= step ? "var(--green)" : "var(--border)",
            transition: "background 0.2s",
          }}
        />
      ))}
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [riskLevel, setRiskLevel] = useState("moderate")
  const [markets, setMarkets] = useState<string[]>(["AAPL", "TSLA", "NVDA"])
  const [alpacaKey, setAlpacaKey] = useState("")
  const [alpacaSecret, setAlpacaSecret] = useState("")
  const [isPaper, setIsPaper] = useState(true)
  const [saving, setSaving] = useState(false)

  const next = () => setStep((s) => s + 1)
  const back = () => setStep((s) => s - 1)

  const saveAndFinish = async () => {
    setSaving(true)
    try {
      await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: markets, source: "news" }),
      })
      await fetch("/api/strategies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risk_level: riskLevel, onboarding_complete: true }),
      })
      showToast("Setup complete — welcome to EventEdge")
      router.push("/")
    } catch {
      showToast("Error saving settings")
    } finally {
      setSaving(false)
    }
  }

  const container: React.CSSProperties = {
    minHeight: "100vh", background: "var(--bg0)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24,
  }

  const card: React.CSSProperties = {
    background: "var(--bg1)", border: "1px solid var(--border)",
    borderRadius: 16, padding: "40px 48px",
    width: "100%", maxWidth: 600,
  }

  const btnPrimary: React.CSSProperties = {
    background: "var(--green)", border: "none", borderRadius: 8,
    padding: "12px 28px", color: "#000", cursor: "pointer",
    fontWeight: 700, fontSize: 14,
  }

  const btnSecondary: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--border)", borderRadius: 8,
    padding: "12px 20px", color: "var(--muted)", cursor: "pointer", fontSize: 14,
  }

  return (
    <div style={container}>
      <div style={card}>
        <Progress step={step} total={STEPS.length - 1} />

        {step === 0 && (
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Welcome to EventEdge</div>
            <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, marginBottom: 32 }}>
              EventEdge monitors market signals from news, Polymarket prediction markets, and technical
              analytics to generate AI-powered trading strategies. Let&apos;s get you set up in 4 steps.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {["Real-time signal monitoring across 3 data sources", "AI-powered strategy generation via Claude", "Backtested entries with win rates & expected returns", "Direct execution via Alpaca (paper or live)"].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", flexShrink: 0 }} />
                  {item}
                </div>
              ))}
            </div>
            <button onClick={next} style={btnPrimary}>Get started →</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Risk profile</div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>
              This determines position sizing for every strategy. You can change it later.
            </p>
            <RiskSelector value={riskLevel} onChange={setRiskLevel} />
            <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
              <button onClick={back} style={btnSecondary}>Back</button>
              <button onClick={next} style={btnPrimary}>Continue →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Watched markets</div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>
              Choose the tickers you want EventEdge to monitor. More can be added in settings.
            </p>
            <MarketSelector selected={markets} onChange={setMarkets} />
            <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
              <button onClick={back} style={btnSecondary}>Back</button>
              <button onClick={next} style={btnPrimary}>Continue →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Connect Alpaca</div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>
              Connect your Alpaca account to execute strategies. You can skip this and add keys later.
            </p>
            <AlpacaConnect
              keyId={alpacaKey}
              secretKey={alpacaSecret}
              isPaper={isPaper}
              onSave={(k, s, p) => { setAlpacaKey(k); setAlpacaSecret(s); setIsPaper(p) }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <button onClick={back} style={btnSecondary}>Back</button>
              <button onClick={next} style={btnSecondary}>Skip for now</button>
              <button onClick={next} style={btnPrimary}>Continue →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>You&apos;re all set!</div>
            <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, marginBottom: 32 }}>
              EventEdge is now monitoring <strong style={{ color: "var(--text)" }}>{markets.length} market{markets.length !== 1 ? "s" : ""}</strong> with a{" "}
              <strong style={{ color: "var(--text)" }}>{riskLevel}</strong> risk profile.
              Strategies will appear in your inbox as signals are detected.
            </p>
            <button onClick={saveAndFinish} disabled={saving} style={btnPrimary}>
              {saving ? "Saving…" : "Go to dashboard →"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
