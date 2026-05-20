"use client"

import { useState, useEffect } from "react"
import type { Category, Subcategory } from "@/app/api/catalog/route"

interface Props {
  initialCategories?: string[]
  onChange?: (categories: string[]) => void
}

const PALETTE: Record<string, { bg: string; accent: string; border: string; bar: string }> = {
  crypto:      { bg: "rgba(245,158,11,0.08)",  accent: "#d97706", border: "rgba(245,158,11,0.30)", bar: "#d97706" },
  us_equities: { bg: "rgba(92,106,196,0.08)",  accent: "#818cf8", border: "rgba(92,106,196,0.30)", bar: "#818cf8" },
  commodities: { bg: "rgba(5,150,105,0.08)",   accent: "#10b981", border: "rgba(5,150,105,0.30)",  bar: "#10b981" },
  macro:       { bg: "rgba(220,38,38,0.08)",   accent: "#f87171", border: "rgba(220,38,38,0.30)",  bar: "#f87171" },
}
const DEFAULT_PALETTE = PALETTE.us_equities

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none"
      style={{ transform: up ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CategoryCatalog({ initialCategories = [], onChange }: Props) {
  const [catalog, setCatalog] = useState<Category[]>([])
  const [active, setActive] = useState<Set<string>>(new Set(initialCategories))
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)

  useEffect(() => { setActive(new Set(initialCategories)) }, [initialCategories])

  useEffect(() => {
    setCatalogLoading(true)
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => { if (d.catalog) setCatalog(d.catalog) })
      .catch(() => {})
      .finally(() => setCatalogLoading(false))
  }, [])

  const toggle = async (sub: Subcategory) => {
    const id = sub.id
    if (loading.has(id)) return
    setLoading((prev) => new Set(Array.from(prev).concat(id)))
    const isActive = active.has(id)
    try {
      if (isActive) {
        await fetch(`/api/categories?category=${encodeURIComponent(id)}`, { method: "DELETE" })
      } else {
        await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: id, symbols: sub.symbols.map((s) => s.ticker) }),
        })
      }
      const next = new Set(active)
      if (isActive) next.delete(id)
      else next.add(id)
      setActive(next)
      onChange?.(Array.from(next))
    } catch { /* ignore */ } finally {
      setLoading((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const toggleAll = async (cat: Category, selectAll: boolean) => {
    for (const sub of cat.subcategories) {
      if (selectAll && !active.has(sub.id)) await toggle(sub)
      if (!selectAll && active.has(sub.id)) await toggle(sub)
    }
  }

  if (catalogLoading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 110, borderRadius: 14 }} />
        ))}
      </div>
    )
  }

  const expandedCat = expanded ? catalog.find((c) => c.id === expanded) ?? null : null
  const expandedColors = expandedCat ? (PALETTE[expandedCat.id] ?? DEFAULT_PALETTE) : DEFAULT_PALETTE

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* 2×2 category card grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {catalog.map((cat) => {
          const isExpanded = expanded === cat.id
          const colors = PALETTE[cat.id] ?? DEFAULT_PALETTE
          const total = cat.subcategories.length
          const activeCount = cat.subcategories.filter((s) => active.has(s.id)).length
          const fraction = total > 0 ? activeCount / total : 0

          return (
            <button
              key={cat.id}
              onClick={() => setExpanded(isExpanded ? null : cat.id)}
              style={{
                background: isExpanded ? colors.bg : "var(--bg1)",
                border: `1.5px solid ${isExpanded ? colors.border : "var(--border)"}`,
                borderRadius: 14,
                boxShadow: "var(--shadow-card)",
                padding: "16px 18px 14px",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              {/* Top row: icon + chevron */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18,
                }}>
                  {cat.icon}
                </div>
                <span style={{ color: isExpanded ? colors.accent : "var(--dim)" }}>
                  <ChevronIcon up={isExpanded} />
                </span>
              </div>

              {/* Name */}
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 2 }}>
                {cat.label}
              </div>

              {/* Description — 1 line clamp */}
              <div style={{
                fontSize: 11, color: "var(--muted)", lineHeight: 1.4, marginBottom: 10,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {cat.description}
              </div>

              {/* Progress bar + count */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, height: 3, borderRadius: 99, background: "var(--bg3)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 99,
                    width: `${Math.round(fraction * 100)}%`,
                    background: activeCount > 0 ? colors.bar : "transparent",
                    transition: "width 0.3s ease",
                  }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: activeCount > 0 ? colors.accent : "var(--dim)", flexShrink: 0 }}>
                  {activeCount}/{total}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Expanded subcategory panel */}
      {expandedCat && (
        <div style={{
          background: "var(--bg1)",
          borderRadius: 14,
          border: `1.5px solid ${expandedColors.border}`,
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
          animation: "slide-up 0.15s ease-out",
        }}>
          {/* Panel header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${expandedColors.border}`,
            background: expandedColors.bg,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{expandedCat.icon}</span>
              <span style={{
                fontSize: 12, fontWeight: 700, color: expandedColors.accent,
                textTransform: "uppercase", letterSpacing: "0.07em",
              }}>
                {expandedCat.label}
              </span>
            </div>

            {/* Select all / None shortcuts */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={(e) => { e.stopPropagation(); toggleAll(expandedCat, true) }}
                style={{
                  fontSize: 11, fontWeight: 600,
                  color: expandedColors.accent,
                  background: "transparent",
                  border: `1px solid ${expandedColors.border}`,
                  borderRadius: 6, padding: "3px 10px",
                  cursor: "pointer",
                }}
              >
                All
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); toggleAll(expandedCat, false) }}
                style={{
                  fontSize: 11, fontWeight: 600,
                  color: "var(--muted)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6, padding: "3px 10px",
                  cursor: "pointer",
                }}
              >
                None
              </button>
            </div>
          </div>

          {/* Subcategory 2-col grid */}
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {expandedCat.subcategories.map((sub) => {
              const isActive = active.has(sub.id)
              const isLoading = loading.has(sub.id)

              return (
                <button
                  key={sub.id}
                  onClick={() => toggle(sub)}
                  disabled={isLoading}
                  style={{
                    position: "relative",
                    background: isActive ? expandedColors.bg : "var(--bg2)",
                    border: `1.5px solid ${isActive ? expandedColors.border : "var(--border)"}`,
                    borderRadius: 12, padding: "12px 14px 12px 14px",
                    textAlign: "left", cursor: isLoading ? "default" : "pointer",
                    transition: "all 0.15s",
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  {/* Checkmark badge — top right */}
                  <div style={{
                    position: "absolute", top: 10, right: 10,
                    width: 18, height: 18, borderRadius: "50%",
                    background: isActive ? expandedColors.bar : "var(--bg3)",
                    border: `1.5px solid ${isActive ? expandedColors.border : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.15s, border-color 0.15s",
                  }}>
                    {isActive && (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* Name */}
                  <div style={{
                    fontWeight: 700, fontSize: 13,
                    color: isActive ? expandedColors.accent : "var(--text)",
                    marginBottom: 3, paddingRight: 24,
                  }}>
                    {sub.label}
                  </div>

                  {/* Description — 2 lines max */}
                  <div style={{
                    fontSize: 11, color: "var(--muted)", marginBottom: 8,
                    lineHeight: 1.4,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>
                    {sub.description}
                  </div>

                  {/* Symbol chips — all symbols, wrapping */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {sub.symbols.map((sym) => (
                      <span key={sym.ticker} style={{
                        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                        background: isActive ? expandedColors.bg : "var(--bg3)",
                        color: isActive ? expandedColors.accent : "var(--muted)",
                        borderRadius: 5, padding: "2px 6px",
                        border: `1px solid ${isActive ? expandedColors.border : "transparent"}`,
                        transition: "all 0.15s",
                      }}>
                        {sym.ticker.replace("-USD", "")}
                      </span>
                    ))}
                  </div>

                  {isLoading && (
                    <div style={{ fontSize: 10, color: "var(--dim)", marginTop: 6 }}>saving…</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
