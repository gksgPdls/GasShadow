// 전날 준비 화면의 상태 모양과 계산. 공용 데이터(data/permits.ts)는 그대로 두고,
// 관리자가 이 화면에서 한 일(AI 체크 처리 · 구역 매핑 · 최종 Y/N)을 겹쳐서 "지금 값"을 만든다.
import {
  AI_CHECKS,
  PERMITS,
  SELECTIONS,
  type Extra,
  type Permit,
  type PermitForm,
  type Selection,
  type Suggestion,
} from "@/data/permits"
import { ZONES } from "@/data/scenario"

export const ME = "홍OO" // 이 화면을 쓰는 안전관리자 (시연용)

// ---------- AI 체크 ----------
export type AiStatus = "미처리" | "보완 요청" | "반영" | "문제 없음"
export interface AiState {
  status: Exclude<AiStatus, "미처리">
  by: string
  at: string
  reason?: string
}
export type AiStates = Record<string, AiState>

/** '반영'을 누르면 허가서에 겹쳐 보일 보완 내용 */
export const AI_FIX: Record<string, { extra?: Extra; hazards?: string[]; form?: PermitForm }> = {
  "AC-01": { extra: "가스측정" },
  "AC-03": { extra: "가스측정" },
  "AC-08": { extra: "가스측정" },
  "AC-02": { hazards: ["일산화탄소", "용접 흄", "화재", "산소 결핍"] },
  "AC-04": { form: "도장/세척" },
}

export const aiStatusOf = (ai: AiStates, id: string): AiStatus => ai[id]?.status ?? "미처리"

/** 아직 처리 안 한 '확인 필요' */
export const unresolvedOf = (ai: AiStates, permit?: string) =>
  AI_CHECKS.filter((c) => c.level === "확인 필요" && !ai[c.id] && (!permit || c.permit === permit))

// ---------- 구역 매핑 ----------
export interface Mapping {
  block: string
  zoneId: string
  by: string
  at: string
}
export type Mappings = Record<string, Mapping>

// ---------- 허가서 지금 값 ----------
export interface EffectivePermit extends Permit {
  aiExtras: Extra[]
  aiHazards: string[]
  aiForm: boolean
  /** 관리자가 시스템 제안과 다르게 매핑했거나 미매핑을 매핑함 */
  mappedByAdmin: boolean
}

export function effective(p: Permit, ai: AiStates, maps: Mappings): EffectivePermit {
  const applied = AI_CHECKS.filter((c) => c.permit === p.no && ai[c.id]?.status === "반영").map((c) => AI_FIX[c.id] ?? {})
  const aiExtras = [...new Set(applied.flatMap((f) => (f.extra && !p.extras.includes(f.extra) ? [f.extra] : [])))]
  const aiHazards = [...new Set(applied.flatMap((f) => f.hazards ?? []))].filter((h) => !p.hazards.includes(h))
  const form = applied.find((f) => f.form)?.form
  const m = maps[p.no]
  return {
    ...p,
    form: form ?? p.form,
    extras: [...p.extras, ...aiExtras],
    hazards: [...p.hazards, ...aiHazards],
    block: m ? m.block : p.block,
    zoneId: m ? m.zoneId : p.zoneId,
    aiExtras,
    aiHazards,
    aiForm: !!form,
    mappedByAdmin: !!m,
  }
}

/** 화면에 보일 문장에서 개발용 메모를 뺀다 */
export const clean = (s: string) => s.replace(/\s*\(원문 확인 필요\)/g, "")

export const isConfined = (p: Permit) => p.extras.includes("밀폐구역출입")
export const zoneOf = (id: string | null) => ZONES.find((z) => z.id === id)

// ---------- 측정 대상 선별 ----------
export interface Decision {
  final: "Y" | "N"
  reason: string
  note?: string
  by: string
  at: string
}
export type Overrides = Record<string, "Y" | "N">
export type Decisions = Record<string, Decision>

export const REASONS = ["환기 양호 확인", "현장 사전 점검 완료", "과거 이력 반영", "작업 범위 축소", "기타"]

/** 데이터에 있던 결정 (전날 15:06~15:11 기록)을 처음 값으로 */
export const initialDecisions = (): Decisions =>
  Object.fromEntries(
    SELECTIONS.filter((s) => s.decision && s.final).map((s) => [
      s.permit,
      { final: s.final!, reason: s.decision!.reason, by: s.decision!.by, at: s.decision!.at },
    ]),
  )

export interface SelRow {
  sel: Selection
  p: EffectivePermit
  suggestion: Suggestion
  chips: Selection["chips"]
  final: "Y" | "N" | null
  /** 제안과 다르거나 검토를 정한 행 — 사유가 있어야 함 */
  needsReason: boolean
  decision?: Decision
  /** 확정을 막는 행 (사유 없음 · 검토 미결정) */
  blocking: boolean
  inspector?: string
}

const yn = (s: Suggestion) => (s === "Y" || s === "N" ? s : null)

export function selectionRows(ai: AiStates, maps: Mappings, overrides: Overrides, decisions: Decisions): SelRow[] {
  const order: Record<Suggestion, number> = { Y: 0, 검토: 1, N: 2, 보류: 3 }
  return SELECTIONS.map((sel) => {
    const p = effective(PERMITS.find((x) => x.no === sel.permit)!, ai, maps)
    let suggestion = sel.suggestion
    const chips = [...sel.chips]
    // 0452: 구역을 매핑하면 보류가 풀리고 사람이 정할 '검토'가 된다
    if (sel.suggestion === "보류" && p.zoneId) {
      suggestion = "검토"
      chips.splice(0, chips.length, { kind: "rule", text: "구역 매핑됨 · 과거 이력 없음" })
    }
    // AI 체크로 양식이 도장/세척으로 정정되면 S-2가 걸린다
    if (p.aiForm && p.form === "도장/세척") {
      suggestion = "Y"
      chips.unshift({ kind: "rule", text: "S-2 세척 (양식 정정 · AI 체크)" })
    }
    if (p.aiExtras.length) chips.push({ kind: "rule", text: `${p.aiExtras.join("·")} ☑ (AI 제안 반영)` })

    const decided = decisions[sel.permit]
    const final = overrides[sel.permit] ?? decided?.final ?? yn(suggestion)
    const needsReason = final !== null && (suggestion === "검토" || final !== yn(suggestion))
    const decision = decided && decided.final === final ? decided : undefined
    const blocking = (suggestion === "검토" && final === null) || (needsReason && !decision)
    const inspector =
      final === "Y" ? (sel.inspector ?? (["B-D21", "B-D23", "B-C41", "B-E11"].includes(p.block ?? "") ? "A동 김OO" : "B동 박OO")) : undefined
    return { sel, p, suggestion, chips, final, needsReason, decision, blocking, inspector }
  }).sort((a, b) => order[a.suggestion] - order[b.suggestion])
}
