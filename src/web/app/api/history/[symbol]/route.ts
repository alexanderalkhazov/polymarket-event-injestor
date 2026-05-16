import { tsdb } from "@/lib/tsdb"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get("days") ?? "90")
  const interval = searchParams.get("interval") ?? "1d"
  const symbol = params.symbol

  const [ohlcvRes, techRes, sigRes, oppRes] = await Promise.all([
    tsdb.query(
      `SELECT time AS ts, open, high, low, close, volume
       FROM ohlcv
       WHERE symbol=$1 AND interval=$2 AND time > NOW() - ($3 || ' days')::interval
       ORDER BY time ASC`,
      [symbol, interval, days]
    ),
    tsdb.query(
      `SELECT time AS ts, rsi_14 AS rsi, macd, macd_signal
       FROM technicals
       WHERE symbol=$1 AND interval=$2 AND time > NOW() - ($3 || ' days')::interval
       ORDER BY time ASC`,
      [symbol, interval, days]
    ),
    db.query(
      `SELECT id, source, type, score, created_at
       FROM signals WHERE $1 = ANY(tickers) ORDER BY created_at DESC LIMIT 20`,
      [symbol]
    ),
    db.query(
      `SELECT id, action, confidence, expected_return_pct, created_at
       FROM opportunities WHERE $1 = ANY(tickers) ORDER BY created_at DESC LIMIT 10`,
      [symbol]
    ),
  ])

  return Response.json({
    ohlcv: ohlcvRes.rows,
    technicals: techRes.rows,
    signals: sigRes.rows,
    opportunities: oppRes.rows,
  })
}
