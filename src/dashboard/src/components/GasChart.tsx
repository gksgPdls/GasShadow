import type { Gas, GasValues, Limit } from "@/data/scenario"
import { fmtTime, type Status } from "@/lib/sim"

const W = 420
const H = 190
const PAD = { l: 40, r: 14, t: 14, b: 26 }
const PAST = 40 // 분
const AHEAD = 15 // 예측선 최대 길이 (분)

const LINE: Record<Status, string> = {
  legal: "var(--legal)",
  unauth: "var(--unauth)",
  missing: "var(--missing)",
  warn: "var(--warn)",
  ok: "var(--ok)",
  idle: "var(--muted-foreground)",
}

interface Props {
  gas: Gas
  limit: Limit
  history: { t: number; vals: GasValues }[]
  now: number
  status: Status
  slope: number
  /** 법정 기준까지 남은 분 (없으면 예측선 없음) */
  eta: number | null
}

// 최근 40분 가스 농도 + 경계·법정 기준선 + 지금 추세가 이어질 때의 예측선
export function GasChart({ gas, limit, history, now, status, slope, eta }: Props) {
  const t0 = now - PAST
  const t1 = now + AHEAD
  const vals = history.map((h) => h.vals[gas])
  const last = history.length ? history[history.length - 1] : null

  // 세로 범위: 기준선이 늘 보이게
  const lines =
    gas === "O2"
      ? [
          { v: limit.warnLow!, label: `경계 ${limit.warnLow}`, color: "var(--warn)" },
          { v: limit.legalLow!, label: `법정 ${limit.legalLow}`, color: "var(--legal)" },
        ]
      : [
          { v: limit.warn!, label: `경계 ${limit.warn}`, color: "var(--warn)" },
          { v: limit.legal!, label: `법정 ${limit.legal}`, color: "var(--legal)" },
        ]
  let lo: number
  let hi: number
  if (gas === "O2") {
    lo = Math.min(limit.legalLow! - 0.6, ...vals)
    hi = Math.max(21.5, ...vals)
  } else {
    lo = 0
    hi = Math.max(limit.legal! * 1.35, ...vals.map((v) => v * 1.1))
  }
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)

  const pts = history.filter((h) => h.t >= t0).map((h) => `${x(h.t).toFixed(1)},${y(h.vals[gas]).toFixed(1)}`)
  const path = pts.length ? `M${pts.join("L")}` : ""
  const area = pts.length ? `${path}L${x(history[history.length - 1].t)},${y(lo)}L${x(Math.max(t0, history[0].t))},${y(lo)}Z` : ""

  // 예측선: 지금 기울기로 법정 기준까지 (최대 15분)
  const ahead = eta !== null ? Math.min(eta, AHEAD) : null
  const fx = last && ahead !== null ? last.t + ahead : null
  const fy = last && ahead !== null ? last.vals[gas] + slope * ahead : null

  const ticks = [t0, t0 + 10, t0 + 20, t0 + 30, now]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${gas} 최근 40분`}>
      {/* 기준선 */}
      {lines.map((l) => (
        <g key={l.label}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(l.v)} y2={y(l.v)} stroke={l.color} strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={W - PAD.r} y={y(l.v) - 4} textAnchor="end" fontSize={12} fill={l.color} fontWeight={600}>
            {l.label}
          </text>
        </g>
      ))}
      {/* 지금 */}
      <line x1={x(now)} x2={x(now)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeWidth={1.5} />
      <path d={area} fill={LINE[status]} opacity={0.08} />
      <path d={path} fill="none" stroke={LINE[status]} strokeWidth={2.5} strokeLinejoin="round" />
      {fx !== null && fy !== null && last && (
        <>
          <line x1={x(last.t)} y1={y(last.vals[gas])} x2={x(fx)} y2={y(fy)} stroke={LINE[status]} strokeWidth={2} strokeDasharray="3 4" />
          <circle cx={x(fx)} cy={y(fy)} r={4} fill="#fff" stroke="var(--legal)" strokeWidth={2} />
        </>
      )}
      {last && <circle cx={x(last.t)} cy={y(last.vals[gas])} r={5} fill={LINE[status]} stroke="#fff" strokeWidth={2} />}
      {/* 시각 눈금 */}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)" fontFamily="var(--font-mono)">
          {t === now ? "지금" : fmtTime(t)}
        </text>
      ))}
      <text x={PAD.l - 6} y={y(hi) + 10} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
        {gas === "O2" ? hi.toFixed(1) : Math.round(hi)}
      </text>
      <text x={PAD.l - 6} y={y(lo)} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
        {gas === "O2" ? lo.toFixed(1) : 0}
      </text>
    </svg>
  )
}
