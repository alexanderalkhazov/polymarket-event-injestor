import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

const VALID_CATEGORIES = [
  "oil_energy", "us_equities", "crypto", "rates_macro", "commodities", "fx",
] as const

const CATEGORY_SYMBOLS: Record<string, string[]> = {
  oil_energy:  ["USO", "XOM", "XLE", "LNG"],
  us_equities: ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
  crypto:      ["BTC-USD", "ETH-USD", "SOL-USD"],
  rates_macro: ["TLT", "GLD", "SLV"],
  commodities: ["GLD", "SLV", "UNG", "WEAT"],
  fx:          [],
}

const SOURCES = ["polymarket", "news", "analytics"]

async function resolveSubscriptions(userId: string): Promise<void> {
  const catRows = await db.query(
    "SELECT category FROM market_category_subscriptions WHERE user_id=$1",
    [userId]
  )
  const activeSymbols = new Set<string>()
  for (const row of catRows.rows) {
    for (const sym of CATEGORY_SYMBOLS[row.category] ?? []) {
      activeSymbols.add(sym)
    }
  }

  // Insert new subscriptions
  for (const symbol of Array.from(activeSymbols)) {
    for (const source of SOURCES) {
      await db.query(
        "INSERT INTO subscriptions (user_id, source, symbol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [userId, source, symbol]
      )
    }
  }

  // Remove stale subscriptions
  if (activeSymbols.size > 0) {
    await db.query(
      "DELETE FROM subscriptions WHERE user_id=$1 AND symbol != ALL($2::text[])",
      [userId, Array.from(activeSymbols)]
    )
  } else {
    await db.query("DELETE FROM subscriptions WHERE user_id=$1", [userId])
  }
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const rows = await db.query(
    "SELECT category FROM market_category_subscriptions WHERE user_id=$1 ORDER BY created_at",
    [userId]
  )
  return Response.json({ categories: rows.rows.map((r) => r.category) })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const { category } = await req.json()

  if (!VALID_CATEGORIES.includes(category)) {
    return Response.json({ error: "invalid category" }, { status: 400 })
  }

  await db.query(
    "INSERT INTO market_category_subscriptions (user_id, category) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [userId, category]
  )
  await resolveSubscriptions(userId!)
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const { searchParams } = new URL(req.url)
  const category = searchParams.get("category")

  if (!category || !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    return Response.json({ error: "invalid category" }, { status: 400 })
  }

  await db.query(
    "DELETE FROM market_category_subscriptions WHERE user_id=$1 AND category=$2",
    [userId, category]
  )
  await resolveSubscriptions(userId!)
  return Response.json({ ok: true })
}
