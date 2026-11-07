import type { Extra, PermitForm } from "@/data/permits"

// 허가서 원문 화면이 따르는 작업허가서 양식 구조 (시연용 예시).
// 일반적인 위험작업허가서 항목을 바탕으로 만든 예시이며, 칸에 들어가는 값은 합성이다.

export interface FormSheet {
  title: string
  en: string
  /** 현장 확인점검사항 (작업 당일 작업 시작 전 체크) */
  checklist: string[]
}

export const FORM_SHEETS: Record<PermitForm, FormSheet> = {
  화기: {
    title: "화기 작업허가서",
    en: "HOT WORK PERMIT",
    checklist: ["화기 감시자 배치", "불받이포 설치", "환기 실시", "병행작업 확인 (SIMOPS)", "인화성물질 제거", "소화장비 배치", "이면부 확인", "가스호스 누설 확인"],
  },
  "도장/세척": {
    title: "도장/세척 작업허가서",
    en: "PAINTING/CLEANING WORK PERMIT",
    checklist: ["비산방지조치 실시", "MSDS 게시", "환기 실시", "병행작업 확인 (SIMOPS)", "장비 접지 실시", "소화장비 배치", "방독마스크 착용", "비위험지역 유기용제 보관"],
  },
  전기: {
    title: "전기 작업허가서",
    en: "ELECTRIC WORK PERMIT",
    checklist: ["활선 상태 확인", "전원차단 및 브레이커 잠금 (LOTO)", "감전위험 표지물 게시", "충전부 방호조치 실시", "절연보호구 착용", "소화장비 배치", "접지 여부 확인", "병행작업관리 (SIMOPS)"],
  },
  RT: {
    title: "방사선(RT) 작업허가서",
    en: "RADIOACTIVE EXAMINATION WORK PERMIT",
    checklist: ["작업구역 잔류자 확인", "방사선관리구역 설정", "경광등 설치", "방사선 위험표지 설치", "개인피폭선량계 소지", "조사기 표면점검 및 자물쇠 확인", "PIG-TAIL 및 연결부 확인", "알람모니터 경보음 주기 확인"],
  },
  족장: {
    title: "족장 작업허가서 (설치/해체)",
    en: "SCAFFOLDING WORK PERMIT",
    checklist: ["작업구역 통제조치 실시", "생명줄 설치 및 안전벨트 활용", "낙하물 제거 확인", "병행작업 확인 (SIMOPS)", "달줄상태 점검 실시", "족장 자재 점검", "족장 보관지역 설정", "족장 자재 통행로 미침범"],
  },
  압력Test: {
    title: "압력검사 작업허가서",
    en: "PRESSURE TEST WORK PERMIT",
    checklist: ["감시자 배치", "공지문/경고표지 부착", "미사용 밸브 시건 (LOTO)", "작업구역 통제조치 실시", "플랜지/볼팅/가스켓 상태 확인", "P&ID/매뉴얼 사전확인", "무전기 채널 확인", "압력계 원거리 이격설치"],
  },
  기타위험: {
    title: "기타위험 작업허가서 (비일상 및 기타 작업)",
    en: "OTHER RISKY WORK PERMIT",
    checklist: ["공지문/경고표지 부착", "작업구역 통제조치 실시", "전원차단 및 브레이커 잠금 (LOTO)", "병행작업 확인 (SIMOPS)", "인화성물질 제거", "소화장비 배치", "통행로 확보", "야간 작업시 조명 설치"],
  },
  중량물: {
    title: "중량물 권상작업허가서",
    en: "CRITICAL LIFTING OPERATION WORK PERMIT",
    checklist: [
      "환경조건", "지반상태", "무게중심", "장비상태", "조명", "장비작동점검", "출입 및 비상대피로", "작업자 자격 및 역량",
      "출입통제", "주변간섭물", "당김줄", "낙하위험물", "권상공구 체결상태", "러그 NDT 상태", "기타",
    ],
  },
}

/** 공통 '추가정보' 칸 (3열). extra = 허가서 데이터의 체크값과 연결되는 칸 */
export const EXTRA_INFO: { label: string; extra?: Extra }[][] = [
  [
    { label: "밀폐구역출입", extra: "밀폐구역출입" },
    { label: "출입현황판 설치" },
    { label: "출입감시자 배치" },
    { label: "환기", extra: "환기" },
    { label: "가스측정", extra: "가스측정" },
    { label: "조명설치" },
  ],
  [{ label: "고소작업" }, { label: "출입수단" }, { label: "작업대" }, { label: "안전벨트" }, { label: "생명줄" }, { label: "기타추락방지조치" }],
  [{ label: "환기여부" }, { label: "아르곤가스 사용", extra: "아르곤가스" }, { label: "수전구역" }, { label: "압력사용" }],
]

/** 작업 유형 표시 순서 (필터·정렬) */
export const FORM_ORDER: PermitForm[] = ["화기", "도장/세척", "기타위험", "압력Test", "족장", "전기", "중량물", "RT"]
