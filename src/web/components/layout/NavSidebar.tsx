"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/",           label: "Strategies",  icon: "▦", color: "var(--green)" },
  { href: "/correlator", label: "Correlator",  icon: "◎", color: "var(--blue)" },
  { href: "/chart",      label: "Chart",       icon: "∿", color: "var(--blue)" },
  { href: "/backtests",  label: "Backtests",   icon: "↗", color: "var(--blue)" },
  { href: "/trades",     label: "Trades",      icon: "⊡", color: "var(--blue)" },
  { href: "/settings",   label: "Settings",    icon: "⚙", color: "var(--muted)" },
]

export function NavSidebar() {
  const pathname = usePathname()

  return (
    <nav style={{
      background: "var(--bg1)", borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column", alignItems: "center",
      paddingTop: 12, gap: 4, width: 52,
    }}>
      {/* Logo */}
      <div style={{
        width: 32, height: 32, background: "var(--green)", borderRadius: 8,
        marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-dm-mono)", fontSize: 11, fontWeight: 600, color: "#000",
        flexShrink: 0,
      }}>
        EE
      </div>

      {NAV.slice(0, -2).map((item) => {
        const active = pathname === item.href
        return (
          <Link key={item.href} href={item.href} title={item.label} style={{ textDecoration: "none" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: active ? "var(--bg3)" : "transparent",
              color: active ? item.color : "var(--muted)",
              fontSize: 16, cursor: "pointer",
              transition: "background 0.1s, color 0.1s",
            }}>
              {item.icon}
            </div>
          </Link>
        )
      })}

      <div style={{ flex: 1 }} />
      <div style={{ width: 28, height: 1, background: "var(--border)", margin: "4px 0" }} />

      {NAV.slice(-2).map((item) => {
        const active = pathname === item.href
        return (
          <Link key={item.href} href={item.href} title={item.label} style={{ textDecoration: "none", marginBottom: 4 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: active ? "var(--bg3)" : "transparent",
              color: active ? item.color : "var(--muted)",
              fontSize: 16, cursor: "pointer",
            }}>
              {item.icon}
            </div>
          </Link>
        )
      })}
    </nav>
  )
}
