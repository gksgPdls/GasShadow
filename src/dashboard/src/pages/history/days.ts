// 안전 일지: 날짜 하나(DayData)로 기록 목록 · 사건 상세 · 일일 보고서를 함께 만든다.
// 오늘(11/9)은 관제 시뮬레이션 값, 지난 날은 archive.ts 합성값.
import { ZONES, blockName, type Gas } from "@/data/scenario"
import type { DecisionRecord } from "@/lib/records"
import { STATUS, fmtTime, gasLabel, type SimView, type Status } from "@/lib/sim"
import { ARCHIVE, DAYS, STATIC_DOCS, TODAY, type ArcIncident, type DayKey } from "@/pages/history/archive"
import { incidents, prepSummary, reportNumbers, todayEvents, zoneDef, type Ev } from "@/pages/history/model"
import { ME } from "@/pages/prep/model"

export type RecKind = "사건" | "조치" | "허가 결정" | "측정·작업"
/** 태그 색: 상태 색은 상태일 때만. 조치 = 진한 회색 · 대기 = 회색 · 그 밖 = 옅은 회색 */
export type TagTone = Status | "act" | "wait" | "plain"

export interface Rec {
  key: string
  day: DayKey
  t: number
  kind: RecKind
  tag: string
  tone: TagTone
  zoneId?: string
  /** 굵게 보이는 앞부분 (구역 이름 · 허가번호) */
  title: string
  text: string
  sub?: string
  who?: string
  /** 전날 허가 검토 기록 */
  prep?: boolean
  hay: string
}

export interface GasTrace {
  gas: Gas
  points: [number, number][]
}

/** 관리자가 입력하는 조치 결과 */
export const OUTCOMES = ["정상 복귀 · 작업 재개", "작업 중지 유지", "추가 조치 필요"] as const
export type Outcome = (typeof OUTCOMES)[number]
export interface IncidentResult {
  outcome: Outcome
  memo: string
  /** 입력 시각 HH:MM */
  at: string
  by: string
}

export interface DayIncident {
  id: string
  day: DayKey
  zoneId: string
  name: string
  block: string
  worst: Status
  since: number | null
  state: string
  work: string | null
  permitNo?: string
  dept?: string
  steps: { t: number; text: string; who?: string }[]
  resolved?: string
  trace?: GasTrace
  live?: boolean
  /** 지난 날은 이미 입력된 결과 (오늘은 화면에서 입력) */
  result?: IncidentResult
}

/** 보고서 쪽마다 들어가는 사건 수. 넘치면 사건을 쪼개지 않고 다음 쪽으로 넘긴다 */
export const FIRST_SLOTS = 5
export const NEXT_SLOTS = 8
export const reportPages = (d: { incidents: unknown[] }) => (d.incidents.length <= FIRST_SLOTS ? 1 : 1 + Math.ceil((d.incidents.length - FIRST_SLOTS) / NEXT_SLOTS))

/** 사건마다 사람이 한 조치만 (첫 경보 줄·자동 문장 제외) */
export const actionsOf = (inc: DayIncident) => inc.steps.filter((s) => s.who)

export interface DayNums {
  legal: number
  missing: number
  warn: number
  acks: number
  calls: number
  works: number
}

export interface DayData {
  key: DayKey
  label: string
  off?: boolean
  live: boolean
  asOf: string
  nums: DayNums
  incidents: DayIncident[]
  recs: Rec[]
  prepDay?: string
  prepLine: string
}

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** 검색용: 소문자 · 공백 없앰 · 아래첨자 숫자를 보통 숫자로 (H₂S = H2S) */
export const norm = (s: string) => s.toLowerCase().replace(/₂/g, "2").replace(/\s+/g, "")
// 띄어 쓴 말도 한 덩어리로 찾는다 ("3번 밸러스트" ≠ "2번 밸러스트탱크(좌현) 3번 칸")
export const tokensOf = (q: string) => (norm(q) ? [norm(q)] : [])
export const matches = (hay: string, tokens: string[]) => tokens.every((t) => hay.includes(t))

const TONE_TAG: Partial<Record<Status, string>> = { legal: "법정 초과", missing: "센서 결측", warn: "경고", unauth: "무허가 의심", ok: "정상 복귀" }

/** 문장 앞의 구역 이름과 그 뒤 조사를 뗀다 ("코퍼댐 2번 칸에 측정기를…" → "측정기를…") */
function stripZone(text: string, zoneName: string) {
  if (!text.startsWith(zoneName)) return text
  return text
    .slice(zoneName.length)
    .replace(/^\s*(—\s*)?/, "")
    .replace(/^(에서|에|이|가|은|는|의)\s+/, "")
}

const zoneSub = (zoneId?: string) => {
  const z = zoneId ? zoneDef(zoneId) : undefined
  if (!z) return undefined
  return z.permit ? `${z.permit.task} · ${z.permit.no}` : blockName(z.block)
}

function prepTag(text: string): [string, TagTone] {
  if (text.includes("승인 취소")) return ["승인 취소", "legal"]
  if (text.includes("보완 요청")) return ["보완 요청", "wait"]
  if (text.includes("재접수")) return ["재접수", "wait"]
  if (text.includes("승인")) return ["승인", "ok"]
  if (text.includes("확정")) return ["선별 확정", "plain"]
  return ["검토", "plain"]
}

function prepRec(day: DayKey, key: string, t: number, title: string, text: string, who: string): Rec {
  const [tag, tone] = prepTag(text)
  return { key, day, t, kind: "허가 결정", tag, tone, title, text, who, prep: true, hay: norm(`${title} ${text} ${who} ${tag}`) }
}

// ---------- 지난 날 (합성) ----------

// 그래프용 합성 곡선: 평상시 → 서서히 오름 → 기준 초과 → 조치 뒤 내려옴
function synthTrace(a: ArcIncident, since: number, firstAct: number, res: number): GasTrace | undefined {
  if (!a.gas || a.base === undefined || a.peak === undefined) return undefined
  const after = a.after ?? a.base
  const knots: [number, number][] = [
    [since - 40, a.base],
    [since - 22, a.base + (a.peak - a.base) * 0.12],
    [since - 6, a.base + (a.peak - a.base) * 0.55],
    [since, a.base + (a.peak - a.base) * 0.97],
    [since + 4, a.peak],
    [firstAct + 10, a.base + (a.peak - a.base) * 0.93],
    [res - 8, after + (a.peak - after) * 0.2],
    [res, after],
    [res + 20, after + (a.base - after) * 0.3],
  ]
  const at = (t: number) => {
    for (let i = 1; i < knots.length; i++) {
      const [t1, v1] = knots[i]
      const [t0, v0] = knots[i - 1]
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / Math.max(1, t1 - t0)
    }
    return knots[knots.length - 1][1]
  }
  const points: [number, number][] = []
  const wiggle = Math.abs(a.peak - a.base) * 0.03
  for (let t = since - 40; t <= res + 20; t += 2) points.push([t, Math.max(0, at(t) + wiggle * Math.sin(t * 1.7))])
  return { gas: a.gas, points }
}

function archiveDay(key: DayKey): DayData {
  const def = DAYS.find((d) => d.key === key)!
  const arc = ARCHIVE[key]
  const empty: DayNums = { legal: 0, missing: 0, warn: 0, acks: 0, calls: 0, works: 0 }
  if (!arc) return { key, label: def.label, off: def.off, live: false, asOf: "휴무", nums: empty, incidents: [], recs: [], prepLine: "" }

  const incs: DayIncident[] = arc.incidents.map((a) => {
    const z = zoneDef(a.zoneId)!
    const since = toMin(a.since)
    const res = toMin(a.resolved[0])
    const steps = [...a.steps.map(([t, text, who]) => ({ t: toMin(t), text, who: who || undefined })), { t: res, text: a.resolved[1] }]
    return {
      id: `${key}:${a.zoneId}`,
      day: key,
      zoneId: a.zoneId,
      name: z.name,
      block: z.block,
      worst: a.worst,
      since,
      state: a.worst === "legal" ? "조치 후 재개" : "정상 복귀",
      work: `${a.work} · ${a.permitNo}`,
      permitNo: a.permitNo,
      dept: a.dept,
      steps,
      resolved: `${a.resolved[0]} ${a.resolved[1]}`,
      trace: synthTrace(a, since, steps[1]?.t ?? since + 5, res),
      result: { outcome: "정상 복귀 · 작업 재개", memo: a.resolved[1], at: a.resolved[0], by: ME },
    }
  })

  const recs: Rec[] = []
  arc.incidents.forEach((a, i) => {
    const inc = incs[i]
    const sub = `${a.dept} · ${a.permitNo} · ${a.work}`
    const zoneHay = `${inc.name} ${blockName(inc.block)} ${sub}`
    a.steps.forEach(([t, text, who], j) => {
      const first = j === 0
      recs.push({
        key: `${key}-${i}-${j}`,
        day: key,
        t: toMin(t),
        kind: first ? "사건" : "조치",
        tag: first ? TONE_TAG[a.worst]! : "조치",
        tone: first ? a.worst : "act",
        zoneId: a.zoneId,
        title: inc.name,
        text,
        sub: first ? sub : who,
        who: who || undefined,
        hay: norm(`${zoneHay} ${text} ${who ?? ""} ${first ? TONE_TAG[a.worst] : "조치"}`),
      })
    })
    recs.push({
      key: `${key}-${i}-r`,
      day: key,
      t: toMin(a.resolved[0]),
      kind: "사건",
      tag: "정상 복귀",
      tone: "ok",
      zoneId: a.zoneId,
      title: inc.name,
      text: a.resolved[1],
      sub,
      hay: norm(`${zoneHay} ${a.resolved[1]} 정상 복귀`),
    })
  })
  arc.ops.forEach(([t, text], i) =>
    recs.push({ key: `${key}-o${i}`, day: key, t: toMin(t), kind: "측정·작업", tag: text.includes("측정") ? "측정" : "작업", tone: "plain", title: "현장 전체", text, hay: norm(`현장 전체 ${text}`) }),
  )
  arc.prep.forEach(([t, target, text, who], i) => recs.push(prepRec(key, `${key}-p${i}`, toMin(t), target, text, who)))

  const allSteps = incs.flatMap((inc) => inc.steps)
  return {
    key,
    label: def.label,
    live: false,
    asOf: "17:30 마감본",
    nums: {
      legal: incs.filter((x) => x.worst === "legal").length,
      missing: incs.filter((x) => x.worst === "missing").length,
      warn: incs.filter((x) => x.worst === "warn").length,
      acks: allSteps.filter((s) => s.who === "안전관리자").length,
      calls: allSteps.filter((s) => /출동 요청|확인 요청/.test(s.text)).length,
      works: arc.works,
    },
    incidents: incs,
    recs,
    prepDay: def.prepDay,
    prepLine: arc.prepLine,
  }
}

// 지난 날은 바뀌지 않으니 한 번만 만든다
const ARCHIVED = new Map(DAYS.filter((d) => d.key !== TODAY).map((d) => [d.key, archiveDay(d.key)]))

// ---------- 오늘 (관제 시뮬레이션) ----------

const GAS_BY_LABEL: [string, Gas][] = [
  ["H₂S", "H2S"],
  ["CO₂", "CO2"],
  ["O₂", "O2"],
  ["LEL", "LEL"],
  ["CO", "CO"],
]
const gasIn = (text: string) => GAS_BY_LABEL.find(([label]) => text.includes(label))?.[1]

function evRec(e: Ev): Rec {
  const title = e.zoneName === "전체" ? "현장 전체" : e.zoneName
  const text = stripZone(e.text, e.zoneName)
  let kind: RecKind = "측정·작업"
  let tag = e.kind === "시스템" ? "시스템" : text.includes("측정") ? "측정" : "작업"
  let tone: TagTone = "plain"
  if (e.kind === "사건") {
    kind = "사건"
    const unauth = e.tone === "unauth" || text.includes("무허가")
    tag = unauth ? "무허가 의심" : (TONE_TAG[e.tone as Status] ?? "상태")
    tone = unauth ? "unauth" : e.tone === "info" ? "plain" : (e.tone as Status)
  } else if (e.kind === "조치") {
    kind = "조치"
    tag = "조치"
    tone = "act"
  }
  const sub = zoneSub(e.zoneId)
  const z = e.zoneId ? zoneDef(e.zoneId) : undefined
  return {
    key: e.key,
    day: TODAY,
    t: e.t,
    kind,
    tag,
    tone,
    zoneId: e.zoneId,
    title,
    text,
    sub,
    hay: norm(`${title} ${z ? blockName(z.block) : ""} ${text} ${sub ?? ""} ${tag}`),
  }
}

export function todayData(view: SimView, records: DecisionRecord[]): DayData {
  const def = DAYS.find((d) => d.key === TODAY)!
  const evs = todayEvents(view, records)
  const list = incidents(view, evs)
  const incs: DayIncident[] = list.map((inc) => {
    const gas = gasIn(inc.nowLine?.head ?? "") ?? gasIn(inc.events.map((e) => e.text).join(" "))
    const z = zoneDef(inc.zoneId)!
    let trace: GasTrace | undefined
    if (gas && inc.worst !== "missing") {
      const from = Math.max(8 * 60, (inc.since ?? view.t) - 40)
      const points: [number, number][] = []
      for (let t = from; t <= view.t; t += 1) points.push([t, z.gas(t)[gas]])
      trace = { gas, points }
    }
    return {
      id: `${TODAY}:${inc.zoneId}`,
      day: TODAY,
      zoneId: inc.zoneId,
      name: inc.name,
      block: inc.block,
      worst: inc.worst,
      since: inc.since,
      state: inc.state.label,
      work: inc.work,
      permitNo: z.permit?.no,
      steps: inc.events.map((e) => ({ t: e.t, text: stripZone(e.text, inc.name), who: e.kind === "조치" ? "조치" : undefined })),
      trace,
      live: true,
    }
  })
  const prep = prepSummary(records)
  const prepRecs = records
    .filter((r) => r.day === "11/7")
    .map((r) => prepRec(TODAY, `p${r.id}`, toMin(r.time), r.target, r.text, r.who))
  return {
    key: TODAY,
    label: def.label,
    live: true,
    asOf: `${fmtTime(view.t)} 기준 · 실시간 갱신`,
    nums: reportNumbers(view, evs),
    incidents: incs,
    recs: [...evs.map(evRec), ...prepRecs],
    prepDay: def.prepDay,
    prepLine: `대면 점검 Y ${prep.y} · N ${prep.n} · 보류 ${prep.hold} · 관리자 판단 ${prep.decisions}건 · AI 체크 처리 ${prep.aiDone}/${prep.aiTotal}`,
  }
}

export function allDays(view: SimView, records: DecisionRecord[]): DayData[] {
  return DAYS.map((d) => (d.key === TODAY ? todayData(view, records) : ARCHIVED.get(d.key)!))
}

// ---------- 문서 ----------

export interface DocItem {
  key: string
  kind: "허가서" | "보완 요청" | "법령" | "사내 세칙"
  title: string
  sub: string
  day?: DayKey
  hay: string
}

const staticDoc = (d: (typeof STATIC_DOCS)[number]): DocItem => ({ key: d.id, kind: d.kind, title: d.title, sub: d.sub, hay: norm(`${d.title} ${d.sub} ${d.kind}`) })

function permitDocs(day: DayData): DocItem[] {
  const out = new Map<string, DocItem>()
  day.incidents.forEach((inc) => {
    if (!inc.permitNo || out.has(inc.permitNo)) return
    const sub = `${inc.work?.split(" · ")[0] ?? ""} · ${inc.name}${inc.dept ? ` · ${inc.dept}` : ""}`
    out.set(inc.permitNo, { key: `${day.key}:${inc.permitNo}`, kind: "허가서", title: `허가서 원문 · ${inc.permitNo}`, sub, day: day.key, hay: norm(`허가서 ${inc.permitNo} ${sub}`) })
  })
  if (day.live)
    ZONES.filter((z) => z.permit && !out.has(z.permit.no)).forEach((z) =>
      out.set(z.permit!.no, { key: `${day.key}:${z.permit!.no}`, kind: "허가서", title: `허가서 원문 · ${z.permit!.no}`, sub: `${z.permit!.task} · ${z.name}`, day: day.key, hay: norm(`허가서 ${z.permit!.no} ${z.permit!.task} ${z.name}`) }),
    )
  day.recs
    .filter((r) => r.tag === "보완 요청")
    .forEach((r) => out.set(`req-${r.key}`, { key: `${day.key}:req-${r.key}`, kind: "보완 요청", title: `보완 요청 · ${r.title}`, sub: r.text, day: day.key, hay: norm(`보완 요청 ${r.title} ${r.text}`) }))
  return [...out.values()]
}

/** 고른 날짜들의 문서 (허가서 · 보완 요청) + 법령 · 사내 세칙 */
export function docsFor(days: DayData[]): DocItem[] {
  return [...days.flatMap(permitDocs), ...STATIC_DOCS.map(staticDoc)]
}

/** 사건 하나에 붙일 문서: 그 허가서 + 가스·작업 종류에 맞는 법령 · 세칙 */
export function docsForIncident(inc: DayIncident, day: DayData): DocItem[] {
  const topics = new Set<string>()
  if (inc.trace) topics.add(inc.trace.gas)
  if (inc.worst === "missing") topics.add("missing")
  if (/도장|세척/.test(inc.work ?? "")) topics.add("도장")
  if (/용접|절단|그라인딩/.test(inc.work ?? "")) topics.add("화기")
  const permit = permitDocs(day).filter((d) => d.kind !== "법령" && inc.permitNo && d.title.includes(inc.permitNo))
  return [...permit, ...STATIC_DOCS.filter((d) => d.topics.some((t) => topics.has(t))).map(staticDoc)]
}

// ---------- 구역 이력 ----------

/** 띠·구역 이력에 보이는 7일 */
export interface ZoneHistory {
  zoneId: string
  name: string
  block: string
  byDay: Record<DayKey, DayIncident | undefined>
  summary: string
}

/** 검색어가 구역 이름이면, 7일 안에 사건이 있었던 그 구역들의 날짜별 기록 */
export function zoneHistories(days: DayData[], tokens: string[]): ZoneHistory[] {
  if (!tokens.length) return []
  return ZONES.filter((z) => matches(norm(`${z.name} ${blockName(z.block)}`), tokens))
    .map((z) => {
      const byDay: Record<DayKey, DayIncident | undefined> = {}
      days.forEach((d) => {
        const inc = d.incidents.find((x) => x.zoneId === z.id)
        if (inc) byDay[d.key] = inc
      })
      const incs = Object.values(byDay).filter((x): x is DayIncident => !!x)
      const n = (s: Status) => incs.filter((x) => x.worst === s).length
      const gases = [...new Set(incs.map((x) => (x.trace ? gasLabel(x.trace.gas) : x.worst === "missing" ? "센서 신호" : STATUS[x.worst].label)))]
      const works = [...new Set(incs.map((x) => x.work?.split(" · ")[0]?.replace(/\s*\(.*\)$/, "")).filter(Boolean))]
      const parts = (["legal", "warn", "missing", "unauth"] as Status[])
        .filter((s) => n(s))
        .map((s) => `${s === "warn" ? "경고" : STATUS[s].label} ${n(s)}번`)
        .join(" · ")
      const summary =
        incs.length >= 2
          ? `같은 구역에서 이 7일 동안 ${gases.join("·")} 문제가 ${incs.length}번(${parts}) 있었습니다${works.length === 1 ? ` — 모두 ${works[0]} 작업 중` : ""}. 다음 허가 검토 때 이 구역 허가서에 '과거 유사 사례'로 붙습니다.`
          : `이 7일 동안 이 구역의 기록은 ${incs.length}번입니다.`
      return { zoneId: z.id, name: z.name, block: z.block, byDay, summary }
    })
    .filter((h) => Object.keys(h.byDay).length > 0)
    .slice(0, 2)
}
