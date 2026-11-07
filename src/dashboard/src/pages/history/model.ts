// 안전 일지: 오늘 일어난 일을 사건(구역)별로 묶고, 일일 보고서 숫자를 계산한다.
// 재료는 관제 화면과 같은 시뮬레이션 값 — 자연어 이벤트(view.feed) + 사건·조치 로그(view.log) + 관리자 결정 기록.
import { AI_CHECKS, SELECTIONS } from "@/data/permits"
import { ZONES, type Tone, type ZoneDef } from "@/data/scenario"
import type { DecisionRecord } from "@/lib/records"
import { STATUS, fmtTime, type FeedEvent, type SimView, type Status } from "@/lib/sim"

export type EvKind = "사건" | "조치" | "작업" | "시스템" | "전날 준비"

export interface Ev {
  key: string
  t: number
  /** 전날 기록은 "11/7 15:08"처럼 날짜를 붙여 보여준다 */
  day: "11/7" | "11/9"
  text: string
  tone: Tone
  kind: EvKind
  zoneId?: string
  zoneName: string
}

const zoneByName = new Map(ZONES.map((z) => [z.name, z]))
const zoneById = new Map(ZONES.map((z) => [z.id, z]))

const ACTION = /호출|출동|도착|작업 중지를 지시|작업 중단|책임자 확인|요청/
const STATUS_SENTENCE = /법정 기준|경계 수준|신호가 끊겼|정상 범위|통신 두절|의심|급변/

function classifyLog(text: string): { tone: Tone; kind: EvKind } {
  if (text.includes("법정 초과")) return { tone: "legal", kind: "사건" }
  if (text.includes("통신 두절")) return { tone: "missing", kind: "사건" }
  if (text.includes("무허가")) return { tone: "unauth", kind: "사건" }
  if (/의심|급변/.test(text)) return { tone: "warn", kind: "사건" }
  if (text.includes("통신 장애")) return { tone: "warn", kind: "시스템" }
  if (text.includes("통신 복구")) return { tone: "ok", kind: "시스템" }
  if (ACTION.test(text)) return { tone: "info", kind: "조치" }
  return { tone: "info", kind: "작업" }
}

function classifyFeed(e: FeedEvent): EvKind {
  if (ACTION.test(e.text)) return "조치"
  if (STATUS_SENTENCE.test(e.text) || e.tone === "legal" || e.tone === "missing") return "사건"
  return e.zoneId ? "작업" : "시스템"
}

// 로그 문장 중 기계적인 것만 읽기 쉽게 바꾼다
function readable(text: string) {
  return text.replace(/^(.*) 법정 초과 → 경보 발생 \(규칙층\)$/, "$1 — 법정 기준을 넘어 경보가 울렸습니다")
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

function zoneOfTarget(target: string): ZoneDef | undefined {
  return ZONES.find((z) => target.includes(z.name))
}

/** 오늘 기록 전체 (시간 순). 자연어 이벤트가 있으면 같은 내용의 로그 줄은 뺀다 */
export function todayEvents(view: SimView, records: DecisionRecord[]): Ev[] {
  const feed: Ev[] = view.feed.map((e) => ({
    key: `f${e.id}`,
    t: e.t,
    day: "11/9",
    text: e.text,
    tone: e.tone,
    kind: classifyFeed(e),
    zoneId: e.zoneId,
    zoneName: e.zoneName ?? "전체",
  }))
  const logs: Ev[] = view.log
    // 같은 시각에 같은 구역의 '다른 종류' 문장(예: 경보 + 작업 중지 지시)은 둘 다 남긴다
    .filter((l) => !feed.some((f) => f.zoneName === l.zone && (f.text === l.text || (Math.abs(f.t - l.t) < 1 && f.kind === classifyLog(l.text).kind))))
    .map((l, i) => ({
      key: `l${i}`,
      t: l.t,
      day: "11/9",
      text: readable(l.text),
      ...classifyLog(l.text),
      zoneId: zoneByName.get(l.zone)?.id,
      zoneName: l.zone,
    }))
  // 경보 확인은 로그·이벤트에 이미 같은 줄이 있어서 결정 기록 쪽은 뺀다
  const recs: Ev[] = records
    .filter((r) => r.day === "11/9" && r.kind !== "경보")
    .map((r) => {
      const z = zoneOfTarget(r.target)
      return {
        key: `r${r.id}`,
        t: toMin(r.time),
        day: "11/9",
        text: `${r.text}${r.who ? ` · ${r.who}` : ""}`,
        tone: "info",
        kind: "조치",
        zoneId: z?.id,
        zoneName: z?.name ?? r.target,
      }
    })
  return [...feed, ...logs, ...recs].sort((a, b) => a.t - b.t)
}

/** 전날 준비 기록 (선별·AI 체크·구역 매핑) */
export function prepEvents(records: DecisionRecord[]): Ev[] {
  return records
    .filter((r) => r.day === "11/7")
    .map((r) => ({
      key: `p${r.id}`,
      t: toMin(r.time),
      day: "11/7" as const,
      text: `${r.target} — ${r.text}${r.who ? ` · ${r.who}` : ""}`,
      tone: "info" as const,
      kind: "전날 준비" as const,
      zoneName: r.kind,
    }))
    .sort((a, b) => a.t - b.t)
}

// ---------- 사건 (구역별) ----------

export interface Incident {
  zoneId: string
  name: string
  block: string
  work: string | null
  /** 오늘 가장 나빴던 상태 */
  worst: Status
  now: Status
  state: { label: string; tone: Status }
  /** 처음 문제가 생긴 시각 (지금 상태만 나쁜 경우 null) */
  since: number | null
  /** 지금 수치 한 줄 (관제 화면 '주의 구역'과 같은 문장) */
  nowLine: { head: string; detail: string } | null
  events: Ev[]
  actors: string[]
}

const BAD: Status[] = ["legal", "unauth", "missing", "warn"]
const worse = (a: Status, b: Status) => (STATUS[a].rank <= STATUS[b].rank ? a : b)

// 사람 이름은 이벤트 문장에서 뽑는다 (복귀해서 지금은 다른 곳에 있어도 남도록)
function actorsOf(events: Ev[], view: SimView, zoneId: string) {
  const out = new Set<string>()
  events.forEach((e) => {
    if (/작업 중지를 지시|책임자 확인|작업 중단/.test(e.text)) out.add("안전관리자")
    for (const m of e.text.matchAll(/측정요원 ([가-힣]OO)/g)) out.add(`측정요원 ${m[1]}`)
    for (const m of e.text.matchAll(/([가-힣]+ \d+반) 관리감독자/g)) out.add(`${m[1]} 관리감독자`)
  })
  view.people
    .filter((p) => p.zoneId === zoneId && p.status !== "대기")
    .forEach((p) => out.add(p.role === "측정요원" ? `측정요원 ${p.name}` : p.name))
  return [...out]
}

function stateOf(now: Status, acked: boolean, view: SimView, zoneId: string): Incident["state"] {
  const people = view.people.filter((p) => p.zoneId === zoneId && p.status !== "대기")
  const arrived = people.some((p) => p.status === "현장 도착")
  if (now === "legal") return acked ? { label: "작업 중지 · 조치 중", tone: "legal" } : { label: "조치 필요", tone: "legal" }
  if (now === "missing")
    return arrived
      ? { label: "현장 측정 중", tone: "missing" }
      : people.length
        ? { label: "측정요원 출동 중", tone: "missing" }
        : { label: "확인 필요", tone: "missing" }
  // 무허가 의심: 관리감독자(또는 측정요원)를 보냈으면 출동 중 → 도착하면 현장 확인 중, 아무도 안 보냈으면 확인 필요
  if (now === "unauth")
    return arrived ? { label: "현장 확인 중", tone: "unauth" } : people.length ? { label: "출동 중", tone: "unauth" } : { label: "확인 필요", tone: "unauth" }
  if (now === "warn") return people.length ? { label: "현장 확인 중", tone: "warn" } : { label: "관찰 중", tone: "warn" }
  return { label: "정상 복귀", tone: "ok" }
}

export function incidents(view: SimView, events: Ev[]): Incident[] {
  const nowOf = new Map(view.zoneStatus.map((z) => [z.id, z.status]))
  const list: Incident[] = []
  ZONES.forEach((z) => {
    const evs = events.filter((e) => e.zoneId === z.id)
    const now = nowOf.get(z.id) ?? "idle"
    const bad = evs.filter((e) => e.kind === "사건" && BAD.includes(e.tone as Status))
    if (!bad.length && !BAD.includes(now)) return
    const worst = [...bad.map((e) => e.tone as Status), now].reduce(worse, "idle")
    const acked = evs.some((e) => /작업 중지를 지시|책임자 확인|작업 중단/.test(e.text))
    const f = view.focus.find((x) => x.zone.id === z.id)
    list.push({
      zoneId: z.id,
      name: z.name,
      block: z.block,
      work: z.permit ? `${z.permit.task} · ${z.permit.no}` : z.entry ? `승인 전 출입 · ${z.entry.task} · ${z.entry.no}` : null,
      worst,
      now,
      state: stateOf(now, acked, view, z.id),
      since: bad[0]?.t ?? null,
      nowLine: f ? { head: f.head, detail: f.detail } : null,
      events: evs,
      actors: actorsOf(evs, view, z.id),
    })
  })
  return list.sort(
    (a, b) =>
      STATUS[a.now].rank - STATUS[b.now].rank ||
      STATUS[a.worst].rank - STATUS[b.worst].rank ||
      (a.since ?? view.t) - (b.since ?? view.t),
  )
}

/** 카드 안에서는 구역 이름이 제목에 있으니 문장 앞의 이름을 뗀다 */
export function withoutZone(text: string, zoneName: string) {
  return text.startsWith(zoneName) ? text.slice(zoneName.length).replace(/^\s*(—\s*)?/, "") : text
}

// ---------- 일일 보고서 ----------

export function reportNumbers(view: SimView, events: Ev[]) {
  const missingZones = new Set(events.filter((e) => e.tone === "missing" && e.zoneId).map((e) => e.zoneId))
  view.zoneStatus.filter((z) => z.status === "missing").forEach((z) => missingZones.add(z.id))
  return {
    legal: view.log.filter((e) => e.text.includes("법정 초과 → 경보")).length,
    acks: view.log.filter((e) => e.text.includes("책임자 확인")).length,
    missing: missingZones.size,
    warn: view.zoneStatus.filter((z) => z.status === "warn").length,
    calls: view.log.filter((e) => /출동 요청|호출$/.test(e.text)).length,
    works: view.watched,
  }
}

/** 보고서의 조치 내역: 사람이 한 일만 */
export function actions(events: Ev[]) {
  return events.filter((e) => e.kind === "조치")
}

export function prepSummary(records: DecisionRecord[]) {
  const done = new Set(
    records.filter((r) => r.kind === "AI 체크").map((r) => r.target.match(/AC-\d+/)?.[0] ?? r.target),
  )
  return {
    y: SELECTIONS.filter((s) => s.final === "Y").length,
    n: SELECTIONS.filter((s) => s.final === "N").length,
    hold: SELECTIONS.filter((s) => s.final === null).length,
    decisions: SELECTIONS.filter((s) => s.decision).length,
    aiDone: done.size,
    aiTotal: AI_CHECKS.length,
  }
}

/** 점검 권고 (반복 경보·측정기 이상) */
export const ADVICE = [
  { sensor: "GS-027", zone: "파이프덕트 PD-4", why: "통신 두절 반복 (최근 14일 4회)", todo: "배터리·무선 중계 점검" },
  { sensor: "GS-017", zone: "WBT No.2 (P)", why: "영점 드리프트 의심 (맑은 공기 O₂ 20.6%)", todo: "교정 요청" },
]

export const zoneDef = (id: string) => zoneById.get(id)
export const time = (e: Ev) => (e.day === "11/7" ? `11/7 ${fmtTime(e.t)}` : fmtTime(e.t))
