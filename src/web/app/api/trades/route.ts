import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"
import { getRedis } from "@/lib/redis"

// Trading is fully automated — the auto-trader service manages all order entry and exit.
export async function POST() {
  return Response.json(
    { error: "Trading is fully automated. The system manages all order entry and exit." },
    { status: 405 },
  )
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = (session.user as { id?: string }).id
  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type")

  if (type === "account") {
    const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
    const user = userRes.rows[0]
    if (!user) return Response.json({ error: "not found" }, { status: 404 })
    if (!user.alpaca_key_id || !user.alpaca_secret)
      return Response.json({ connected: false, is_paper: true })
    const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
    const account = await alpaca.getAccount()
    return Response.json({
      connected: true,
      is_paper: user.is_paper ?? true,
      equity:        parseFloat(account.equity),
      cash:          parseFloat(account.cash),
      buying_power:  parseFloat(account.buying_power ?? "0"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unrealized_pl: parseFloat((account as any).unrealized_pl ?? "0"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      last_equity:   parseFloat((account as any).last_equity ?? account.equity),
    })
  }

  if (type === "quote") {
    const symbol = searchParams.get("symbol")
    if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 })
    const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
    const user = userRes.rows[0]
    if (!user?.alpaca_key_id || !user?.alpaca_secret)
      return Response.json({ price: null, atr: null, symbol })
    try {
      const { tsdb } = await import("@/lib/tsdb")
      const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [quote, atrRow] = await Promise.allSettled([
        alpaca.getLatestQuote(symbol) as Promise<unknown>,
        tsdb.query("SELECT atr_14 FROM features WHERE symbol=$1 ORDER BY ts DESC LIMIT 1", [symbol]),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = quote.status === "fulfilled" ? (quote.value as any) : null
      const price = q ? parseFloat(q.AskPrice ?? q.ap ?? q.ask_price ?? "0") || null : null
      const atrVal = atrRow.status === "fulfilled" ? atrRow.value.rows[0]?.atr_14 : null
      const atr = atrVal ? parseFloat(atrVal) : null
      return Response.json({ price, atr, symbol })
    } catch {
      return Response.json({ price: null, atr: null, symbol })
    }
  }

  const userRes = await db.query("SELECT alpaca_key_id, alpaca_secret, is_paper FROM users WHERE id=$1", [userId])
  const user = userRes.rows[0]
  const hasAlpaca = !!(user?.alpaca_key_id && user?.alpaca_secret)

  const tradesRes = await db.query(
    "SELECT * FROM trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
    [userId],
  )

  // Sync fill status for any submitted orders that may have filled since last check
  if (hasAlpaca) {
    const submitted = tradesRes.rows.filter((t) => t.status === "submitted" && t.alpaca_order_id)
    if (submitted.length) {
      const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
      await Promise.all(submitted.map(async (trade) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const order = await (alpaca as any).getOrder(trade.alpaca_order_id)
          if (order.status === "filled") {
            const fillPrice = parseFloat(order.filled_avg_price ?? "0") || null
            const filledAt  = order.filled_at ? new Date(order.filled_at) : new Date()
            await db.query(
              "UPDATE trades SET status='filled', fill_price=$1, filled_at=$2 WHERE id=$3",
              [fillPrice, filledAt, trade.id]
            )
            trade.status     = "filled"
            trade.fill_price = fillPrice
            trade.filled_at  = filledAt

            // P&L → SPRT feedback: when a sell (position close) fills, record win/loss
            // on the parent hypothesis so the SPRT health check stays calibrated.
            if (trade.side === "sell" && trade.strategy_id && fillPrice) {
              try {
                const hypRow = await db.query(
                  `SELECT o.hypothesis_id, t_buy.fill_price AS entry_price, t_buy.qty
                   FROM strategies s
                   JOIN opportunities o ON o.id = s.opportunity_id
                   LEFT JOIN trades t_buy ON t_buy.strategy_id = s.id
                     AND t_buy.side = 'buy' AND t_buy.status = 'filled'
                   WHERE s.id = $1
                   LIMIT 1`,
                  [trade.strategy_id]
                )
                const hyp = hypRow.rows[0]
                if (hyp?.hypothesis_id && hyp.entry_price) {
                  const pnl = (fillPrice - parseFloat(hyp.entry_price)) * parseFloat(hyp.qty ?? "1")
                  const isWin = pnl > 0
                  await db.query(
                    isWin
                      ? "UPDATE hypotheses SET sprt_wins = sprt_wins + 1 WHERE id=$1"
                      : "UPDATE hypotheses SET sprt_losses = sprt_losses + 1 WHERE id=$1",
                    [hyp.hypothesis_id]
                  )
                  // Re-entry lockout: block the correlator from re-entering this symbol
                  // for 2 hours after a loss to avoid catching falling knives.
                  if (!isWin) {
                    const redis = getRedis()
                    await redis.setex(`reentry_lock:${trade.symbol}`, 7200, "1")
                  }
                }
              } catch { /* best-effort — never block the fill response */ }
            }
          } else if (["cancelled", "expired", "rejected"].includes(order.status)) {
            await db.query("UPDATE trades SET status=$1 WHERE id=$2", [order.status, trade.id])
            trade.status = order.status
          }
        } catch { /* order may not exist yet — skip */ }
      }))
    }
  }

  // Live positions and orders come from Alpaca (not the local shadow table)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let positions: any[]  = []
  let alpacaOrders: unknown[] = []
  if (hasAlpaca) {
    const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
    const [posResult, ordResult] = await Promise.allSettled([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (alpaca as any).getPositions(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (alpaca as any).getOrders({ status: "all", limit: 50 }),
    ])
    if (posResult.status === "fulfilled") positions   = posResult.value
    if (ordResult.status === "fulfilled") alpacaOrders = ordResult.value
  }

  // Normalise Alpaca position field names for the frontend
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normPos = positions.map((p: any) => ({
    symbol:           p.symbol,
    side:             p.side,
    qty:              parseFloat(p.qty ?? p.quantity ?? "0"),
    avg_entry_price:  parseFloat(p.avg_entry_price ?? p.avg_cost ?? "0"),
    current_price:    parseFloat(p.current_price ?? "0"),
    market_value:     parseFloat(p.market_value ?? "0"),
    unrealized_pl:    parseFloat(p.unrealized_pl ?? "0"),
    unrealized_plpc:  parseFloat(p.unrealized_plpc ?? "0"),
  }))

  return Response.json({ trades: tradesRes.rows, positions: normPos, alpacaOrders, hasAlpaca })
}
