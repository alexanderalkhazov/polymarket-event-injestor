import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tsdb } from "@/lib/tsdb"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const id = searchParams.get("id")

  // Single strategy detail (for StrategyDetail panel)
  if (id) {
    const stratRes = await db.query(
      `SELECT s.*, o.summary, o.thesis, o.risk_note, o.historical_note,
              o.action, o.tickers, o.model_confidence,
              o.expected_return_pct, o.hold_days, o.stop_loss_pct,
              o.top_features, o.macro_snapshot,
              b.win_rate, b.sample_size, b.avg_return_pct, b.max_drawdown_pct, b.sharpe
       FROM strategies s
       JOIN opportunities o ON o.id = s.opportunity_id
       LEFT JOIN backtest_results b ON b.id = o.backtest_id
       WHERE s.id=$1 AND s.user_id=$2`,
      [id, userId]
    )
    const strat = stratRes.rows[0]
    if (!strat) return Response.json({ error: "not found" }, { status: 404 })

    // Fetch signals by IDs stored in opportunities.signal_ids array
    const sigRes = strat.signal_ids?.length
      ? await db.query(
          `SELECT id, source, type, symbol, score FROM signals
           WHERE id = ANY($1::uuid[]) ORDER BY score DESC LIMIT 10`,
          [strat.signal_ids]
        )
      : { rows: [] }

    const macroRes = await tsdb.query(
      `SELECT DISTINCT ON (series_id) series_id, value
       FROM raw_macro ORDER BY series_id, ts DESC LIMIT 6`
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = (v: any) => (v != null ? Number(v) : null)
    return Response.json({
      ...strat,
      model_confidence: n(strat.model_confidence),
      expected_return_pct: n(strat.expected_return_pct),
      stop_loss_pct: n(strat.stop_loss_pct),
      win_rate: n(strat.win_rate),
      avg_return_pct: n(strat.avg_return_pct),
      max_drawdown_pct: n(strat.max_drawdown_pct),
      sharpe: n(strat.sharpe),
      sample_size: n(strat.sample_size),
      signals: sigRes.rows.map((r) => ({ ...r, score: n(r.score) })),
      macro: macroRes.rows.map((r) => ({ ...r, value: n(r.value) })),
    })
  }

  let query = `
    SELECT s.*, o.summary, o.thesis, o.action, o.tickers, o.model_confidence,
           o.expected_return_pct, o.hold_days, o.stop_loss_pct,
           b.win_rate, b.sample_size, b.avg_return_pct, b.max_drawdown_pct
    FROM strategies s
    JOIN opportunities o ON o.id = s.opportunity_id
    LEFT JOIN backtest_results b ON b.id = o.backtest_id
    WHERE s.user_id=$1`
  const params: unknown[] = [userId]

  if (status) {
    params.push(status)
    query += ` AND s.status=$${params.length}`
  }

  query += " ORDER BY s.created_at DESC LIMIT 100"

  const res = await db.query(query, params)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = (v: any) => (v != null ? Number(v) : null)
  const rows = res.rows.map((r) => ({
    ...r,
    model_confidence: n(r.model_confidence),
    expected_return_pct: n(r.expected_return_pct),
    stop_loss_pct: n(r.stop_loss_pct),
    win_rate: n(r.win_rate),
    avg_return_pct: n(r.avg_return_pct),
    max_drawdown_pct: n(r.max_drawdown_pct),
    sample_size: n(r.sample_size),
  }))
  return Response.json(rows)
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const body = await req.json()

  // Profile update (risk level, onboarding flag)
  if (body.risk_level !== undefined || body.onboarding_complete !== undefined) {
    const updates: string[] = []
    const params: unknown[] = []

    if (body.risk_level) {
      params.push(body.risk_level); updates.push(`risk_level=$${params.length}`)
    }
    if (body.onboarding_complete !== undefined) {
      params.push(body.onboarding_complete); updates.push(`onboarding_complete=$${params.length}`)
    }

    if (updates.length) {
      params.push(userId)
      await db.query(`UPDATE users SET ${updates.join(",")} WHERE id=$${params.length}`, params)
    }
    return Response.json({ ok: true })
  }

  // Strategy status update (dismiss / restore / expire)
  const { id, status } = body
  if (!["dismissed", "expired", "pending"].includes(status))
    return Response.json({ error: "invalid status" }, { status: 400 })

  await db.query(
    "UPDATE strategies SET status=$1 WHERE id=$2 AND user_id=$3",
    [status, id, userId]
  )
  return Response.json({ ok: true })
}
