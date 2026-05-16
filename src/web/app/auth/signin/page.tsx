"use client"

import { Suspense, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"

function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const callbackUrl = params.get("callbackUrl") ?? "/"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    const res = await signIn("credentials", { email, password, redirect: false })
    setLoading(false)
    if (res?.ok) {
      router.push(callbackUrl)
    } else {
      setError("Invalid email or password")
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "11px 14px", color: "var(--text)",
    fontSize: 14, outline: "none", boxSizing: "border-box",
  }

  return (
    <div style={{
      background: "var(--bg1)", border: "1px solid var(--border)",
      borderRadius: 16, padding: "40px 44px", width: "100%", maxWidth: 400,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Sign in</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 28 }}>
        to EventEdge AI
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required autoComplete="email" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required autoComplete="current-password" style={inputStyle} />
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--red)", textAlign: "center" }}>{error}</div>
        )}
        <button type="submit" disabled={loading} style={{
          background: loading ? "var(--bg3)" : "var(--green)", border: "none",
          borderRadius: 8, padding: "12px", color: loading ? "var(--muted)" : "#000",
          cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 14, marginTop: 4,
        }}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--muted)" }}>
        No account?{" "}
        <Link href="/auth/register" style={{ color: "var(--text)", textDecoration: "underline" }}>
          Register
        </Link>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg0)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <Suspense fallback={<div style={{ color: "var(--muted)" }}>Loading…</div>}>
        <SignInForm />
      </Suspense>
    </div>
  )
}
