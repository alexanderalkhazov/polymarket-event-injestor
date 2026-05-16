import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { strategy_id, confirmed } = await req.json()
  if (!confirmed)
    return Response.json({ error: "explicit confirmation required" }, { status: 400 })

  const userId = (session.user as { id?: string }).id

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

  const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id ?? undefined, user.alpaca_secret ?? undefined)
  const account = await alpaca.getAccount()
  const equity = parseFloat(account.equity)
  const sizing = strat.sizing_usd ?? equity * strat.sizing_pct
  const symbol = strat.tickers[0]
  const quote = await alpaca.getLatestQuote(symbol)
  const price = parseFloat(quote.ap)
  const qty = Math.floor(sizing / price)

  if (qty < 1)
    return Response.json({ error: "position too small for account size" }, { status: 422 })

  const order = await alpaca.createOrder({
    symbol,
    qty,
    side: strat.action === "sell" ? "sell" : "buy",
    type: "market",
    time_in_force: "day",
  })

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
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = (session.user as { id?: string }).id
  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type")

  if (type === "account") {
    const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
    const user = userRes.rows[0]
    if (!user) return Response.json({ error: "not found" }, { status: 404 })
    const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id ?? undefined, user.alpaca_secret ?? undefined)
    const account = await alpaca.getAccount()
    return Response.json({
      equity: parseFloat(account.equity),
      cash: parseFloat(account.cash),
      unrealized_pl: parseFloat(account.unrealized_pl ?? "0"),
    })
  }

  const [tradesRes, posRes] = await Promise.all([
    db.query("SELECT * FROM trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [userId]),
    db.query("SELECT * FROM positions WHERE user_id=$1", [userId]),
  ])

  return Response.json({ trades: tradesRes.rows, positions: posRes.rows })
}
