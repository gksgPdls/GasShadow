import type { SimView } from "@/lib/sim"
import type { Route } from "@/lib/route"
import type { useSimulation } from "@/lib/useSimulation"

// 탭 페이지가 받는 공통 값
export interface PageProps {
  /** 당일 시뮬레이션 (관제 화면과 같은 값) */
  view: SimView
  /** 시뮬레이션 동작: 경보 확인·인력 호출·구역 상세 */
  sim: Pick<ReturnType<typeof useSimulation>, "ack" | "call" | "setBlower" | "logAction" | "release" | "zoneDetail" | "ai" | "source" | "stale" | "reconnect">
  /** 아직 만들지 않은 화면 버튼 → 안내 토스트 */
  onTodo: (what: string) => void
  navigate: (r: Route) => void
}
