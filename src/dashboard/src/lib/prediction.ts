import { gasLabel } from "@/lib/sim"
import type { Prediction } from "@/lib/server"

/** 【AI ①】 5가스 위험예측 한 줄. hot = 60분 안 초과 예측 (주황으로 표시) */
export function predictionText(p: Prediction | undefined): { text: string; hot: boolean } | null {
  if (!p) return null
  if (p.prediction_status !== "PREDICTED") return { text: "예측 불가 (법정 초과 중이거나 최근 10분 데이터 부족)", hot: false }
  const gas = p.predicted_threshold_gas && p.predicted_threshold_gas !== "NONE" ? gasLabel(p.predicted_threshold_gas) : ""
  const min = p.predicted_minutes_to_threshold !== null ? Math.round(p.predicted_minutes_to_threshold) : null
  const prob = p.risk_probability_30m !== null ? ` · 30분 내 위험 ${Math.round(p.risk_probability_30m * 100)}%` : ""
  if (p.forecast_state === "IMMINENT") return { text: `약 ${min}분 뒤 ${gas} 기준 초과 가능${prob}`, hot: true }
  if (p.forecast_state === "WATCH") return { text: `30~60분 안 ${gas} 기준 초과 가능 (약 ${min}분)${prob}`, hot: true }
  return { text: `60분 안 기준 초과 예상 없음${prob}`, hot: false }
}
