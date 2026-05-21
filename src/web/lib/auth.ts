import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "./db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const { email, password } = credentials as { email: string; password: string }
        const res = await db.query("SELECT * FROM users WHERE email=$1", [email])
        const user = res.rows[0]
        if (!user) return null
        const valid = await bcrypt.compare(password, user.password_hash)
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.email }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (session.user) (session.user as { id?: unknown }).id = token.id
      return session
    },
  },
  pages: { signIn: "/auth/signin" },
  secret: process.env.NEXTAUTH_SECRET,
})
