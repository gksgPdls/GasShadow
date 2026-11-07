// 안전 일지의 지난 날짜 기록 (SYNTHETIC — 시연용 가정값)
// 오늘(11/9)은 관제 시뮬레이션 값을 그대로 쓰고, 그 전 근무일 5일(11/3~11/7)은 여기 적어 둔 값을 쓴다.
// 구역 이름은 data/site.json 과 같다. 일부러 넣은 반복 패턴:
//   · 3번 밸러스트탱크(우현) 4번 칸 — 도장 중 LEL 상승이 11/5(법정 초과) · 11/6(경고)에 이어 오늘도
//   · 파이프덕트 4 1번 칸 측정기 GS-027 — 통신 두절이 11/3 · 11/6에 이어 오늘도 (점검 권고와 같은 내용)
import type { Gas } from "@/data/scenario"
import type { Status } from "@/lib/sim"

/** "MM/DD" (2026년) */
export type DayKey = string

export interface DayDef {
  key: DayKey
  label: string
  /** 칸이 좁을 때 쓰는 날짜 ("9/1") */
  short: string
  /** 0 = 일요일 */
  dow: number
  /** 공장 휴무 (기록 없음) */
  off?: boolean
  /** 전날 허가 검토를 한 날 (휴무 다음 날은 그 전 근무일) */
  prepDay?: string
}

// 기록이 있는 기간: 시스템을 들인 9/1부터 오늘(11/9, 본선 발표일)까지. 요일은 2026년 달력 (11/9 월요일).
// 일요일과 추석 연휴(9/24~9/26) · 개천절(10/3)과 대체휴일(10/5) · 한글날(10/9)은 휴무 (2026년 달력 기준 가정)
export const FIRST_DAY = "09/01"
export const TODAY: DayKey = "11/09"
const YEAR = 2026
/** 달력 요일 계산용 (화면에는 연도를 쓰지 않는다) */
export const CAL_YEAR = YEAR
const HOLIDAYS = new Set(["09/24", "09/25", "09/26", "10/03", "10/05", "10/09"])
const DOW = "일월화수목금토"

function buildDays(): DayDef[] {
  const out: DayDef[] = []
  let prev: string | undefined
  for (let d = new Date(YEAR, 8, 1); d <= new Date(YEAR, 10, 9); d.setDate(d.getDate() + 1)) {
    const m = d.getMonth() + 1
    const dd = d.getDate()
    const key = `${String(m).padStart(2, "0")}/${String(dd).padStart(2, "0")}`
    const label = `${m}/${dd}(${DOW[d.getDay()]})`
    const off = d.getDay() === 0 || HOLIDAYS.has(key)
    out.push({ key, label, short: `${m}/${dd}`, dow: d.getDay(), off: off || undefined, prepDay: off ? undefined : (prev ?? "8/31(월)") })
    if (!off) prev = label
  }
  return out
}

export const DAYS: DayDef[] = buildDays()
const DAY_INDEX = new Map(DAYS.map((d, i) => [d.key, i]))
export const dayIndex = (k: DayKey) => DAY_INDEX.get(k) ?? -1
export const dayDef = (k: DayKey) => DAYS[dayIndex(k)]
export const dayLabel = (k: string) => dayDef(k)?.label ?? k

/** 지난 날 사건 한 건 (구역 하나에서 기준을 넘은 일) */
export interface ArcIncident {
  zoneId: string
  worst: Exclude<Status, "ok" | "idle">
  /** 처음 기준을 넘은 시각 HH:MM */
  since: string
  gas?: Gas
  base?: number
  peak?: number
  work: string
  permitNo: string
  dept: string
  /** [시각, 내용, 조치한 사람] — 시간 순 */
  steps: [string, string, string?][]
  /** 정상으로 돌아온 시각과 확인 값 */
  resolved: [string, string]
  /** 해제 확인 값 (그래프 끝점) */
  after?: number
}

export interface ArcDay {
  works: number
  incidents: ArcIncident[]
  /** 그날 측정·작업 기록 [시각, 내용] */
  ops: [string, string][]
  /** 전날 허가 검토 기록 [시각, 대상, 내용, 사람] */
  prep: [string, string, string, string][]
  /** 보고서 '전날 확정' 줄 */
  prepLine: string
}

const HANDMADE: Record<string, ArcDay> = {
  "11/03": {
    works: 7,
    incidents: [
      {
        zoneId: "Z-P12-PD4", worst: "missing", since: "10:20", work: "배관 서포트 용접", permitNo: "PTW-2541-0378", dept: "배관 7반",
        steps: [
          ["10:20", "센서 GS-027 통신 두절 — 측정요원 출동 요청", "안전관리자"],
          ["10:27", "측정요원 김OO 도착 · 휴대용 측정기로 확인 (O₂ 20.8% · LEL 0)", "측정요원 김OO"],
        ],
        resolved: ["11:05", "통신 복구 · 측정값 정상"],
      },
      {
        zoneId: "Z-F01-FPT", worst: "warn", since: "14:10", gas: "LEL", base: 2.1, peak: 6.2, after: 3.1, work: "내부 도장 터치업", permitNo: "PTW-2541-0381", dept: "도장 1반",
        steps: [
          ["14:10", "LEL 6.2 %LEL — 경계 수준 (기준 10)", ""],
          ["14:13", "관리감독자 확인 요청 · 대기 송풍기(2번) 가동", "안전관리자"],
        ],
        resolved: ["14:40", "LEL 3.1 %LEL 확인"],
      },
    ],
    ops: [
      ["07:55", "작업 전 측정 7구역 입력 · 측정요원 2명"],
      ["08:10", "허가 작업 7건 시작"],
      ["17:05", "작업 종료 · 측정기 회수 7대"],
    ],
    prep: [
      ["14:48", "측정 대상 선별", "확정 → 당일 관제 목록 생성", "김성욱 직장"],
      ["14:40", "PTW-2541-0381", "승인 · 안전대면허가", "김성욱 직장"],
    ],
    prepLine: "대면 점검 Y 4 · N 3 · 보류 0 · 허가 승인 7건",
  },
  "11/04": {
    works: 4,
    incidents: [],
    ops: [
      ["08:00", "작업 전 측정 4구역 입력 · 측정요원 1명"],
      ["08:15", "허가 작업 4건 시작 (토요 특근)"],
      ["12:40", "작업 종료 · 측정기 회수 4대"],
    ],
    prep: [["14:52", "측정 대상 선별", "확정 → 당일 관제 목록 생성", "김성욱 직장"]],
    prepLine: "대면 점검 Y 2 · N 2 · 보류 0 · 허가 승인 4건",
  },
  "11/05": {
    works: 8,
    incidents: [
      {
        zoneId: "Z-D23-WBT3S", worst: "legal", since: "10:48", gas: "LEL", base: 2.4, peak: 12.4, after: 3.4, work: "이음부 도장 (1차)", permitNo: "PTW-2541-0388", dept: "도장 2반",
        steps: [
          ["10:48", "LEL 12.4 %LEL — 법정 기준 10 초과, 경보", ""],
          ["10:49", "작업 중지 · 대피 지시", "안전관리자"],
          ["10:55", "측정요원 박OO 재측정 (LEL 11.8)", "측정요원 박OO"],
          ["11:30", "송풍기 2대로 환기 강화", "도장 2반 관리감독자"],
        ],
        resolved: ["12:10", "LEL 3.4 %LEL 확인 후 작업 재개"],
      },
      {
        zoneId: "Z-C41-CD3", worst: "warn", since: "15:20", gas: "CO", base: 6, peak: 22, after: 9, work: "격벽 절단", permitNo: "PTW-2541-0392", dept: "대조립 1반",
        steps: [
          ["15:20", "CO 22 ppm — 경계 수준 (기준 30)", ""],
          ["15:24", "관리감독자 확인 요청 · 절단기 배기 확인", "안전관리자"],
        ],
        resolved: ["15:40", "CO 9 ppm 확인"],
      },
    ],
    ops: [
      ["07:50", "작업 전 측정 8구역 입력 · 측정요원 2명"],
      ["08:05", "허가 작업 8건 시작"],
      ["17:10", "작업 종료 · 측정기 회수 8대"],
    ],
    prep: [
      ["14:55", "측정 대상 선별", "확정 → 당일 관제 목록 생성", "김성욱 직장"],
      ["14:31", "PTW-2541-0388", "승인 · 안전대면허가", "김성욱 직장"],
      ["13:50", "PTW-2541-0392", "보완 요청 → 재접수 후 승인 · 전산허가", "김성욱 직장"],
    ],
    prepLine: "대면 점검 Y 5 · N 3 · 보류 0 · 보완 요청 1건 · 허가 승인 8건",
  },
  "11/06": {
    works: 7,
    incidents: [
      {
        zoneId: "Z-D23-WBT3S", worst: "warn", since: "09:40", gas: "LEL", base: 2.2, peak: 7.1, after: 3.0, work: "이음부 도장 (2차)", permitNo: "PTW-2541-0397", dept: "도장 2반",
        steps: [
          ["09:40", "LEL 7.1 %LEL — 경계 수준 (기준 10)", ""],
          ["09:45", "관리감독자 확인 요청 · 대기 송풍기(2번) 가동", "안전관리자"],
        ],
        resolved: ["10:15", "LEL 3.0 %LEL 확인"],
      },
      {
        zoneId: "Z-P12-PD4", worst: "missing", since: "13:05", work: "배관 서포트 용접", permitNo: "PTW-2541-0398", dept: "배관 7반",
        steps: [
          ["13:05", "센서 GS-027 통신 두절 — 측정요원 출동 요청", "안전관리자"],
          ["13:12", "측정요원 박OO 도착 · 휴대용 측정기로 확인 (O₂ 20.9% · LEL 0)", "측정요원 박OO"],
        ],
        resolved: ["13:50", "통신 복구 · 배터리 교체"],
      },
    ],
    ops: [
      ["07:55", "작업 전 측정 7구역 입력 · 측정요원 2명"],
      ["08:10", "허가 작업 7건 시작"],
      ["17:00", "작업 종료 · 측정기 회수 7대"],
    ],
    prep: [
      ["14:50", "측정 대상 선별", "확정 → 당일 관제 목록 생성", "김성욱 직장"],
      ["14:22", "PTW-2541-0397", "승인 · 안전대면허가 (전날 LEL 초과 구역 · 환기 2대 조건)", "김성욱 직장"],
    ],
    prepLine: "대면 점검 Y 5 · N 2 · 보류 0 · 허가 승인 7건",
  },
  "11/07": {
    works: 6,
    incidents: [
      {
        zoneId: "Z-E11-FOT1", worst: "warn", since: "14:35", gas: "LEL", base: 1.8, peak: 5.8, after: 2.6, work: "용제 세척", permitNo: "PTW-2541-0399", dept: "도장 1반",
        steps: [
          ["14:35", "LEL 5.8 %LEL — 경계 수준 (기준 10)", ""],
          ["14:38", "관리감독자 확인 요청 · 세척 용제 사용량 줄임", "안전관리자"],
        ],
        resolved: ["15:05", "LEL 2.6 %LEL 확인"],
      },
    ],
    ops: [
      ["07:55", "작업 전 측정 6구역 입력 · 측정요원 2명"],
      ["08:10", "허가 작업 6건 시작"],
      ["16:55", "작업 종료 · 측정기 회수 6대"],
    ],
    prep: [
      ["14:52", "측정 대상 선별", "확정 → 당일 관제 목록 생성", "김성욱 직장"],
      ["14:10", "PTW-2541-0399", "승인 · 안전대면허가", "김성욱 직장"],
    ],
    prepLine: "대면 점검 Y 4 · N 2 · 보류 0 · 허가 승인 6건",
  },
}

// ---------- 9/1 ~ 11/2: 규칙으로 만든 합성 기록 ----------
// 날짜마다 같은 값이 나오도록 날짜 번호로 씨앗을 정한다. 위 손으로 적은 날(11/3~11/7)은 그 값을 쓴다.

const GAS_TEXT: Record<"LEL" | "CO" | "O2", { label: string; unit: string; limit: string; warn: [number, number]; legal: [number, number]; base: number; after: number; digits: number }> = {
  LEL: { label: "LEL", unit: "%LEL", limit: "10", warn: [5.2, 8.6], legal: [10.6, 14.2], base: 2.2, after: 3.0, digits: 1 },
  CO: { label: "CO", unit: "ppm", limit: "30", warn: [20, 28], legal: [31, 41], base: 6, after: 9, digits: 0 },
  O2: { label: "O₂", unit: "%", limit: "18", warn: [19.0, 19.4], legal: [17.3, 17.9], base: 20.8, after: 20.6, digits: 1 },
}
const GAS_WORKS: { zoneId: string; work: string; dept: string; gas: "LEL" | "CO" | "O2" }[] = [
  { zoneId: "Z-D23-WBT3S", work: "이음부 도장", dept: "도장 2반", gas: "LEL" },
  { zoneId: "Z-F01-FPT", work: "내부 도장 터치업", dept: "도장 1반", gas: "LEL" },
  { zoneId: "Z-E11-FOT1", work: "용제 세척", dept: "도장 1반", gas: "LEL" },
  { zoneId: "Z-S31-TST3P", work: "용제 세척(신너)", dept: "선행의장 4반", gas: "LEL" },
  { zoneId: "Z-C41-CD3", work: "격벽 절단", dept: "대조립 1반", gas: "CO" },
  { zoneId: "Z-G05-WBT1S", work: "블록 이음 용접", dept: "대조립 2반", gas: "CO" },
  { zoneId: "Z-E21-ERDB", work: "탑재 이음 용접", dept: "탑재 1반", gas: "CO" },
  { zoneId: "Z-D21-WBT2P", work: "아르곤 용접", dept: "선행의장 2반", gas: "O2" },
]
const SENSOR_WORKS = [
  { zoneId: "Z-P12-PD4", sensor: "GS-027", work: "배관 서포트 용접", dept: "배관 7반" },
  { zoneId: "Z-S35-TST5S", sensor: "GS-044", work: "블라스팅", dept: "도장 3반" },
]
const MEASURER = ["김OO", "박OO"]

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`

function seeded(seed: number) {
  let x = (seed * 2654435761) % 4294967296
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return x / 4294967296
  }
}

function generated(def: DayDef, n: number): ArcDay {
  const r = seeded(n + 7)
  const sat = def.dow === 6
  const works = sat ? 3 + Math.floor(r() * 3) : 6 + Math.floor(r() * 4)
  const endMin = sat ? 12 * 60 + 30 : 17 * 60
  let permit = 160 + n * 4
  const pick = r()
  const count = pick < 0.38 ? 0 : pick < 0.8 ? 1 : 2
  const used = new Set<string>()
  const incidents: ArcIncident[] = []
  for (let i = 0; i < count; i++) {
    const kind = r()
    const since = 8 * 60 + 40 + Math.floor(r() * (endMin - 9 * 60 - 60))
    const who = MEASURER[Math.floor(r() * 2)]
    const permitNo = `PTW-2541-${String(permit++).padStart(4, "0")}`
    if (kind > 0.8) {
      const w = SENSOR_WORKS[Math.floor(r() * SENSOR_WORKS.length)]
      if (used.has(w.zoneId)) continue
      used.add(w.zoneId)
      incidents.push({
        zoneId: w.zoneId, worst: "missing", since: hm(since), work: w.work, permitNo, dept: w.dept,
        steps: [
          [hm(since), `센서 ${w.sensor} 통신 두절 — 측정요원 출동 요청`, "안전관리자"],
          [hm(since + 7), `측정요원 ${who} 도착 · 휴대용 측정기로 확인 (O₂ 20.9% · LEL 0)`, `측정요원 ${who}`],
        ],
        resolved: [hm(since + 40), "통신 복구 · 측정값 정상"],
      })
      continue
    }
    const w = GAS_WORKS[Math.floor(r() * GAS_WORKS.length)]
    if (used.has(w.zoneId)) continue
    used.add(w.zoneId)
    const g = GAS_TEXT[w.gas]
    const legal = kind < 0.12
    const [lo, hi] = legal ? g.legal : g.warn
    const peak = Number((lo + r() * (hi - lo)).toFixed(g.digits))
    const v = (x: number) => x.toFixed(g.digits)
    const head = `${g.label} ${v(peak)} ${g.unit}`
    incidents.push(
      legal
        ? {
            zoneId: w.zoneId, worst: "legal", since: hm(since), gas: w.gas, base: g.base, peak, after: g.after, work: w.work, permitNo, dept: w.dept,
            steps: [
              [hm(since), `${head} — 법정 기준 ${g.limit} ${w.gas === "O2" ? "미달" : "초과"}, 경보`, ""],
              [hm(since + 1), "작업 중지 · 대피 지시", "안전관리자"],
              [hm(since + 7), `측정요원 ${who} 재측정 (${g.label} ${v(peak * (w.gas === "O2" ? 1.005 : 0.95))})`, `측정요원 ${who}`],
              [hm(since + 35), "송풍기 2대로 환기 강화", `${w.dept} 관리감독자`],
            ],
            resolved: [hm(since + 75), `${g.label} ${v(g.after)} ${g.unit} 확인 후 작업 재개`],
          }
        : {
            zoneId: w.zoneId, worst: "warn", since: hm(since), gas: w.gas, base: g.base, peak, after: g.after, work: w.work, permitNo, dept: w.dept,
            steps: [
              [hm(since), `${head} — 경계 수준 (기준 ${g.limit})`, ""],
              [hm(since + 3), "관리감독자 확인 요청 · 대기 송풍기(2번) 가동", "안전관리자"],
            ],
            resolved: [hm(since + 30), `${g.label} ${v(g.after)} ${g.unit} 확인`],
          },
    )
  }
  const y = Math.max(1, Math.round(works * 0.6))
  return {
    works,
    incidents: incidents.sort((a, b) => a.since.localeCompare(b.since)),
    ops: [
      ["07:55", `작업 전 측정 ${works}구역 입력 · 측정요원 ${sat ? 1 : 2}명`],
      ["08:10", `허가 작업 ${works}건 시작${sat ? " (토요 특근)" : ""}`],
      [hm(endMin + 5), `작업 종료 · 측정기 회수 ${works}대`],
    ],
    prep: [
      ["14:50", "측정 대상 선별", "확정 → 당일 관제 목록 생성", "김성욱 직장"],
      ...incidents.slice(0, 1).map((i): [string, string, string, string] => ["14:20", i.permitNo, i.worst === "missing" ? "승인 · 전산허가" : "승인 · 안전대면허가", "김성욱 직장"]),
    ],
    prepLine: `대면 점검 Y ${y} · N ${works - y} · 보류 0 · 허가 승인 ${works}건`,
  }
}

/** 오늘을 뺀 근무일 기록 */
export const ARCHIVE: Record<DayKey, ArcDay> = Object.fromEntries(
  DAYS.map((d, n) => [d, n] as const)
    .filter(([d]) => !d.off && d.key !== TODAY)
    .map(([d, n]) => [d.key, HANDMADE[d.key] ?? generated(d, n)]),
)

/** 관련 문서 (법령·사내 세칙). 허가서·보완 요청은 기록에서 만든다 */
export interface StaticDoc {
  id: string
  kind: "법령" | "사내 세칙"
  title: string
  sub: string
  /** 이 문서를 같이 보여 줄 가스·상황 */
  topics: (Gas | "missing" | "화기" | "도장")[]
}

export const STATIC_DOCS: StaticDoc[] = [
  { id: "law-618", kind: "법령", title: "산업안전보건기준에 관한 규칙 제618조 (정의)", sub: "적정공기 기준 — 산소 18% 이상 23.5% 미만 · CO 30ppm 미만 · H₂S 10ppm 미만", topics: ["O2", "CO", "H2S", "CO2"] },
  { id: "law-619-2", kind: "법령", title: "산업안전보건기준에 관한 규칙 제619조의2 (산소 및 유해가스 농도의 측정)", sub: "밀폐공간 작업 시작 전 · 작업 중 측정", topics: ["O2", "LEL", "CO", "H2S", "CO2", "missing"] },
  { id: "law-620", kind: "법령", title: "산업안전보건기준에 관한 규칙 제620조 (환기 등)", sub: "작업 전·작업 중 적정공기가 유지되도록 환기", topics: ["LEL", "CO", "H2S", "CO2", "O2", "도장"] },
  { id: "law-241", kind: "법령", title: "산업안전보건기준에 관한 규칙 제241조 (화재위험작업 시의 준수사항)", sub: "용접·용단 등 화기작업 때 인화성 물질 관리", topics: ["LEL", "화기"] },
  { id: "rule-confined", kind: "사내 세칙", title: "위험작업 안전관리 세칙 · 밀폐구역 작업", sub: "가스 측정 · 환기 · 감시인 배치 · 작업 중지 기준", topics: ["O2", "LEL", "CO", "H2S", "CO2", "missing", "도장", "화기"] },
]
