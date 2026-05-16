import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const passed = searchParams.get("passed")
  const days = parseInt(searchParams.get("days") ?? "30")

  let query = `SELECT * FROM backtest_results
               WHERE created_at > NOW() - ($1 || ' days')::interval`
  const params: unknown[] = [days]

  if (passed !== null) {
    params.push(passed === "true")
    query += ` AND passed=$${params.length}`
  }

  query += " ORDER BY created_at DESC LIMIT 500"
  const res = await db.query(query, params)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = (v: any) => (v != null ? Number(v) : null)
  const results = res.rows.map((r) => ({
    ...r,
    win_rate: n(r.win_rate),
    avg_return_pct: n(r.avg_return_pct),
    max_drawdown_pct: n(r.max_drawdown_pct),
    sharpe: n(r.sharpe),
    sample_size: n(r.sample_size),
  }))
  return Response.json({ results })
}
