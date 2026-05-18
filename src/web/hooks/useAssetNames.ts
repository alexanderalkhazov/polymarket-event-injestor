"use client"

import { useEffect, useState } from "react"

export function useAssetNames(symbols: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const seen = new Set<string>()
    const unique: string[] = []
    for (const s of symbols.filter(Boolean)) {
      if (!seen.has(s)) { seen.add(s); unique.push(s) }
    }
    if (!unique.length) return

    // Only fetch symbols we don't already have
    const needed = unique.filter((s) => !names[s])
    if (!needed.length) return

    fetch(`/api/asset?symbols=${needed.join(",")}`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data && typeof data === "object") setNames((prev) => ({ ...prev, ...data }))
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")])

  return names
}
