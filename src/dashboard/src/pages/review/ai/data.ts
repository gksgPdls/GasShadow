import { PERMITS, type Permit } from "@/data/permits"
import type { AccidentCase, AiResult, Evidence, IntakePermit, StepDef } from "@/pages/review/ai/types"
import { SCENARIO_PERMITS } from "../scenario-permits"
import { REVIEW_PERMITS } from "@/pages/review/data"

// 작업허가 AI 사전 검토 데이터 (SYNTHETIC)
// - 기존 상세 검토 6건 + scenario-permits.ts의 공정·구획별 합성 60건 = 66건. 접수·결과·원문 ID를 공유한다.
// - AI 결과: 미리 적어 둔 합성값. 실제 RAG·모델 출력이 아니다.
// - 근거 문구: 아래 출처는 원문을 직접 열어 확인한 것만 넣었다 (2026-11-01).
//   · 사내 세칙·양식: 공개 저장소에서는 조선소 내부 자료를 빼고 일반적인 내용으로 바꿔 적었다 (예시)
//   · 법령: 산업안전보건기준에 관한 규칙 [시행 2026.3.2.] law.go.kr 원문
//   · 기술지침: KOSHA GUIDE A-G-14-2026(현행), G-117-2014, KOSHA CODE B-1-2008 PDF 원문 (G-117·B-1은 2026.1.30 지침 정비 후 현행 여부 미확인). 모두 권고
//   · 사고 사례: CSB 보고서·대법원 판결은 원문, 나머지는 언론 기사 원문을 열어 확인 (checked 표시)
// - 허가등급(전산·안전대면·안전현장) 이름은 HD현대중공업 2025 안전·보건 경영보고서. 어느 작업을 어느 등급으로 보낼지는 팀 가정:
//   안전현장허가 = 다른 위험작업과 겹치거나 신청 양식보다 위험한 작업이 섞인 경우 / 안전대면허가 = 밀폐구역 출입 화기·도장·아르곤·압력, 중량물, RT / 전산허가 = 그 밖

const tools: Record<string, string[]> = {
  "PTW-2541-0417": ["TIG 용접기", "아르곤 백퍼지 호스", "송풍기"],
  "PTW-2541-0418": ["CO₂ 용접기", "그라인더"],
  "PTW-2541-0421": ["붓·롤러", "방폭 송풍기"],
  "PTW-2541-0425": ["배관 청소 장비", "방폭 조명"],
  "PTW-2541-0431": ["세척용 신너", "방폭 송풍기"],
  "PTW-2541-0441": ["가스 절단기", "그라인더"],
  "PTW-2541-0451": ["세척 용제", "방폭 송풍기", "배출 펌프"],
  "PTW-2541-0452": [],
  "PTW-2541-0461": ["TIG 용접기", "아르곤 백퍼지 호스"],
  "PTW-2541-0471": ["붓·롤러", "방폭 송풍기"],
  "PTW-2541-0481": ["CO₂ 용접기", "그라인더"],
  "PTW-2541-0483": ["공기 압축기", "압력계"],
  "PTW-2541-0402": ["족장재", "달줄"],
  "PTW-2541-0405": ["케이블 드럼", "케이블 보호대"],
  "PTW-2541-0409": ["골리앗 크레인", "샤클·와이어 로프"],
  "PTW-2541-0412": ["방사선 조사기", "개인 선량계"],
}

const fromShared = (p: Permit): IntakePermit => ({
  id: p.no,
  form: p.form,
  task: p.task,
  department: p.dept,
  place: p.block ? `${p.block} · ${p.placeText}` : p.placeText,
  block: p.block,
  workDate: p.period,
  workTime: p.time.replace("-", "–"),
  workers: p.workers,
  extras: p.extras,
  hazards: p.hazards,
  tools: tools[p.no] ?? [],
  channel: p.channel,
  jsp: p.jsp,
  receivedAt: `${p.receivedAt}:00`,
})

const extra: IntakePermit[] = [
  {
    id: "PTW-2541-0403", form: "족장", task: "선수부 외부 족장 설치", department: "족장 1반", place: "선수 F01 · 선수부 외판",
    block: "B-F01", workDate: "11/9", workTime: "08:00–16:59", workers: 4, extras: [], hazards: ["추락", "낙하물"],
    tools: ["족장재", "달줄"], channel: "전산", receivedAt: "09:52:00",
  },
  {
    id: "PTW-2541-0407", form: "중량물", task: "블록 탑재 인양 (1도크 골리앗)", department: "운반 2반", place: "C42 블록 · 1도크",
    block: "B-C42", workDate: "11/9", workTime: "08:00–11:00", workers: 8, extras: [], hazards: ["낙하", "협착"],
    tools: ["골리앗 크레인", "샤클·와이어 로프"], channel: "전산", receivedAt: "10:40:00",
  },
  {
    id: "PTW-2541-0414", form: "화기", task: "외판 취부 용접 (옥외 정반)", department: "대조립 4반", place: "파이프덕트 P12 · PE장 2번 정반 외판",
    block: "B-P12", workDate: "11/9", workTime: "08:00–16:59", workers: 3, extras: [], hazards: ["화재", "용접 흄"],
    tools: ["CO₂ 용접기", "그라인더"], channel: "전산", receivedAt: "11:15:00",
  },
  {
    id: "PTW-2541-0416", form: "전기", task: "탑재 블록 임시 전원 연결", department: "전장 1반", place: "C42 블록 · 1도크 탑재 위치",
    block: "B-C42", workDate: "11/9", workTime: "13:00–16:59", workers: 2, extras: [], hazards: ["감전"],
    tools: ["임시 분전반", "절연 공구"], channel: "전산", receivedAt: "13:40:00",
  },
  // ↓ 마감 직전 접수 (화면을 보는 중에 들어온다)
  {
    id: "PTW-2541-0496", form: "전기", task: "거주구 하부 통로 임시 조명 설치", department: "전장 3반", place: "선미 A51 · 거주구 하부 통로",
    block: "B-A51", workDate: "11/9", workTime: "08:00–12:00", workers: 2, extras: [], hazards: ["감전"],
    tools: ["임시 조명등", "분전반"], channel: "전산", receivedAt: "14:57:48",
  },
  {
    // PD-3은 WBT No.3(S)와 격벽 하나를 사이에 둔다고 가정
    id: "PTW-2541-0491", form: "화기", task: "배관 관통부 취부 용접·그라인딩", department: "의장 6반", place: "이중저 D23 · 파이프덕트 PD-3 (WBT No.3(S) 옆)",
    block: "B-D23", workDate: "11/9", workTime: "10:00–16:59", workers: 2, extras: ["밀폐구역출입", "환기"], hazards: ["용접 흄", "화재"],
    tools: ["CO₂ 용접기", "그라인더"], channel: "전산", receivedAt: "14:58:12",
  },
  {
    // 족장 양식이지만 공구에 가스 절단기 — 바로 아래가 FOT No.1(용제 세척, 0451)이라고 가정
    id: "PTW-2541-0494", form: "족장", task: "E/R 상부 족장 해체 및 간섭 러그 제거", department: "족장 2반", place: "기관실 하부 E11 · E/R 상부 갑판 (FOT No.1 위)",
    block: "B-E11", workDate: "11/9", workTime: "13:00–16:59", workers: 3, extras: [], hazards: ["추락", "낙하물"],
    tools: ["가스 절단기(산소·LPG)", "그라인더", "달줄"], channel: "전산", receivedAt: "14:59:34",
  },
]

/** 접수 시각 순 */
// 검토함(review/data.ts REVIEW_PERMITS)에 있는 건만 접수·AI 검토 대상으로 쓴다 (건수를 검토함과 맞춤)
const REVIEW_IDS = new Set(REVIEW_PERMITS.map((p) => p.id))
export const INTAKE: IntakePermit[] = [...PERMITS.map(fromShared), ...extra, ...SCENARIO_PERMITS.map((p) => p.intake)]
  .filter((p) => REVIEW_IDS.has(p.id))
  .map((p) => {
    const review = REVIEW_PERMITS.find((r) => r.id === p.id)!
    return { ...p, task: review.task, form: review.form as IntakePermit["form"], place: review.place, workDate: review.workDate, workTime: review.workTime, workers: review.workers }
  })
  .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))

// ---------- 근거 문구 (원문 확인) ----------

const LAW = {
  r239: {
    source: "법령",
    text: "위험물이 있어 폭발이나 화재가 발생할 우려가 있는 장소 또는 그 상부에서 불꽃이나 아크를 발생하거나 고온으로 될 우려가 있는 화기ㆍ기계ㆍ기구 및 공구 등을 사용해서는 아니 된다.",
    ref: "산업안전보건기준에 관한 규칙 제239조",
  },
  r241_2: {
    source: "법령",
    text: "가연성물질이 금속으로 된 칸막이ㆍ벽ㆍ천장 또는 지붕의 반대쪽 면에 인접해 있어 열전도나 열복사에 의해 발화될 우려가 있는 장소 → 화재감시자 지정·배치",
    ref: "산업안전보건기준에 관한 규칙 제241조의2 ① 3호",
  },
  r619: {
    source: "법령",
    text: "밀폐공간 작업 시작 전 확인: 산소 및 유해가스 농도의 측정결과 및 후속조치 사항 · 작업 중 불활성가스 또는 유해가스의 누출ㆍ유입ㆍ발생 가능성 검토",
    ref: "산업안전보건기준에 관한 규칙 제619조 ② 3·4호",
  },
  r619_2: {
    source: "법령",
    text: "밀폐공간 작업을 시작하기 전에 지정된 사람이 산소 및 유해가스 농도를 측정하여 적정공기가 유지되고 있는지를 평가하도록 해야 한다.",
    ref: "산업안전보건기준에 관한 규칙 제619조의2 ①",
  },
  ag14: { source: "기술지침", text: "도장작업 등과 같이 인화성 물질을 사용하는 작업은 안전거리 내에서 동시 작업을 금지하여야 한다.", ref: "KOSHA GUIDE A-G-14-2026 6.1(6)" },
  g117_out: { source: "기술지침", text: "밀폐공간에서 인화성 증기의 축적은 외부의 고열작업에 의해서도 발화될 수 있다.", ref: "KOSHA GUIDE G-117-2014 7.(16)" },
  b1_tank: { source: "기술지침", text: "탱크를 청소하는 동안 탱크의 인접장소 또는 갑판 상부에서 화기작업이 이루어져서는 안된다.", ref: "KOSHA CODE B-1-2008 5.5.2(10)" },
} satisfies Record<string, Evidence>

const RULE = {
  hot: { source: "사내 세칙", text: "화기작업: 화재·폭발 위험이 있는 작업. 가연성·인화성 물질 주변이나 출입금지 구역 안의 화기작업 포함 (예시)", ref: "위험작업 안전관리 기준 · 화기 (예시)" },
  paint: { source: "사내 세칙", text: "도장/세척 작업: 질식·화재·폭발 위험이 있는 작업. 밀폐공간 안의 도장·세척 포함 (예시)", ref: "위험작업 안전관리 기준 · 도장/세척 (예시)" },
  pressure: { source: "사내 세칙", text: "압력 시험(공기·수압·유압) 작업 — 비일상 위험작업 (예시)", ref: "위험작업 안전관리 기준 · 압력시험 (예시)" },
  hotForm: { source: "사내 양식", text: "화기 작업허가서 현장 확인점검: 화기 감시자 배치 · 불받이포 설치 · 인화성물질 제거 · 병행작업 확인(SIMOPS)", ref: "작업허가서 양식 · 화기 (예시)" },
  paintForm: { source: "사내 양식", text: "도장/세척 작업허가서 현장 확인점검: MSDS 게시 · 장비 접지 · 방독마스크 · 병행작업 확인", ref: "작업허가서 양식 · 도장/세척 (예시)" },
  pressureForm: { source: "사내 양식", text: "압력시험 작업허가서 현장 확인점검: 감시자 배치 · 작업구역 통제 · 압력계 이격 설치", ref: "작업허가서 양식 · 압력시험 (예시)" },
} satisfies Record<string, Evidence>


// ---------- 과거 사고 사례 ----------

export const CASES: AccidentCase[] = [
  {
    id: "C-PCA",
    when: "2017.2.8",
    where: "미국 루이지애나 PCA DeRidder 제지공장",
    title: "배관 용접 중 옆 탱크 폭발",
    what: "배관 용접 화기허가를 냈지만 허가는 배관·발판만 다뤘고, 바로 옆 탱크 안의 폭발성 증기는 검토하지도 재지도 않았다. 용접 중 탱크가 폭발해 3명이 숨지고 7명이 다쳤다.",
    lesson: "허가서가 작업 지점만 보고 인접 설비의 위험을 보지 않았다.",
    source: "미국 화학안전조사위원회(CSB) 최종보고서, 2018.4",
    url: "https://www.csb.gov/assets/1/20/FINAL_PCA_Report_-_To_Post_(4-24-2018).pdf",
    checked: "원문 확인",
  },
  {
    id: "C-HANWHA",
    when: "2015.7.3",
    where: "울산 화학공장 폐수 저장조",
    title: "저장조 위 배관 용접 중 폭발",
    what: "저장조 상부에서 배관 용접을 하다 저장조에서 새어 나온 잔류가스에 불티가 붙어 폭발, 협력업체 작업자 6명이 숨졌다.",
    lesson: "회사 측은 주변 가스만 재고 안전작업허가서를 냈고, 밀폐된 저장조 내부는 재지 않았다고 설명했다.",
    source: "서울신문 2015.7.3 보도",
    url: "https://m.seoul.co.kr/news/2015/07/04/20150704500067",
    checked: "2차 출처",
  },
  {
    id: "C-USUKI",
    when: "2024.10",
    where: "일본 오이타현 우스키시 조선소",
    title: "도장 마친 탱크에 위쪽 용접 불티",
    what: "탱크 안 가연성 가스에 위쪽에서 떨어진 용접 불티가 붙어 폭발한 것으로 보이며, 탱크 안에서 도장을 마친 작업자 1명이 숨졌다.",
    lesson: "오이타 노동국은 원청의 혼재작업 수시 조정과, 도장·용접을 다른 업체가 할 때 작업 시간대 제한·출입 금지를 요청했다.",
    source: "労働新聞 2024.11.22 (오이타 노동국 요청 보도)",
    url: "https://www.rodo.co.jp/news/187246/",
    checked: "2차 출처",
  },
  {
    id: "C-ICHEON",
    when: "2020.4.29",
    where: "이천 물류창고 신축 현장",
    title: "우레탄 작업 옆 용접 — 38명 사망",
    what: "용접 불티가 천장 우레탄폼에 튀어 불이 난 것으로 경찰이 잠정 결론 내렸다. 38명이 숨지고 10명이 다쳤다.",
    lesson: "우레탄 발포와 용접을 동시에 하지 못하게 하거나 일정을 조정한 정황이 없었고, 화재감시인은 자리를 비웠다.",
    source: "세계일보 2020.6.15 (경찰 수사 결과 보도)",
    url: "https://www.segye.com/newsView/20200615510027",
    checked: "2차 출처",
  },
  {
    id: "C-STX",
    when: "2017.8.20",
    where: "국내 조선소 잔유 보관 탱크",
    title: "탱크 도장 중 폭발 — 4명 사망",
    what: "건조 중인 석유화학제품운반선의 잔유 보관 탱크에서 도장 중 폭발이 나 안에 있던 4명이 숨졌다.",
    lesson: "위험작업 신청·허가서에는 3명이었는데 당일 4명이 들어갔고, 원청 관리자가 이를 알고도 허가서에 서명했다고 수사본부가 밝혔다.",
    source: "경향신문 2017.8.24 보도",
    url: "https://www.khan.co.kr/article/201708241713001",
    checked: "2차 출처",
  },
]

// ---------- AI 결과 ----------

const ok = (grade: AiResult["grade"], gradeReason: string, summary: string): AiResult => ({
  verdict: "검토 완료",
  grade,
  gradeReason,
  headline: summary.split(".")[0],
  summary,
  missing: [],
  findings: [],
})

const src = (text: string): Evidence => ({ source: "허가서 원문", text })
const NO_GAS = src("추가정보: 밀폐구역출입 ☑ · 가스측정 ☐")

export const RESULTS: Record<string, AiResult> = {
  // ── 확인 필요 (목록 순서 = 이 순서. 겹치는 쌍은 붙여 둔다) ──
  "PTW-2541-0494": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "화기 포함 + 아래 탱크 세척과 겹침",
    headline: "족장 신청인데 가스 절단 포함",
    summary: "족장 해체로 냈지만 가스 절단이 있어 사실상 화기작업입니다. 같은 시간 바로 아래 탱크에서 용제 세척 중입니다.",
    ask: "화기 허가를 추가로 받게 할까요, 절단을 세척 뒤로 미룰까요?",
    missing: ["화기 작업허가서", "아래 탱크 세척과 시간 분리"],
    findings: [
      {
        step: 1,
        kind: "과소 신청 의심",
        title: "족장 신청인데 공구에 가스 절단기",
        body: "화기 점검(화기 감시자·불받이포)이 빠진 채 승인될 수 있습니다.",
        evidence: [src("작업 유형: 족장 · 공구: 가스 절단기, 그라인더 · 작업: 간섭 러그 제거"), RULE.hot, RULE.hotForm],
      },
      {
        step: 2,
        kind: "작업 간 충돌",
        title: "아래 탱크 용제 세척과 13:00–16:59 겹침",
        body: "절단 불티가 아래 탱크 증기에 닿을 수 있습니다.",
        related: ["PTW-2541-0451"],
        evidence: [LAW.b1_tank, LAW.r239],
      },
      { step: 3, kind: "과거 유사 사고", title: "옆 탱크를 안 보고 허가한 용접 폭발", caseId: "C-PCA", evidence: [] },
    ],
  },
  "PTW-2541-0451": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "세척 중 위에서 화기작업",
    headline: "위 갑판 가스 절단과 겹침",
    summary: "세척 자체는 문제없지만, 13:00부터 바로 위에서 가스 절단(0494)이 신청됐습니다.",
    ask: "0494와 같이 정해 주세요.",
    missing: ["위쪽 절단 작업과 시간 분리"],
    findings: [
      {
        step: 2,
        kind: "작업 간 충돌",
        title: "위 갑판 가스 절단과 13:00–16:59 겹침",
        related: ["PTW-2541-0494"],
        evidence: [LAW.b1_tank],
      },
      { step: 3, kind: "과거 유사 사고", title: "저장조 위 용접으로 폭발", caseId: "C-HANWHA", evidence: [] },
    ],
  },
  "PTW-2541-0491": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "옆 탱크 도장과 겹치는 화기작업",
    headline: "옆 탱크 도장과 시간 겹침",
    summary: "도장 중인 옆 탱크와 같은 시간에 용접·그라인딩을 합니다. 마감 직전에 들어와 협의 기록이 없습니다.",
    ask: "용접을 도장 뒤로 미룰까요, 감시자·가스측정 조건으로 같이 진행할까요?",
    missing: ["옆 탱크 도장과 시간 분리 또는 동시작업 조건", "가스측정 체크"],
    findings: [
      {
        step: 2,
        kind: "작업 간 충돌",
        title: "옆 탱크 도장과 09:00–10:00 겹침",
        body: "격벽 너머 용접 열로 도장 증기에 불이 붙을 수 있습니다.",
        related: ["PTW-2541-0421"],
        evidence: [LAW.ag14, LAW.g117_out, LAW.r241_2],
      },
      { step: 3, kind: "과거 유사 사고", title: "도장 탱크 옆 용접 — 조선소 폭발", caseId: "C-USUKI", evidence: [] },
      { step: 4, kind: "체크 항목 모순", title: "밀폐 출입인데 가스측정 미체크", evidence: [NO_GAS, LAW.r619_2] },
    ],
  },
  "PTW-2541-0421": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "옆 구획 용접과 겹침",
    headline: "옆 구획 용접과 시간 겹침",
    summary: "도장 신청서는 문제없지만, 바로 옆 구획에 용접(0491)이 같은 시간에 들어왔습니다.",
    ask: "0491과 같이 정해 주세요.",
    missing: ["옆 구획 용접과 시간 분리"],
    findings: [
      {
        step: 2,
        kind: "작업 간 충돌",
        title: "옆 구획 용접과 10:00–16:59 겹침",
        related: ["PTW-2541-0491"],
        evidence: [LAW.g117_out, LAW.ag14],
      },
      { step: 3, kind: "과거 유사 사고", title: "인화성 작업 옆 용접 — 38명 사망", caseId: "C-ICHEON", evidence: [] },
    ],
  },
  "PTW-2541-0483": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "배관 안에 사람이 있는 시간에 압력시험",
    headline: "같은 배관 안에 작업자 있음",
    summary: "13:00부터 공기압 시험을 하는데, 같은 배관 안에서 하루 종일 청소 작업(0425)이 잡혀 있습니다.",
    ask: "시험을 미룰까요, 13시 전에 내부 작업을 끝내게 할까요?",
    missing: ["배관 내부 작업과 시간 분리", "가스측정 체크"],
    findings: [
      {
        step: 2,
        kind: "작업 간 충돌",
        title: "같은 배관 내부 청소와 13:00–16:59 겹침",
        related: ["PTW-2541-0425"],
        evidence: [RULE.pressureForm, RULE.pressure],
      },
      { step: 4, kind: "체크 항목 모순", title: "밀폐 출입인데 가스측정 미체크", evidence: [NO_GAS, LAW.r619_2] },
    ],
  },
  "PTW-2541-0425": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "같은 배관 압력시험과 겹침",
    headline: "같은 배관 압력시험과 겹침",
    summary: "배관 안을 청소하는 오후 시간에 같은 배관 압력시험(0483)이 잡혀 있습니다.",
    ask: "0483과 같이 정해 주세요. 오전에 끝내면 승인할 수 있습니다.",
    missing: ["압력시험과 시간 분리"],
    findings: [
      {
        step: 2,
        kind: "작업 간 충돌",
        title: "같은 배관 압력시험과 13:00–16:59 겹침",
        related: ["PTW-2541-0483"],
        evidence: [RULE.pressureForm],
      },
    ],
  },
  "PTW-2541-0431": {
    verdict: "직접 판단",
    grade: "안전대면허가",
    gradeReason: "밀폐 탱크 신너 세척",
    headline: "세척 작업을 기타위험으로 신청",
    summary: "신너 세척을 기타위험 허가서로 냈습니다. 도장/세척 허가서에 있는 MSDS·접지·방독마스크 항목이 빠졌습니다.",
    ask: "도장/세척 허가서로 다시 받을까요, 대면 접수 때 확인할까요?",
    missing: ["도장/세척 허가서로 재제출"],
    findings: [
      {
        step: 1,
        kind: "과소 신청 의심",
        title: "신너 세척을 기타위험으로 신청",
        evidence: [src("작업 유형: 기타위험 · 작업: 용제 세척(신너)"), RULE.paint, RULE.paintForm],
      },
      { step: 3, kind: "과거 유사 사고", title: "탱크 도장 중 폭발 — 4명 사망", caseId: "C-STX", evidence: [] },
    ],
  },
  "PTW-2541-0441": {
    verdict: "직접 판단",
    grade: "안전대면허가",
    gradeReason: "밀폐 구역 화기작업",
    headline: "위험요소 공란 · 가스측정 미체크",
    summary: "밀폐 구역에서 절단하는데 위험요소 칸이 비어 있고 가스측정 체크가 없습니다.",
    ask: "보완 요청으로 돌려보낼까요?",
    missing: ["유해위험요소", "가스측정 계획"],
    findings: [
      { step: 1, kind: "기재 누락", title: "위험요소 칸 공란", evidence: [src("유해위험요소: 공란"), LAW.r619] },
      { step: 3, kind: "과거 유사 사고", title: "내부 가스를 안 재고 허가 → 폭발", caseId: "C-HANWHA", evidence: [] },
      { step: 4, kind: "체크 항목 모순", title: "밀폐 출입인데 가스측정 미체크", evidence: [src("추가정보: 밀폐구역출입 ☑ · 환기 ☑ · 가스측정 ☐"), LAW.r619_2] },
    ],
  },
  "PTW-2541-0452": {
    verdict: "직접 판단",
    grade: "안전현장허가",
    gradeReason: "구역 미특정",
    headline: "작업 위치 불명확",
    summary: "장소가 ‘블록 9개’로만 적혀 있어 어느 구역인지 모릅니다. 위치가 없으면 겹치는 작업도 확인할 수 없습니다.",
    ask: "블록·구역을 적어 다시 내도록 보완 요청할까요?",
    missing: ["블록·구역 ID", "날짜별 작업 시간", "유해위험요소"],
    findings: [
      { step: 1, kind: "기재 누락", title: "장소·위험요소 불충분", evidence: [src("작업장소: 대조립 BAY 3 블록 9개 · 유해위험요소: 공란 · 수기 접수"), LAW.r619] },
    ],
  },

  // ── 문제없음 ──
  "PTW-2541-0417": ok("안전대면허가", "밀폐 구역 아르곤 작업", "아르곤 용접. 필요한 체크가 다 있습니다. 작업 전 하부 산소만 확인하세요."),
  "PTW-2541-0418": ok("안전대면허가", "밀폐 구역 화기작업", "덕트 안 용접. 주변에 불붙을 작업이 없습니다."),
  "PTW-2541-0461": ok("안전대면허가", "밀폐 구역 아르곤 작업", "배관 안 아르곤 용접. 체크 항목이 다 있습니다."),
  "PTW-2541-0471": ok("안전대면허가", "밀폐 구역 도장", "탱크 도장. 주변에 화기작업이 없습니다."),
  "PTW-2541-0481": ok("안전대면허가", "밀폐 구역 화기작업", "탱크 안 용접. 체크 항목이 다 있습니다."),
  "PTW-2541-0409": ok("안전대면허가", "중량물 인양", "블록 뒤집기. 인양 범위 안에 다른 작업이 없습니다."),
  "PTW-2541-0407": ok("안전대면허가", "중량물 인양", "블록 탑재 인양. 같은 자리 전기 작업은 오후라 겹치지 않습니다."),
  "PTW-2541-0412": ok("안전대면허가", "방사선 검사", "방사선 검사. 같은 블록 용접이 끝난 뒤(18시)에 시작합니다."),
  "PTW-2541-0414": ok("전산허가", "겹치는 작업 없음", "야외 정반 용접. 주변에 불붙을 작업이 없습니다."),
  "PTW-2541-0402": ok("전산허가", "겹치는 작업 없음", "외부 족장 설치. 겹치는 작업이 없습니다."),
  "PTW-2541-0403": ok("전산허가", "겹치는 작업 없음", "외부 족장 설치. 겹치는 작업이 없습니다."),
  "PTW-2541-0405": ok("전산허가", "불꽃 없는 작업", "케이블 포설. 불꽃이 나는 작업이 아니라 아래 세척과 겹쳐도 괜찮습니다."),
  "PTW-2541-0416": ok("전산허가", "겹치는 작업 없음", "임시 전원 연결. 오전 인양이 끝난 뒤 시작합니다."),
  "PTW-2541-0496": ok("전산허가", "겹치는 작업 없음", "임시 조명 설치. 겹치는 작업이 없습니다."),
}

// ---------- 진행 화면 문구 (건수는 결과에서 센다) ----------

// 기존 상세 검토 6건도 현재 검토함의 등급·누락·쟁점과 건수를 맞춘다.
for (const permit of REVIEW_PERMITS) {
  if (SCENARIO_PERMITS.some((p) => p.intake.id === permit.id)) continue
  if (permit.id === "PTW-2541-0491") continue // 시연 사건 2: 위에 직접 적은 AI 결과(사고 사례·법령 근거 포함)를 그대로 쓴다
  RESULTS[permit.id] = {
    verdict: permit.findings.length ? "직접 판단" : "검토 완료",
    grade: permit.recommendedGrade, gradeReason: permit.recommendationReason,
    headline: permit.findings[0]?.title ?? "추가 확인사항 없음",
    summary: permit.findings.map((f) => f.description).join(" ") || "접수된 정보에서 추가 쟁점이 발견되지 않았습니다.",
    missing: permit.missing,
    findings: permit.findings.map((f) => ({ step: 4, kind: /미기재|누락|불명확/.test(f.title) ? "기재 누락" : /양식/.test(f.title) ? "과소 신청 의심" : "판단 필요", title: f.title, body: f.description, evidence: f.evidence.map((e) => ({ source: e.source === "허가서 원문" ? "허가서 원문" : "허가 이력", text: e.text })) })),
  }
}
Object.assign(RESULTS, Object.fromEntries(SCENARIO_PERMITS.map((p) => [p.intake.id, p.result])))

const count = (pred: (r: AiResult) => boolean) => INTAKE.filter((p) => pred(RESULTS[p.id])).length
const has = (kind: string) => (r: AiResult) => r.findings.some((f) => f.kind === kind)
const conflictPairs = new Set(
  INTAKE.flatMap((p) => RESULTS[p.id].findings.filter((f) => f.kind === "작업 간 충돌").flatMap((f) => (f.related ?? []).map((r) => [p.id, r].sort().join("+")))),
).size
const needs = count((r) => r.verdict === "직접 판단")
const cases = new Set(INTAKE.flatMap((p) => RESULTS[p.id].findings.map((f) => f.caseId).filter(Boolean))).size

export const STEPS: StepDef[] = [
  {
    step: 1,
    title: "규정 적합성 검증",
    sub: "사내 세칙 · 산업안전보건기준 규칙 · 허가서 양식 11종과 대조",
    logs: ["사내 세칙 위험작업 조항 색인", "산업안전보건기준에 관한 규칙 화기·밀폐 조문 대조", `${INTAKE.length}건 작업내용 ↔ 신청 유형 정합성 판별`],
    result: `유형 불일치 ${count(has("과소 신청 의심"))} · 기재 누락 ${count(has("기재 누락"))}`,
    ms: 1400,
  },
  {
    step: 2,
    title: "병행작업 간섭 분석",
    sub: "같은 시간대 · 같은 블록과 인접 구획 작업의 위험 조합",
    logs: ["블록·구획 인접 관계 구성", `${(INTAKE.length * (INTAKE.length - 1)) / 2}개 작업 조합 시간대 교차 분석`, "화기 × 인화성 · 압력시험 × 내부 출입 조합 판별"],
    result: `간섭 ${conflictPairs}쌍`,
    ms: 1700,
  },
  {
    step: 3,
    title: "유사 사고사례 매칭",
    sub: "국내외 사고 조사보고서 · 보도에서 같은 위험 패턴 검색",
    logs: ["작업 패턴별 사고사례 검색", "사고 원인과 허가 누락 지점 대조"],
    result: `매칭 ${cases}건`,
    ms: 1300,
  },
  {
    step: 4,
    title: "판단 쟁점 도출",
    sub: "체크 항목 모순 · 관리자 확인 질문 · 추천 허가등급",
    logs: ["체크 항목 상호 모순 검사", "관리자 확인 질문 작성", "허가등급 산정"],
    result: `확인 필요 ${needs} · 문제없음 ${INTAKE.length - needs}`,
    ms: 1000,
  },
]
