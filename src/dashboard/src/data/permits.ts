// 전날 준비(PW-01·SL-01)·측정 대상 작업(SL-02)·이력·보고가 같이 쓰는 허가서 데이터 (SYNTHETIC).
// 출처: 와이어프레임 PW-01·SL-01·SL-02 예시 행 (미검증 가정값). 와이어프레임에서 잘려 보이지 않는 값
// (접수 시각 분, 구역 용적 일부, 대면 점검 담당 등)과 synthetic: true 인 허가서는 화면 시연용으로 만든 값이다.
// 센서는 docs/decisions.md #5·#7에 따라 모든 밀폐구역에 상시 부착된 것으로 본다.
// 2중점검 Y/N은 안전요원 대면 점검과 우선 감시 여부만 정한다 (센서 유무가 아님).

export type PermitForm = "화기" | "도장/세척" | "기타위험" | "압력Test" | "족장" | "전기" | "중량물" | "RT"
/** 양식 추가정보 칸 (목록 아이콘: 밀 · 환 · Ar · 가) */
export type Extra = "밀폐구역출입" | "환기" | "아르곤가스" | "가스측정"
export const EXTRAS: { key: Extra; short: string }[] = [
  { key: "밀폐구역출입", short: "밀" },
  { key: "환기", short: "환" },
  { key: "아르곤가스", short: "Ar" },
  { key: "가스측정", short: "가" },
]
/** 밀폐 위험이 있어 기본 선택되는 양식 4종 (PW-01 필터) */
export const CONFINED_FORMS: PermitForm[] = ["화기", "도장/세척", "기타위험", "압력Test"]

export interface Permit {
  no: string
  form: PermitForm
  /** 시스템이 제안한 블록·밀폐구역 (null = 미매핑) */
  block: string | null
  zoneId: string | null
  /** 신청서에 적힌 작업장소 원문 */
  placeText: string
  task: string
  /** 작업일 (여러 날 묶음이면 범위) */
  period: string
  time: string
  workers: number
  extras: Extra[]
  /** 유해위험요소. 빈 배열 = 미기재 */
  hazards: string[]
  channel: "전산" | "수기"
  /** 접수 시각 (D-1, 11/7) */
  receivedAt: string
  dept: string
  jsp: string
  synthetic?: boolean
}

export const WORK_DAY = "11/9(월)"
export const PREP_DAY = "11/7(토)"
export const DEADLINE = "15:00" // 현장 운영 15:00 (가정값)

export const PERMITS: Permit[] = [
  {
    no: "PTW-2541-0417", form: "기타위험", block: "B-D21", zoneId: "Z-D21-WBT2P", placeText: "WBT No.2 (P) 내부",
    task: "SUS 배관 아르곤 백퍼지 용접", period: "11/9~11/14", time: "08:00-16:59", workers: 2,
    extras: ["밀폐구역출입", "환기", "아르곤가스", "가스측정"], hazards: ["산소 결핍(아르곤)", "용접 흄", "협소 공간"],
    channel: "전산", receivedAt: "13:05", dept: "선행의장 2반 (협력사 OO)", jsp: "JSP-PIP-021",
  },
  {
    no: "PTW-2541-0418", form: "화기", block: "B-D21", zoneId: "Z-D21-PD2", placeText: "파이프덕트 PD-2",
    task: "배관 서포트 취부 용접", period: "11/9", time: "08:00-16:59", workers: 2,
    extras: ["밀폐구역출입", "환기"], hazards: ["용접 흄", "화재"],
    channel: "전산", receivedAt: "13:06", dept: "선행의장 2반 (협력사 OO)", jsp: "JSP-PIP-024",
  },
  {
    no: "PTW-2541-0421", form: "도장/세척", block: "B-D23", zoneId: "Z-D23-WBT3S", placeText: "WBT No.3 (S)",
    task: "이음부 도장 터치업(에폭시)", period: "11/9", time: "08:00-16:59", workers: 3,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: ["유기용제 증기", "인화성", "협소 공간"],
    channel: "전산", receivedAt: "13:12", dept: "도장 3반", jsp: "JSP-PNT-007",
  },
  {
    no: "PTW-2541-0425", form: "기타위험", block: "B-D25", zoneId: "Z-D25-WBT4P", placeText: "WBT No.4 (P) φ600 배관",
    task: "φ600 배관 내부 청소·검사", period: "11/9", time: "08:00-16:59", workers: 4,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: ["산소 결핍", "협소 공간"],
    channel: "전산", receivedAt: "12:10", dept: "배관 5반", jsp: "JSP-PIP-030",
  },
  {
    no: "PTW-2541-0431", form: "기타위험", block: "B-S31", zoneId: "Z-S31-TST3P", placeText: "TST No.3 (P)",
    task: "용제 세척(신너)", period: "11/9", time: "08:00-16:59", workers: 3,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: ["유기용제 증기"],
    channel: "전산", receivedAt: "11:48", dept: "선행의장 4반", jsp: "JSP-OUT-012",
  },
  {
    no: "PTW-2541-0441", form: "화기", block: "B-C41", zoneId: "Z-C41-CD3", placeText: "코퍼댐 CD-3",
    task: "격벽 보강재 절단·그라인딩", period: "11/9", time: "08:00-16:59", workers: 4,
    extras: ["밀폐구역출입", "환기"], hazards: [],
    channel: "전산", receivedAt: "12:40", dept: "대조립 1반", jsp: "JSP-HUL-015",
  },
  {
    no: "PTW-2541-0451", form: "도장/세척", block: "B-E11", zoneId: "Z-E11-FOT1", placeText: "연료유 탱크 FOT No.1",
    task: "용제 세척", period: "11/9", time: "08:00-16:59", workers: 4,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: ["유기용제 증기", "인화성"],
    channel: "전산", receivedAt: "12:22", dept: "도장 1반", jsp: "JSP-PNT-011",
  },
  {
    no: "PTW-2541-0452", form: "기타위험", block: null, zoneId: null, placeText: "대조립 BAY 3 블록 9개",
    task: "블록 밀폐공간 내부 작업", period: "11/9~11/12", time: "08:00-16:59", workers: 4,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: [],
    channel: "수기", receivedAt: "14:20", dept: "대조립 3반 (협력사 OO)", jsp: "—",
  },
  {
    no: "PTW-2541-0461", form: "기타위험", block: "B-P12", zoneId: "Z-P12-PD4", placeText: "파이프덕트 PD-4",
    task: "배관 내부 용접(SUS, 아르곤)", period: "11/9", time: "08:00-16:59", workers: 2,
    extras: ["밀폐구역출입", "환기", "아르곤가스", "가스측정"], hazards: ["산소 결핍(아르곤)", "용접 흄"],
    channel: "전산", receivedAt: "11:30", dept: "배관 7반", jsp: "JSP-PIP-022",
  },
  {
    no: "PTW-2541-0471", form: "도장/세척", block: "B-F01", zoneId: "Z-F01-FPT", placeText: "포어피크 탱크",
    task: "내부 도장 터치업", period: "11/9", time: "08:00-16:59", workers: 3,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: ["유기용제 증기", "인화성"],
    channel: "전산", receivedAt: "10:55", dept: "도장 4반", jsp: "JSP-PNT-009",
  },
  {
    no: "PTW-2541-0481", form: "화기", block: "B-A51", zoneId: "Z-A51-APT", placeText: "애프터피크 탱크",
    task: "보강재 용접", period: "11/9", time: "08:00-16:59", workers: 3,
    extras: ["밀폐구역출입", "환기", "가스측정"], hazards: ["용접 흄", "화재"],
    channel: "전산", receivedAt: "10:30", dept: "대조립 2반", jsp: "JSP-HUL-018",
  },
  {
    no: "PTW-2541-0483", form: "압력Test", block: "B-D25", zoneId: "Z-D25-WBT4P", placeText: "WBT No.4 (P) φ600 배관",
    task: "φ600 배관 공기압 테스트 2.5 bar", period: "11/9", time: "13:00-16:59", workers: 2,
    extras: ["밀폐구역출입"], hazards: ["압력 배관"],
    channel: "전산", receivedAt: "14:35", dept: "배관 5반", jsp: "JSP-PIP-031",
  },
  // 밀폐구역 출입이 없는 허가서 — 필터("밀폐구역 출입 체크된 것만")가 걸러내는 모습을 보이려는 합성 행
  {
    no: "PTW-2541-0402", form: "족장", block: "B-D21", zoneId: null, placeText: "이중저 D21 외부 측면",
    task: "외부 족장 설치", period: "11/9", time: "08:00-16:59", workers: 4,
    extras: [], hazards: ["추락"], channel: "전산", receivedAt: "09:40", dept: "족장 1반", jsp: "JSP-SCF-003", synthetic: true,
  },
  {
    no: "PTW-2541-0405", form: "전기", block: "B-E11", zoneId: null, placeText: "기관실 하부 E11 상부 데크",
    task: "임시 케이블 포설", period: "11/9", time: "08:00-12:00", workers: 2,
    extras: [], hazards: ["감전"], channel: "전산", receivedAt: "10:12", dept: "전장 2반", jsp: "JSP-ELE-006", synthetic: true,
  },
  {
    no: "PTW-2541-0409", form: "중량물", block: "B-S32", zoneId: null, placeText: "PE장 3번 정반",
    task: "블록 턴오버", period: "11/9", time: "13:00-15:00", workers: 6,
    extras: [], hazards: ["낙하", "협착"], channel: "전산", receivedAt: "11:05", dept: "운반 1반", jsp: "JSP-LFT-002", synthetic: true,
  },
  {
    no: "PTW-2541-0412", form: "RT", block: "B-C41", zoneId: null, placeText: "코퍼댐 C41 격벽 용접부",
    task: "방사선 투과검사", period: "11/9", time: "18:00-20:00", workers: 2,
    extras: [], hazards: ["방사선"], channel: "전산", receivedAt: "12:55", dept: "품질 검사팀", jsp: "JSP-QC-004", synthetic: true,
  },
]

/** 접수되지 않은 반 (D-1, 합성) */
export const MISSING_TEAMS = ["의장 6반", "도장 2반", "배관 3반"]

/** 밀폐구역 정보 (PW-01 구역 매핑 · SL-01 S-6). 0417·0441·0461은 와이어프레임 값, 나머지는 합성 */
export const ZONE_META: Record<string, { volume: number; openings: string }> = {
  "Z-D21-WBT2P": { volume: 310, openings: "맨홀 2" },
  "Z-D21-PD2": { volume: 90, openings: "해치 2 (상시 개방)" },
  "Z-D23-WBT3S": { volume: 290, openings: "맨홀 2" },
  "Z-D23-PD3": { volume: 85, openings: "해치 1" },
  "Z-D25-WBT4P": { volume: 300, openings: "맨홀 2" },
  "Z-S31-TST3P": { volume: 420, openings: "맨홀 3" },
  "Z-S32-TST3S": { volume: 420, openings: "맨홀 3" },
  "Z-C41-CD3": { volume: 120, openings: "출입구 1" },
  "Z-C41-CD4": { volume: 120, openings: "출입구 1" },
  "Z-E11-FOT1": { volume: 180, openings: "맨홀 1" },
  "Z-E11-VOID": { volume: 60, openings: "맨홀 1" },
  "Z-P12-PD4": { volume: 110, openings: "해치 2" },
  "Z-F01-FPT": { volume: 160, openings: "맨홀 1" },
  "Z-F01-CL": { volume: 40, openings: "해치 1" },
  "Z-A51-APT": { volume: 140, openings: "맨홀 1" },
  "Z-A51-ST": { volume: 70, openings: "해치 1" },
}

// ---------- AI 체크 검토 (PW-01) ----------
// 허가서의 추가정보 체크·기재가 맞는지 시스템이 짚는다. 실제 RAG·학습 모델은 아직 없어서 판정과 근거는 모두 합성.
// source: 규칙 = 양식 필수 항목 검사 · 유사 허가서 검색 = 과거 허가서를 찾아 비교(RAG)
//         사내 문서 검색 = 세칙·교육자료에서 관련 대목 찾기(RAG) · 분류 모델 = 작업내용 문장으로 양식·위험 추정

export type AiSource = "규칙" | "유사 허가서 검색" | "사내 문서 검색" | "분류 모델"
export interface AiCheck {
  id: string
  permit: string
  level: "확인 필요" | "참고"
  kind: "체크 누락 추정" | "기재 누락" | "양식 불일치" | "구역 미매핑" | "동시 작업" | "다중일"
  /** 한 줄 요약 */
  title: string
  /** 시스템이 권하는 보완 (체크 추가·기재 문구 등) */
  suggest?: string
  evidence: { source: AiSource; text: string }[]
  /** 분류 모델·검색 결과의 확신도 (0~1, 합성) */
  confidence?: number
}

export const AI_CHECKS: AiCheck[] = [
  {
    id: "AC-01", permit: "PTW-2541-0483", level: "확인 필요", kind: "체크 누락 추정",
    title: "밀폐구역출입 ☑인데 가스측정 ☐ — 테스트 중 배관 진입 가능성",
    suggest: "추가정보 '가스측정' 체크 · 작업 전 복합가스 측정",
    evidence: [
      { source: "규칙", text: "밀폐구역출입 체크 시 가스측정 체크 동반 (양식 추가정보 조합 검사)" },
      { source: "유사 허가서 검색", text: "φ600 이상 배관 압력Test 허가서 11건 중 9건이 가스측정 ☑ — 7건은 테스트 중 배관 진입 기록" },
    ],
    confidence: 0.82,
  },
  {
    id: "AC-02", permit: "PTW-2541-0441", level: "확인 필요", kind: "기재 누락",
    title: "유해위험요소 미기재 — 화기 + 밀폐 작업",
    suggest: "유해위험요소: 일산화탄소 · 용접 흄 · 화재 · 산소 결핍",
    evidence: [
      { source: "규칙", text: "유해위험요소는 양식 공통 필수 항목" },
      { source: "유사 허가서 검색", text: "코퍼댐 절단·그라인딩 허가서 17건에 가장 많이 적힌 위험: CO 15 · 흄 14 · 화재 12" },
    ],
  },
  {
    id: "AC-03", permit: "PTW-2541-0441", level: "확인 필요", kind: "체크 누락 추정",
    title: "화기 + 밀폐인데 가스측정 ☐",
    suggest: "추가정보 '가스측정' 체크",
    evidence: [
      { source: "유사 허가서 검색", text: "화기 + 밀폐 허가서 31건 중 29건 가스측정 ☑" },
      { source: "분류 모델", text: "작업내용 '절단·그라인딩' → CO 발생 작업으로 분류" },
    ],
    confidence: 0.91,
  },
  {
    id: "AC-04", permit: "PTW-2541-0431", level: "확인 필요", kind: "양식 불일치",
    title: "작업내용 '용제 세척(신너)'인데 양식은 기타위험 — 도장/세척 양식일 가능성",
    suggest: "양식 분류 확인 → 도장/세척이면 선별 규칙 S-2(용제 증기) 적용",
    evidence: [
      { source: "분류 모델", text: "작업내용 문장 → 도장/세척 0.86 · 기타위험 0.11" },
      { source: "유사 허가서 검색", text: "'신너 세척' 허가서 24건 중 21건이 도장/세척 양식" },
    ],
    confidence: 0.86,
  },
  {
    id: "AC-05", permit: "PTW-2541-0452", level: "확인 필요", kind: "구역 미매핑",
    title: "작업장소 '대조립 BAY 3 블록 9개' — 블록·밀폐구역을 특정할 수 없음",
    suggest: "작업부서에 블록 번호·구역 확인 요청 → 구역 매핑 후 선별",
    evidence: [{ source: "규칙", text: "작업장소 텍스트에서 블록 ID를 찾지 못함 (수기 접수)" }],
  },
  {
    id: "AC-06", permit: "PTW-2541-0452", level: "확인 필요", kind: "기재 누락",
    title: "유해위험요소 미기재",
    suggest: "작업 범위 확인 후 기재 요청",
    evidence: [{ source: "규칙", text: "유해위험요소는 양식 공통 필수 항목" }],
  },
  {
    id: "AC-07", permit: "PTW-2541-0425", level: "확인 필요", kind: "동시 작업",
    title: "같은 구역 13:00~16:59 압력Test(0483)와 겹침 (SIMOPS)",
    suggest: "작업 순서 조정 또는 같은 시간대 감시 강화",
    evidence: [{ source: "규칙", text: "같은 밀폐구역 · 겹치는 작업 시간 (Z-D25-WBT4P)" }],
  },
  {
    id: "AC-08", permit: "PTW-2541-0418", level: "참고", kind: "체크 누락 추정",
    title: "인접 구역(0417) 아르곤 사용 — 가스측정 체크 권장",
    suggest: "추가정보 '가스측정' 체크 검토",
    evidence: [
      { source: "유사 허가서 검색", text: "아르곤 작업 인접 화기 허가서 12건 중 8건 가스측정 ☑" },
    ],
    confidence: 0.64,
  },
  {
    id: "AC-09", permit: "PTW-2541-0421", level: "참고", kind: "체크 누락 추정",
    title: "도장 터치업 + 환기 1계통 — 과거 동종 사고 유형(환기팬 정지)",
    suggest: "송풍기 2대 이상 · 정지 시 즉시 알림 확인",
    evidence: [
      { source: "사내 문서 검색", text: "밀폐공간 안전 교육자료(예시): 탱크 내부 도장 중 환기팬 정지로 인한 유기용제 중독 사고 유형" },
    ],
  },
  {
    id: "AC-10", permit: "PTW-2541-0417", level: "참고", kind: "다중일",
    title: "여러 날 묶음 허가서(11/9~11/14) — 2일차부터 재확인 (S-7)",
    evidence: [{ source: "규칙", text: "다중일 허가서는 작업일별로 나눠 표시 · 2일차 이후 재확인" }],
  },
]

// ---------- 측정 대상 선별 (SL-01) ----------

export type Suggestion = "Y" | "검토" | "N" | "보류"
export interface Selection {
  permit: string
  suggestion: Suggestion
  /** 선정 근거 칩: rule 기본 규칙(회색) · history 과거 이력(청록) · weight 가중 요인(주황) */
  chips: { kind: "rule" | "history" | "weight"; text: string }[]
  /** 규칙별 기여도 (선택 허가서 근거 패널) */
  contributions?: { rule: string; label: string; value: string }[]
  /** 관리자 최종 (확정 시점 값). null = 보류 */
  final: "Y" | "N" | null
  /** 제안과 다르게 정했거나 검토를 정한 기록 */
  decision?: { reason: string; by: string; at: string }
  /** 대면 점검 담당 (최종 Y만) */
  inspector?: "A동 김OO" | "B동 박OO"
  /** 당일 대면 점검 완료 시각 (SL-02) — 없으면 예정 */
  faceCheckAt?: string
  /** 과거 유사 작업 (SYNTHETIC) */
  history?: { date: string; place: string; result: string }[]
}

export const SELECTION_RUN = { at: "15:02", by: "홍OO" }
export const SELECTION_CONFIRMED = { at: "11/7 15:14", by: "홍OO" }

export const RULES = [
  { id: "S-1", cond: "아르곤가스 사용 ☑ → 산소 결핍", result: "Y" },
  { id: "S-2", cond: "도장/세척 양식 + 밀폐 ☑ → 용제 증기", result: "Y" },
  { id: "S-3", cond: "화기 양식 + 밀폐 ☑ → CO·화재", result: "검토" },
  { id: "S-4", cond: "과거 유사 작업 경계 이상 비율 ≥ 20%", result: "Y" },
  { id: "S-5", cond: "같은 날 같은 블록 동시 작업", result: "+가중" },
  { id: "S-6", cond: "용적 < 150 m³ 또는 출입구 1개소", result: "+가중" },
  { id: "S-7", cond: "다중일 허가서 2일차 이후", result: "재확인" },
]

export const SELECTIONS: Selection[] = [
  {
    permit: "PTW-2541-0417", suggestion: "Y", final: "Y", inspector: "A동 김OO", faceCheckAt: "08:02",
    chips: [
      { kind: "rule", text: "S-1 아르곤" },
      { kind: "history", text: "S-4 유사 14건 · 경계 3 (21%)" },
      { kind: "weight", text: "S-5 0418 화기 인접" },
    ],
    contributions: [
      { rule: "S-1", label: "아르곤 사용 → O₂ 결핍", value: "단독 Y" },
      { rule: "S-4", label: "유사 작업 경계 비율 21%", value: "0.7" },
      { rule: "S-5", label: "같은 블록 화기 동시", value: "+0.4" },
      { rule: "S-6", label: "용적 310 m³ · 맨홀 2", value: "0" },
    ],
    history: [
      { date: "10/21", place: "WBT 1P Ar 용접", result: "경계 O₂ 19.3" },
      { date: "10/14", place: "WBT 2S Ar 용접", result: "정상" },
      { date: "10/08", place: "PD-1 Ar 용접", result: "경계 O₂ 19.1" },
      { date: "09/30", place: "WBT 3P Ar 용접", result: "정상" },
    ],
  },
  {
    permit: "PTW-2541-0421", suggestion: "Y", final: "Y", inspector: "A동 김OO", faceCheckAt: "08:05",
    chips: [
      { kind: "rule", text: "S-2 도장" },
      { kind: "history", text: "S-4 유사 22건 · 경계 5 (23%)" },
      { kind: "history", text: "2014 동종 사고 유형" },
    ],
    contributions: [
      { rule: "S-2", label: "도장/세척 + 밀폐 → 용제 증기", value: "단독 Y" },
      { rule: "S-4", label: "유사 작업 경계 비율 23%", value: "0.8" },
      { rule: "S-6", label: "용적 290 m³ · 맨홀 2", value: "0" },
    ],
    history: [
      { date: "11/3", place: "WBT 2S 도장 터치업", result: "경계 LEL 6.1" },
      { date: "10/17", place: "WBT 1P 도장 터치업", result: "정상" },
      { date: "10/09", place: "COT 3C 도장 터치업", result: "경계 LEL 7.4" },
    ],
  },
  {
    permit: "PTW-2541-0441", suggestion: "검토", final: "Y", inspector: "A동 김OO", faceCheckAt: "08:08",
    chips: [
      { kind: "rule", text: "S-3 화기+밀폐" },
      { kind: "weight", text: "S-6 120 m³ · 출입구 1" },
      { kind: "rule", text: "유해위험 미기재" },
    ],
    decision: { reason: "검토→Y 확정 · 미기재 보완 요청", by: "홍OO", at: "15:06" },
  },
  {
    permit: "PTW-2541-0451", suggestion: "Y", final: "Y", inspector: "A동 김OO", faceCheckAt: "08:12",
    chips: [
      { kind: "rule", text: "S-2 세척" },
      { kind: "history", text: "S-4 유사 12건 · 경계 3 (25%)" },
    ],
  },
  {
    permit: "PTW-2541-0461", suggestion: "Y", final: "Y", inspector: "B동 박OO", faceCheckAt: "08:10",
    chips: [
      { kind: "rule", text: "S-1 아르곤" },
      { kind: "weight", text: "S-6 해치 2 · 110 m³" },
    ],
  },
  {
    permit: "PTW-2541-0471", suggestion: "Y", final: "Y", inspector: "B동 박OO", faceCheckAt: "08:15",
    chips: [
      { kind: "rule", text: "S-2 도장" },
      { kind: "history", text: "S-4 유사 9건 · 경계 1 (11%)" },
    ],
  },
  {
    permit: "PTW-2541-0425", suggestion: "Y", final: "Y", inspector: "B동 박OO", faceCheckAt: "08:20",
    chips: [
      { kind: "rule", text: "밀폐 ☑ 환기 ☑ 가스측정 ☑" },
      { kind: "weight", text: "S-5 0483 압력Test 겹침" },
    ],
  },
  {
    permit: "PTW-2541-0483", suggestion: "N", final: "Y", inspector: "B동 박OO",
    chips: [
      { kind: "rule", text: "밀폐 ☑ · 가스측정 ☐" },
      { kind: "weight", text: "S-5 0425 청소와 시간 겹침" },
    ],
    decision: { reason: "N→Y 테스트 중 배관 진입 가능성 (AI 체크 AC-01 반영)", by: "홍OO", at: "15:08" },
  },
  {
    permit: "PTW-2541-0418", suggestion: "검토", final: "N",
    chips: [
      { kind: "rule", text: "S-3 화기+밀폐" },
      { kind: "weight", text: "S-5 0417 아르곤 인접" },
      { kind: "history", text: "S-4 유사 30건 · 경계 0" },
    ],
    decision: { reason: "검토→N 해치 2개소 상시 개방·개방형 · 대표 확인", by: "홍OO", at: "15:10" },
  },
  {
    permit: "PTW-2541-0431", suggestion: "N", final: "N",
    chips: [
      { kind: "history", text: "S-4 유사 18건 · 경계 0 (0%)" },
      { kind: "rule", text: "S-6 420 m³ · 맨홀 3" },
    ],
  },
  {
    permit: "PTW-2541-0481", suggestion: "검토", final: "N",
    chips: [
      { kind: "rule", text: "S-3 화기+밀폐" },
      { kind: "history", text: "S-4 유사 26건 · 경계 1 (4%)" },
    ],
    decision: { reason: "검토→N 국소배기 설치 · 맨홀 개방 확인", by: "홍OO", at: "15:11" },
  },
  {
    permit: "PTW-2541-0452", suggestion: "보류", final: null,
    chips: [{ kind: "rule", text: "근거 산출 불가 (구역 미매핑)" }],
  },
]

/** 현장 측정자·안전요원 (합성) */
export const INSPECTORS = [
  { name: "A동 김OO", role: "현장 측정자 · 대면 점검" },
  { name: "B동 박OO", role: "현장 측정자 · 대면 점검" },
]

export const permitByNo = (no: string) => PERMITS.find((p) => p.no === no)
export const selectionOf = (no: string) => SELECTIONS.find((s) => s.permit === no)
export const checksOf = (no: string) => AI_CHECKS.filter((c) => c.permit === no)
