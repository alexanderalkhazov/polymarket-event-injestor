import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

export async function POST(req: Request) {
  const { email, password } = await req.json()
  if (!email || !password)
    return Response.json({ error: "email and password required" }, { status: 400 })

  const hash = await bcrypt.hash(password, 12)
  try {
    const res = await db.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hash]
    )
    return Response.json(res.rows[0], { status: 201 })
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505")
      return Response.json({ error: "email already registered" }, { status: 409 })
    throw err
  }
}
