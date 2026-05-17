"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/",       label: "Strategies", icon: "⬡" },
  { href: "/trades", label: "Trades",     icon: "↗" },
]

const BOTTOM = [
  { href: "/settings", label: "Settings", icon: "⚙" },
]

export function NavSidebar() {
  const pathname = usePathname()

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
