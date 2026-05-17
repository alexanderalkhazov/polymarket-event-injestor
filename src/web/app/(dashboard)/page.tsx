"use client"

import { useState, useMemo } from "react"
import { useStrategyStream, type Strategy } from "@/hooks/useStrategyStream"
import { StrategyCard } from "@/components/strategy/StrategyCard"
import { StrategyDetail } from "@/components/strategy/StrategyDetail"
import { Topbar } from "@/components/layout/Topbar"
import { Skeleton } from "@/components/ui/Skeleton"

type Filter = "all" | "pending" | "executed" | "dismissed" | "dropped"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending" },
  { key: "executed",  label: "Executed" },
  { key: "dismissed", label: "Dismissed" },
  { key: "dropped",   label: "Dropped" },
]

export default function StrategyInboxPage() {
  const { strategies, connected, loaded } = useStrategyStream()
  const [selected, setSelected] = useState<Strategy | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({})

  const merged = strategies.map((s) =>
    localStatuses[s.id] ? { ...s, status: localStatuses[s.id] } : s
  )

  const filtered = useMemo(() => {
    if (filter === "all") return merged
    if (filter === "dropped") return merged.filter((s) => s.status === "expired")
    return merged.filter((s) => s.status === filter)
  }, [merged, filter])

  const close = () => setSelected(null)

  const handleDismiss = () => {
    if (!selected) return
    setLocalStatuses((p) => ({ ...p, [selected.id]: "dismissed" }))
    setSelected(null)
  }

  const handleRestore = () => {
    if (!selected) return
    setLocalStatuses((p) => ({ ...p, [selected.id]: "pending" }))
    setSelected((prev) => prev ? { ...prev, status: "pending" } : null)
  }

  const handleExecuted = () => {
    if (!selected) return
    setLocalStatuses((p) => ({ ...p, [selected.id]: "executed" }))
    setSelected((prev) => prev ? { ...prev, status: "executed" } : null)
  }

  const pendingCount = merged.filter((s) => s.status === "pending").length

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        title="Strategy Inbox"
        subtitle={pendingCount > 0 ? `${pendingCount} pending` : undefined}
      />

      {/* filter bar */}
      <div style={{
        display: "flex", gap: 6, padding: "10px 20px",
        borderBottom: "1px solid var(--border)", flexShrink: 0,
        background: "var(--bg1)",
      }}>
        {FILTERS.map((f) => {
          const count = f.key === "all"
            ? merged.length
            : f.key === "dropped"
            ? merged.filter((s) => s.status === "expired").length
            : merged.filter((s) => s.status === f.key).length

          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? "var(--primary)" : "transparent",
                border: "none",
                borderRadius: 8, padding: "6px 14px", cursor: "pointer",
                fontSize: 13, fontWeight: filter === f.key ? 600 : 400,
                color: filter === f.key ? "#fff" : "var(--muted)",
                display: "flex", alignItems: "center", gap: 7,
                transition: "background 0.12s, color 0.12s",
              }}
            >
              {f.label}
              {count > 0 && (
                <span style={{
                  background: filter === f.key ? "rgba(255,255,255,0.25)" : "var(--bg3)",
                  borderRadius: 10, padding: "1px 7px",
                  fontSize: 11, fontFamily: "var(--font-dm-mono)",
                  color: filter === f.key ? "#fff" : "var(--dim)",
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* card list */}
        <div style={{
          width: selected ? "380px" : "100%", flexShrink: 0,
          overflowY: "auto", padding: "16px",
          display: "flex", flexDirection: "column", gap: 12,
          borderRight: selected ? "1px solid var(--border)" : "none",
          transition: "width 0.15s",
        }}>
          {!loaded && strategies.length === 0 && (
            <>
              <Skeleton height={120} />
              <Skeleton height={120} />
              <Skeleton height={80} />
            </>
          )}
          {loaded && strategies.length === 0 && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: 300, gap: 10,
              color: "var(--muted)", fontSize: 13,
            }}>
              <div style={{ fontSize: 28, opacity: 0.3 }}>◎</div>
              <div>Waiting for strategies</div>
              <div style={{ fontSize: 11, color: "var(--dim)" }}>
                The correlator will surface opportunities when signals align.
              </div>
            </div>
          )}
          {filtered.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              selected={selected?.id === s.id}
              onClick={() => setSelected(selected?.id === s.id ? null : s)}
            />
          ))}
          {filtered.length === 0 && strategies.length > 0 && (
            <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", paddingTop: 40 }}>
              No strategies match this filter.
            </div>
          )}
        </div>

        {/* detail panel */}
        {selected && (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <StrategyDetail
              strategy={merged.find((s) => s.id === selected.id) ?? selected}
              onClose={close}
              onDismiss={handleDismiss}
              onExecuted={handleExecuted}
              onRestore={handleRestore}
            />
          </div>
        )}
      </div>
    </div>
  )
}
