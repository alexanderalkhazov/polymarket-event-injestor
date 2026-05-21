"use client"

import { useState, useMemo, useEffect } from "react"
import { useStrategyStream } from "@/hooks/useStrategyStream"
import { useAssetNames } from "@/hooks/useAssetNames"
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
  { key: "dropped",   label: "Expired" },
]

export default function StrategyInboxPage() {
  const { strategies, loaded } = useStrategyStream()
  const allTickers = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const s of strategies) {
      for (const t of s.tickers ?? []) {
        if (!seen.has(t)) { seen.add(t); result.push(t) }
      }
    }
    return result
  }, [strategies])
  const assetNames = useAssetNames(allTickers)
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [filter, setFilter]             = useState<Filter>("all")
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({})

  const merged = useMemo(
    () => strategies.map((s) => localStatuses[s.id] ? { ...s, status: localStatuses[s.id] } : s),
    [strategies, localStatuses],
  )

  const selected = selectedId ? (merged.find((s) => s.id === selectedId) ?? null) : null

  const filtered = useMemo(() => {
    if (filter === "all")     return merged
    if (filter === "dropped") return merged.filter((s) => s.status === "expired")
    return merged.filter((s) => s.status === filter)
  }, [merged, filter])

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = selected ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [!!selected])

  const handleSelect  = (id: string) => setSelectedId(id)
  const close         = () => setSelectedId(null)

  const handleDismiss  = () => { if (selectedId) { setLocalStatuses((p) => ({ ...p, [selectedId]: "dismissed" })); close() } }
  const handleRestore  = () => { if (selectedId) setLocalStatuses((p) => ({ ...p, [selectedId]: "pending" })) }
  const handleExecuted = () => { if (selectedId) { setLocalStatuses((p) => ({ ...p, [selectedId]: "executed" })); close() } }

  const pendingCount = merged.filter((s) => s.status === "pending").length

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg0)" }}>
      <Topbar
        title="Strategy Inbox"
        subtitle={pendingCount > 0 ? `${pendingCount} pending` : undefined}
      />

      {/* Filter bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "8px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg1)", flexShrink: 0,
      }}>
        {FILTERS.map((f) => {
          const count =
            f.key === "all"     ? merged.length
            : f.key === "dropped" ? merged.filter((s) => s.status === "expired").length
            : merged.filter((s) => s.status === f.key).length
          const isActive = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: isActive ? "var(--primary)" : "transparent",
                border: "none", borderRadius: 8,
                padding: "5px 13px", cursor: "pointer",
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                color: isActive ? "#fff" : "var(--muted)",
                display: "flex", alignItems: "center", gap: 6,
                transition: "all 0.12s",
              }}
            >
              {f.label}
              {count > 0 && (
                <span style={{
                  background: isActive ? "rgba(255,255,255,0.22)" : "var(--bg3)",
                  color: isActive ? "#fff" : "var(--dim)",
                  borderRadius: 10, padding: "1px 6px",
                  fontSize: 11, fontFamily: "var(--font-dm-mono)",
                  minWidth: 18, textAlign: "center",
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Card list — always full width */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px" }}>
        {!loaded && strategies.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={128} />
            <Skeleton height={128} />
            <Skeleton height={100} />
          </div>
        )}
        {loaded && strategies.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            height: 320, gap: 12, color: "var(--muted)",
          }}>
            <div style={{ fontSize: 36, opacity: 0.2 }}>◎</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Waiting for strategies</div>
            <div style={{ fontSize: 12, color: "var(--dim)", textAlign: "center", maxWidth: 240, lineHeight: 1.6 }}>
              The correlator will surface opportunities when signals align.
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 680, margin: "0 auto" }}>
          {filtered.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              assetNames={assetNames}
              selected={selectedId === s.id}
              onClick={() => handleSelect(s.id)}
            />
          ))}
        </div>
        {filtered.length === 0 && strategies.length > 0 && (
          <div style={{ textAlign: "center", paddingTop: 48, fontSize: 13, color: "var(--dim)" }}>
            No strategies match this filter.
          </div>
        )}
      </div>

      {/* Modal overlay */}
      {selected && (
        <>
          {/* Backdrop */}
          <div
            onClick={close}
            style={{
              position: "fixed", inset: 0, zIndex: 50,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(3px)",
              WebkitBackdropFilter: "blur(3px)",
            }}
          />
          {/* Modal */}
          <div style={{
            position: "fixed", zIndex: 51,
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(780px, calc(100vw - 32px))",
          }}>
            <StrategyDetail
              key={selected.id}
              strategy={selected}
              assetNames={assetNames}
              onClose={close}
              onDismiss={handleDismiss}
              onExecuted={handleExecuted}
              onRestore={handleRestore}
            />
          </div>
        </>
      )}
    </div>
  )
}
