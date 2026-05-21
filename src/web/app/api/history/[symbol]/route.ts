import { tsdb } from "@/lib/tsdb"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get("days") ?? "90")
  const interval = searchParams.get("interval") ?? "1d"
  const symbol = params.symbol

  const [ohlcvRes, techRes, sigRes, oppRes] = await Promise.all([
    tsdb.query(
      `SELECT ts, open, high, low, close, volume
       FROM raw_ohlcv
       WHERE symbol=$1 AND interval=$2 AND ts > NOW() - ($3 || ' days')::interval
       ORDER BY ts ASC`,
      [symbol, interval, days]
    ),
    tsdb.query(
      `SELECT ts, rsi_14 AS rsi, macd, macd_signal
       FROM technicals
       WHERE symbol=$1 AND interval=$2 AND ts > NOW() - ($3 || ' days')::interval
       ORDER BY ts ASC`,
      [symbol, interval, days]
    ),
    db.query(
      `SELECT id, source, type, symbol, score, created_at
       FROM signals WHERE symbol=$1 ORDER BY created_at DESC LIMIT 20`,
      [symbol]
    ),
    db.query(
      `SELECT id, action, model_confidence, expected_return_pct, created_at
       FROM opportunities WHERE $1 = ANY(tickers) ORDER BY created_at DESC LIMIT 10`,
      [symbol]
    ),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = (v: any) => (v != null ? Number(v) : null)

  return Response.json({
    ohlcv: ohlcvRes.rows.map((r) => ({
      ...r,
      open: n(r.open), high: n(r.high), low: n(r.low), close: n(r.close), volume: n(r.volume),
    })),
    technicals: techRes.rows.map((r) => ({
      ...r,
      rsi: n(r.rsi), macd: n(r.macd), macd_signal: n(r.macd_signal),
    })),
    signals: sigRes.rows.map((r) => ({ ...r, score: n(r.score) })),
    opportunities: oppRes.rows.map((r) => ({
      ...r,
      model_confidence: n(r.model_confidence), expected_return_pct: n(r.expected_return_pct),
    })),
  })
}
