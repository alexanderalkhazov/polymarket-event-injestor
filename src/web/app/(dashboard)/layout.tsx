import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { NavSidebar } from "@/components/layout/NavSidebar"
import { ToastContainer } from "@/components/ui/Toast"
import { db } from "@/lib/db"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const userId = (session.user as { id?: string }).id
  if (userId) {
    const res = await db.query("SELECT onboarding_complete FROM users WHERE id=$1", [userId])
    if (res.rows[0] && !res.rows[0].onboarding_complete) redirect("/onboarding")
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "52px 1fr", height: "100vh", overflow: "hidden" }}>
      <NavSidebar />
      <main style={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
        {children}
      </main>
      <ToastContainer />
    </div>
  )
}
