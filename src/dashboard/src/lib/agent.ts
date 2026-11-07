// 안전 에이전트: 화면에 있는 값으로 바로 답할 수 있는 질문
import { LIMITS } from "@/data/scenario"
import { STATUS, fmtTime, fmtVal, gasLabel, type SimView } from "@/lib/sim"
import { predictionText } from "@/lib/prediction"
import type { Prediction } from "@/lib/server"

export type SuggestionKind = "summary" | "zone" | "crew" | "forecast" | "missing" | "permit"
export interface Suggestion {
  kind: SuggestionKind
  /** 보내는 질문 */
  text: string
  /** 알약에 쓰는 글 (두 개가 한 줄에 들어가게 짧게) */
  label: string
}

/** 대화창 추천 질문: 종류가 다른 4개 (요약 · 허가 대조 · 구역 분석 · 인력). 구역 분석은 맨 위 주의 구역, 없으면 예측 */
export function suggestions(view: SimView): Suggestion[] {
  const top = view.focus[0]
  // 알약은 두 칸씩 한 줄 (AgentDock Suggest)
  return [
    { kind: "summary", text: "지금 위험한 순서 요약해줘", label: "지금 위험한 순서 요약해줘" },
    { kind: "crew", text: "측정요원 지금 어디 있어?", label: "측정요원 어디 있어?" },
    { kind: "permit", text: "0491 허가서랑 들어간 사람 맞아?", label: "0491 허가서랑 출입자 맞아?" },
    top ? { kind: "zone", text: `${top.zone.name} 분석해줘`, label: "위험 구역 분석해줘" } : { kind: "forecast", text: "곧 기준 넘을 것 같은 구역은?", label: "곧 넘을 구역은?" },
  ]
}

function zoneLine(f: SimView["focus"][number]) {
  const a = f.a
  if (a.status === "missing") return `${f.zone.name}: 센서 결측 ${a.lostMin}분째 (${f.detail})`
  const v = `${gasLabel(a.gas)} ${fmtVal(a.gas, a.value)} ${LIMITS[a.gas].unit}`
  const eta = a.status !== "legal" && a.eta ? `, 지금 추세면 약 ${Math.round(a.eta)}분 뒤 법정 기준` : ""
  return `${f.zone.name}: ${STATUS[f.status].label} · ${v}${eta}`
}

export function summary(view: SimView) {
  if (!view.focus.length) return "지금은 주의 구역이 없어요. 모든 구역이 기준 이내예요."
  return `주의 구역 ${view.focus.length}곳, 위험한 순서예요.\n` + view.focus.map((f, i) => `${i + 1}. ${zoneLine(f)}`).join("\n")
}

export function crew(view: SimView) {
  const rows = view.people.map((p) => {
    const who = p.role === "측정요원" ? `측정요원 ${p.name}` : p.name
    if (p.status === "대기") return `${who}: 대기`
    if (p.status === "출동 중") return `${who}: ${p.zoneName}로 이동 중, ${fmtTime(p.arriveAt ?? view.t)} 도착 예정`
    return `${who}: ${p.zoneName} 현장에 있음`
  })
  return rows.length ? [`현장 인력 ${rows.length}명이에요.`, ...rows].join("\n") : "등록된 현장 인력이 없어요."
}

export function forecasts(view: SimView, predictions: Record<string, Prediction>) {
  const names = new Map(view.blocks.flatMap((b) => b.zones.map((z) => [z.id, z.name] as const)))
  const hot = Object.entries(predictions)
    .map(([id, p]) => ({ id, t: predictionText(p) }))
    .filter((x) => x.t?.hot)
  if (!Object.keys(predictions).length) return "예측 모델 결과가 아직 없어요."
  if (!hot.length) return "예측 모델 기준으로 60분 안에 기준을 넘을 것으로 보이는 구역은 없어요."
  return hot.map((x) => `${names.get(x.id) ?? x.id}: ${x.t!.text}`).join("\n")
}

/** 화면 값만으로 답할 수 있으면 답을, 아니면 null */
export function localAnswer(q: string, view: SimView, predictions: Record<string, Prediction>): string | null {
  if (/요약|위험한 순|주의 구역|확인할 곳|지금 상황/.test(q)) return summary(view)
  if (/측정요원|인력|누가|관리감독자/.test(q)) return crew(view)
  if (/센서|끊|결측|신호/.test(q)) {
    const m = view.focus.filter((f) => f.a.status === "missing")
    return m.length ? m.map(zoneLine).join("\n") : "지금 센서가 끊긴 구역은 없어요."
  }
  if (/예측|사전|곧 .*넘/.test(q)) return forecasts(view, predictions)
  // 구역 이름 전체, 또는 'PD-4'처럼 숫자가 든 짧은 이름으로 찾는다
  const key = (name: string) => name.split(" ").filter((w) => /\d/.test(w) && !w.startsWith("("))
  const f = view.focus.find((x) => q.includes(x.zone.name) || key(x.zone.name).some((w) => q.includes(w)))
  if (f) return zoneLine(f)
  return null
}
