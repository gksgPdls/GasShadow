// 밀폐구역 출입증 (현장 출입현황판에 거는 이름표). 오늘 작업허가서마다 허가 인원만큼 작업자
// 이름·회사·연락처는 모두 연출용 가상 값이다 (이름은 성 + 조선소 낱말, 연락처 가운데 가림)
// 승인 전 허가서로 들어간 출입(ZoneDef.entry)도 출입증이 있으니 목록에 넣고 unapproved로 표시한다
// 허가서 양식·작업 시간·작업반은 permits.ts(전날 접수분)에 같은 번호가 있으면 그것을, 없으면 작업 내용으로 정한 가정값
import { BLOCKS, ZONES, blockName, type BlockDef } from "./scenario"
import { PERMITS, type PermitForm } from "./permits"

export interface CrewMember {
  /** 작업자 번호 (1부터, 3D의 작업자 n과 같다) */
  n: number
  name: string
  dept: string
  company: string
  phone: string
}

/** 작업자 관리 목록 한 줄: 작업자 + 그 사람이 들어가는 허가서·구역 */
export interface CrewRow extends CrewMember {
  key: string
  zoneId: string
  zoneName: string
  block: string
  blockName: string
  stage: BlockDef["stage"]
  permitNo: string
  task: string
  form: PermitForm
  time: string
  /** 작업반 (허가서 신청 부서) */
  team: string
  /** 승인 전 허가서로 들어간 출입 */
  unapproved?: boolean
}

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신"]
const WORDS = ["안전", "조선", "현대", "한화", "선박", "바다", "항구", "철판", "강철", "해양", "갑판", "선체", "등대", "파도", "순항", "항해"]
const COMPANIES = ["(주)한빛테크", "(주)대성이엔지", "(주)동방산업", "(주)세진기공", "(주)우성마린"]
const DEPT: Record<string, string> = { assembly: "대조립3부", outfit: "선행의장부", paint: "도장1부", pe: "PE부", erect: "탑재부" }
export const STAGE_NAME: Record<BlockDef["stage"], string> = { assembly: "대조립", outfit: "선행의장", paint: "선행도장", pe: "PE장", erect: "탑재 (도크)" }

// 구역 ID로 정해지는 의사 난수 (새로고침해도 같은 사람)
function seeded(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/** 출입증이 걸리는 인원: 승인된 허가 인원, 없으면 승인 전 허가서로 들어간 인원 */
const headcount = (z: (typeof ZONES)[number]) => z.permit?.workers ?? z.entry?.workers ?? 0

// 전체 작업자를 한 번에 만든다 (구역 순서대로, 이름이 겹치지 않게)
let cache: Map<string, CrewMember[]> | null = null
function build() {
  const out = new Map<string, CrewMember[]>()
  const used = new Set<string>()
  ZONES.forEach((z) => {
    const count = headcount(z)
    if (!count) return
    const rnd = seeded(z.id)
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
    const dept = DEPT[BLOCKS.find((b) => b.id === z.block)?.stage ?? ""] ?? "생산부"
    const company = pick(COMPANIES)
    const phone = () => `010-****-${String(1000 + Math.floor(rnd() * 9000))}`
    const name = () => {
      let nm = ""
      for (let k = 0; k < 60 && (!nm || used.has(nm)); k++) nm = `${pick(SURNAMES)}${pick(WORDS)}`
      used.add(nm)
      return nm
    }
    const list: CrewMember[] = []
    for (let n = 1; n <= count; n++) list.push({ n, name: name(), dept, company, phone: phone() })
    out.set(z.id, list)
  })
  return out
}

/** 구역의 출입증 목록: 작업자 1..N. 허가도 출입도 없는 구역은 빈 목록 */
export function crewOf(zoneId: string): CrewMember[] {
  cache ??= build()
  return cache.get(zoneId) ?? []
}

// 허가서 양식: 작업 내용으로 추정 (permits.ts에 없는 허가서)
function formOf(task: string): PermitForm {
  if (/용접|절단|그라인딩|취부/.test(task)) return "화기"
  if (/도장|세척|신너|블라스팅/.test(task)) return "도장/세척"
  return "기타위험"
}

/** 오늘 허가서 기준 허가서 정보 (허가 있는 구역 + 승인 전 허가서로 들어간 구역) */
export function permitInfo(zoneId: string) {
  const z = ZONES.find((x) => x.id === zoneId)
  if (!z) return null
  if (!z.permit && z.entry) {
    const stage = BLOCKS.find((b) => b.id === z.block)?.stage ?? "assembly"
    return { no: z.entry.no, task: z.entry.task, workers: z.entry.workers, form: formOf(z.entry.task), time: "09:00-16:59", team: z.entry.team, stage, unapproved: true }
  }
  if (!z.permit) return null
  const p = PERMITS.find((x) => x.no === z.permit!.no)
  const stage = BLOCKS.find((b) => b.id === z.block)?.stage ?? "assembly"
  return {
    no: z.permit.no,
    task: z.permit.task,
    workers: z.permit.workers,
    form: p?.form ?? formOf(z.permit.task),
    time: p?.time ?? "08:00-16:59",
    team: p?.dept ?? `${STAGE_NAME[stage]} 작업반`,
    stage,
    unapproved: false,
  }
}

/** 오늘 일하는 전체 작업자 (작업허가서 순서) */
export function todayCrew(): CrewRow[] {
  return ZONES.filter((z) => z.permit || z.entry).flatMap((z) => {
    const info = permitInfo(z.id)!
    return crewOf(z.id).map((m) => ({
      ...m,
      key: `${z.id}#${m.n}`,
      zoneId: z.id,
      zoneName: z.name,
      block: z.block,
      blockName: blockName(z.block),
      stage: info.stage,
      permitNo: info.no,
      task: info.task,
      form: info.form,
      time: info.time,
      team: info.team,
      unapproved: info.unapproved,
    }))
  })
}
