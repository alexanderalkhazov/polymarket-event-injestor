import { auth } from "@/lib/auth"
import { getRedis } from "@/lib/redis"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return new Response("Unauthorized", { status: 401 })

  const sub = getRedis().duplicate()
  const channel = `strategies:${(session.user as { id?: string }).id}`

  const stream = new ReadableStream({
    async start(controller) {
      await sub.subscribe(channel)
      sub.on("message", (_, data) => {
        controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
      })
      const hb = setInterval(
        () => controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")),
        30_000
      )
      req.signal.addEventListener("abort", async () => {
        clearInterval(hb)
        await sub.unsubscribe(channel)
        await sub.quit()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
