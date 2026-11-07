import { useEffect, useState } from "react"
import type { AgentId, Report, Trigger } from "@/lib/agentTeam"

// 에이전트 팀 분석 한 번의 진행 시간표와 표시 색 (AgentRun · AgentDock · 알람 배너 단추가 같이 쓴다)

export interface Run {
  key: string
  report: Report
  /** 화면에서 분석을 시작한 실제 시각 (ms) */
  startedAt: number
}

// 위험도·원인·현장 자원은 서로 필요 없어 같이 시작하고, 사례 검색은 위험도(가스)·원인(작업)이 나와야 찾는다.
// 총괄은 넷이 끝난 뒤 (ms)
export const SCHEDULE: Record<AgentId | "lead", [number, number]> = {
  risk: [0, 1000],
  crew: [0, 1300],
  cause: [0, 1700],
  cases: [1700, 2700],
  lead: [2700, 4000],
}
export const RUN_MS = SCHEDULE.lead[1]

/** 분석을 시작한 뒤 지난 시간(ms). 분석이 도는 동안만 시계를 돌린다 */
export function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(() => performance.now())
  const done = startedAt === null || now - startedAt >= RUN_MS
  useEffect(() => {
    if (done) return
    const id = setInterval(() => setNow(performance.now()), 120)
    return () => clearInterval(id)
  }, [done])
  return startedAt === null ? 0 : now - startedAt
}

export const TRIGGER_DOT: Record<Trigger, string> = { legal: "bg-legal", unauth: "bg-unauth", missing: "bg-missing", warn: "bg-warn", trend: "bg-warn", ask: "bg-idle" }
export const TRIGGER_TEXT: Record<Trigger, string> = { legal: "text-legal", unauth: "text-unauth", missing: "text-missing", warn: "text-warn-ink", trend: "text-warn-ink", ask: "text-muted-foreground" }

