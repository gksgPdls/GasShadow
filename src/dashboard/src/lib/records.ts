// 관리자 결정 기록 (누가·언제·무엇을 왜). 전날 준비·측정 대상 작업에서 쌓고 이력·보고에서 본다.
// 새로고침하면 처음 값으로 돌아간다 (서버 저장 없음, 시연용).
import { useSyncExternalStore } from "react"
import { SELECTIONS, SELECTION_CONFIRMED, SELECTION_RUN } from "@/data/permits"

export type RecordKind = "AI 체크" | "구역 매핑" | "선별" | "선별 확정" | "측정 입력" | "경보" | "기타"

export interface DecisionRecord {
  id: number
  /** "11/7" (전날) 또는 "11/9" (당일) */
  day: string
  time: string
  kind: RecordKind
  who: string
  /** 허가서 번호·구역 등 */
  target: string
  text: string
}

let nextId = 1
let records: DecisionRecord[] = [
  { day: "11/7", time: SELECTION_RUN.at, kind: "선별" as const, who: SELECTION_RUN.by, target: "측정 대상 선별", text: "선별 실행 (밀폐구역 출입 허가서 12건)" },
  ...SELECTIONS.filter((s) => s.decision).map((s) => ({
    day: "11/7", time: s.decision!.at, kind: "선별" as const, who: s.decision!.by, target: s.permit,
    text: `2중점검 제안 ${s.suggestion} → 최종 ${s.final ?? "보류"} · ${s.decision!.reason}`,
  })),
  { day: "11/7", time: SELECTION_CONFIRMED.at.slice(-5), kind: "선별 확정" as const, who: SELECTION_CONFIRMED.by, target: "측정 대상 선별", text: "확정 → 당일 관제 목록 생성 (보류 1건)" },
].map((r) => ({ ...r, id: nextId++ }))

const listeners = new Set<() => void>()

export function addRecord(r: Omit<DecisionRecord, "id">) {
  records = [...records, { ...r, id: nextId++ }]
  listeners.forEach((l) => l())
}

export function useRecords() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => records,
  )
}
