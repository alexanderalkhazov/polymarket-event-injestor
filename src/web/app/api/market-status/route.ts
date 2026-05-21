import { NextResponse } from "next/server"

function getMarketStatus() {
  const now = new Date()
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
  const day = et.getDay() // 0=Sun, 6=Sat
  const mins = et.getHours() * 60 + et.getMinutes()

  const isWeekend = day === 0 || day === 6
  const isRegular = !isWeekend && mins >= 9 * 60 + 30 && mins < 16 * 60
  const isPre     = !isWeekend && mins >= 4 * 60 && mins < 9 * 60 + 30
  const isAfter   = !isWeekend && mins >= 16 * 60 && mins < 20 * 60

  // Next open: next weekday at 09:30 ET
  const nextOpen = new Date(et)
  nextOpen.setSeconds(0, 0)
  if (isRegular) {
    nextOpen.setHours(16, 0)
  } else if (isPre) {
    nextOpen.setHours(9, 30)
  } else {
    nextOpen.setDate(nextOpen.getDate() + 1)
    while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
      nextOpen.setDate(nextOpen.getDate() + 1)
    }
    nextOpen.setHours(9, 30)
  }

  return {
    open: isRegular,
    session: isRegular ? "regular" : isPre ? "pre" : isAfter ? "after" : "closed",
    time: `${String(et.getHours()).padStart(2,"0")}:${String(et.getMinutes()).padStart(2,"0")} ET`,
    nextEvent: nextOpen.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/New_York",
    }),
  }
}

export function GET() {
  return NextResponse.json(getMarketStatus(), {
    headers: { "Cache-Control": "no-store" },
  })
}
