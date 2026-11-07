// 안전 에이전트 팀: 관리자가 경보 때 묻는 질문 하나에 에이전트 하나, 데이터 출처 하나씩.
//   위험도 평가  얼마나 위험하고 얼마나 빨리 나빠지나  ← 센서 값·기울기, 5가스 위험예측 모델(AI ①)
//   원인 추정    왜 이러나                           ← 허가서·작업 내용, 맞닿은 칸
//   사례 검색    전에 어떻게 해결했나                 ← 처리 기록 (시연용 합성)
//   현장 자원    지금 누가 갈 수 있나                 ← 측정요원·관리감독자 위치
//   총괄        그래서 뭘 하나                       ← 위 넷의 결과로 단계·조치 순서·호출 대상을 정한다
// 총괄은 각 에이전트 결과로 결론을 바꾼다 (trace에 무엇이 무엇을 바꿨는지 남긴다).
// 화면 값만으로 판단한다 (LLM 호출 없음). 5가스 위험예측 모델 결과가 있으면 위험도 평가에 쓴다.
// 작업→가스 대응(TASK_GAS)과 사례(CASES)는 팀 가정·합성 기록이다 (src/server/ai_server/seed.py 판례와 같은 내용, 미검증)
import { LIMITS, ZONES, type Gas } from "@/data/scenario"
import { STATUS, fmtTime, fmtVal, type SimView, type Simulation } from "@/lib/sim"
import { predictionText } from "@/lib/prediction"
import type { Prediction } from "@/lib/server"

export type Detail = NonNullable<ReturnType<Simulation["zoneDetail"]>>
export type AgentId = "risk" | "cause" | "cases" | "crew"
/** 분석을 시작한 이유. trend = 규칙상 정상이지만 기울기나 예측 모델로 30분 안 기준 도달 */
export type Trigger = "legal" | "unauth" | "missing" | "warn" | "trend" | "ask"
export type Flag = "risk" | "caution" | "clear" | "info"
export type Level = "stop" | "hold" | "limit" | "watch" | "normal"
export type CallKind = "stop" | "vent" | "measurer" | "supervisor"
/** 현장 확인을 맡기는 방법: 측정요원·관리감독자 호출, 설비 담당 요청(기록), 안전관리자 본인 확인 */
export type Act = "measurer" | "supervisor" | "facility" | "self"
export interface Check {
  what: string
  who: string
  act: Act
  /** 이미 그 사람이 가는 중이거나 현장에 있으면 버튼 대신 이 상태를 보여 준다 */
  pending?: string
}

export const AGENTS: { id: AgentId; name: string; question: string; doing: string }[] = [
  { id: "risk", name: "위험도 평가", question: "얼마나 위험하고, 얼마나 빨리 나빠지나", doing: "가스 추세·예측 모델 확인 중" },
  { id: "cause", name: "원인 추정", question: "왜 이러나", doing: "허가서·맞닿은 칸 대조 중" },
  { id: "crew", name: "현장 자원", question: "지금 누가 갈 수 있나", doing: "측정요원·관리감독자 위치 확인 중" },
  { id: "cases", name: "사례 검색", question: "전에 어떻게 해결했나", doing: "비슷한 처리 기록 찾는 중" },
]

export const TRIGGER_LABEL: Record<Trigger, string> = {
  legal: "법정 초과",
  unauth: "무허가 의심",
  missing: "센서 결측",
  warn: "경계 진입",
  trend: "경보 전 감지",
  ask: "요청 분석",
}
/** 같은 구역에서 더 심한 단계로 바뀔 때만 다시 분석한다 */
export const TRIGGER_RANK: Record<Trigger, number> = { ask: 0, trend: 1, warn: 2, missing: 3, unauth: 3, legal: 4 }

export interface Finding {
  id: AgentId
  flag: Flag
  head: string
  lines: string[]
}

export interface Verdict {
  level: Level
  title: string
  /** 에이전트가 관리자에게 하는 상황 설명 (무슨 일이고 왜 위험한지) */
  briefing: string[]
  /** 시스템이 알 수 없어 현장에서 사람이 확인해야 할 것 · 누가 */
  checks: Check[]
  actions: string[]
  calls: CallKind[]
  /** 에이전트 결과가 결론의 어디를 정했는지 */
  trace: { id: AgentId; effect: string }[]
  /** 조치 순서 출처 */
  from: string
}

export interface Report {
  zoneId: string
  zoneName: string
  trigger: Trigger
  t: number
  findings: Finding[]
  verdict: Verdict
}

// 작업 내용 → 그 작업에서 나오기 쉬운 가스 (팀 가정)
const TASK_GAS: [RegExp, Gas[]][] = [
  [/아르곤/, ["O2"]],
  [/용접|절단|그라인딩|사상/, ["CO"]],
  [/도장|신너/, ["LEL"]],
  [/용제 세척/, ["LEL", "CO2"]],
  [/청소|검사/, ["H2S", "O2"]],
]
const expectedGases = (task: string) => [...new Set(TASK_GAS.filter(([re]) => re.test(task)).flatMap(([, g]) => g))]

// 시연용 합성 처리 기록 (seed.py SEED와 같은 내용을 줄여 옮김)
const CASES: { title: string; task: string; gas: Gas; actions: string[]; outcome: string; missing?: boolean }[] = [
  { title: "이중저 WBT 도장 중 송풍기 1대 정지로 LEL 급상승", task: "도장 터치업", gas: "LEL", actions: ["도장 작업 즉시 중지, 스프레이건·점화원 차단", "작업자 맨홀로 대피, 인원 점검", "정지 송풍기 재가동, 대기 송풍기(2번) 가동", "측정요원 휴대용 측정기로 상·중·하 재측정", "LEL 5% 미만 30분 유지 확인 후 관리감독자 승인 받아 재입장"], outcome: "20분 뒤 3%LEL로 하강. 송풍기 전원 케이블 손상 확인" },
  { title: "도장 중 환기 덕트 꺾임으로 LEL 경계 진입", task: "내부 도장", gas: "LEL", actions: ["도장 일시 중지", "덕트 꺾임 해소, 덕트 끝을 탱크 하부까지 연장", "LEL 하강 추세 확인 후 작업 재개"], outcome: "10분 안에 2%LEL로 하강, 작업 재개" },
  { title: "아르곤 백퍼지 용접 중 산소 농도 저하", task: "아르곤 용접", gas: "O2", actions: ["용접 중지, 아르곤 공급 밸브 잠금", "작업자 즉시 대피", "급기 송풍기로 신선 공기 공급", "퍼지 호스·이음부 누설 점검", "O₂ 19.5% 이상 회복 확인 후 재입장"], outcome: "퍼지 호스 이음부 누설 확인, 교체 후 재개" },
  { title: "파이프덕트 아르곤 체류로 산소 결핍 경계", task: "아르곤 용접", gas: "O2", actions: ["작업 일시 중지", "하부에 배기 덕트 설치해 고인 아르곤 배출", "작업자 위치를 상부로 조정", "재측정 후 재개"], outcome: "O₂ 20.5% 회복" },
  { title: "코퍼댐 절단·그라인딩 중 CO 상승", task: "절단·그라인딩", gas: "CO", actions: ["절단 작업 중지, 토치 소화", "작업자 대피", "국소 배기 장치 설치, 배기 덕트를 절단 지점 가까이", "CO 20ppm 미만 확인 후 재개", "절단 시간 분할 운영"], outcome: "CO 8ppm으로 하강, 국소 배기 상시 가동 조건으로 재개" },
  { title: "선미 탱크 보강재 용접 흄 CO 경계", task: "보강재 용접", gas: "CO", actions: ["대기 송풍기(2번) 가동", "용접 지점 국소 배기", "15분 뒤 재측정"], outcome: "CO 12ppm 유지" },
  { title: "연료유 탱크 용제 세척 중 CO₂ 상승", task: "용제 세척", gas: "CO2", actions: ["내부 인원 2명으로 축소", "대기 송풍기 가동, 급기·배기 위치 분리", "CO₂ 1.0% 미만 확인 후 인원 복귀"], outcome: "CO₂ 0.6%로 하강" },
  { title: "TST 신너 세척 중 LEL 상승", task: "용제 세척(신너)", gas: "LEL", actions: ["세척 중지", "신너 용기 밀폐 후 탱크 밖으로 반출", "환기 강화, 방폭 공구 사용 확인", "LEL 5% 미만 확인 후 재개"], outcome: "1.5%LEL로 하강" },
  { title: "이중저 배관 청소 중 H₂S 검출", task: "배관 내부 청소·검사", gas: "H2S", actions: ["청소 작업 중지", "작업자 대피", "슬러지 구역 환기, 교반 중지", "송기마스크 착용 조건 검토", "H₂S 5ppm 미만 확인 후 재입장"], outcome: "환기 40분 뒤 1ppm 미만" },
  { title: "센서 통신 두절 구역 수동 측정 대응", task: "아르곤 용접", gas: "O2", missing: true, actions: ["측정요원 출동, 휴대용 측정기로 즉시 측정", "측정 전까지 작업자 상부 대기", "센서 전원·통신 점검", "복구 전까지 30분마다 수동 측정"], outcome: "센서 배터리 방전 확인, 교체 후 복구" },
]

const words = (s: string) => s.split(/[\s·()]+/).filter((w) => w.length > 1)

function searchCases(task: string, gas: Gas | null, missing: boolean) {
  const tw = words(task)
  return CASES.map((c) => {
    let s = 0.2
    if (gas && c.gas === gas) s += 0.45
    if (missing === !!c.missing) s += missing ? 0.4 : 0.05
    s += 0.3 * (tw.filter((w) => c.task.includes(w)).length / Math.max(1, tw.length))
    return { c, sim: Math.min(0.97, s) }
  }).sort((a, b) => b.sim - a.sim)
}

const fmtSlope = (g: Gas, s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(g === "CO" ? 1 : g === "CO2" ? 3 : 2)}`
const limitText = (g: Gas) => (g === "O2" ? `${LIMITS.O2.legalLow}% 미만` : `${LIMITS[g].legal}${LIMITS[g].unit}`)
const reached = (g: Gas, v: number) => (g === "O2" ? v < LIMITS.O2.legalLow! : v >= LIMITS[g].legal!)
const BAD = ["legal", "warn", "unauth", "missing"]

/** 지금 이 구역에서 분석을 시작해야 하는 이유 (없으면 null). 정상이어도 기울기나 예측 모델이 30분 안 초과를 보면 trend */
export function triggerOf(status: string, d: Detail | null, p?: Prediction): Trigger | null {
  if (status === "legal" || status === "unauth" || status === "missing" || status === "warn") return status
  if (status === "ok" && d?.zone.permit && (d.gases.some((g) => g.eta !== null && g.eta < 30) || predictionText(p)?.hot)) return "trend"
  return null
}

type Severity = "critical" | "high" | "elevated" | "unknown" | "low"
type Cause = { kind: "work" | "neighbor" | "unauth" | "leak" | "blind" | "none"; neighbor?: { id: string; name: string; task: string } }

export function analyze(trigger: Trigger, d: Detail, view: SimView, prediction: Prediction | undefined): Report {
  const z = d.zone
  const a = d.assessment
  const missing = a.status === "missing"
  const task = z.permit?.task ?? ""
  const exp = expectedGases(task)
  // 볼 가스: 추세 감지면 가장 빨리 기준에 닿는 가스, 다 정상이면 이 작업에서 나오기 쉬운 가스, 아니면 규칙 판정 가스
  const soonest = [...d.gases].filter((g) => g.eta !== null).sort((x, y) => x.eta! - y.eta!)[0]
  const ruled = missing ? null : (d.gases.find((g) => g.gas === a.gas) ?? null)
  const quiet = a.status === "ok" || a.status === "idle"
  const key = missing ? null : trigger === "trend" && soonest ? soonest : quiet && exp.length ? d.gases.find((g) => g.gas === exp[0])! : ruled
  const pt = prediction?.prediction_status === "PREDICTED" ? predictionText(prediction) : null

  // ── 1 위험도 평가: 센서 값·기울기 + 예측 모델 → 심각도
  let severity: Severity
  const risk: Finding = (() => {
    if (missing) {
      severity = "unknown"
      const last = d.history[d.history.length - 1]
      return {
        id: "risk",
        flag: "risk",
        head: `판단 불가 · 센서 ${z.sensor} 통신 두절 ${a.lostMin}분째`,
        lines: [last ? `마지막 수신 ${fmtTime(last.t)} · O₂ ${fmtVal("O2", last.vals.O2)}% · LEL ${fmtVal("LEL", last.vals.LEL)}%LEL` : "오늘 받은 값이 없음", "지금 안쪽 공기 상태를 알 수 없음"],
      }
    }
    if (!key || key.value === null) {
      severity = "low"
      return { id: "risk", flag: "info", head: "측정값 없음 (작업 전)", lines: [] }
    }
    const over = reached(key.gas, key.value)
    const up = key.gas === "O2" ? key.slope < -0.005 : key.slope > 0.005
    severity = over ? "critical" : key.status === "warn" && key.eta !== null && key.eta <= 15 ? "high" : key.status === "warn" || key.eta !== null || pt?.hot ? "elevated" : "low"
    if (pt?.hot && severity === "elevated" && prediction?.forecast_state === "IMMINENT") severity = "high"
    const others = d.gases.filter((g) => g.gas !== key.gas && (g.status === "warn" || g.status === "legal"))
    const label = { critical: "매우 높음", high: "높음", elevated: "주의", low: "낮음", unknown: "판단 불가" }[severity]
    return {
      id: "risk",
      flag: severity === "critical" || severity === "high" ? "risk" : severity === "elevated" ? "caution" : "clear",
      head: `위험도 ${label} · ${key.label} ${key.text} ${key.unit} (분당 ${fmtSlope(key.gas, key.slope)})`,
      lines: [
        over ? `법정 기준(${limitText(key.gas)}) 넘음${up ? ", 계속 악화 중" : ""}` : key.eta !== null ? `이 추세면 약 ${Math.round(key.eta)}분 뒤 법정 기준(${limitText(key.gas)})` : `법정 기준 ${limitText(key.gas)} · 도달 추세 아님`,
        pt ? `예측 모델: ${pt.text}${prediction?.risk_probability_30m != null ? ` (30분 안 ${Math.round(prediction.risk_probability_30m * 100)}%)` : ""}` : "예측 모델 서버 미연결 → 최근 기울기로 판단",
        ...(others.length ? [`함께 높은 가스: ${others.map((g) => `${g.label} ${g.text}`).join(", ")}`] : []),
      ],
    }
  })()

  // ── 2 원인 추정: 허가서·작업 내용과 맞닿은 칸 → 발생원
  const statusOf = new Map(view.zoneStatus.map((s) => [s.id, s.status]))
  const nearIds = ZONES.filter((x) => x.id !== z.id && ((z.adjacentTo ?? []).includes(x.id) || (x.adjacentTo ?? []).includes(z.id))).map((x) => x.id)
  const badNear = ZONES.filter((x) => nearIds.includes(x.id) && BAD.includes(statusOf.get(x.id) ?? ""))
  // 옆 칸이 이상하거나, 이 칸이 작업 없는 칸이면 옆 작업 칸을 발생원 후보로
  const workNear = ZONES.find((x) => nearIds.includes(x.id) && x.permit)
  // 송풍기: 제어 시스템 실시간 상태. vent.stopAt 이 지났고 1번이 꺼져 있으면 그 시각에 멈춘 것
  const ventOn = d.blowers.filter(Boolean).length
  const ventStop = z.vent && view.t >= z.vent.stopAt && !d.blowers[0] ? z.vent.stopAt : null
  const ventLine = d.blowers.length ? `송풍기 ${d.blowers.map((b, i) => `${i + 1} ${b ? "가동" : i === 0 && ventStop !== null ? `정지(${fmtTime(ventStop)})` : "정지"}`).join(" · ")}` : ""
  // 승인 전 허가서로 들어간 출입 (출입현황판 기록). 옆 칸이 도장 중이면 불꽃이 넘어가는 게 더 큰 위험
  const entry = z.entry
  const paintNear = workNear?.permit && /도장/.test(workNear.permit.task) ? workNear : null
  const elevated = !!key && (key.status !== "ok" || key.eta !== null)
  const cause: Cause = missing
    ? { kind: "blind" }
    : !elevated && a.status !== "unauth"
      ? { kind: "none" }
      : !z.permit
        ? badNear.length && badNear[0].permit
          ? { kind: "neighbor", neighbor: { id: badNear[0].id, name: badNear[0].name, task: badNear[0].permit.task } }
          : { kind: "unauth" }
        : exp.includes(key!.gas)
          ? { kind: "work" }
          : badNear.length
            ? { kind: "neighbor", neighbor: { id: badNear[0].id, name: badNear[0].name, task: badNear[0].permit?.task ?? "작업 없음" } }
            : { kind: "leak" }
  const nearLine = !nearIds.length
    ? "맞닿은 감시 칸 없음"
    : badNear.length
      ? `맞닿은 칸 중 ${badNear.map((x) => `${x.name} ${STATUS[statusOf.get(x.id)!].label}`).join(", ")}`
      : `맞닿은 칸 ${nearIds.length}곳 모두 이상 없음`
  const causeFinding: Finding = {
    id: "cause",
    flag: cause.kind === "none" ? "clear" : cause.kind === "blind" ? "caution" : "risk",
    head: {
      work: `발생원: 이 칸의 ${task}`,
      neighbor: `발생원: 옆 칸 ${cause.neighbor?.name} 유입 의심`,
      unauth: "발생원: 허가 없는 작업 의심",
      leak: `발생원: 작업과 무관 → 설비 누설·환기 불량 의심`,
      blind: "발생원 판단 불가 (값 없음)",
      none: "이상 징후 없음",
    }[cause.kind],
    lines: [
      z.permit
        ? `허가 ${z.permit.no} · ${task} · 출입 ${z.permit.workers}명`
        : entry
          ? `오늘 승인된 허가 0건 · 출입현황판 ${entry.team} ${entry.workers}명 ${fmtTime(entry.from)} 입장`
          : `오늘 허가 없는 칸${workNear ? ` (맞닿은 작업 칸: ${workNear.name})` : ""}`,
      cause.kind === "unauth" && entry ? `허가서 ${entry.no} ${entry.task} — 아직 승인 전` : "",
      cause.kind === "unauth" && entry && key && expectedGases(entry.task).includes(key.gas) ? `${entry.task}에서 나오는 가스(${key.label})와 일치` : "",
      cause.kind === "work"
        ? `${task}에서 나오는 가스(${key!.label})와 일치`
        : cause.kind === "leak"
          ? `${task}에서는 잘 나오지 않는 가스(${key!.label})`
          : cause.kind === "none" && exp.length
            ? `이 작업에서 주의할 가스 ${exp.map((g) => d.gases.find((x) => x.gas === g)!.label).join(", ")} · 지금은 정상`
            : "",
      cause.kind === "unauth" && paintNear ? `옆 ${paintNear.name} ${paintNear.permit!.task} 중 → 불꽃이 넘어가면 화재 위험` : nearLine,
      cause.kind === "work" || cause.kind === "leak" ? ventLine : "",
    ].filter(Boolean),
  }

  // ── 3 현장 자원: 측정요원·관리감독자
  const here = view.people.find((p) => p.role === "측정요원" && p.zoneId === z.id && p.status !== "대기")
  const free = view.people.filter((p) => p.role === "측정요원" && p.status === "대기")
  const crewState: "onsite" | "enroute" | "free" | "none" = here ? (here.status === "현장 도착" ? "onsite" : "enroute") : free.length ? "free" : "none"
  const sup = view.people.find((p) => p.role === "관리감독자" && p.zoneId === z.id && p.status !== "대기")
  const crew: Finding = {
    id: "crew",
    flag: crewState === "none" ? "caution" : "info",
    head: {
      onsite: `측정요원 ${here?.name} 현장에 있음`,
      enroute: `측정요원 ${here?.name} 이동 중 · ${fmtTime(here?.arriveAt ?? view.t)} 도착`,
      free: `바로 보낼 수 있는 측정요원 ${free[0]?.name}(${free[0]?.area})`,
      none: "대기 중인 측정요원 없음",
    }[crewState],
    lines: [
      free.length && crewState !== "free" ? `대기 측정요원: ${free.map((p) => p.name).join(", ")}` : crewState === "none" ? "모두 다른 구역으로 이동 중 → 출동 지연" : "",
      sup ? `관리감독자 ${sup.name} ${sup.status}` : "작업부서 관리감독자 호출 가능 (약 3분)",
    ].filter(Boolean),
  }

  // ── 4 사례 검색: 위험도(가스)·원인(작업)으로 찾는다
  const found = searchCases(cause.kind === "neighbor" ? (cause.neighbor?.task ?? task) : task, key?.gas ?? (missing ? "O2" : null), missing)
  const top = found[0]
  const cases: Finding = {
    id: "cases",
    flag: "info",
    head: `가장 비슷한 기록 ${Math.round(top.sim * 100)}% · ${top.c.title}`,
    lines: [`결과: ${top.c.outcome}`, `검색 조건: ${key?.label ?? "센서 결측"}${cause.kind === "neighbor" ? ` · 옆 칸 ${cause.neighbor?.task}` : task ? ` · ${task}` : ""} (시연용 합성 기록)`],
  }

  // ── 총괄: 위험도 → 단계, 원인 → 첫 조치·대상, 현장 자원 → 호출 대상, 사례 → 나머지 조치
  const trace: Verdict["trace"] = []
  let level: Level
  let title: string
  const stopWord = cause.kind === "neighbor" ? `옆 칸(${cause.neighbor?.name}) 작업 중지` : cause.kind === "unauth" ? "출입자 퇴거" : "작업 중지"
  if (cause.kind === "unauth") {
    level = "stop"
    title = "작업 중지 · 출입자 확인"
  } else if (severity! === "unknown") {
    level = "hold"
    title = "작업 보류 · 수동 측정"
  } else if (severity! === "critical") {
    level = "stop"
    title = cause.kind === "neighbor" ? `대피 · ${stopWord}` : cause.kind === "leak" ? "대피 · 누설 지점 차단" : "즉시 작업 중지 · 대피"
  } else if (severity! === "high") {
    level = "limit"
    title = cause.kind === "neighbor" ? stopWord : "작업 일시 중지"
  } else if (severity! === "elevated") {
    level = a.status === "warn" ? "limit" : "watch"
    title = a.status === "warn" ? "환기 보강 · 감시 강화" : "경보 전 선제 점검"
  } else {
    level = "normal"
    title = "지금은 조치 없이 감시 유지"
  }
  trace.push({ id: "risk", effect: `위험도 ${risk.head.split(" · ")[0].replace("위험도 ", "")} → 단계 「${title}」` })

  const first: string | null = {
    work:
      severity! === "critical"
        ? `${task} 즉시 중지, 작업자 ${z.permit?.workers ?? ""}명 대피`
        : severity! === "high"
          ? `${task} 일시 중지, 작업자 맨홀 근처 대기`
          : `${task} 관리감독자에게 ${key?.label} 상승 추세 통보`,
    neighbor: `옆 칸 ${cause.neighbor?.name}의 ${cause.neighbor?.task} 확인·중지 (가스 유입 차단)`,
    unauth: entry ? `${entry.team} ${entry.workers}명 작업 중지·퇴거 (관리감독자 현장 확인)` : "관리감독자 현장 확인, 출입자 즉시 퇴거",
    leak: `${key?.label ?? ""} 누설 지점·환기 상태 점검 (작업과 무관한 가스)`,
    blind: "측정 전까지 작업자 상부 대기 또는 밖으로",
    none: null,
  }[cause.kind]
  if (cause.kind !== "none") trace.push({ id: "cause", effect: `${causeFinding.head.replace("발생원: ", "")} → 1단계 「${first}」` })

  const crewStep = {
    onsite: `현장의 측정요원 ${here?.name}이 휴대용 측정기로 상·중·하 교차 측정`,
    enroute: `측정요원 ${here?.name} 도착(${fmtTime(here?.arriveAt ?? view.t)}) 즉시 재측정`,
    free: `측정요원 ${free[0]?.name} 호출해 휴대용 측정기로 교차 측정`,
    none: "측정요원 모두 이동 중 → 관리감독자가 휴대용 측정기로 먼저 측정",
  }[crewState]
  const calls: CallKind[] = []
  if (level !== "normal") {
    if (a.status === "legal") calls.push("stop")
    // 가스가 쌓이는 건(경계·상승·법정 초과): 꺼져 있는 송풍기를 켜서 낮춘다 (다 돌고 있으면 권하지 않음). 센서 결측·무허가는 환기로 풀 일이 아니다
    if (a.status !== "missing" && cause.kind !== "unauth" && d.blowers.some((b) => !b)) calls.push("vent")
    if (cause.kind === "unauth" || crewState === "none") calls.push("supervisor")
    if (crewState === "free") calls.push("measurer")
    trace.push({ id: "crew", effect: crewState === "free" ? `측정요원 ${free[0]?.name}에게 교차 측정 요청` : crewState === "none" ? "측정요원 없음 → 관리감독자에게 측정 넘김" : `이미 ${here?.name} 출동 → 추가 호출 안 함` })
  }

  let actions: string[]
  let from: string
  if (level === "normal") {
    actions = ["지금 값 계속 감시", "기울기가 커지면 다시 분석"]
    from = "규칙 기반"
  } else if (cause.kind === "unauth") {
    // 무허가 작업은 처리 기록이 없어 사례 조치를 쓰지 않는다
    actions = [
      first!,
      crewStep,
      entry ? `허가서 ${entry.no} 승인 전 출입 경위 확인` : "출입 기록·오늘 허가서 대조",
      ...(paintNear ? [`옆 ${paintNear.name} 도장 쪽으로 불꽃·열 차단 확인`] : workNear ? [`맞닿은 작업 칸 ${workNear.name} 환기·누설 점검`] : []),
    ]
    from = "원인·현장 자원 판단 (무허가 작업 처리 기록 없음)"
    trace.push({ id: "cases", effect: "무허가 작업 사례 없음 → 사례 조치 쓰지 않음" })
  } else {
    // 사례 조치 중 1단계·측정과 겹치는 것(중지·대피·측정)은 빼고 나머지를 붙인다
    const caseSteps = top.c.actions.filter((s) => !/중지|대피|측정|퇴거|대기/.test(s) || /재입장|재개|복귀/.test(s))
    actions = [first, crewStep, ...caseSteps].filter((s): s is string => !!s).slice(0, 5)
    from = `원인·현장 자원 판단 + 사례 「${top.c.title}」`
    if (caseSteps.length) trace.push({ id: "cases", effect: `사례 조치 ${Math.min(caseSteps.length, 3)}단계 반영 (환기·재입장 조건)` })
  }

  // ── 상황 설명: 무슨 일이 있고, 왜 위험하고, 무엇을 모르는지
  const workers = z.permit?.workers ?? 0
  const lim = key ? limitText(key.gas) : ""
  const rising = key ? (key.gas === "O2" ? key.slope < -0.005 : key.slope > 0.005) : false
  const pace = key && rising ? `분당 ${fmtSlope(key.gas, key.slope).replace(/^[+−]/, "")}${key.unit}씩 ${key.gas === "O2" ? "떨어지고" : "오르고"} 있어요` : ""
  const lastRecv = d.history[d.history.length - 1]
  // 조사: LEL만 받침이 있다 (엘이엘이 · 씨오가)
  const subj = key ? `${key.label}${key.gas === "LEL" ? "이" : "가"}` : ""
  const topic = key ? `${key.label}${key.gas === "LEL" ? "은" : "는"}` : ""
  const amount = key && key.value !== null ? `${key.text} ${key.unit}` : ""
  const moved = key?.gas === "O2" ? "떨어져" : "올라"
  const briefing: string[] = []
  if (missing) {
    briefing.push(`${z.name} 센서 ${z.sensor}에서 ${a.lostMin}분째 값이 들어오지 않고 있어요.${lastRecv ? ` 마지막으로 받은 값(${fmtTime(lastRecv.t)})은 정상이었어요.` : ""}`)
    briefing.push(z.permit ? `문제는 ${task} 작업자 ${workers}명이 안에 있는데, 지금 안쪽 공기가 안전한지 확인할 방법이 없다는 점이에요. ${task.includes("아르곤") ? "아르곤은 냄새가 없어 산소가 떨어져도 작업자가 알아채기 어려워요." : ""}`.trim() : "작업은 없는 칸이지만, 값이 없는 동안은 이상을 잡을 수 없어요.")
  } else if (cause.kind === "unauth" && entry) {
    briefing.push(`${z.name}에서 ${subj} ${amount}까지 ${moved}갔어요. 이 칸에 오늘 승인된 허가는 없는데, 출입현황판에는 ${entry.team} ${entry.workers}명이 ${fmtTime(entry.from)}에 들어간 기록이 있어요.`)
    briefing.push(`허가서 ${entry.no}(${entry.task})가 승인 전인 채로 작업을 시작한 것으로 보여요.${key && expectedGases(entry.task).includes(key.gas) ? ` 이 작업에서 나오는 ${key.label}와도 맞아요.` : ""}`)
    if (paintNear) briefing.push(`옆 ${paintNear.name}에서는 ${paintNear.permit!.task} 중이라, 용접 불꽃이 넘어가면 도료 증기에 불이 붙을 수 있어요.`)
  } else if (cause.kind === "unauth") {
    briefing.push(`오늘 작업 허가가 없는 ${z.name}에서 ${subj} ${amount}까지 ${moved}갔어요. 사람이 없으면 거의 나오지 않는 수치예요.`)
    briefing.push(`허가 없이 누군가 안에서 작업 중일 수 있어요${workNear ? `. 또는 맞닿은 ${workNear.name} 작업에서 가스가 넘어왔을 수도 있어서` : "."}${workNear ? " 사람이 직접 들어가 봐야 구분할 수 있어요." : ""}`)
  } else if (cause.kind === "none") {
    briefing.push(`${z.name}은 지금 5가스 모두 기준 안이고, 악화되는 추세도 없어요.${z.permit ? ` ${task} 작업자 ${workers}명이 일하고 있어요.` : ""}`)
  } else if (key) {
    const where = z.permit ? `${task} 중인 ${z.name}에서` : `${z.name}에서`
    if (severity! === "critical") briefing.push(`${where} ${subj} ${amount}까지 ${moved} 법정 기준(${lim})을 넘었어요.${pace ? ` 지금도 ${pace}.` : ""}`)
    else if (severity! === "high") briefing.push(`${where} ${subj} ${amount}까지 ${moved} 경계 구간에 들어왔어요. ${pace ? `${pace}. ` : ""}이대로면 약 ${Math.round(key.eta ?? 0)}분 뒤 법정 기준(${lim})을 넘어요.`)
    else briefing.push(`${where} ${topic} 아직 기준 안(${amount})이지만 ${pace || "올라가는 중이에요"}. 이대로면 약 ${Math.round(key.eta ?? 0)}분 뒤 법정 기준(${lim})에 닿아서, 경보가 울리기 전에 먼저 알려드려요.`)
    briefing.push(
      {
        work:
          d.blowers.length && ventOn === 0
            ? `${task}에서 원래 나오는 가스인데, ${ventStop !== null ? `송풍기 1이 ${fmtTime(ventStop)}에 멈췄고 ${d.blowers.length > 1 ? "2번도 대기 중이라" : "다른 송풍기가 없어"}` : "송풍기가 모두 꺼져 있어"} 환기 없이 쌓이고 있어요.`
            : `${task}에서 원래 나오는 가스라 이 작업이 원인일 가능성이 높아요. 다만 평소보다 빨리 쌓이는 건 환기가 부족하다는 뜻일 수 있어요.`,
        leak: `${task}에서는 잘 나오지 않는 가스예요. 작업보다는 배관·밸브 누설이나 환기 문제일 수 있어요.`,
        neighbor: `맞닿은 ${cause.neighbor?.name}도 이상이 있어서, 그쪽 가스가 넘어오는 것으로 보여요.`,
        blind: "",
        unauth: "",
        none: "",
      }[cause.kind] + (severity! === "critical" && workers ? ` 안에 작업자 ${workers}명이 있어요.` : ""),
    )
  }
  if (cause.kind !== "none" && cause.kind !== "unauth") briefing.push(`비슷했던 사례 「${top.c.title}」 → ${top.c.outcome}.`)

  // ── 현장 확인: 시스템이 모르는 것 (송풍기 가동·작업자 상태·실제 출입은 실시간 데이터가 없다)
  const measurer = here?.name ?? free[0]?.name
  const who = measurer ? `측정요원 ${measurer}` : "관리감독자"
  const GAS_CHECK: Record<Gas, string> = {
    LEL: "점화원(스프레이건·전기 공구) 사용 여부와 도료·신너 용기 뚜껑",
    CO: "국소 배기 위치가 작업 지점 가까이 있는지",
    O2: "아르곤 공급 밸브·퍼지 호스 이음부 누설",
    CO2: "안에 있는 인원 수가 허가 인원과 같은지",
    H2S: "슬러지·오수를 휘젓고 있지 않은지",
  }
  const checks: Omit<Check, "act">[] = []
  if (missing) {
    checks.push({ what: `안에 있는 작업자 ${workers}명 상태 (무전·육성 확인)`, who: "관리감독자" })
    checks.push({ what: "휴대용 측정기로 O₂·LEL 실측 값", who })
    checks.push({ what: `센서 ${z.sensor} 전원·배터리·통신선`, who: "설비 담당" })
  } else if (cause.kind === "unauth" && entry) {
    checks.push({ what: `안에 있는 ${entry.team} ${entry.workers}명이 무슨 작업 중인지, 작업 중지·퇴거`, who: "관리감독자" })
    checks.push({ what: `허가서 ${entry.no}이 승인 전인데 왜 들어갔는지`, who: "안전관리자" })
    if (paintNear) checks.push({ what: `${paintNear.name} 도장 쪽으로 불꽃·열이 넘어가는 틈(관통부·개구부)이 있는지`, who })
  } else if (cause.kind === "unauth") {
    checks.push({ what: "칸 안에 실제로 사람이 있는지, 누가 무슨 작업 중인지", who: "관리감독자" })
    checks.push({ what: "출입 기록·오늘 허가서에 빠진 작업이 있는지", who: "안전관리자" })
    if (workNear) checks.push({ what: `${workNear.name} 쪽 개구부·배관으로 가스가 넘어오는지`, who })
  } else if (cause.kind !== "none" && key) {
    checks.push({
      what: !d.blowers.length
        ? "송풍기가 실제로 돌고 있는지, 덕트가 꺾이거나 빠지지 않았는지 (시스템에 실시간 정보 없음)"
        : ventOn === 0
          ? "송풍기가 멈춘 이유 (전원·케이블), 덕트가 꺾이거나 빠지지 않았는지"
          : "덕트가 꺾이거나 빠지지 않았는지 (송풍기 가동은 제어 시스템으로 확인)",
      who: "관리감독자",
    })
    checks.push({ what: GAS_CHECK[key.gas], who: "관리감독자" })
    checks.push({ what: "휴대용 측정기로 센서 값이 맞는지 (상·중·하)", who })
    if (cause.kind === "neighbor") checks.push({ what: `${cause.neighbor?.name} 작업 상태`, who: "관리감독자" })
  }

  // 누가 확인하느냐로 버튼을 정한다. 이미 가는 중이면 버튼 대신 상태
  function toCheck(c: Omit<Check, "act">): Check {
    if (c.who.startsWith("측정요원"))
      return { ...c, act: "measurer", pending: here ? `${here.name} ${here.status === "현장 도착" ? "현장에 있음" : `이동 중 · ${fmtTime(here.arriveAt ?? view.t)} 도착`}` : undefined }
    if (c.who === "관리감독자") return { ...c, act: "supervisor", pending: sup ? `${sup.name} ${sup.status}` : undefined }
    if (c.who === "설비 담당") return { ...c, act: "facility" }
    return { ...c, act: "self" }
  }

  return {
    zoneId: z.id,
    zoneName: z.name,
    trigger,
    t: view.t,
    findings: [risk, causeFinding, crew, cases],
    verdict: { level, title, briefing, checks: checks.map(toCheck), actions, calls, trace, from },
  }
}
