"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

const NAV = [
  { href: "/",       label: "Strategies", icon: "⬡" },
  { href: "/trades", label: "Trades",     icon: "↗" },
]

const BOTTOM = [
  { href: "/settings", label: "Settings", icon: "⚙" },
]

type MarketStatus = { open: boolean; session: string; time: string; nextEvent: string }

function useMarketStatus() {
  const [status, setStatus] = useState<MarketStatus | null>(null)
  useEffect(() => {
    const fetch_ = () =>
      fetch("/api/market-status").then(r => r.json()).then(setStatus).catch(() => {})
    fetch_()
    const id = setInterval(fetch_, 30_000)
    return () => clearInterval(id)
  }, [])
  return status
}

export function NavSidebar() {
  const pathname = usePathname()
  const market   = useMarketStatus()

  return (
    <nav style={{
      background: "#1e2140",
      display: "flex",
      flexDirection: "column",
      padding: "16px 12px 12px",
      gap: 2,
      width: 200,
    }}>
      {/* Logo */}
      <Link href="/" style={{ textDecoration: "none", marginBottom: 28, paddingLeft: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34,
            background: "var(--primary)",
            borderRadius: 9,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-dm-mono)", fontSize: 11, fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}>
            EE
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#fff", letterSpacing: "-0.01em" }}>
              EventEdge
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", marginTop: 1 }}>
              AI TRADING
            </div>
          </div>
        </div>
      </Link>

      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em",
        textTransform: "uppercase", paddingLeft: 8, marginBottom: 4 }}>
        Navigation
      </div>

      {NAV.map((item) => (
        <NavItem key={item.href} item={item} active={pathname === item.href} />
      ))}

      <div style={{ flex: 1 }} />

      {/* Market status indicator */}
      {market && (
        <div style={{
          margin: "0 4px 8px",
          padding: "10px 12px",
          borderRadius: 10,
          background: market.open
            ? "rgba(34,197,94,0.12)"
            : "rgba(239,68,68,0.10)",
          border: `1px solid ${market.open ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.2)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: market.open ? "#22c55e" : "#ef4444",
              boxShadow: market.open ? "0 0 6px #22c55e" : "0 0 6px #ef4444",
            }} />
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
              color: market.open ? "#4ade80" : "#f87171",
              textTransform: "uppercase",
            }}>
              {market.open ? "Market Open" : market.session === "pre" ? "Pre-Market" : market.session === "after" ? "After-Hours" : "Market Closed"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", paddingLeft: 15 }}>
            {market.time}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", paddingLeft: 15, marginTop: 2 }}>
            {market.open ? `Closes ${market.nextEvent}` : `Opens ${market.nextEvent}`}
          </div>
        </div>
      )}

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "8px 0" }} />

      {BOTTOM.map((item) => (
        <NavItem key={item.href} item={item} active={pathname === item.href} />
      ))}
    </nav>
  )
}

function NavItem({
  item,
  active,
}: {
  item: { href: string; label: string; icon: string }
  active: boolean
}) {
  return (
    <Link href={item.href} style={{ textDecoration: "none" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px",
        borderRadius: 8,
        background: active ? "rgba(92,106,196,0.25)" : "transparent",
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        cursor: "pointer",
        transition: "background 0.12s, color 0.12s",
        borderLeft: active ? "3px solid var(--primary)" : "3px solid transparent",
      }}>
        <span style={{ fontSize: 16, width: 20, textAlign: "center", flexShrink: 0 }}>
          {item.icon}
        </span>
        <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>
          {item.label}
        </span>
      </div>
    </Link>
  )
}
