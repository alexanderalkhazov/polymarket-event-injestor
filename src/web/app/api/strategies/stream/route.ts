import { auth } from "@/lib/auth"
import { getRedis } from "@/lib/redis"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return new Response("Unauthorized", { status: 401 })

  const userId = (session.user as { id?: string }).id
  const channel = `strategies:${userId}`
  const sub = getRedis().duplicate()
  const enc = new TextEncoder()

  let hb: ReturnType<typeof setInterval>
  let closed = false

  const cleanup = async () => {
    if (closed) return
    closed = true
    clearInterval(hb)
    sub.removeAllListeners()
    try { await sub.unsubscribe(channel) } catch {}
    try { await sub.quit() } catch {}
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Make controller.close() idempotent — Next.js internals call it on disconnect
      // and may call it again after our cancel() has already closed the stream.
      const origClose = controller.close.bind(controller)
      let ctrlClosed = false
      controller.close = () => {
        if (ctrlClosed) return
        ctrlClosed = true
        try { origClose() } catch {}
      }

      await sub.subscribe(channel)

      sub.on("message", (_ch: string, data: string) => {
        if (closed || ctrlClosed) return
        try { controller.enqueue(enc.encode(`data: ${data}\n\n`)) } catch {}
      })

      hb = setInterval(() => {
        if (closed || ctrlClosed) { clearInterval(hb); return }
        try { controller.enqueue(enc.encode(": heartbeat\n\n")) } catch {}
      }, 30_000)

      req.signal.addEventListener("abort", cleanup, { once: true })
    },
    cancel: cleanup,
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
