"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { RiskSelector } from "@/components/settings/RiskSelector"
import { CategoryCatalog } from "@/components/settings/CategoryCatalog"
import { AlpacaConnect } from "@/components/settings/AlpacaConnect"
import { showToast } from "@/components/ui/Toast"

const STEPS = ["Welcome", "Risk", "Markets", "Alpaca", "Done"]

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 40 }}>
      {STEPS.map((_, i) => (
        <div
          key={i}
          style={{
            height: 3, flex: 1, borderRadius: 2,
            background: i <= step ? "var(--green)" : "var(--border)",
            transition: "background 0.25s",
          }}
        />
      ))}
    </div>
  )
}

// ─── Step label ───────────────────────────────────────────────────────────────
function StepLabel({ n, total }: { n: number; total: number }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", color: "var(--dim)", marginBottom: 10,
    }}>
      Step {n} of {total}
    </div>
  )
}

// ─── Shared button styles ──────────────────────────────────────────────────────
const btnPrimary: React.CSSProperties = {
  background: "var(--green)", border: "none", borderRadius: 10,
  padding: "13px 28px", color: "#fff", cursor: "pointer",
  fontWeight: 700, fontSize: 14, letterSpacing: "0.01em",
  transition: "opacity 0.15s",
}
const btnSecondary: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border2)", borderRadius: 10,
  padding: "13px 20px", color: "var(--muted)", cursor: "pointer",
  fontSize: 14, transition: "background 0.15s",
}
const btnGhost: React.CSSProperties = {
  background: "none", border: "none",
  color: "var(--dim)", cursor: "pointer",
  fontSize: 13, padding: "13px 0",
  textDecoration: "underline", textDecorationColor: "var(--border2)",
}

// ─── Feature bullets ──────────────────────────────────────────────────────────
const FEATURES = [
  { icon: "⚡", text: "Real-time signals from Polymarket, news and price analytics" },
  { icon: "🤖", text: "Claude AI generates plain-English trade narratives" },
  { icon: "📊", text: "Every strategy is backtested — win rates shown before you act" },
  { icon: "🔐", text: "You execute trades via your own Alpaca account" },
]

const RISK_LABELS: Record<string, { label: string; sub: string }> = {
  conservative: { label: "Conservative", sub: "1% per trade" },
  moderate:     { label: "Moderate",     sub: "3% per trade" },
  aggressive:   { label: "Aggressive",   sub: "6% per trade" },
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [riskLevel, setRiskLevel] = useState("moderate")
  const [categories, setCategories] = useState<string[]>([])
  const [alpacaKeyId, setAlpacaKeyId] = useState("")
  const [isPaper, setIsPaper] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // Resume from last incomplete step
  useEffect(() => {
    Promise.all([
      fetch("/api/user").then(r => r.ok ? r.json() : {}),
      fetch("/api/categories").then(r => r.ok ? r.json() : {}),
    ]).then(([user, cats]: [Record<string, unknown>, Record<string, unknown>]) => {
      const activeCats: string[] = (cats.categories as string[]) ?? []
      setCategories(activeCats)
      if (user.risk_level) setRiskLevel(user.risk_level as string)
      if (user.alpaca_key_id) setAlpacaKeyId(user.alpaca_key_id as string)
      setIsPaper((user.is_paper as boolean) ?? true)

      // Determine resume step
      if (activeCats.length > 0 && user.alpaca_key_id) setStep(4)
      else if (activeCats.length > 0) setStep(3)
      // else start at 0
    }).finally(() => setLoading(false))
  }, [])

  const next = () => setStep(s => s + 1)
  const back = () => setStep(s => s - 1)

  const saveRisk = async () => {
    await fetch("/api/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_level: riskLevel }),
    })
  }

  const finish = async () => {
    setSaving(true)
    try {
      await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_complete: true }),
      })
      showToast("Welcome to EventEdge!")
      router.push("/")
    } catch {
      showToast("Error saving — please try again")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", background: "var(--bg0)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div className="skeleton" style={{ width: 560, height: 400, borderRadius: 20 }} />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg0)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 16px",
    }}>
      <div style={{
        background: "var(--bg1)",
        border: "1px solid var(--border)",
        borderRadius: 20,
        padding: "44px 52px",
        width: "100%", maxWidth: 580,
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}>
        <ProgressBar step={step} />

        {/* ── Step 0: Welcome ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="step-enter">
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
              <div style={{
                width: 44, height: 44, background: "var(--green)", borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-dm-mono)", fontSize: 14, fontWeight: 700, color: "#fff",
                flexShrink: 0,
              }}>
                EE
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
                  Welcome to EventEdge
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                  AI-powered trading intelligence
                </div>
              </div>
            </div>

            <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, marginBottom: 28 }}>
              EventEdge monitors prediction markets, news, and price analytics in real time.
              When signals align, Claude generates a plain-English trade narrative with
              backtested statistics — and you decide whether to execute.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 36 }}>
              {FEATURES.map(f => (
                <div key={f.text} style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "10px 14px",
                  background: "var(--bg2)", borderRadius: 10,
                  border: "1px solid var(--border)",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                  <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{f.text}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={next} style={btnPrimary}>Get started →</button>
              <span style={{ fontSize: 12, color: "var(--dim)" }}>Takes about 2 minutes</span>
            </div>
          </div>
        )}

        {/* ── Step 1: Risk profile ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="step-enter">
            <StepLabel n={1} total={4} />
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: "-0.01em" }}>
              Risk profile
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 28, lineHeight: 1.6 }}>
              This sets position size for every strategy. You can change it any time in Settings.
            </p>

            <RiskSelector value={riskLevel} onChange={setRiskLevel} />

            <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
              <button onClick={back} style={btnSecondary}>← Back</button>
              <button
                onClick={async () => { await saveRisk(); next() }}
                style={btnPrimary}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Market categories ────────────────────────────────────── */}
        {step === 2 && (
          <div className="step-enter">
            <StepLabel n={2} total={4} />
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: "-0.01em" }}>
              Watched markets
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24, lineHeight: 1.6 }}>
              Select the market categories you want EventEdge to monitor. Each category
              subscribes you to the relevant tickers automatically.
            </p>

            <CategoryCatalog
              initialCategories={categories}
              onChange={setCategories}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 32, alignItems: "center" }}>
              <button onClick={back} style={btnSecondary}>← Back</button>
              <button
                onClick={next}
                disabled={categories.length === 0}
                style={{
                  ...btnPrimary,
                  opacity: categories.length === 0 ? 0.4 : 1,
                  cursor: categories.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                Continue →
              </button>
              {categories.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--dim)" }}>
                  Select at least one category
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Alpaca ───────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="step-enter">
            <StepLabel n={3} total={4} />
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: "-0.01em" }}>
              Connect Alpaca
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
              Link your Alpaca account to execute strategies directly.
              Paper mode is enabled by default — no real money at risk.
            </p>
            <div style={{
              fontSize: 11, color: "var(--dim)", background: "var(--blue-bg)",
              border: "1px solid var(--blue-bg)", borderRadius: 8,
              padding: "8px 12px", marginBottom: 24,
            }}>
              Don&apos;t have an Alpaca account? Create one free at alpaca.markets — paper trading is instant.
            </div>

            <AlpacaConnect
              keyId={alpacaKeyId}
              secretKey=""
              isPaper={isPaper}
              onSave={(k, _s, p) => {
                setAlpacaKeyId(k)
                setIsPaper(p)
              }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 28, alignItems: "center" }}>
              <button onClick={back} style={btnSecondary}>← Back</button>
              <button onClick={next} style={btnPrimary}>Continue →</button>
              <button onClick={next} style={btnGhost}>Skip for now</button>
            </div>
          </div>
        )}

        {/* ── Step 4: Done ─────────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="step-enter">
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{
                width: 56, height: 56,
                background: "var(--green-bg)",
                border: "2px solid var(--green)",
                borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
                fontSize: 24,
              }}>
                ✓
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 8 }}>
                You&apos;re all set!
              </div>
              <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
                EventEdge is configured. Strategies will appear in your inbox
                as signals are detected.
              </p>
            </div>

            {/* Summary */}
            <div style={{
              background: "var(--bg2)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "18px 20px",
              display: "flex", flexDirection: "column", gap: 12,
              marginBottom: 28,
            }}>
              <SummaryRow
                label="Risk profile"
                value={`${RISK_LABELS[riskLevel]?.label ?? riskLevel} · ${RISK_LABELS[riskLevel]?.sub ?? ""}`}
              />
              <div style={{ height: 1, background: "var(--border)" }} />
              <SummaryRow
                label="Markets"
                value={categories.length > 0 ? `${categories.length} subcategory${categories.length !== 1 ? "s" : ""} selected` : "None selected"}
              />
              <div style={{ height: 1, background: "var(--border)" }} />
              <SummaryRow
                label="Execution"
                value={alpacaKeyId ? `Alpaca connected · ${isPaper ? "Paper mode" : "Live mode"}` : "Not connected — add keys in Settings"}
              />
            </div>

            <button
              onClick={finish}
              disabled={saving}
              style={{ ...btnPrimary, width: "100%", textAlign: "center", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Go to dashboard →"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dim)", flexShrink: 0, marginTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--text)", textAlign: "right" }}>
        {value}
      </span>
    </div>
  )
}
