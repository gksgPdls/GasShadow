import { useEffect, useState } from "react"

// 상단 탭 = 주소의 #/... (새로고침·공유해도 같은 탭이 열린다). 예: /?start=0912#/workers
export type Route = "prep" | "today" | "workers" | "history"
const ROUTES: Route[] = ["prep", "today", "workers", "history"]

const read = (): Route => {
  const r = location.hash.replace(/^#\/?/, "") as Route
  return ROUTES.includes(r) ? r : "today"
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(read)
  useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  const navigate = (r: Route) => {
    location.hash = `/${r}`
  }
  return { route, navigate }
}
