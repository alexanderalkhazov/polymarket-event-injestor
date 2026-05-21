import { auth } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const res = await db.query(
    "SELECT risk_level, is_paper, alpaca_key_id, onboarding_complete FROM users WHERE id=$1",
    [userId]
  )
  const user = res.rows[0]
  if (!user) return Response.json({ error: "not found" }, { status: 404 })

  return Response.json({
    risk_level: user.risk_level,
    is_paper: user.is_paper,
    alpaca_key_id: user.alpaca_key_id ?? "",
    onboarding_complete: user.onboarding_complete,
  })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const userId = (session.user as { id?: string }).id
  const body = await req.json()

  const updates: string[] = []
  const params: unknown[] = []

  if (body.risk_level !== undefined) {
    const valid = ["conservative", "moderate", "aggressive"]
    if (!valid.includes(body.risk_level))
      return Response.json({ error: "invalid risk_level" }, { status: 400 })
    params.push(body.risk_level); updates.push(`risk_level=$${params.length}`)
  }
  if (body.alpaca_key_id !== undefined) {
    params.push(body.alpaca_key_id); updates.push(`alpaca_key_id=$${params.length}`)
  }
  if (body.alpaca_secret !== undefined) {
    params.push(body.alpaca_secret); updates.push(`alpaca_secret=$${params.length}`)
  }
  if (body.is_paper !== undefined) {
    params.push(body.is_paper); updates.push(`is_paper=$${params.length}`)
  }
  if (body.onboarding_complete !== undefined) {
    params.push(body.onboarding_complete); updates.push(`onboarding_complete=$${params.length}`)
  }

  if (!updates.length) return Response.json({ ok: true })

  params.push(userId)
  await db.query(`UPDATE users SET ${updates.join(",")} WHERE id=$${params.length}`, params)
  return Response.json({ ok: true })
}
