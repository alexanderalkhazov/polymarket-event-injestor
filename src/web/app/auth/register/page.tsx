"use client"

export const dynamic = "force-dynamic"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { showToast } from "@/components/ui/Toast"

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    setLoading(true)
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    })
    setLoading(false)
    if (res.ok) {
      showToast("Account created — sign in to continue")
      router.push("/auth/signin")
    } else {
      const data = await res.json()
      setError(data.error ?? "Registration failed")
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "11px 14px", color: "var(--text)",
    fontSize: 14, outline: "none", boxSizing: "border-box",
  }

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg0)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "var(--bg1)", border: "1px solid var(--border)",
        borderRadius: 16, padding: "40px 44px", width: "100%", maxWidth: 400,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Create account</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 28 }}>
          Join EventEdge AI
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              style={inputStyle}
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center" }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading ? "var(--bg3)" : "var(--green)", border: "none",
              borderRadius: 8, padding: "12px", color: loading ? "var(--muted)" : "#fff",
              cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 14, marginTop: 4,
            }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--muted)" }}>
          Already have an account?{" "}
          <Link href="/auth/signin" style={{ color: "var(--text)", textDecoration: "underline" }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
