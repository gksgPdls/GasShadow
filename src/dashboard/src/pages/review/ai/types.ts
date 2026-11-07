import type { Extra, PermitForm } from "@/data/permits"
import type { PermitGrade } from "@/pages/review/data"

// 15:00 마감 후 AI 사전 검토 — 화면에서 쓰는 모양.
// 실제 RAG·모델은 아직 없다. 검토 결과는 데이터 파일(data.ts)에 미리 적어 둔 합성값이고,
// 이 화면은 그 결과가 나오기까지의 과정을 시간에 맞춰 보여 준다.

/** 검토 단계: ① 규정 적합성 ② 병행작업 간섭 ③ 유사 사고사례 ④ 판단 쟁점 */
export type Step = 1 | 2 | 3 | 4

export interface StepDef {
  step: Step
  title: string
  /** 한 줄 설명 (무엇을 대조하는지) */
  sub: string
  /** 진행 중에 차례로 바뀌는 처리 문구 */
  logs: string[]
  /** 끝났을 때 결과 한 줄 */
  result: string
  /** 이 단계에 걸리는 시간 (ms, 연출) */
  ms: number
}

/** 하루치 접수 허가서 한 건 */
export interface IntakePermit {
  id: string
  form: PermitForm
  task: string
  department: string
  /** 신청서에 적힌 작업장소 */
  place: string
  block: string | null
  workDate: string
  workTime: string
  workers: number
  extras: Extra[]
  /** 유해위험요소. 빈 배열 = 미기재 */
  hazards: string[]
  /** 신청서의 공구/기기 칸 */
  tools: string[]
  channel: "전산" | "수기"
  /** 표준작업지도서 번호 (없으면 공란) */
  jsp?: string
  /** 접수 시각 HH:MM:SS (D-1) */
  receivedAt: string
  /** 관리감독자 (없으면 전산 접수 = 이OO 직장, 수기 = 미지정) */
  supervisor?: string
  /** extras 밖의 추가정보 체크 칸(라벨). 2차 접수에서 새로 체크한 칸 */
  checkedLabels?: string[]
  /** 2차 접수에서 작업부서가 적은 보완 내용 */
  revisionNote?: string
}

export type FindingKind = "과소 신청 의심" | "작업 간 충돌" | "과거 유사 사고" | "기재 누락" | "체크 항목 모순" | "판단 필요" | "참고"

export type EvidenceSource = "허가서 원문" | "사내 세칙" | "사내 양식" | "법령" | "기술지침" | "사고 사례" | "허가 이력"

export interface Evidence {
  source: EvidenceSource
  text: string
  /** 원문 위치 (조항·쪽·URL) */
  ref?: string
}

export interface Finding {
  step: Step
  kind: FindingKind
  title: string
  /** 한 줄 보충 (없어도 된다) */
  body?: string
  /** 함께 봐야 할 다른 허가서 */
  related?: string[]
  /** 연결된 과거 사고 사례 (CASES의 id) */
  caseId?: string
  evidence: Evidence[]
}

export interface AiResult {
  verdict: "직접 판단" | "검토 완료"
  grade: PermitGrade
  /** 등급 추천 이유 (짧게) */
  gradeReason: string
  /** 목록에 보일 한 줄 이유 */
  headline: string
  /** 관리자에게 먼저 보여 줄 판단 요약 (짧은 1~2문장) */
  summary: string
  /** 사람이 정해야 할 질문 */
  ask?: string
  /** 보완 요청 시 기본 문구에 들어갈 부족 항목 */
  missing: string[]
  findings: Finding[]
}

export interface AccidentCase {
  id: string
  when: string
  where: string
  title: string
  /** 무슨 일이 있었나 (1~2문장) */
  what: string
  /** 허가 관점에서 무엇이 빠졌나 */
  lesson: string
  source: string
  url?: string
  /** 원문 직접 확인 / 2차 출처(언론 등) */
  checked: "원문 확인" | "2차 출처"
}
