// 합성 데이터로 실시간 수신을 흉내 낸다. src/prototype/mn-01/app.js의 판정 로직을 그대로 옮겼다.
// 서버 모드(serverMode)에서는 값을 만들지 않고 메인 서버가 보낸 센서 값·규칙 판정을 받아서 쓴다 (useSimulation.ts)
import {
  BLOCKS,
  INITIAL_DISPATCH,
  INITIAL_LOG,
  LIMITS,
  MEASURERS,
  TIMELINE,
  ZONES,
  type BlockDef,
  type Gas,
  type GasValues,
  type LogEntry,
  type Tone,
  type ZoneDef,
} from "@/data/scenario"
import { PERMITS } from "@/data/permits"

export type Status = "legal" | "unauth" | "missing" | "warn" | "ok" | "idle"

export const STATUS: Record<Status, { rank: number; label: string }> = {
  legal: { rank: 0, label: "법정 초과" },
  unauth: { rank: 1, label: "무허가 의심" },
  missing: { rank: 2, label: "센서 결측" },
  warn: { rank: 3, label: "경계" },
  ok: { rank: 4, label: "정상" },
  idle: { rank: 5, label: "작업 없음" },
}
export const STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v.label]),
) as Record<Status, string>

const SAMPLE_SEC = 10 // 센서 수신 주기(가정)
const MISSING_AFTER_MIN = 2 // 이 시간 동안 수신이 없으면 결측
const HISTORY_MIN = 60
export const GASES: Gas[] = ["O2", "LEL", "CO", "H2S", "CO2"]
const NOISE: GasValues = { O2: 0.05, LEL: 0.15, CO: 0.5, H2S: 0.05, CO2: 0.01 }
// 무허가 작업 의심 (도둑작업): 오늘 허가가 없는 구역에서 아래 값을 넘으면 "누가 안에서 작업 중"으로 본다.
// 평상시 값과 센서 흔들림보다 확실히 큰 값으로 잡은 팀 가정 (근거 없음). 서버 rules.py UNAUTH와 같다
const UNAUTH: Partial<Record<Gas, number>> = { LEL: 3, CO: 8, H2S: 2, CO2: 0.3 }
const UNAUTH_O2_LOW = 20.0

function unauthGas(cur: GasValues): Gas | null {
  let best: { gas: Gas; r: number } | null = null
  ;(Object.keys(UNAUTH) as Gas[]).forEach((g) => {
    const lim = UNAUTH[g]!
    if (cur[g] >= lim && (!best || cur[g] / lim > best.r)) best = { gas: g, r: cur[g] / lim }
  })
  if (best) return (best as { gas: Gas }).gas
  return cur.O2 <= UNAUTH_O2_LOW ? "O2" : null
}

export const fmtTime = (m: number) => {
  const h = Math.floor(m / 60) % 24
  const mm = Math.floor(m % 60)
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}
/** 시연 시각(분) → HH:MM:SS */
export const fmtClock = (m: number) => {
  const s = Math.floor(m * 60) % 86400
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":")
}
export const fmtVal = (gas: Gas, v: number) => (gas === "CO" ? v.toFixed(0) : gas === "CO2" ? v.toFixed(2) : v.toFixed(1))
export const gasLabel = (g: Gas) => ({ O2: "O₂", LEL: "LEL", CO: "CO", H2S: "H₂S", CO2: "CO₂" })[g]

// (구역, 시각, 가스)마다 같은 노이즈가 나오도록 해시 기반 의사난수를 쓴다.
function noise(zoneIdx: number, sampleIdx: number, gasIdx: number) {
  let x = (zoneIdx * 73856093) ^ (sampleIdx * 19349663) ^ (gasIdx * 83492791)
  x = (x ^ (x >>> 13)) * 1274126177
  x = x ^ (x >>> 16)
  return ((x >>> 0) / 4294967295) * 2 - 1
}

// 가스별 위험도: 0 미만 = 정상, 0~1 = 경계 구간, 1 이상 = 법정 초과
function severity(g: Gas, v: number) {
  const L = LIMITS[g]
  if (g === "O2") {
    if (v >= L.legalHigh!) return 1
    return (L.warnLow! - v) / (L.warnLow! - L.legalLow!)
  }
  return (v - L.warn!) / (L.legal! - L.warn!)
}

// 현재 기울기가 유지되면 법정 기준까지 몇 분 남았는지
function etaToLegal(g: Gas, v: number, s: number) {
  const L = LIMITS[g]
  let eta: number | null = null
  if (g === "O2" && s < -0.005) eta = (v - L.legalLow!) / -s
  else if (g !== "O2" && s > 0.005) eta = (L.legal! - v) / s
  return eta !== null && eta > 0 && eta < 180 ? eta : null
}

interface ZoneState extends ZoneDef {
  history: { t: number; vals: GasValues }[]
  lastRecv: number | null
  alarmed: boolean
  acked: boolean
  /** 무허가 작업 의심 알림을 이미 띄웠는지 */
  unauthNotified: boolean
}

export type Assessment =
  | { status: "missing"; score: 0; lostMin: number }
  | {
      status: Exclude<Status, "missing">
      gas: Gas
      score: number
      value: number
      slope: number
      eta: number | null
      /** 오늘 허가 없는 구역인데 작업 흔적 가스가 잡힘 (법정 초과일 때도 true일 수 있다) */
      unauth?: boolean
      /** 측정기를 붙이기 전 (작업 전) */
      pending?: boolean
    }

export interface FocusItem {
  zone: ZoneState
  status: Status
  /** 판정 (가스·값·기울기·법정 기준까지 남은 분) */
  a: Assessment
  /** 원인 한 문장의 앞부분 (수치 또는 센서 상태) */
  head: string
  /** 나머지 (기준·작업·허가 번호) */
  detail: string
}

export interface BlockView {
  def: BlockDef
  status: Status
  zones: { id: string; name: string; status: Status }[]
}

export interface Notice {
  text: string
  danger?: boolean
}

/** 관제 화면 말풍선·이벤트 카드에 띄우는 문장 */
export interface FeedEvent {
  id: number
  t: number
  tone: Tone
  zoneId?: string
  zoneName?: string
  block?: string
  text: string
}

export type PersonRole = "측정요원" | "관리감독자"
export interface Person {
  id: string
  name: string
  role: PersonRole
  /** 측정요원 담당 동 · 관리감독자 작업부서 */
  area: string
  status: "대기" | "출동 중" | "현장 도착"
  zoneId: string | null
  arriveAt: number | null
}

const ARRIVE_MIN: Record<PersonRole, number> = { 측정요원: 5, 관리감독자: 3 }
// 경계선 근처에서 상태가 깜박일 때 알림이 반복되지 않게: 새 상태가 이 시간(분) 이어져야 알리고,
// 같은 구역·같은 상태 알림은 STATUS_EVENT_GAP 안에 다시 띄우지 않는다. 법정 초과는 바로 알린다
const STATUS_CONFIRM = 1
const STATUS_EVENT_GAP = 10

// 송풍기: 구역마다 최대 2대, 하나씩 켜고 끄기(ON/OFF)만 한다. 평소엔 1번만 돌고 2번은 대기(OFF).
// 관리자가 꺼져 있던 송풍기를 켜면(환기 강화) 그때부터 VENT_MIN분에 걸쳐 평상시 값보다 높던(산소는 낮던) 부분이 VENT_KEEP 비율까지 줄어든다.
// 시연용 가정값 (실측 근거 없음). 메인 서버(main_server/app.py vent_adjust)도 같은 식을 쓴다
const VENT_MIN = 12
const VENT_KEEP = 0.25
const VENT_BASE: GasValues = { O2: 20.9, LEL: 0.3, CO: 2, H2S: 0.1, CO2: 0.06 }
/** 구역 송풍기 대수 (최대 2). 작업 칸만. 투입 3명 이상이거나 가스가 나오는 작업(도장·세척·용접·그라인딩·절단)이면 2대 */
export function blowerCount(z: ZoneDef): number {
  if (z.vent) return Math.min(2, Math.max(1, z.vent.blowers))
  if (!z.permit) return 0
  return z.permit.workers >= 3 || /도장|세척|용접|그라인딩|절단/.test(z.permit.task) ? 2 : 1
}

export function ventAdjust(vals: GasValues, dtMin: number): GasValues {
  if (dtMin < 0) return vals
  const f = 1 - (1 - VENT_KEEP) * Math.min(1, dtMin / VENT_MIN)
  const out = { ...vals }
  GASES.forEach((g) => {
    out[g] = VENT_BASE[g] + (vals[g] - VENT_BASE[g]) * f
  })
  return out
}

export class Simulation {
  t = 0
  outage = false
  zones: ZoneState[] = []
  log: LogEntry[] = []
  feed: FeedEvent[] = []
  people: Person[] = []
  private nextSample = 0
  private firedEvents = new Set<string>()
  private firedTimeline = new Set<number>()
  private notices: Notice[] = []
  private prevStatus = new Map<string, Status>()
  private candidate = new Map<string, { status: Status; since: number }>()
  private lastStatusEvent = new Map<string, number>()
  private feedId = 1
  private readonly start: number
  /** 메인 서버에서 값을 받는 중인지. 이때 assess()는 서버 규칙 판정을 그대로 쓴다 */
  serverMode = false
  private serverAssess = new Map<string, Assessment>()
  /** 환기 강화(꺼져 있던 송풍기를 켬)가 시작된 시각 (구역별). 다시 끄면 지운다 */
  ventAt = new Map<string, number>()
  /** 관리자가 바꾼 송풍기 ON/OFF (구역별, 번호 순서. 안 건드린 칸은 undefined) */
  private blowerSet = new Map<string, (boolean | undefined)[]>()

  constructor(start: number) {
    this.start = start
    this.reset(false)
  }

  reset(outage: boolean) {
    this.t = this.start
    this.outage = outage
    this.nextSample = 0
    this.zones = ZONES.map((z) => ({ ...z, history: [], lastRecv: null, alarmed: false, acked: false, unauthNotified: false }))
    this.log = INITIAL_LOG.map((e) => ({ ...e }))
    this.firedEvents = new Set()
    this.firedTimeline = new Set()
    this.notices = []
    this.feed = []
    this.prevStatus = new Map()
    this.candidate = new Map()
    this.lastStatusEvent = new Map()
    this.ventAt = new Map()
    this.blowerSet = new Map()
    this.people = MEASURERS.map((m) => ({
      id: m.id, name: m.name, role: "측정요원" as const, area: m.area, status: "대기" as const, zoneId: null, arriveAt: null,
    }))
    const dispatch = INITIAL_DISPATCH
    const d = dispatch && this.people.find((p) => p.id === dispatch.person)
    if (d && dispatch) Object.assign(d, { status: "출동 중", zoneId: dispatch.zone, arriveAt: dispatch.arriveAt })
    // 시작 시점 이전 40분 이력을 채워 추세 계산이 바로 되게 한다.
    this.sampleUntil(this.start, this.start - 40)
    // 시작 시각 전에 지나간 현장 이벤트는 로그에만 남기고, 지금 상태는 알림 없이 기억해 둔다
    TIMELINE.forEach((e, i) => {
      if (e.t > this.start) return
      this.firedTimeline.add(i)
      if (e.log !== false) this.log.push({ t: e.t, zone: this.zoneName(e.zone), text: e.text })
    })
    this.zones.forEach((z) => this.prevStatus.set(z.id, this.assess(z).status))
    // 시작 시각 이전에 이미 넘은 경보는 로그에 남긴다
    this.checkEvents()
  }

  advance(minutes: number) {
    this.t += minutes
    this.sampleUntil(this.t)
    this.checkEvents()
  }

  setOutage(on: boolean) {
    this.outage = on
    this.addLog("시스템", on ? "통신 장애 감지 → 기본 순회 모드 전환" : "통신 복구 → 자동 복귀 (공백 구간 기록)")
    this.emit(on ? "warn" : "ok", undefined, on ? "서버·통신 장애가 감지됐습니다. 현장 측정요원 순회로 전환합니다." : "통신이 복구됐습니다. 센서 수신을 다시 시작합니다.")
    this.checkEvents()
  }

  ack(zoneId: string) {
    const z = this.zones.find((x) => x.id === zoneId)
    if (!z || z.acked) return
    z.acked = true
    this.addLog(z.name, "책임자 확인 · 작업 중단 지시 (경보는 해제 조건 충족 전까지 유지)")
    this.emit("info", z.id, `${z.name} — 책임자가 작업 중지를 지시했습니다. 기준 아래로 내려갈 때까지 경보를 유지합니다.`)
  }

  /** 측정요원·관리감독자 호출. 결과 문장을 돌려준다 */
  call(role: PersonRole, zoneId: string): string {
    const z = this.zones.find((x) => x.id === zoneId)
    if (!z) return ""
    if (role === "측정요원") {
      const here = this.people.find((p) => p.role === "측정요원" && p.zoneId === zoneId)
      if (here) return `측정요원 ${here.name} — 이미 ${here.status === "출동 중" ? "가는 중입니다" : "현장에 있습니다"}`
      const p =
        this.people.find((x) => x.role === "측정요원" && x.status === "대기") ??
        this.people.find((x) => x.role === "측정요원" && x.status === "현장 도착")
      if (!p) {
        const text = "출동할 수 있는 측정요원이 없습니다 (모두 이동 중)"
        this.emit("warn", zoneId, text)
        return text
      }
      Object.assign(p, { status: "출동 중", zoneId, arriveAt: this.t + ARRIVE_MIN.측정요원 })
      const text = `측정요원 ${p.name}에게 ${z.name} 출동을 요청했습니다. 약 ${ARRIVE_MIN.측정요원}분 뒤 도착합니다.`
      this.addLog(z.name, `측정요원 ${p.name} 출동 요청`)
      this.emit("info", zoneId, text)
      return text
    }
    const id = `S-${zoneId}`
    let p = this.people.find((x) => x.id === id)
    if (p && p.status !== "대기") return `${p.name} — 이미 ${p.status === "출동 중" ? "이동 중입니다" : "현장에 있습니다"}`
    if (!p) {
      p = { id, name: `${this.dept(z)} 관리감독자`, role: "관리감독자", area: this.dept(z), status: "대기", zoneId, arriveAt: null }
      this.people.push(p)
    }
    Object.assign(p, { status: "출동 중", zoneId, arriveAt: this.t + ARRIVE_MIN.관리감독자 })
    const text = `${p.name}를 호출했습니다. ${z.name} 현장으로 이동합니다.`
    this.addLog(z.name, `${p.name} 호출`)
    this.emit("info", zoneId, text)
    return text
  }

  /** 관리자가 손대지 않았을 때의 송풍기 상태: 1번 가동 · 2번 대기. 1번 정지 의심 시각이 지나면 1번도 OFF */
  private blowerDefault(z: ZoneDef): boolean[] {
    const n = blowerCount(z)
    const stopped = !!z.vent && this.t >= z.vent.stopAt
    return Array.from({ length: n }, (_, i) => i === 0 && !stopped)
  }

  /** 구역 송풍기 ON/OFF (번호 순서) */
  blowers(zoneId: string): boolean[] {
    const z = this.zones.find((x) => x.id === zoneId)
    if (!z) return []
    const set = this.blowerSet.get(zoneId) ?? []
    return this.blowerDefault(z).map((b, i) => set[i] ?? b)
  }

  /** 송풍기 하나 켜기/끄기. 꺼져 있던 걸 켜서 평소보다 많이 돌면 환기 강화로 본다. 결과 문장을 돌려준다 */
  setBlower(zoneId: string, i: number, on: boolean): string {
    const z = this.zones.find((x) => x.id === zoneId)
    if (!z || i >= blowerCount(z)) return ""
    if (this.blowers(zoneId)[i] === on) return `${z.name} 송풍기 ${i + 1} — 이미 ${on ? "가동 중" : "정지"}입니다`
    const set = [...(this.blowerSet.get(zoneId) ?? [])]
    set[i] = on
    this.blowerSet.set(zoneId, set)
    const now = this.blowers(zoneId)
    const base = this.blowerDefault(z)
    const boost = now.some((b, k) => b && !base[k])
    const started = boost && !this.ventAt.has(zoneId)
    if (started) this.ventAt.set(zoneId, this.t)
    if (!boost) this.ventAt.delete(zoneId)
    const text = `${z.name} 송풍기 ${i + 1} ${on ? "가동" : "정지"}${started ? ` · 약 ${VENT_MIN}분에 걸쳐 농도가 내려갈 것으로 예상합니다` : ""}`
    this.addLog(z.name, `송풍기 ${i + 1} ${on ? "ON" : "OFF"} (안전관리자)`)
    this.emit("info", zoneId, text)
    return text
  }

  /** 사건·조치 로그와 현장 이벤트에 한 줄 남긴다 (AI 추천 승인 등) */
  logAction(zoneId: string, text: string) {
    const z = this.zones.find((x) => x.id === zoneId)
    if (!z) return
    this.addLog(z.name, text)
    this.emit("info", zoneId, `${z.name} — ${text}`)
  }

  /** 현장 이벤트에만 한 줄 남긴다 (예측 모델 사전 경고 등. 사건·조치 로그에는 남기지 않음) */
  note(zoneId: string, text: string, tone: Tone = "warn") {
    this.emit(tone, zoneId, text)
  }

  /** 현장 인력을 대기로 돌린다 */
  release(personId: string) {
    const p = this.people.find((x) => x.id === personId)
    if (p) Object.assign(p, { status: "대기", zoneId: p.role === "관리감독자" ? p.zoneId : null, arriveAt: null })
  }

  /** 마지막으로 꺼낸 뒤 새로 생긴 알림 (토스트용) */
  drainNotices() {
    const n = this.notices
    this.notices = []
    return n
  }

  /** 서버 모드: 서버가 새 시연을 시작함 → 처음 상태로 돌리고 서버 이력을 채운다 */
  serverReset(t: number, zones: Record<string, { history: ({ t: number } & GasValues)[]; lastRecv: number | null; assess: Assessment; acked: boolean }>) {
    this.serverMode = true
    this.serverAssess = new Map()
    this.reset(false)
    this.t = t
    this.zones.forEach((z) => {
      const s = zones[z.id]
      if (!s) return
      z.history = s.history.map(({ t, ...vals }) => ({ t, vals: vals as GasValues }))
      z.lastRecv = s.lastRecv
      z.acked = s.acked
      this.serverAssess.set(z.id, s.assess)
    })
    this.zones.forEach((z) => this.prevStatus.set(z.id, this.assess(z).status))
    this.checkEvents()
  }

  /** 서버 모드: 10초마다 오는 센서 값과 서버 규칙 판정 */
  serverTick(t: number, readings: ({ zone_id: string; t: number } & GasValues)[], assess: Record<string, Assessment>) {
    this.t = t
    readings.forEach(({ zone_id, t: ts, ...vals }) => {
      const z = this.zones.find((x) => x.id === zone_id)
      if (!z) return
      z.history.push({ t: ts, vals: { O2: vals.O2, LEL: vals.LEL, CO: vals.CO, H2S: vals.H2S, CO2: vals.CO2 } })
      z.lastRecv = ts
      while (z.history.length && z.history[0].t < ts - HISTORY_MIN) z.history.shift()
    })
    Object.entries(assess).forEach(([id, a]) => this.serverAssess.set(id, a))
    this.checkEvents()
  }

  private sampleUntil(tMin: number, fromMin?: number) {
    if (this.serverMode) return
    if (fromMin !== undefined) this.nextSample = Math.ceil((fromMin * 60) / SAMPLE_SEC)
    while (this.nextSample * SAMPLE_SEC <= tMin * 60) {
      const ts = (this.nextSample * SAMPLE_SEC) / 60
      if (!this.outage) {
        this.zones.forEach((z, zi) => {
          if (z.sensorLostAt !== undefined && ts >= z.sensorLostAt) return
          if (z.measureFrom !== undefined && ts < z.measureFrom) return // 측정기를 아직 붙이지 않았다
          const v0 = this.ventAt.get(z.id)
          const truth = v0 !== undefined && ts >= v0 ? ventAdjust(z.gas(ts), ts - v0) : z.gas(ts)
          const vals = {} as GasValues
          GASES.forEach((g, gi) => {
            // 모델 시험 에피소드는 이미 측정 잡음이 들어 있어 그대로 쓴다 (서버 재생기와 같다)
            vals[g] = Math.max(0, truth[g] + (z.episode ? 0 : noise(zi, this.nextSample, gi) * NOISE[g]))
          })
          z.history.push({ t: ts, vals })
          z.lastRecv = ts
          while (z.history.length && z.history[0].t < ts - HISTORY_MIN) z.history.shift()
        })
      }
      this.nextSample++
    }
  }

  // 최근 10분 선형 회귀 기울기(분당)
  private slope(z: ZoneState, g: Gas) {
    const pts = z.history.filter((h) => h.t >= this.t - 10)
    if (pts.length < 6) return 0
    const n = pts.length
    const mx = pts.reduce((s, p) => s + p.t, 0) / n
    const my = pts.reduce((s, p) => s + p.vals[g], 0) / n
    let num = 0
    let den = 0
    pts.forEach((p) => {
      num += (p.t - mx) * (p.vals[g] - my)
      den += (p.t - mx) ** 2
    })
    return den ? num / den : 0
  }

  assess(z: ZoneState): Assessment {
    if (this.serverMode) {
      const a = this.serverAssess.get(z.id)
      if (a) return a
    }
    if (z.lastRecv === null && z.measureFrom !== undefined && this.t < z.measureFrom + MISSING_AFTER_MIN) {
      // 측정 전 (작업 전 측정 때 측정기를 붙인다). 결측이 아니다 — 서버 rules.assess 와 같은 값
      return { status: "idle", gas: "O2", score: -1, value: 20.9, slope: 0, eta: null, pending: true }
    }
    const missing = z.lastRecv === null || this.t - z.lastRecv > MISSING_AFTER_MIN
    if (missing) {
      const since = z.sensorLostAt ?? z.lastRecv ?? this.t
      return { status: "missing", score: 0, lostMin: Math.max(0, Math.round(this.t - since)) }
    }
    const cur = z.history[z.history.length - 1].vals
    let worst = { gas: GASES[0], score: -Infinity, value: 0 }
    GASES.forEach((g) => {
      const sc = severity(g, cur[g])
      if (sc > worst.score) worst = { gas: g, score: sc, value: cur[g] }
    })
    let status: Exclude<Status, "missing"> = worst.score >= 1 ? "legal" : worst.score >= 0 ? "warn" : "ok"
    const ug = z.permit ? null : unauthGas(cur)
    if (ug && status !== "legal") {
      status = "unauth"
      worst = { gas: ug, score: Math.max(worst.score, severity(ug, cur[ug])), value: cur[ug] }
    }
    if (status === "ok" && !z.permit) status = "idle"
    const s = this.slope(z, worst.gas)
    return { status, ...worst, slope: s, eta: etaToLegal(worst.gas, worst.value, s), unauth: !!ug }
  }

  private reason(z: ZoneState, a: Assessment): { head: string; detail: string } {
    const p = z.permit
    const work = p ? `${p.task} ${p.no}` : "오늘 허가 없음"
    if (a.status === "missing") {
      const m = this.people.find((x) => x.role === "측정요원" && x.zoneId === z.id && x.status !== "대기")
      const field = !m ? "측정요원 호출 필요" : m.status === "현장 도착" ? `측정요원 ${m.name} 현장 측정 중` : `측정요원 ${m.name} 출동 중`
      return {
        head: `센서 ${z.sensor} 통신 두절 ${a.lostMin}분`,
        detail: `${work}${p ? " 진행 중" : ""} · ${field}`,
      }
    }
    const L = LIMITS[a.gas]
    const head = `${gasLabel(a.gas)} ${fmtVal(a.gas, a.value)} ${L.unit}`
    if (a.status === "unauth") {
      const sup = this.people.find((x) => x.role === "관리감독자" && x.zoneId === z.id && x.status !== "대기")
      return { head, detail: `허가 없이 누가 안에서 작업 중일 수 있음 · ${sup ? `${sup.name} ${sup.status}` : "관리감독자 확인 필요"}` }
    }
    if (a.status === "legal") {
      const lim = a.gas === "O2" ? `기준 ${L.legalLow} 미만` : `기준 ${L.legal} 초과`
      return { head, detail: `${lim} · ${work}${p ? ` · 출입중 ${p.workers}` : ""}` }
    }
    const band = a.gas === "O2" ? `경계(${L.warnLow} 미만)` : `경계(${L.warn} 이상)`
    const dir = a.gas === "O2" ? (a.slope < -0.005 ? "하락 추세" : "") : a.slope > 0.005 ? "상승 추세" : ""
    const eta = a.eta ? ` · 현재 추세면 약 ${Math.round(a.eta)}분 뒤 법정 기준` : ""
    return { head, detail: `${band}${dir ? ", " + dir : ""} · ${work}${eta}` }
  }

  private addLog(zone: string, text: string) {
    this.log.push({ t: this.t, zone, text })
  }

  private zoneName(id: string) {
    return this.zones.find((z) => z.id === id)?.name ?? id
  }

  // 작업부서 (관리감독자 호출용). 허가서의 부서명에서 협력사 표기는 뺀다
  private dept(z: ZoneState) {
    const d = z.permit ? PERMITS.find((p) => p.no === z.permit!.no)?.dept : undefined
    // 승인 전 허가서로 들어간 칸은 그 허가서의 작업반 관리감독자를 부른다
    return d ? d.replace(/\s*\(.*\)$/, "") : (z.entry?.team ?? "선행의장 1공장")
  }

  private emit(tone: Tone, zoneId: string | undefined, text: string) {
    const z = zoneId ? this.zones.find((x) => x.id === zoneId) : undefined
    this.feed.push({ id: this.feedId++, t: this.t, tone, zoneId, zoneName: z?.name, block: z?.block, text })
    if (this.feed.length > 200) this.feed.shift()
  }

  // 상태가 바뀐 구역을 자연어로 알린다
  private statusEvents() {
    this.zones.forEach((z) => {
      const a = this.assess(z)
      const prev = this.prevStatus.get(z.id)
      if (!prev || prev === a.status) {
        this.candidate.delete(z.id)
        if (!prev) this.prevStatus.set(z.id, a.status)
        return
      }
      const c = this.candidate.get(z.id)
      if (a.status !== "legal" && a.status !== "unauth") {
        if (!c || c.status !== a.status) {
          this.candidate.set(z.id, { status: a.status, since: this.t })
          return
        }
        if (this.t - c.since < STATUS_CONFIRM) return
      }
      this.candidate.delete(z.id)
      this.prevStatus.set(z.id, a.status)
      if ((prev === "ok" || prev === "idle") && (a.status === "ok" || a.status === "idle")) return
      const key = `${z.id}:${a.status}`
      const last = this.lastStatusEvent.get(key)
      if (last !== undefined && this.t - last < STATUS_EVENT_GAP) return
      this.lastStatusEvent.set(key, this.t)
      if (a.status === "missing") {
        this.emit("missing", z.id, `${z.name} 센서 ${z.sensor} 신호가 끊겼습니다. 측정요원 확인이 필요합니다.`)
        return
      }
      if (a.status === "ok" || a.status === "idle") {
        this.emit("ok", z.id, `${z.name} — 정상 범위로 돌아왔습니다.`)
        return
      }
      const val = `${gasLabel(a.gas)} ${fmtVal(a.gas, a.value)} ${LIMITS[a.gas].unit}`
      if (a.status === "unauth") {
        this.emit("unauth", z.id, `${z.name} — 오늘 작업 허가가 없는 구역인데 ${val}가 잡혔습니다. 허가 없이 작업 중일 수 있습니다.`)
      } else if (a.status === "legal") {
        this.emit("legal", z.id, `${z.name} ${val} — 법정 기준을 넘었습니다. 즉시 작업 중지·대피가 필요합니다.`)
      } else if (prev !== "legal") {
        this.emit("warn", z.id, `${z.name} ${val} — 경계 수준에 들어섰습니다.`)
      }
    })
  }

  private checkEvents() {
    TIMELINE.forEach((e, i) => {
      if (e.t > this.t || this.firedTimeline.has(i)) return
      this.firedTimeline.add(i)
      if (e.log !== false) this.log.push({ t: e.t, zone: this.zoneName(e.zone), text: e.text })
      this.emit(e.tone, e.zone, e.text)
    })
    this.people.forEach((p) => {
      if (p.status !== "출동 중" || p.arriveAt === null || p.arriveAt > this.t || !p.zoneId) return
      p.status = "현장 도착"
      const zn = this.zoneName(p.zoneId)
      const who = p.role === "측정요원" ? `측정요원 ${p.name}` : p.name
      this.addLog(zn, `${who} 현장 도착`)
      this.emit(
        "ok",
        p.zoneId,
        p.role === "측정요원"
          ? `${who}이 ${zn}에 도착했습니다. 휴대용 측정기로 확인을 시작합니다.`
          : `${who}가 ${zn}에 도착했습니다.`,
      )
    })
    this.statusEvents()
    this.zones.forEach((z) => {
      ;(z.events || []).forEach((e, ei) => {
        const key = `${z.id}:${ei}`
        if (this.t >= e.t && !this.firedEvents.has(key)) {
          this.firedEvents.add(key)
          this.log.push({ t: e.t, zone: z.name, text: e.text })
        }
      })
      const a = this.assess(z)
      if (a.status === "unauth" && !z.unauthNotified) {
        z.unauthNotified = true
        this.addLog(z.name, `허가 없는 구역에서 ${gasLabel(a.gas)} ${fmtVal(a.gas, a.value)} 감지 → 무허가 작업 의심 (규칙층)`)
        this.notices.push({ text: `무허가 작업 의심: ${z.name} — 오늘 허가가 없는데 ${gasLabel(a.gas)}가 잡혔습니다`, danger: true })
      }
      if (a.status === "legal" && !z.alarmed) {
        z.alarmed = true
        this.addLog(z.name, `${gasLabel(a.gas)} ${fmtVal(a.gas, a.value)} 법정 초과 → 경보 발생 (규칙층)`)
        this.notices.push({ text: `법정 기준 초과: ${z.name} — 책임자 확인이 필요합니다`, danger: true })
      }
    })
  }

  /** 구역 상세 (클릭한 밀폐구역): 5가스 현재값·추세·최근 40분 이력·사람·이벤트 */
  zoneDetail(id: string) {
    const z = this.zones.find((x) => x.id === id)
    if (!z) return null
    const a = this.assess(z)
    const last = z.history.length ? z.history[z.history.length - 1].vals : null
    const gases = GASES.map((g) => {
      const v = last ? last[g] : null
      const sev = v === null ? null : severity(g, v)
      const slope = this.slope(z, g)
      return {
        gas: g,
        label: gasLabel(g),
        unit: LIMITS[g].unit,
        limit: LIMITS[g],
        value: v,
        text: v === null ? "—" : fmtVal(g, v),
        status: (sev === null ? "idle" : sev >= 1 ? "legal" : sev >= 0 ? "warn" : "ok") as Status,
        slope,
        eta: v === null ? null : etaToLegal(g, v, slope),
      }
    })
    return {
      zone: z,
      assessment: a,
      gases,
      history: z.history.filter((h) => h.t >= this.t - 40),
      lastRecv: z.lastRecv,
      people: this.people.filter((p) => p.zoneId === id && p.status !== "대기"),
      /** 송풍기 ON/OFF (번호 순서, 최대 2대) */
      blowers: this.blowers(id),
      events: this.feed.filter((e) => e.zoneId === id).slice(-6).reverse(),
    }
  }

  /** 화면에 그릴 값 한 벌 */
  view() {
    const A = this.zones.map((z) => this.assess(z))
    const statusOf = (i: number) => A[i].status
    const missing = A.filter((a) => a.status === "missing").length

    const focus: FocusItem[] = this.zones
      .map((z, i) => ({ z, a: A[i] }))
      .filter(({ a }) => a.status === "legal" || a.status === "unauth" || a.status === "missing" || a.status === "warn")
      .sort((x, y) => STATUS[x.a.status].rank - STATUS[y.a.status].rank || (y.a.score || 0) - (x.a.score || 0))
      .map(({ z, a }) => ({ zone: z, status: a.status, a, ...this.reason(z, a) }))

    const blocks: BlockView[] = BLOCKS.map((b) => {
      const zs = this.zones.flatMap((z, i) => (z.block === b.id ? [{ id: z.id, name: z.name, status: statusOf(i) }] : []))
      const status = zs.reduce<Status>((w, z) => (STATUS[z.status].rank < STATUS[w].rank ? z.status : w), "idle")
      return { def: b, status, zones: zs }
    })

    return {
      t: this.t,
      outage: this.outage,
      zoneStatus: this.zones.map((z, i) => ({ id: z.id, status: statusOf(i) })),
      watched: this.zones.filter((z) => z.permit).length,
      sensorOk: A.length - missing,
      /** 가장 최근에 센서 값을 받은 시각 (시연 시각, 분) */
      lastRecv: this.zones.reduce<number | null>((m, z) => (z.lastRecv !== null && (m === null || z.lastRecv > m) ? z.lastRecv : m), null),
      missing,
      pending: this.zones.filter((z) => z.alarmed && !z.acked),
      focus,
      legalCount: focus.filter((f) => f.status === "legal").length,
      unauthCount: focus.filter((f) => f.status === "unauth").length,
      blocks,
      log: [...this.log].sort((x, y) => y.t - x.t),
      /** 최근 것부터 */
      feed: [...this.feed].reverse(),
      people: this.people.map((p) => ({ ...p, zoneName: p.zoneId ? this.zoneName(p.zoneId) : null })),
    }
  }
}

export type SimView = ReturnType<Simulation["view"]>
