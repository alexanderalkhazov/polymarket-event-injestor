import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"
import { getRedis } from "@/lib/redis"

const MAX_POSITIONS       = parseInt(process.env.MAX_POSITIONS       ?? "5")
const DAILY_LOSS_LIMIT    = parseFloat(process.env.DAILY_LOSS_LIMIT  ?? "0.03")

function isMarketOpen(): boolean {
  const now = new Date()
  const et  = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
  const day = et.getDay() // 0=Sun 6=Sat
  if (day === 0 || day === 6) return false
  const mins = et.getHours() * 60 + et.getMinutes()
  return mins >= 9 * 60 + 30 && mins < 16 * 60
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json()
  const userId = (session.user as { id?: string }).id

  // ── Cancel a pending order ────────────────────────────────────────────────
  if (body.action === "cancel_order") {
    const { alpaca_order_id } = body
    if (!alpaca_order_id) return Response.json({ error: "alpaca_order_id required" }, { status: 400 })
    const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
    const user = userRes.rows[0]
    if (!user?.alpaca_key_id || !user?.alpaca_secret)
      return Response.json({ error: "Alpaca not connected" }, { status: 422 })
    const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (alpaca as any).cancelOrder(alpaca_order_id)
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.message ?? (err as any)?.message ?? "Cancel failed"
      return Response.json({ error: msg }, { status: 422 })
    }
    await db.query(
      "UPDATE trades SET status='cancelled' WHERE alpaca_order_id=$1 AND user_id=$2",
      [alpaca_order_id, userId],
    )
    return Response.json({ cancelled: true })
  }

  // ── Position management actions ───────────────────────────────────────────
  if (body.action === "close_position" || body.action === "sell_partial" || body.action === "add_to_position") {
    const { symbol, qty, order_type, limit_price } = body
    if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 })
    if (body.action !== "close_position" && (!qty || qty <= 0))
      return Response.json({ error: "qty required" }, { status: 400 })

    const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
    const user = userRes.rows[0]
    if (!user?.alpaca_key_id || !user?.alpaca_secret)
      return Response.json({ error: "Alpaca not connected" }, { status: 422 })

    if (!user.is_paper && !isMarketOpen())
      return Response.json({ error: "Market is closed" }, { status: 422 })

    const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
    const side   = body.action === "add_to_position" ? "buy" : "sell"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderParams: Record<string, any> = {
      symbol,
      qty:             qty ? qty.toString() : undefined,
      side,
      type:            order_type === "limit" ? "limit" : "market",
      time_in_force:   "day",
    }
    if (order_type === "limit" && limit_price)
      orderParams.limit_price = Number(limit_price).toFixed(2)

    const order = await alpaca.createOrder(orderParams)
    await db.query(
      `INSERT INTO trades (user_id, alpaca_order_id, symbol, side, qty, status, is_paper)
       VALUES ($1,$2,$3,$4,$5,'submitted',$6)`,
      [userId, order.id, symbol, side, parseFloat(order.qty ?? qty?.toString() ?? "0"), user.is_paper],
    )
    return Response.json({ order_id: order.id, symbol, qty: order.qty })
  }

  const { strategy_id, confirmed, order_type, limit_price, stop_loss_price, take_profit_price, trail_percent, leverage, extended_hours } = body
  if (!confirmed)
    return Response.json({ error: "explicit confirmation required" }, { status: 400 })

  const dup = await db.query(
    "SELECT id FROM trades WHERE strategy_id=$1 AND user_id=$2 AND status!='rejected'",
    [strategy_id, userId]
  )
  if (dup.rows.length)
    return Response.json({ error: "already submitted" }, { status: 409 })

  const stratRes = await db.query(
    `SELECT s.*, o.tickers, o.action
     FROM strategies s JOIN opportunities o ON o.id=s.opportunity_id
     WHERE s.id=$1 AND s.user_id=$2`,
    [strategy_id, userId]
  )
  const strat = stratRes.rows[0]
  if (!strat) return Response.json({ error: "strategy not found" }, { status: 404 })

  const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
  const user = userRes.rows[0]

  if (!user.alpaca_key_id || !user.alpaca_secret)
    return Response.json({ error: "Alpaca account not connected — add your API keys in Settings" }, { status: 422 })

  // Market hours — paper accounts can trade anytime; live accounts are gated
  if (!user.is_paper && !isMarketOpen())
    return Response.json({ error: "Market is closed. Orders can only be placed 9:30 AM – 4:00 PM ET, Mon–Fri." }, { status: 422 })

  const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
  const account = await alpaca.getAccount()
  const equity = parseFloat(account.equity)

  // Portfolio risk: max concurrent positions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openPositions = await (alpaca as any).getPositions().catch(() => []) as any[]
  if (openPositions.length >= MAX_POSITIONS)
    return Response.json({ error: `Max ${MAX_POSITIONS} concurrent positions reached. Close a position before adding a new one.` }, { status: 422 })

  // Portfolio risk: daily loss limit
  const lastEquity = parseFloat(account.last_equity ?? account.equity)
  if (lastEquity > 0) {
    const dailyReturn = (equity - lastEquity) / lastEquity
    if (dailyReturn <= -DAILY_LOSS_LIMIT)
      return Response.json({ error: `Daily loss limit reached (${(dailyReturn * 100).toFixed(1)}% today). Trading paused to protect capital.` }, { status: 422 })
  }
  const leverageMult = Math.min(Math.max(parseInt(leverage ?? "1"), 1), 4)
  const sizing = (strat.sizing_usd ?? equity * strat.sizing_pct) * leverageMult
  const symbol = strat.tickers[0]

  // Fetch price: prefer ask from latest quote, fall back to last trade price
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let price = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = await alpaca.getLatestQuote(symbol) as any
    price = parseFloat(quote.AskPrice ?? quote.ap ?? quote.ask_price ?? "0") || 0
  } catch { /* fall through to trade price */ }
  if (price <= 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trade = await (alpaca as any).getLatestTrade(symbol) as any
      price = parseFloat(trade.Price ?? trade.price ?? "0") || 0
    } catch { /* leave price as 0 */ }
  }
  if (price <= 0)
    return Response.json({ error: `Unable to get current price for ${symbol}. Market may be closed or data unavailable.` }, { status: 422 })

  const qty = Math.floor(sizing / price)

  if (!isFinite(qty) || qty < 1)
    return Response.json({ error: "position too small for account size" }, { status: 422 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Extended hours requires limit orders and day time_in_force
  const isExtended = extended_hours === true
  const effectiveType = isExtended ? "limit" : (order_type === "limit" ? "limit" : "market")
  const orderParams: Record<string, any> = {
    symbol,
    qty: qty.toString(),
    side: strat.action === "sell" ? "sell" : "buy",
    type: effectiveType,
    time_in_force: "day",
    ...(isExtended ? { extended_hours: true } : {}),
  }
  if (effectiveType === "limit") {
    const lp = limit_price ?? price
    orderParams.limit_price = Number(lp).toFixed(2)
  }
  const isBuy = strat.action !== "sell"
  if (trail_percent) {
    orderParams.order_class = "oto"
    orderParams.stop_loss   = { trail_percent: Number(trail_percent).toFixed(2) }
  } else {
    // Validate stop/take against actual price — frontend quote may be stale
    const slNum = stop_loss_price ? Number(stop_loss_price) : null
    const tpNum = take_profit_price ? Number(take_profit_price) : null
    const validSl = slNum && (isBuy ? slNum < price : slNum > price)
    const validTp = tpNum && (isBuy ? tpNum > price : tpNum < price)
    if (validSl || validTp) {
      orderParams.order_class = "bracket"
      if (validSl) orderParams.stop_loss    = { stop_price:  slNum!.toFixed(2) }
      if (validTp) orderParams.take_profit  = { limit_price: tpNum!.toFixed(2) }
    }
  }

  let order: Record<string, unknown>
  try {
    order = await alpaca.createOrder(orderParams) as Record<string, unknown>
  } catch (err: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const alpacaMsg = (err as any)?.response?.data?.message ?? (err as any)?.message ?? "Order rejected by broker"
    return Response.json({ error: alpacaMsg }, { status: 422 })
  }

  await db.query(
    `INSERT INTO trades (user_id,strategy_id,alpaca_order_id,symbol,side,qty,status,is_paper)
     VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7)`,
    [userId, strategy_id, order.id, symbol, order.side, qty, user.is_paper]
  )
  await db.query("UPDATE strategies SET status='executed' WHERE id=$1", [strategy_id])

  return Response.json({ order_id: order.id, qty, estimated_cost: qty * price })
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
