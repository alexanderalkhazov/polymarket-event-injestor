import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const source = searchParams.get("source")
  const limit = parseInt(searchParams.get("limit") ?? "100")

  let query = "SELECT * FROM signals WHERE created_at > NOW()-INTERVAL '24 hours'"
  const params: unknown[] = []

  if (source) {
    params.push(source)
    query += ` AND source=$${params.length}`
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
  params.push(limit)

  const res = await db.query(query, params)
  const signals = res.rows.map((r: Record<string, unknown>) => ({
    ...r,
    score: r.score != null ? Number(r.score) : 0,
  }))
  return Response.json({ signals })
}
