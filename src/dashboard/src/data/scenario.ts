// MN-01 합성 데이터 (SYNTHETIC). src/prototype/mn-01/data.js를 타입만 붙여 옮긴 것.
// 와이어프레임 예시 시나리오 S-2541-A를 따른다. 모든 수치·기준은 미검증 가정값이다.
// 위험 구역 3곳은 5가스 위험예측 모델의 시험 에피소드 값이다 (episodes.json, scripts/export_episodes.py).
// 블록·구획 목록과 값 지정은 site.json 하나에 있다 (화면·서버 재생기가 같이 읽음). 에피소드 보간은 scenario.py 와 같은 방식
import EPISODE_DATA from "@/data/episodes.json"
import SITE_DATA from "@/data/site.json"

export type Gas = "O2" | "LEL" | "CO" | "H2S" | "CO2"
export type GasValues = Record<Gas, number>

export interface Limit {
  unit: string
  legal?: number
  warn?: number
  legalLow?: number
  legalHigh?: number
  warnLow?: number
}

export interface Permit {
  no: string
  task: string
  workers: number
}

/** 블록 모양 (블록 기준 미터. x 길이 방향 가운데 0 · y 바닥 0 · z 폭 방향 가운데 0, +z가 앞면) */
export interface BlockShape {
  kind: string
  L: number
  /** 단면 (z, y) 다각형 */
  section: number[][]
  /** 가로 칸막이(플로어·웹) x 위치 · 그중 수밀 */
  xs: number[]
  wt_x: number[]
  /** 세로 칸막이(거더) z 위치 · 그중 수밀 */
  zs: number[]
  wt_z: number[]
  /** 수평 칸막이(스트링거·데크) y 위치 · 그중 수밀 */
  ys: number[]
  wt_y: number[]
  /** 출입구가 있는 면 */
  access: "bottom" | "top" | "front"
  warp: "bow" | "stern" | null
  /** 블록 선미쪽 끝 프레임 번호 */
  frame: number
  /** 블록 안 모든 칸 (zone: 측정기가 있으면 감시 구역 ID, 없으면 null — 3D에 윤곽만) */
  comps: { name: string; sub: string; box: number[]; zone: string | null }[]
}

export interface BlockDef {
  id: string
  name: string
  loc: string
  stage: "assembly" | "outfit" | "paint" | "pe" | "erect"
  shape: BlockShape
}

export interface ZoneDef {
  id: string
  block: string
  name: string
  /** 위치 설명 (선수쪽 · 바깥쪽 · Fr.98–110) */
  sub?: string
  /** 블록 안 구획 상자 [x0, x1, z0, z1, y0, y1] (m) */
  box?: number[]
  /** work = 오늘 작업 칸 · adjacent = 작업 칸에 맞닿은 칸 (인접 공간 측정) */
  role?: "work" | "adjacent"
  /** adjacent일 때 맞닿은 작업 칸 구역 ID */
  adjacentTo?: string[]
  sensor: string
  permit: Permit | null
  gas: (t: number) => GasValues
  events?: { t: number; text: string }[]
  /** 송풍기 대수와 1번이 멈춘 시각 (제어 시스템 기록). 없으면 sim.ts blowerCount 가 정한다 */
  vent?: { blowers: number; stopAt: number }
  /** 허가 없이 들어간 출입 (승인 안 된 허가서). permit 은 비어 있어 무허가 판정은 그대로, 3D 출입현황판·작업자 관리에만 쓴다 */
  entry?: Entry
  sensorLostAt?: number
  /** 모델 시험 에피소드 ID (값을 이 에피소드에서 가져온다) */
  episode?: string
  /** 측정기를 붙인 시각 (작업 전 측정). 이 전에는 값이 없고 '작업 없음'으로 본다 */
  measureFrom?: number
  /** 작업 시작 시각 */
  workStart?: number
}

/** 미승인 출입: 전날 접수됐지만 승인되지 않은 허가서로 들어간 작업 */
export interface Entry {
  no: string
  task: string
  workers: number
  team: string
  /** 들어간 시각 (분) */
  from: number
}

export interface LogEntry {
  t: number
  zone: string
  text: string
}

// 판정 기준 (와이어프레임 ZN-01 표기. 법정 기준은 원문 재확인 전, LEL 10%는 사내 가정)
export const LIMITS: Record<Gas, Limit> = {
  O2: { unit: "%", legalLow: 18.0, legalHigh: 23.5, warnLow: 19.5 },
  LEL: { unit: "%LEL", legal: 10, warn: 5 },
  CO: { unit: "ppm", legal: 30, warn: 20 },
  H2S: { unit: "ppm", legal: 10, warn: 5 },
  CO2: { unit: "%", legal: 1.5, warn: 1.0 },
}

export const SITE = { ship: "LPG선 H-2541", shop: "선행의장 1공장" }

// 시뮬레이션 시각은 "자정 이후 분"으로 다룬다.
export const SIM_START = 9 * 60 // 09:00

const base: GasValues = { O2: 20.9, LEL: 0.3, CO: 2, H2S: 0.1, CO2: 0.06 }

// 기울기 함수 도우미: t0 이후 분당 rate로 변화 (무허가 작업 의심 시연 곡선용)
const ramp = (t: number, t0: number, rate: number) => Math.max(0, t - t0) * rate

// 모델 시험 에피소드 → 시각(분)별 값. 15초 간격 사이는 직선 보간, 끝난 뒤에는 마지막 값
interface EpisodeData {
  measure_from: number
  work_start: number
  t: number[]
  O2: number[]
  LEL: number[]
  CO: number[]
  H2S: number[]
  CO2: number[]
}
const EPISODES = EPISODE_DATA.episodes as Record<string, EpisodeData>
const GAS_KEYS: Gas[] = ["O2", "LEL", "CO", "H2S", "CO2"]

function episodeZone(sid: string): Pick<ZoneDef, "episode" | "measureFrom" | "workStart" | "gas"> {
  const ep = EPISODES[sid]
  const at = (i: number) => Object.fromEntries(GAS_KEYS.map((g) => [g, ep[g][i]])) as GasValues
  return {
    episode: sid,
    measureFrom: ep.measure_from,
    workStart: ep.measure_from + ep.work_start,
    gas: (t) => {
      const x = t - ep.measure_from
      if (x <= ep.t[0]) return at(0)
      if (x >= ep.t[ep.t.length - 1]) return at(ep.t.length - 1)
      let j = 1
      while (ep.t[j] < x) j++
      const a = (x - ep.t[j - 1]) / (ep.t[j] - ep.t[j - 1])
      return Object.fromEntries(GAS_KEYS.map((g) => [g, ep[g][j - 1] + (ep[g][j] - ep[g][j - 1]) * a])) as GasValues
    },
  }
}

// 블록·구획: scripts/build_site.py 가 만든 site.json (서버 재생기 src/server/replayer/scenario.py 도 같은 파일을 읽는다).
// 블록 하나 안을 칸막이(플로어·거더·스트링거·데크)로 나눈 구획 하나하나가 감시 구역이다 (구획마다 측정기 1대).
// stage: 블록이 지금 있는 공정 (3D 보기용). 공정 이름·순서는 멘토링 자료, 블록·구획·작업 배정은 가정값
//   assembly 대조립 · outfit 선행의장 · paint 선행도장 · pe PE장 · erect 탑재(도크)
type GasSpec = number | { v: number; ramp?: [number, number][]; min?: number; max?: number }
interface SiteBlock extends BlockShape {
  id: string
  name: string
  loc: string
  stage: BlockDef["stage"]
}
interface SiteZone {
  id: string
  block: string
  name: string
  sub: string
  box: number[]
  sensor: string
  permit: Permit | null
  role: "work" | "adjacent"
  adjacentTo?: string[]
  task_type: string
  gas?: Record<string, GasSpec>
  episode?: string
  sensorLostAt?: number
  vent?: { blowers: number; stopAt: number }
  entry?: Entry
}
const SITE_BLOCKS = SITE_DATA.blocks as SiteBlock[]
const SITE_ZONES = SITE_DATA.zones as SiteZone[]

// 값 지정: 숫자 = 고정값, { v, ramp: [[시작 분, 분당 변화]], min, max } = 시작 값에서 기울기로 변함. 안 적은 가스는 평상시 값
function gasFn(spec: Record<string, GasSpec> = {}): (t: number) => GasValues {
  return (t) => {
    const out = { ...base }
    for (const [g, sp] of Object.entries(spec) as [Gas, GasSpec][]) {
      if (typeof sp === "number") out[g] = sp
      else {
        let v = sp.v + (sp.ramp ?? []).reduce((s, [t0, r]) => s + ramp(t, t0, r), 0)
        if (sp.max !== undefined) v = Math.min(sp.max, v)
        if (sp.min !== undefined) v = Math.max(sp.min, v)
        out[g] = v
      }
    }
    return out
  }
}

export const BLOCKS: BlockDef[] = SITE_BLOCKS.map(({ id, name, loc, stage, ...shape }) => ({ id, name, loc, stage, shape }))

// gas(t): 시각 t(분)의 참값. 노이즈는 sim.ts에서 더한다.
// sensorLostAt: 이 시각 이후 센서 수신 없음
export const ZONES: ZoneDef[] = SITE_ZONES.map((z) => ({
  id: z.id,
  block: z.block,
  name: z.name,
  sub: z.sub,
  box: z.box,
  role: z.role,
  adjacentTo: z.adjacentTo,
  sensor: z.sensor,
  permit: z.permit,
  ...(z.episode ? episodeZone(z.episode) : { gas: gasFn(z.gas) }),
  ...(z.sensorLostAt !== undefined ? { sensorLostAt: z.sensorLostAt } : {}),
  ...(z.vent ? { vent: z.vent } : {}),
  ...(z.entry ? { entry: z.entry } : {}),
}))

// 시뮬레이션 시작 전에 이미 있었던 사건 (로그 패널 초기값)
export const INITIAL_LOG: LogEntry[] = [
  { t: 8 * 60, zone: "전 구역", text: "작업 전 측정 완료 — 전 항목 정상" },
  { t: 8 * 60 + 20, zone: "2번 밸러스트탱크(좌현) 3번 칸", text: "아르곤 백퍼지 용접 시작 · 출입증 2" },
  { t: 8 * 60 + 40, zone: "3번 밸러스트탱크(우현) 4번 칸", text: "측정기 GS-009 부착 · 작업 전 측정 시작" },
  { t: 8 * 60 + 50, zone: "3번 밸러스트탱크(우현) 4번 칸", text: "송풍기 1 정지 (제어 시스템) · 송풍기 2 대기" },
]

// 현장에서 일어나는 일 (관제 화면 말풍선·이벤트 카드). 시연용 합성 시나리오.
// log: false 면 사건·조치 로그에는 남기지 않는다 (같은 내용이 이미 로그에 있을 때)
export type Tone = "info" | "ok" | "warn" | "legal" | "missing" | "unauth"
export interface TimelineEvent {
  t: number
  zone: string
  tone: Tone
  text: string
  log?: boolean
}

export const TIMELINE: TimelineEvent[] = [
  { t: 8 * 60 + 45, zone: "Z-D23-WBT3S", tone: "info", text: "3번 밸러스트탱크(우현) 4번 칸에 작업자 3명이 들어갔습니다. 도장 터치업을 시작합니다." },
  { t: 9 * 60 + 1, zone: "Z-F01-FPT", tone: "info", text: "선수 탱크 1번 칸에 작업자 3명이 들어갔습니다. 내부 도장 터치업을 시작합니다." },
  { t: 9 * 60 + 5, zone: "Z-C41-CD3", tone: "info", text: "코퍼댐 2번 칸에 측정기 GS-005를 붙였습니다. 작업 전 측정을 시작합니다." },
  { t: 9 * 60 + 7, zone: "Z-E11-FOT1", tone: "info", text: "1번 연료유탱크 1번 칸 세척 인원이 4명으로 늘었습니다." },
  { t: 9 * 60 + 16, zone: "Z-C41-CD3", tone: "info", text: "코퍼댐 2번 칸 절단·그라인딩을 시작합니다. 작업자 4명." },
  { t: 9 * 60 + 22, zone: "Z-D25-WBT4P", tone: "info", text: "4번 밸러스트탱크(좌현) 2번 칸 배관 청소 작업자 4명이 휴식으로 나왔습니다." },
  { t: 9 * 60 + 28, zone: "Z-D25-WBT4P", tone: "info", text: "4번 밸러스트탱크(좌현) 2번 칸 배관 청소 작업자 4명이 다시 들어갔습니다." },
  { t: 9 * 60 + 30, zone: "Z-A51-APT", tone: "info", text: "선미 탱크 1번 칸에 측정기 GS-061을 붙였습니다. 작업 전 측정을 시작합니다." },
  { t: 9 * 60 + 35, zone: "Z-S31-TST3P", tone: "ok", text: "3번 톱사이드탱크(좌현) 3번 칸 용제 세척 1차 작업이 끝났습니다. 환기는 계속 유지합니다." },
  { t: 9 * 60 + 44, zone: "Z-A51-APT", tone: "info", text: "선미 탱크 1번 칸에서 보강재 용접을 시작합니다. 작업자 3명." },
  { t: 9 * 60 + 45, zone: "Z-D21-PD2", tone: "info", text: "파이프덕트 2 1번 칸에서 배관 서포트 용접을 시작합니다." },
  { t: 13 * 60, zone: "Z-D25-WBT4P", tone: "warn", text: "4번 밸러스트탱크(좌현) 2번 칸 배관 공기압 테스트를 시작합니다. 같은 칸 청소 작업과 시간이 겹칩니다." },
]

// 현장 인력. 측정요원은 센서 결측·경보 때 휴대용 측정기로 확인하러 간다 (합성)
export const MEASURERS = [
  { id: "M-A", name: "김OO", area: "A동" },
  { id: "M-B", name: "박OO", area: "B동" },
]
// 시작할 때 이미 출동 중인 사람 (시연: 없음 — 두 측정요원 모두 대기)
export const INITIAL_DISPATCH: { person: string; zone: string; arriveAt: number } | null = null

// 화면에 보이는 블록 이름. 내부 ID("B-D21")의 "B-"는 우리가 붙인 접두어라 화면에는 쓰지 않는다
// (실제 블록명 예: B51S · S11P · D24S — 대한조선학회논문집 2008·2016. 글자 뜻은 미확인)
export const blockName = (id: string | null | undefined) =>
  !id ? "" : BLOCKS.find((b) => b.id === id)?.name ?? id.replace(/^B-/, "") + " 블록"
