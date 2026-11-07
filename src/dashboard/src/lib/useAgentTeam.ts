import { useEffect, useRef, useState } from "react"
import type { SimView } from "@/lib/sim"
import type { Prediction } from "@/lib/server"
import { TRIGGER_RANK, analyze, triggerOf, type Detail, type Trigger } from "@/lib/agentTeam"
import type { Run } from "@/lib/agentRun"

// 안전 에이전트 팀 분석 상태: 알람 배너 단추가 분석을 부르고, 오른쪽 아래 에이전트(AgentDock)가 결과를 보여 준다

export interface AgentCase {
  zoneId: string
  trigger: Trigger
  t: number
  run: Run
}

/** 구역마다 마지막 분석 한 건 · 지금 말풍선에 띄운 구역 */
export function useAgentTeam(view: SimView, predictions: Record<string, Prediction>, detailOf: (zoneId: string) => Detail | null) {
  const [cases, setCases] = useState<Record<string, AgentCase>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const lastT = useRef(view.t)
  // 시연을 처음부터 다시 돌리면 비운다
  useEffect(() => {
    if (view.t < lastT.current - 0.5) {
      setCases({})
      setOpenId(null)
    }
    lastT.current = view.t
  }, [view.t])

  const statusOf = (zoneId: string) => view.zoneStatus.find((z) => z.id === zoneId)?.status ?? "idle"
  /** 지금 이 구역을 분석하면 어떤 경보로 보는지 (상태가 더 나빠졌으면 다시 분석하라고 알리는 데 쓴다) */
  const triggerNow = (zoneId: string): Trigger => {
    const st = statusOf(zoneId)
    return triggerOf(st, st === "ok" ? detailOf(zoneId) : null, predictions[zoneId]) ?? "ask"
  }
  const stale = (zoneId: string) => {
    const c = cases[zoneId]
    return !!c && TRIGGER_RANK[triggerNow(zoneId)] > TRIGGER_RANK[c.run.report.trigger]
  }
  const start = (zoneId: string) => {
    const d = detailOf(zoneId)
    if (!d) return
    const trigger = triggerNow(zoneId)
    const report = analyze(trigger, d, view, predictions[zoneId])
    setCases((cs) => ({ ...cs, [zoneId]: { zoneId, trigger, t: view.t, run: { key: `run-${zoneId}-${performance.now()}`, report, startedAt: performance.now() } } }))
    setOpenId(zoneId)
  }
  /** 배너 단추: 분석한 적 없거나 상태가 바뀌었으면 새로 분석, 아니면 결과를 다시 띄운다 */
  const request = (zoneId: string) => (!cases[zoneId] || stale(zoneId) ? start(zoneId) : setOpenId(zoneId))

  return { cases, openId, setOpenId, request, start, stale, triggerNow }
}
export type AgentTeam = ReturnType<typeof useAgentTeam>

