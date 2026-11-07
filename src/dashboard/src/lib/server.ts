// 메인 서버(FastAPI :8000)와 주고받는 값. Vite 개발 서버가 /api, /ws 를 메인 서버로 넘겨준다 (vite.config.ts)
import type { Gas } from "@/data/scenario"
import type { Assessment } from "@/lib/sim"

export interface ServerReading {
  zone_id: string
  t: number
  O2: number
  LEL: number
  CO: number
  H2S: number
  CO2: number
}

/** 【AI ①】 5가스 위험예측 모델 출력 (가스예측모델/README.md 7절과 같은 모양) */
export interface Prediction {
  prediction_status: "PREDICTED" | "UNAVAILABLE"
  forecast_state: "STABLE" | "WATCH" | "IMMINENT" | null
  predicted_threshold_gas: Gas | "NONE" | null
  predicted_minutes_to_threshold: number | null
  risk_probability_30m: number | null
}

export interface RecStep {
  action: string
  reason: string
  case_ids: number[]
}

/** 【AI ②】 조치 추천 (LangGraph: 상황 → RAG → LLM → 관리자 승인 → 기록) */
export interface Recommendation {
  alarm_id: number
  zone_id: string
  status: "running" | "awaiting_approval" | "approved" | "edited" | "unavailable" | "done"
  summary?: string
  steps?: RecStep[]
  cautions?: string[]
  cases?: { id: number; source: string; title: string; actions: string; similarity: number }[]
  llm?: { used: boolean; model: string | null; provider?: "openai" | "openrouter" | null; configured: boolean; prompt?: string | null }
  writes?: number
  final_steps?: string[] | null
  approver?: string | null
  saved_case_id?: number | null
  error?: string
}

export interface Control {
  playing: boolean
  speed: number
  outage: boolean
  reset: number
}

export interface ServerState {
  run_id: string
  t: number
  control: Control
  ai_ok: boolean | null
  zones: Record<string, { history: ({ t: number } & Record<Gas, number>)[]; lastRecv: number | null; assess: Assessment; alarm_id: number | null; acked: boolean }>
  predictions: Record<string, Prediction>
  recommendations: Recommendation[]
}

export type ServerMsg =
  | { type: "reset"; run_id: string }
  | { type: "tick"; run_id: string; t: number; readings: ServerReading[]; assess: Record<string, Assessment> }
  | { type: "predictions"; t: number; predictions: Record<string, Prediction> }
  | { type: "recommendation"; rec: Recommendation }
  | { type: "control"; control: Control }
  | { type: "ai_status"; ok: boolean }

export async function fetchState(): Promise<ServerState | null> {
  try {
    const r = await fetch("/api/state", { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return null
    const s = (await r.json()) as ServerState
    return s.run_id ? s : null // 재생기가 아직 시작 안 했으면 서버 모드로 가지 않는다
  } catch {
    return null
  }
}

export function connect(onMsg: (m: ServerMsg) => void, onOpen: (open: boolean) => void) {
  let ws: WebSocket | null = null
  let stop = false
  const open = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)
    ws.onopen = () => onOpen(true)
    ws.onmessage = (e) => onMsg(JSON.parse(e.data))
    ws.onclose = () => {
      onOpen(false)
      if (!stop) setTimeout(open, 1500)
    }
  }
  open()
  return () => {
    stop = true
    ws?.close()
  }
}

export const postControl = (body: Partial<Omit<Control, "reset">> & { reset?: boolean }) =>
  fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

export const postAck = (zoneId: string) => fetch(`/api/ack/${zoneId}`, { method: "POST" })
/** 환기 강화(꺼져 있던 송풍기를 켬): 메인 서버가 그 구역 측정값에 환기 효과를 적용한다 */
export const postVent = (zoneId: string) => fetch(`/api/vent/${zoneId}`, { method: "POST" })
