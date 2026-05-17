import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

// Subcategory → symbol list (kept in sync with catalog/route.ts static data)
// Crypto symbols come live from CoinGecko so they're resolved at subscribe-time
// by fetching the catalog. Static categories are duplicated here for fast resolution.
const SUBCATEGORY_SYMBOLS: Record<string, string[]> = {
  // US Equities
  equities_tech:      ["AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","INTC","CRM"],
  equities_finance:   ["JPM","BAC","GS","MS","WFC","BLK","V","MA"],
  equities_healthcare:["JNJ","UNH","LLY","PFE","MRNA","ABBV","AMGN","BMY"],
  equities_indices:   ["SPY","QQQ","DIA","IWM","VTI","EEM","ARKK"],
  // Commodities
  commodities_metals:      ["GLD","SLV","GOLD","NEM","RGLD"],
  commodities_energy:      ["USO","UNG","BNO","XLE","XOM","CVX","LNG"],
  commodities_agriculture: ["WEAT","CORN","SOYB","DBA","MOO"],
  // Macro
  macro_bonds:     ["TLT","IEF","SHY","HYG","JNK","AGG"],
  macro_inflation: ["TIP","PDBC","IAU","INFL"],
  // Crypto — these can also be in the DB directly from the catalog response
  crypto_large_cap: ["BTC-USD","ETH-USD","BNB-USD","SOL-USD","XRP-USD","ADA-USD","DOGE-USD","AVAX-USD"],
  crypto_defi:      ["UNI-USD","AAVE-USD","MKR-USD","CRV-USD","SNX-USD"],
  crypto_layer1:    ["SOL-USD","ADA-USD","AVAX-USD","DOT-USD","ATOM-USD"],
  crypto_layer2:    ["MATIC-USD","ARB-USD","OP-USD","IMX-USD"],
  crypto_meme:      ["DOGE-USD","SHIB-USD","PEPE-USD","WIF-USD"],
  crypto_ai:        ["FET-USD","RNDR-USD","TAO-USD","AGIX-USD"],
}

const SOURCES = ["polymarket", "news", "analytics"]

async function resolveSubscriptions(userId: string): Promise<void> {
  const catRows = await db.query(
    "SELECT category FROM market_category_subscriptions WHERE user_id=$1",
    [userId]
  )
  const activeSymbols = new Set<string>()
  for (const row of catRows.rows) {
    for (const sym of SUBCATEGORY_SYMBOLS[row.category] ?? []) {
      activeSymbols.add(sym)
    }
  }

  for (const symbol of Array.from(activeSymbols)) {
    for (const source of SOURCES) {
      await db.query(
        "INSERT INTO subscriptions (user_id, source, symbol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [userId, source, symbol]
      )
    }
  }

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
  const { category, symbols } = await req.json()

  if (!category || typeof category !== "string") {
    return Response.json({ error: "category required" }, { status: 400 })
  }

  await db.query(
    "INSERT INTO market_category_subscriptions (user_id, category) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [userId, category]
  )

  // If caller passed live symbols (e.g. from CoinGecko catalog), upsert them directly
  if (Array.isArray(symbols) && symbols.length > 0) {
    SUBCATEGORY_SYMBOLS[category] = symbols
  }

  await resolveSubscriptions(userId!)
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = (session.user as { id?: string }).id
  const { searchParams } = new URL(req.url)
  const category = searchParams.get("category")

  if (!category) return Response.json({ error: "category required" }, { status: 400 })

  await db.query(
    "DELETE FROM market_category_subscriptions WHERE user_id=$1 AND category=$2",
    [userId, category]
  )
  await resolveSubscriptions(userId!)
  return Response.json({ ok: true })
}
