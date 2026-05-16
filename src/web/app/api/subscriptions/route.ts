import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = (session.user as { id?: string }).id
  const res = await db.query(
    "SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC",
    [userId]
  )
  return Response.json(res.rows)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = (session.user as { id?: string }).id
  const { source, symbol, threshold } = await req.json()

  const res = await db.query(
    `INSERT INTO subscriptions (user_id, source, symbol, threshold)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, source, symbol) DO NOTHING
     RETURNING *`,
    [userId, source, symbol, threshold ?? null]
  )
  return Response.json(res.rows[0] ?? { ok: true }, { status: 201 })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 })
  const userId = (session.user as { id?: string }).id
  const { id } = await req.json()
  await db.query("DELETE FROM subscriptions WHERE id=$1 AND user_id=$2", [id, userId])
  return Response.json({ ok: true })
}
