import { SCENARIO_PERMITS } from "./scenario-permits"

export type PermitGrade = "전산허가" | "안전대면허가" | "안전현장허가"
// 관리자 처리 단계만 나타낸다. AI가 찾은 문제는 가운데 AI 안전 검토에서 본다
export type ReviewStatus = "검토 필요" | "보완 대기" | "승인 완료"
/** 안전관리자 결정 */
export type Decision = { status: ReviewStatus; grade: PermitGrade; at: string; note: string; revised?: boolean; previous?: string }

export interface ReviewEvidence {
  source: "허가서 원문" | "협의 기록" | "사내 기준" | "과거 사례"
  text: string
}

export interface ReviewFinding {
  id: string
  level: "필수 확인" | "확인 권장" | "참고"
  title: string
  description: string
  evidence: ReviewEvidence[]
}

export interface ReviewPermit {
  id: string
  form: string
  task: string
  department: string
  place: string
  workDate: string
  workTime: string
  workers: number
  receivedAt: string
  initialStatus: ReviewStatus
  coordination: {
    confirmed?: boolean
    completedAt: string
    participants: string[]
    summary: string
    transitions: string[]
  }
  relatedWork: string[]
  missing: string[]
  recommendedGrade: PermitGrade
  recommendationReason: string
  findings: ReviewFinding[]
}

/**
 * 화면 시연용 합성 데이터.
 * 허가등급 추천은 내부 PTW 세부 분류표를 확보하기 전까지 검증되지 않은 가정이다.
 */
export const REVIEW_PERMITS: ReviewPermit[] = [
  {
    id: "PTW-2541-0421",
    form: "도장/세척",
    task: "WBT No.3(S) 이음부 도장 터치업",
    department: "도장 3반",
    place: "B-D23 · WBT No.3(S)",
    workDate: "11/9(월)",
    workTime: "08:00–10:00",
    workers: 3,
    receivedAt: "13:12",
    initialStatus: "검토 필요",
    coordination: {
      completedAt: "12:55",
      participants: ["도장 3반", "선행의장 2반", "생산조정"],
      summary: "도장 종료 후 환기·재측정을 완료한 뒤 후행 화기작업을 시작하기로 협의",
      transitions: ["도장 종료 시각 기록", "환기 30분 이상", "화기 시작 전 LEL 재측정"],
    },
    relatedWork: ["PTW-2541-0422 · 같은 구역 화기작업 · 10:30 시작"],
    missing: ["도장 종료 후 재측정 담당자"],
    recommendedGrade: "안전현장허가",
    recommendationReason: "같은 밀폐구역에서 도장 후 화기작업으로 전환되는 작업 조합",
    findings: [
      {
        id: "RF-01",
        level: "필수 확인",
        title: "도장 → 화기 전환조건 확인 필요",
        description: "두 허가서의 시간은 분리되어 있지만 실제 화기 시작 전 환기와 재측정 기록이 필요합니다.",
        evidence: [
          { source: "협의 기록", text: "도장 종료 후 환기·재측정 완료 뒤 화기작업 시작" },
          { source: "허가서 원문", text: "후행 화기작업 PTW-2541-0422 · 10:30 시작" },
        ],
      },
      {
        id: "RF-02",
        level: "확인 권장",
        title: "재측정 책임자 미기재",
        description: "전환조건은 있으나 누가 측정하고 승인할지 신청서에서 확인되지 않습니다.",
        evidence: [{ source: "허가서 원문", text: "가스측정 ☑ · 측정 담당자 공란" }],
      },
    ],
  },
  {
    id: "PTW-2541-0417",
    form: "기타위험",
    task: "SUS 배관 아르곤 백퍼지 용접",
    department: "선행의장 2반",
    place: "B-D21 · WBT No.2(P) 하단",
    workDate: "11/9(월)",
    workTime: "08:00–16:59",
    workers: 2,
    receivedAt: "13:05",
    initialStatus: "검토 필요",
    coordination: {
      completedAt: "12:42",
      participants: ["선행의장 2반", "배관 5반"],
      summary: "아르곤 사용 구역과 인접 화기작업의 동시 진행을 피하고 작업 전 하부를 확인",
      transitions: ["아르곤 공급 종료 확인", "하부 산소농도 확인", "인접 화기작업 책임자 공유"],
    },
    relatedWork: ["PTW-2541-0418 · 인접 PD-2 취부 용접"],
    missing: [],
    recommendedGrade: "안전현장허가",
    recommendationReason: "밀폐구역 아르곤 사용과 인접 화기작업이 함께 계획됨",
    findings: [
      {
        id: "RF-03",
        level: "필수 확인",
        title: "측정값이 정상이어도 하부 잔류 가능성 확인",
        description: "아르곤은 공기보다 무거워 하부에 머물 수 있으므로 단일 측정값만으로 화기작업 가능 여부를 판단하지 않습니다.",
        evidence: [
          { source: "협의 기록", text: "작업 시작 전 WBT 하부 산소농도 확인" },
          { source: "사내 기준", text: "가스 특성과 작업 위치를 고려해 대표성이 있는 지점에서 측정" },
        ],
      },
    ],
  },
  {
    id: "PTW-2541-0441",
    form: "화기",
    task: "코퍼댐 격벽 보강재 절단·그라인딩",
    department: "대조립 1반",
    place: "B-C41 · 코퍼댐 CD-3",
    workDate: "11/9(월)",
    workTime: "08:00–16:59",
    workers: 2,
    receivedAt: "12:40",
    initialStatus: "검토 필요",
    coordination: {
      completedAt: "12:18",
      participants: ["대조립 1반", "생산조정"],
      summary: "단독 작업으로 협의했으나 허가서 위험요인 작성이 완료되지 않음",
      transitions: ["작업 전 환기 상태 확인"],
    },
    relatedWork: [],
    missing: ["유해·위험요인", "가스측정 여부"],
    recommendedGrade: "안전대면허가",
    recommendationReason: "밀폐구역 화기작업이며 필수 위험정보 보완이 필요함",
    findings: [
      {
        id: "RF-04",
        level: "필수 확인",
        title: "유해·위험요소 미기재",
        description: "밀폐구역 화기작업인데 CO·용접 흄·화재·산소 결핍 위험이 기재되지 않았습니다.",
        evidence: [
          { source: "허가서 원문", text: "유해·위험요소: 공란" },
          { source: "과거 사례", text: "동종 코퍼댐 화기 허가서에서 CO·흄·화재 항목을 반복 확인" },
        ],
      },
    ],
  },
  {
    id: "PTW-2541-0452",
    form: "기타위험",
    task: "대조립 BAY 3 블록 밀폐공간 내부 작업",
    department: "대조립 3반",
    place: "대조립 BAY 3 · 블록 9개",
    workDate: "11/9–11/12",
    workTime: "08:00–16:59",
    workers: 4,
    receivedAt: "14:20",
    initialStatus: "검토 필요",
    coordination: {
      completedAt: "14:02",
      participants: ["대조립 3반"],
      summary: "작업 일정만 등록되었고 대상 블록·구역이 특정되지 않음",
      transitions: [],
    },
    relatedWork: [],
    missing: ["블록 ID", "밀폐구역 ID", "작업별 시간", "위험요인"],
    recommendedGrade: "안전현장허가",
    recommendationReason: "현장 범위가 특정되지 않아 현재 단계에서는 등급 확정 불가",
    findings: [
      {
        id: "RF-05",
        level: "필수 확인",
        title: "작업구역을 특정할 수 없음",
        description: "‘블록 9개’만으로는 연관 작업과 위험조건을 비교할 수 없습니다.",
        evidence: [{ source: "허가서 원문", text: "작업장소: 대조립 BAY 3 블록 9개" }],
      },
    ],
  },
  {
    id: "PTW-2541-0431",
    form: "기타위험",
    task: "TST No.3(P) 용제 세척(신너)",
    department: "선행의장 4반",
    place: "B-S31 · TST No.3(P)",
    workDate: "11/9(월)",
    workTime: "08:00–16:59",
    workers: 2,
    receivedAt: "11:48",
    initialStatus: "검토 필요",
    coordination: {
      completedAt: "11:20",
      participants: ["선행의장 4반", "도장 1반"],
      summary: "용제 세척 중 인접구역 작업을 중지하고 환기를 유지",
      transitions: ["인접구역 작업중지 확인", "환기팬 가동 확인"],
    },
    relatedWork: ["인접 TST No.3(S) 배관 검사 · 11:00 시작"],
    missing: [],
    recommendedGrade: "안전대면허가",
    recommendationReason: "용제 사용 밀폐작업으로 양식과 환기조건 대면 확인 권장",
    findings: [
      {
        id: "RF-06",
        level: "확인 권장",
        title: "작업내용과 허가서 양식 불일치 가능성",
        description: "‘용제 세척’은 도장/세척 양식으로 분류되는지 확인이 필요합니다.",
        evidence: [
          { source: "허가서 원문", text: "양식: 기타위험 · 작업내용: 용제 세척(신너)" },
          { source: "과거 사례", text: "유사 용제 세척 허가서에서는 도장/세척 양식을 주로 사용" },
        ],
      },
    ],
  },
  {
    id: "PTW-2541-0405",
    form: "전기",
    task: "상부 데크 임시 케이블 포설",
    department: "전장 2반",
    place: "B-E11 · 상부 데크",
    workDate: "11/9(월)",
    workTime: "08:00–12:00",
    workers: 2,
    receivedAt: "10:12",
    initialStatus: "검토 필요",
    coordination: {
      completedAt: "09:55",
      participants: ["전장 2반", "생산조정"],
      summary: "인접 운반 동선과 시간을 분리하고 작업구역을 표시",
      transitions: ["통행로 케이블 보호대 설치"],
    },
    relatedWork: [],
    missing: [],
    recommendedGrade: "전산허가",
    recommendationReason: "밀폐·화기 작업이 아니며 협의조건과 필수항목이 확인됨",
    findings: [],
  },
  // [시연 사건 2] 전날 마감 직전 접수된 화기 허가서. 아직 승인되지 않았는데 당일 09:23에 이 칸(파이프덕트 3 2번 칸)에 들어가 작업을 시작한다
  // (실시간 관제 '무허가 의심'과 이어짐). 옆 탱크(0421 도장 08:00–10:00)와 09:00–10:00이 겹친다
  {
    id: "PTW-2541-0491",
    form: "화기",
    task: "배관 관통부 취부 용접·그라인딩",
    department: "의장 6반",
    place: "B-D23 · 파이프덕트 PD-3 (WBT No.3(S) 옆)",
    workDate: "11/9(월)",
    workTime: "09:00–16:59",
    workers: 2,
    receivedAt: "14:58",
    initialStatus: "검토 필요",
    coordination: {
      confirmed: false,
      completedAt: "14:58",
      participants: ["의장 6반"],
      summary: "마감 직전 접수 · 옆 탱크 도장(도장 3반)과 협의 기록 없음",
      transitions: [],
    },
    relatedWork: ["PTW-2541-0421 · 옆 탱크 도장 터치업 · 08:00–10:00"],
    missing: ["옆 탱크 도장과 시간 분리 또는 동시작업 조건", "가스측정 체크"],
    recommendedGrade: "안전현장허가",
    recommendationReason: "옆 탱크 도장과 겹치는 화기작업",
    findings: [
      {
        id: "RF-0491-1",
        level: "필수 확인",
        title: "옆 탱크 도장과 09:00–10:00 겹침",
        description: "격벽 너머 탱크(0421)가 도장 중인 시간에 용접·그라인딩을 시작합니다. 용접 열로 도장 증기에 불이 붙을 수 있습니다.",
        evidence: [
          { source: "허가서 원문", text: "작업시간 09:00–16:59 · CO₂ 용접기 · 그라인더" },
          { source: "협의 기록", text: "옆 탱크 도장 3반과 협의 기록 없음" },
        ],
      },
      {
        id: "RF-0491-2",
        level: "필수 확인",
        title: "밀폐구역 출입인데 가스측정 미체크",
        description: "밀폐구역출입·환기는 체크했지만 가스측정 칸이 비어 있습니다.",
        evidence: [{ source: "허가서 원문", text: "밀폐구역출입 ☑ · 환기 ☑ · 가스측정 ☐" }],
      },
    ],
  },
  ...SCENARIO_PERMITS.map((p) => p.review),
]

export const GRADE_INFO: Record<PermitGrade, { short: string; detail: string }> = {
  전산허가: { short: "현업 자율 안전관리", detail: "관련 부서 전산 승인 후 현업 중심으로 작업 전 점검" },
  안전대면허가: { short: "안전요원 대면·접수", detail: "전산 검토 후 안전요원이 신청자와 핵심 조건을 대면 확인" },
  안전현장허가: { short: "대면·접수 + 현장 확인", detail: "안전요원이 실제 작업구역과 조건을 확인한 뒤 허가" },
}

// ---------- 보완 후 재접수 (2차 접수본) ----------
// 관리자가 보완을 요청하면, 아래 내용이 있는 허가서는 잠시 뒤 작업부서가 고쳐 다시 낸다 (시연 흐름).
// checks: 요청 항목(누락 항목)마다 원문에서 무엇이 바뀌었는지와 반영 여부 (AI가 1·2차 원문을 짝지은 결과)
export interface DocFields {
  supervisor?: string
  gasMeasurement?: string
  /** 2차 접수에서 작업부서가 고쳐 적은 추가전달사항 */
  note?: string
  hazards?: string[]
  measures?: string[]
}
/** 추가정보(밀폐구역출입) 체크 칸 */
export type ConfinedChecks = { entryBoard: boolean; watchman: boolean; ventilation: boolean; lighting: boolean }
export interface Revision {
  checks: { item: string; ok: boolean; before: string; after: string }[]
  permit?: Partial<Pick<ReviewPermit, "form" | "place" | "workTime" | "recommendationReason">>
  doc?: DocFields
  /** 2차 접수에서 바뀐 밀폐구역출입 체크 */
  checks2?: Partial<ConfinedChecks>
  /** 2차 접수본에서 해결되어 AI 검토에서 빠지는 지적 */
  resolvedFindings: string[]
}

export const REVISIONS: Record<string, Revision> = {
  "PTW-2541-0421": {
    checks: [
      { item: "도장 종료 후 재측정 담당자", ok: true, before: "미기재", after: "정민재 반장 (도장 3반)" },
      { item: "도장 → 화기 전환조건", ok: true, before: "전환 조건 없음", after: "도장 종료 30분 환기 → LEL 재측정 정상 확인 후 화기 시작" },
    ],
    permit: { recommendationReason: "도장 후 화기 전환조건과 재측정 담당자가 2차 접수에서 명시됨" },
    doc: {
      gasMeasurement: "측정 필요 ☑ · 도장 종료 후 재측정 · 담당 정민재 반장",
      measures: ["작업 중 송풍기 상시 가동", "인접 화기작업 중지", "도장 종료 후 30분 이상 환기", "화기 전환 전 LEL 재측정"],
      note: "후행 화기작업 PTW-2541-0422는 도장 종료 30분 환기 · LEL 재측정 정상 확인 후 시작 (재측정 담당 정민재 반장)",
    },
    resolvedFindings: ["RF-01", "RF-02"],
  },
  "PTW-2541-0417": {
    checks: [
      { item: "하부 잔류 가스 확인 방법", ok: true, before: "작업 전 산소농도 확인만", after: "작업 전·중 WBT 하부 산소농도 30분 간격 측정" },
      { item: "출입감시자 배치", ok: true, before: "미체크", after: "출입감시자 1명 배치" },
    ],
    permit: { recommendationReason: "아르곤 하부 잔류 측정 방법과 출입감시자 배치가 보완됨" },
    doc: {
      gasMeasurement: "측정 필요 ☑ · 작업 전·중 WBT 하부 산소농도 30분 간격",
      measures: ["백퍼지 호스 결속 상태 확인", "하부 환기 유지", "인접 화기작업 책임자에게 공유", "아르곤 차단 후 하부 산소농도 재측정"],
      note: "아르곤 공급 종료 후 하부 산소농도 재측정 · 출입감시자 상주",
    },
    checks2: { watchman: true },
    resolvedFindings: ["RF-03"],
  },
  "PTW-2541-0431": {
    checks: [
      { item: "허가서 양식", ok: true, before: "기타위험", after: "도장/세척" },
      { item: "인접 TST No.3(S) 배관 검사와 시간 분리", ok: false, before: "미기재", after: "인접 배관 검사(11:00) 시간 분리가 여전히 없음" },
    ],
    permit: { form: "도장/세척", recommendationReason: "양식은 바로잡혔으나 인접 배관 검사와 시간 분리가 없어 대면 확인 권장" },
    doc: { note: "신너 세척 작업 — 도장/세척 양식으로 다시 신청" },
    resolvedFindings: ["RF-06"],
  },
  "PTW-2541-0405": {
    checks: [
      { item: "케이블 보호대 설치 위치", ok: true, before: "통행로 표시만", after: "통행로 3곳 보호대 설치 위치 기재" },
    ],
    permit: { recommendationReason: "밀폐·화기 작업이 아니며 보호대 설치 위치가 보완됨" },
    doc: {
      measures: ["케이블 보호대 설치 (통행로 3곳)", "통행로 경계 표시", "운반작업 시간 분리"],
      note: "보호대 설치 위치: 상부 데크 통행로 3곳 (선수·중앙·선미)",
    },
    resolvedFindings: [],
  },
  "PTW-2541-0441": {
    checks: [
      { item: "유해·위험요인", ok: true, before: "미기재", after: "CO·용접 흄 · 화재 · 산소결핍" },
      { item: "가스측정 여부", ok: true, before: "미선택", after: "측정 필요 · 작업 전·중 CO·O₂ 확인" },
    ],
    permit: { recommendationReason: "밀폐구역 화기작업 · 필수 위험정보는 2차 접수에서 보완됨" },
    doc: {
      hazards: ["CO·용접 흄", "화재", "산소결핍"],
      gasMeasurement: "측정 필요 ☑ · 작업 전·중 CO·O₂ 확인",
      note: "위험요인·가스측정 보완 기재 (2차 접수)",
    },
    resolvedFindings: ["RF-04"],
  },
  "PTW-2541-0452": {
    checks: [
      { item: "블록 ID", ok: true, before: "블록 9개", after: "B-D27 ~ B-D35 (9개)" },
      { item: "밀폐구역 ID", ok: false, before: "미기재", after: "블록별 밀폐구역 ID가 여전히 없음" },
      { item: "작업별 시간", ok: true, before: "08:00–16:59 일괄", after: "블록별 시간표 첨부" },
      { item: "위험요인", ok: true, before: "밀폐공간 질식 · 통로 협소", after: "+ 용접 흄 · 산소결핍 추가" },
    ],
    permit: {
      place: "대조립 BAY 3 · B-D27 ~ B-D35 (9개)",
      workTime: "블록별 시간표 첨부",
      recommendationReason: "블록은 특정됐으나 밀폐구역 ID가 없어 현장 확인이 필요함",
    },
    doc: {
      supervisor: "박태호 직장",
      hazards: ["밀폐공간 질식", "통로 협소", "용접 흄", "산소결핍"],
      gasMeasurement: "측정 필요 ☑ · 블록별 작업 전 측정 (밀폐구역 미지정)",
      note: "블록 ID 기재 · 밀폐구역 ID는 블록 반입 후 지정 예정",
    },
    resolvedFindings: [],
  },
}

/** 2차 접수본의 허가서 값 */
export const revisedPermit = (p: ReviewPermit): ReviewPermit => ({ ...p, ...REVISIONS[p.id]?.permit })
