import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getAlpaca } from "@/lib/alpaca"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return new Response("unauthorized", { status: 401 })
  const userId = (session.user as { id?: string }).id

  const userRes = await db.query("SELECT * FROM users WHERE id=$1", [userId])
  const user = userRes.rows[0]
  if (!user?.alpaca_key_id || !user?.alpaca_secret)
    return new Response("Alpaca not connected", { status: 422 })

  const alpaca = getAlpaca(user.is_paper, user.alpaca_key_id, user.alpaca_secret)
  const encoder = new TextEncoder()
  let closed = false
  req.signal?.addEventListener("abort", () => { closed = true })

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch { closed = true }
      }

      while (!closed) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const [account, positions] = await Promise.all([
            alpaca.getAccount(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (alpaca as any).getPositions() as Promise<any[]>,
          ])

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const normPositions = (positions as any[]).map((p: any) => ({
            symbol:          p.symbol,
            side:            p.side,
            qty:             parseFloat(p.qty ?? p.quantity ?? "0"),
            avg_entry_price: parseFloat(p.avg_entry_price ?? p.avg_cost ?? "0"),
            current_price:   parseFloat(p.current_price ?? "0"),
            market_value:    parseFloat(p.market_value ?? "0"),
            unrealized_pl:   parseFloat(p.unrealized_pl ?? "0"),
            unrealized_plpc: parseFloat(p.unrealized_plpc ?? "0"),
          }))

          // Sum unrealized P&L from positions — the account-level unrealized_pl
          // field is often "0" outside market hours or on freshly-opened positions.
          const unrealizedPl = normPositions.reduce((s, p) => s + p.unrealized_pl, 0)

          send({
            account: {
              equity:        parseFloat(account.equity),
              cash:          parseFloat(account.cash),
              buying_power:  parseFloat(account.buying_power ?? "0"),
              unrealized_pl: unrealizedPl,
              last_equity:   parseFloat(account.last_equity ?? account.equity),
            },
            positions: normPositions,
            ts: Date.now(),
          })
        } catch { /* Alpaca unavailable — client keeps last state */ }

        await new Promise<void>((r) => {
          const t = setTimeout(r, 3000)
          req.signal?.addEventListener("abort", () => { clearTimeout(t); r() })
        })
      }

      try { controller.close() } catch { /* already closed */ }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
