import { useSyncExternalStore } from "react"

// 출입현황판에 지금 걸린 출입증 (3D가 알려준다). 오늘 관제 · 작업자 관리가 같이 본다
// tagged: 구역 → 걸린 작업자 번호 · started: 작업 시간이 시작된 구역
// focus: 작업자 관리에서 "현황판 보기"를 누른 구역 (오늘 관제가 받아서 연다)
interface CrewState {
  tagged: Record<string, number[]>
  started: Record<string, boolean>
  focus: string | null
}

let state: CrewState = { tagged: {}, started: {}, focus: null }
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function setCrew(zoneId: string, ns: number[], started: boolean) {
  state = { ...state, tagged: { ...state.tagged, [zoneId]: ns }, started: { ...state.started, [zoneId]: started } }
  emit()
}

export function focusCrew(zoneId: string | null) {
  state = { ...state, focus: zoneId }
  emit()
}

export function useCrewState() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}
