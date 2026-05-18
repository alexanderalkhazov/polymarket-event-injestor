import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"
import { getRedis } from "@/lib/redis"

const CACHE_TTL = 60 * 60 * 24  // 24h — names don't change

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const raw = searchParams.get("symbols") ?? ""
  const seen = new Set<string>()
  const symbols: string[] = []
  for (const s of raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) {
    if (!seen.has(s)) { seen.add(s); symbols.push(s) }
  }
  if (!symbols.length) return Response.json({})

  const redis = getRedis()
  const names: Record<string, string> = {}
  const missing: string[] = []

  // Check Redis cache first
  await Promise.all(
    symbols.map(async (sym) => {
      const cached = await redis.get(`asset_name:${sym}`)
      if (cached) names[sym] = cached
      else missing.push(sym)
    })
  )

  if (missing.length) {
    const userId = (session.user as { id?: string }).id
    const userRes = await db.query(
      "SELECT alpaca_key_id, alpaca_secret, is_paper FROM users WHERE id=$1",
      [userId]
    )
    const user = userRes.rows[0]

    if (user?.alpaca_key_id && user?.alpaca_secret) {
      const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
      await Promise.all(
        missing.map(async (sym) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const asset = await (alpaca as any).getAsset(sym)
            const name: string = asset?.name ?? sym
            names[sym] = name
            await redis.setex(`asset_name:${sym}`, CACHE_TTL, name)
          } catch {
            names[sym] = sym
          }
        })
      )
    } else {
      // No Alpaca — return symbol as name, don't cache so it retries when keys are added
      for (const sym of missing) names[sym] = sym
    }
  }

  return Response.json(names)
}
