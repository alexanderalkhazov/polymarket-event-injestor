import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

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
      `SELECT s.*, o.summary, o.thesis, o.action, o.tickers, o.confidence,
              o.expected_return_pct, o.hold_days, o.stop_loss_pct,
              o.historical_context, o.macro_notes,
              b.win_rate, b.sample_size, b.avg_return_pct, b.max_drawdown_pct,
              b.max_drawdown_pct, b.sharpe
       FROM strategies s
       JOIN opportunities o ON o.id = s.opportunity_id
       LEFT JOIN backtest_results b ON b.id = o.backtest_id
       WHERE s.id=$1 AND s.user_id=$2`,
      [id, userId]
    )
    const strat = stratRes.rows[0]
    if (!strat) return Response.json({ error: "not found" }, { status: 404 })

    const sigRes = await db.query(
      `SELECT sig.id, sig.source, sig.type, sig.symbol, sig.score
       FROM signals sig
       JOIN opportunities_signals os ON os.signal_id = sig.id
       JOIN opportunities o ON o.id = os.opportunity_id
       JOIN strategies s ON s.opportunity_id = o.id
       WHERE s.id=$1 ORDER BY sig.score DESC LIMIT 10`,
      [id]
    )

    const macroRes = await db.query(
      `SELECT series_id, value FROM macro_indicators
       ORDER BY ts DESC LIMIT 6`
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = (v: any) => (v != null ? Number(v) : null)
    return Response.json({
      ...strat,
      confidence: n(strat.confidence),
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
    SELECT s.*, o.summary, o.thesis, o.action, o.tickers, o.confidence,
           o.expected_return_pct, o.hold_days, o.stop_loss_pct,
           o.historical_context, o.macro_notes,
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
    confidence: n(r.confidence),
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

  // Profile update (from settings/onboarding)
  if (body.risk_level !== undefined) {
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

  // Strategy status update
  const { id, status } = body
  if (!["dismissed", "expired"].includes(status))
    return Response.json({ error: "invalid status" }, { status: 400 })

  await db.query(
    "UPDATE strategies SET status=$1 WHERE id=$2 AND user_id=$3",
    [status, id, userId]
  )
  return Response.json({ ok: true })
}
