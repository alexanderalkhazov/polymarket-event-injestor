import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"

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

  // ── Close an open position ────────────────────────────────────────────────
  if (body.action === "close_position") {
    const { symbol, qty } = body
    if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 })
    const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
    const user = userRes.rows[0]
    if (!user?.alpaca_key_id || !user?.alpaca_secret)
      return Response.json({ error: "Alpaca not connected" }, { status: 422 })
    const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
    const order = await alpaca.createOrder({
      symbol,
      qty: qty ? qty.toString() : undefined,
      side: "sell",
      type: "market",
      time_in_force: "day",
    })
    await db.query(
      `INSERT INTO trades (user_id, alpaca_order_id, symbol, side, qty, status, is_paper)
       VALUES ($1,$2,$3,'sell',$4,'submitted',$5)`,
      [userId, order.id, symbol, parseFloat(order.qty ?? qty ?? "0"), user.is_paper],
    )
    return Response.json({ order_id: order.id, symbol, qty: order.qty })
  }

  const { strategy_id, confirmed, order_type, limit_price, stop_loss_price, take_profit_price } = body
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
  const sizing = strat.sizing_usd ?? equity * strat.sizing_pct
  const symbol = strat.tickers[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quote = await alpaca.getLatestQuote(symbol) as any
  const price = parseFloat(quote.ap ?? quote.AskPrice ?? quote.ask_price ?? "0")
  const qty = Math.floor(sizing / price)

  if (qty < 1)
    return Response.json({ error: "position too small for account size" }, { status: 422 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderParams: Record<string, any> = {
    symbol,
    qty: qty.toString(),
    side: strat.action === "sell" ? "sell" : "buy",
    type: order_type === "limit" ? "limit" : "market",
    time_in_force: "day",
  }
  if (order_type === "limit" && limit_price) {
    orderParams.limit_price = Number(limit_price).toFixed(2)
  }
  if (stop_loss_price || take_profit_price) {
    orderParams.order_class = "bracket"
    if (stop_loss_price) {
      orderParams.stop_loss = { stop_price: Number(stop_loss_price).toFixed(2) }
    }
    if (take_profit_price) {
      orderParams.take_profit = { limit_price: Number(take_profit_price).toFixed(2) }
    }
  }
  const order = await alpaca.createOrder(orderParams)

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
      equity: parseFloat(account.equity),
      cash: parseFloat(account.cash),
      buying_power: parseFloat(account.buying_power ?? "0"),
      unrealized_pl: parseFloat(account.unrealized_pl ?? "0"),
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
      const price = q ? parseFloat(q.ap ?? q.AskPrice ?? q.ask_price ?? "0") || null : null
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
