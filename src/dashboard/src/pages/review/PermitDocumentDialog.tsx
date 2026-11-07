import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Check, FileText, Maximize2, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { SCENARIO_PERMITS } from "./scenario-permits"
import { REVISIONS, revisedPermit, type ConfinedChecks, type Decision, type PermitGrade, type ReviewPermit } from "@/pages/review/data"
import { INTAKE } from "@/pages/review/ai/data"
import { FORM_SHEETS } from "@/pages/review/ai/forms"
import { PermitFormSheet, type SheetWas } from "@/pages/review/ai/PermitFormDialog"
import type { IntakePermit } from "@/pages/review/ai/types"

/**
 * 검토 화면 원문 칸도 접수함과 같은 양식(PermitFormSheet)으로 그린다.
 * 2차 접수본이면 작업부서가 고친 칸(장소·일시·유해위험요소·가스측정 체크·양식)을 반영하고,
 * '바뀐 곳 표시'가 켜져 있으면 그 칸을 노랗게 칠하고 1차 값을 지운 줄로 보인다.
 */
function sheetOf(permit: ReviewPermit, version: 1 | 2, highlight: boolean): { intake?: IntakePermit; was?: SheetWas } {
  const base = INTAKE.find((p) => p.id === permit.id)
  const rev = REVISIONS[permit.id]
  if (!base || version === 1 || !rev) return { intake: base }
  const form = (rev.permit?.form as IntakePermit["form"] | undefined) ?? base.form
  const place = rev.permit?.place ?? base.place
  const workTime = rev.permit?.workTime?.replace("-", "–") ?? base.workTime
  const hazards = rev.doc?.hazards ?? base.hazards
  const gasAdded = Boolean(rev.doc?.gasMeasurement) && !base.extras.includes("가스측정")
  const extras = gasAdded ? [...base.extras, "가스측정" as const] : base.extras
  // 밀폐구역출입 체크 칸 → 양식 추가정보 칸 라벨
  const CHECK_LABEL: Record<keyof ConfinedChecks, string> = { entryBoard: "출입현황판 설치", watchman: "출입감시자 배치", ventilation: "환기", lighting: "조명설치" }
  const checkedLabels = (Object.keys(rev.checks2 ?? {}) as (keyof ConfinedChecks)[]).filter((k) => rev.checks2?.[k]).map((k) => CHECK_LABEL[k])
  const intake: IntakePermit = {
    ...base,
    form,
    place,
    workTime,
    hazards,
    extras,
    supervisor: rev.doc?.supervisor ?? base.supervisor,
    checkedLabels,
    revisionNote: rev.doc?.note,
  }
  if (!highlight) return { intake }
  const was: SheetWas = {}
  if (form !== base.form) was.form = FORM_SHEETS[base.form].title
  if (rev.doc?.supervisor) was.supervisor = base.channel === "수기" ? "미지정" : "이OO 직장"
  const checked = [...(gasAdded ? ["가스측정"] : []), ...checkedLabels]
  if (checked.length) was.checked = checked
  if (rev.doc?.note) was.note = "미기재" // 1차에는 없던 칸: 다른 칸처럼 1차 값(미기재)을 지운 줄로 보여 준다
  if (place !== base.place) was.place = base.place
  if (workTime !== base.workTime) was.workTime = `${base.workDate} · ${base.workTime.replace("–", " ~ ")}`
  if (hazards.join() !== base.hazards.join()) was.hazards = base.hazards.length ? base.hazards.join(", ") : "미기재"
  return { intake, was }
}

type DocumentDetail = {
  applicant: string
  supervisor: string
  hazards: string[]
  measures: string[]
  gasMeasurement: string
  equipment: string[]
  note: string
}

const DOCUMENT_DETAILS: Record<string, DocumentDetail> = {
  "PTW-2541-0421": {
    applicant: "이도현 반장",
    supervisor: "김성욱 직장",
    hazards: ["유기용제 증기", "화재·폭발", "밀폐공간 중독"],
    measures: ["작업 중 송풍기 상시 가동", "인접 화기작업 중지", "도장 종료 후 30분 이상 환기"],
    gasMeasurement: "측정 필요 ☑ · 도장 종료 후 재측정 · 측정 담당자 미기재",
    equipment: ["방독마스크", "방폭형 송풍기", "소화기"],
    note: "후행 화기작업 PTW-2541-0422는 환기·재측정 완료 후 시작",
  },
  "PTW-2541-0417": {
    applicant: "박민수 반장",
    supervisor: "정태호 직장",
    hazards: ["아르곤 누출", "산소결핍", "용접 불꽃·화재"],
    measures: ["백퍼지 호스 결속 상태 확인", "하부 환기 유지", "인접 화기작업 책임자에게 공유"],
    gasMeasurement: "측정 필요 ☑ · 작업 전 WBT 하부 산소농도 확인",
    equipment: ["용접면", "방염포", "송풍기", "휴대용 5가스 측정기"],
    note: "아르곤 공급 종료 후 하부 산소농도를 재확인할 것",
  },
  "PTW-2541-0441": {
    applicant: "최진우 반장",
    supervisor: "한승현 직장",
    hazards: [],
    measures: ["작업 전 환기 상태 확인", "불티 비산 방지포 설치"],
    gasMeasurement: "미선택",
    equipment: ["보안면", "방염포", "소화기"],
    note: "유해·위험요소 미기재 — 작업부서 보완 필요",
  },
  "PTW-2541-0452": {
    applicant: "윤재현 반장",
    supervisor: "미지정",
    hazards: ["밀폐공간 질식", "통로 협소"],
    measures: ["출입자 기록", "작업 전 환기"],
    gasMeasurement: "측정 필요 ☑ · 대상 구역 미지정",
    equipment: ["송풍기", "휴대용 5가스 측정기"],
    note: "작업장소: 대조립 BAY 3 블록 9개 — 블록·밀폐구역 ID 미기재",
  },
  "PTW-2541-0431": {
    applicant: "김현석 반장",
    supervisor: "오세훈 직장",
    hazards: ["신너 증기", "피부·호흡기 노출", "화재"],
    measures: ["인접구역 작업 중지", "환기팬 계속 가동", "화기원 통제"],
    gasMeasurement: "측정 필요 ☑ · 작업 전·중 LEL 확인",
    equipment: ["방독마스크", "내화학 장갑", "송풍기"],
    note: "신청 양식: 기타위험 — 도장/세척 양식 해당 여부 확인 필요",
  },
  "PTW-2541-0405": {
    applicant: "이준호 반장",
    supervisor: "문성환 직장",
    hazards: ["임시 케이블 걸림", "운반 동선 간섭"],
    measures: ["케이블 보호대 설치", "통행로 경계 표시", "운반작업 시간 분리"],
    gasMeasurement: "해당 없음",
    equipment: ["절연장갑", "안전모", "케이블 보호대"],
    note: "관련 부서 협의조건 반영 완료",
  },
}

const CHANGED = "bg-[#fff4c2]" // 2차 접수에서 바뀐 칸

// 실제 현장 허가서 양식을 따라 칸을 나눈다 (내용만 합성). 판단에 쓰이지 않는 칸(영문 병기·연락처·작업표준 번호·QR,
// 당일 작업 전에만 쓰는 현장 안전조치 확인 등)은 뺐다.
type FormExtra = {
  hull: string
  /** 작업 일자 (여러 날이면 여러 줄) */
  days: string[]
  night?: boolean
  confined: boolean
  /** 밀폐구역출입 세부 체크 (가스측정은 원문 가스측정 값에서 정함) */
  checks: ConfinedChecks
  /** 해당 작업에만 보이는 추가 항목 (예: 아르곤가스 사용) */
  extra?: string[]
  /** 작업부서가 적은 추가전달사항 */
  notice?: string
}
const HULL = "H-2541"
// 신청 양식 → 허가서 이름
const FORM_TITLE: Record<string, string> = { "도장/세척": "도장·세척작업 허가서", 화기: "화기작업 허가서", 기타위험: "기타위험(밀폐)작업 허가서", 전기: "전기작업 허가서", RT: "방사선(RT) 작업허가서", 족장: "족장작업 허가서", 중량물: "중량물작업 허가서", 압력Test: "압력시험 작업허가서" }
const FORM: Record<string, FormExtra> = {
  "PTW-2541-0421": { hull: HULL, days: ["2026-10-30"], confined: true, checks: { entryBoard: true, watchman: true, ventilation: true, lighting: true }, notice: "후행 화기작업 PTW-2541-0422는 환기·재측정 완료 후 시작" },
  "PTW-2541-0417": { hull: HULL, days: ["2026-10-30"], confined: true, checks: { entryBoard: true, watchman: false, ventilation: true, lighting: true }, extra: ["아르곤가스 사용"], notice: "아르곤 공급 종료 후 하부 산소농도 재확인" },
  "PTW-2541-0441": { hull: HULL, days: ["2026-10-30"], confined: true, checks: { entryBoard: true, watchman: false, ventilation: true, lighting: false } },
  "PTW-2541-0452": { hull: HULL, days: ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], confined: true, checks: { entryBoard: true, watchman: false, ventilation: true, lighting: true } },
  "PTW-2541-0431": { hull: HULL, days: ["2026-10-30"], confined: true, checks: { entryBoard: true, watchman: true, ventilation: true, lighting: true } },
  "PTW-2541-0405": { hull: HULL, days: ["2026-10-30"], confined: false, checks: { entryBoard: false, watchman: false, ventilation: false, lighting: false }, notice: "관련 부서 협의조건 반영 완료" },
}

const cellK = "flex items-center border-r border-b border-slate-300 bg-slate-50 px-3 py-2 text-[14px] font-semibold text-slate-600"
const cellV = "flex flex-wrap items-center gap-x-2 border-b border-slate-300 px-3 py-2 text-[15px]"

// 빈 네모(☐) / 체크(☑) / 꽉 찬 네모(■, 양식에 미리 인쇄된 분류 표시)
function Box({ on, solid = false }: { on: boolean; solid?: boolean }) {
  return (
    <span className={cn("grid size-4 shrink-0 place-items-center border-[1.5px] border-slate-700", solid && on && "bg-slate-800")}>
      {on && !solid && <Check className="size-3 text-slate-900" strokeWidth={3} />}
    </span>
  )
}
function Tick({ label, on, changed }: { label: string; on: boolean; changed?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2 px-3 py-2 text-[14px]", changed && CHANGED)}>
      <Box on={on} />
      {label}
    </span>
  )
}
function Section({ n, title, sub, children, className }: { n: number; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-5", className)}>
      <h3 className="mb-2 flex items-baseline gap-2 text-[16px] font-bold">
        <span className="grid size-5 place-items-center self-center bg-slate-800 text-[13px] text-white">{n}</span>
        {title}
        {sub && <span className="text-[13px] font-normal text-slate-500">{sub}</span>}
      </h3>
      {children}
    </section>
  )
}
const Was = ({ v }: { v?: string }) => (v ? <del className="font-normal text-legal">{v}</del> : null)

/** grade: 관리자가 승인한 허가구분 (없으면 검토 중) · request: 안전부서 추가조치 요청 내용 */
export function PermitDocument({
  permit: first,
  version = 1,
  highlight = false,
  grade,
  request,
  minHeight,
}: {
  permit: ReviewPermit
  version?: 1 | 2
  highlight?: boolean
  grade?: PermitGrade
  request?: string
  /** 칸을 꽉 채울 때: 이 높이까지 마지막 칸(추가조치 요청사항)을 늘린다 */
  minHeight?: number
}) {
  const scenario = SCENARIO_PERMITS.find((p) => p.intake.id === first.id)
  const intake = scenario?.intake
  const base = DOCUMENT_DETAILS[first.id] ?? (intake && {
    applicant: `${intake.department} 작업책임자`, supervisor: "담당 관리감독자",
    hazards: intake.hazards, measures: scenario!.measures,
    gasMeasurement: intake.extras.includes("가스측정") ? "측정 필요 ☑ · 작업 전 측정" : intake.extras.includes("밀폐구역출입") ? "측정계획 미기재" : "해당 없음",
    equipment: intake.tools, note: "시연용 합성 허가서 · 작업부서 사전조치 확인",
  })
  const confined = intake?.extras.includes("밀폐구역출입") ?? false
  const form = FORM[first.id] ?? (intake && { hull: HULL, days: ["2026-10-30"], confined,
    checks: { entryBoard: confined, watchman: confined, ventilation: intake.extras.includes("환기"), lighting: confined },
    extra: intake.extras.includes("아르곤가스") ? ["아르곤가스 사용"] : [],
  })
  if (!base || !form) return <div className="p-6 text-[15px] text-muted-foreground">첨부된 허가서 원문이 없습니다.</div>
  const revision = REVISIONS[first.id]
  const rev = version === 2 ? revision : undefined
  const permit = rev ? revisedPermit(first) : first
  const detail = { ...base, ...rev?.doc }
  const later = revision ? { permit: revisedPermit(first), detail: { ...base, ...revision.doc } } : null

  // 2차: 바뀐 칸은 노란 바탕 + 1차 값 취소선 / 1차: 나중에 바뀌는 칸만 노란 바탕
  const changed = (a: string, b: string) => Boolean(highlight && revision && a !== b)
  const placeChg = later ? changed(first.place, later.permit.place) : false
  const timeChg = later ? changed(first.workTime, later.permit.workTime) : false
  const supChg = later ? changed(base.supervisor, later.detail.supervisor) : false
  const gasOn = (g: string) => g.includes("☑")
  const gasChg = later ? highlight && gasOn(base.gasMeasurement) !== gasOn(later.detail.gasMeasurement) : false
  const noticeOf = (d: typeof detail, isRev: boolean) => [
    `유해·위험요소: ${d.hazards.length ? d.hazards.join(", ") : "—"}`,
    `작업 전 안전조치: ${d.measures.join(", ")}`,
    ...(isRev && rev?.doc?.note ? [rev.doc.note] : form.notice ? [form.notice] : []),
  ]
  // 밀폐구역출입 체크: 2차 값과 1차에서 바뀐 칸
  const checks = { ...form.checks, ...rev?.checks2 }
  const checkChg = (k: keyof ConfinedChecks) => Boolean(highlight && revision?.checks2 && k in revision.checks2 && revision.checks2[k] !== form.checks[k])
  const hazardChg = later ? changed(noticeOf(base, false).join("\n"), noticeOf(later.detail, true).join("\n")) || Boolean(highlight && revision?.doc?.note) : false
  const old = (on: boolean, v: string) => (rev && on ? v : undefined)

  const [from, to] = permit.workTime.includes("–") && /^\d/.test(permit.workTime) ? permit.workTime.split("–") : [null, null]
  const twoCheck = grade ? (grade === "전산허가" ? "N" : "Y") : "미결정"

  return (
    <article style={{ minHeight }} className="mx-auto flex flex-col border border-slate-300 bg-white p-7 text-slate-900 shadow-sm">
      <header className="border-b-2 border-slate-800 pb-4 text-center">
        <div className="text-[13px] font-semibold tracking-[0.24em] text-slate-500">PERMIT TO WORK</div>
        <h2 className="mt-2 text-[25px] font-bold tracking-[-0.03em]">{FORM_TITLE[permit.form] ?? "위험작업 허가서"}</h2>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px] text-slate-600">
          <span>양식 <b className="text-slate-900">{permit.form}</b></span>
          <span>접수 <b className="text-slate-900">11/7 {version === 2 && rev ? "(2차)" : permit.receivedAt}</b></span>
        </div>
      </header>

      <Section n={1} title="작업 신청 정보">
        <div className="grid grid-cols-[110px_1fr_110px_1fr] border-t border-l border-slate-300 [&>*]:border-r [&>*]:border-slate-300">
          <div className={cellK}>승인번호</div>
          <div className={cn(cellV, "font-mono")}>{permit.id}</div>
          <div className={cellK}>허가구분</div>
          <div className={cn(cellV, "font-semibold", grade ? "text-primary" : "text-slate-500")}>{grade ? `[${grade}]` : "검토 중"}</div>

          <div className={cellK}>호선</div>
          <div className={cellV}>{form.hull}</div>
          <div className={cellK}>2중점검 대상</div>
          <div className={cn(cellV, "font-semibold", !grade && "text-slate-500")}>{twoCheck}</div>

          <div className={cellK}>작업장소</div>
          <div className={cn(cellV, "col-span-3", placeChg && CHANGED)}><Was v={old(placeChg, first.place)} />{permit.place}</div>

          <div className={cellK}>작업내용</div>
          <div className={cn(cellV, "col-span-3")}>{permit.task}</div>

          <div className={cellK}>작업부서</div>
          <div className={cellV}>{permit.department}</div>
          <div className={cellK}>작업인원</div>
          <div className={cellV}>{permit.workers}명</div>

          <div className={cellK}>작업책임자</div>
          <div className={cellV}>{detail.applicant}</div>
          <div className={cellK}>관리자</div>
          <div className={cn(cellV, supChg && CHANGED, detail.supervisor === "미지정" && "text-slate-400")}>
            <Was v={old(supChg, base.supervisor)} />
            {detail.supervisor === "미지정" ? "" : detail.supervisor}
          </div>
        </div>
      </Section>

      <Section n={2} title="작업 일시">
        <div className="flex items-start gap-4">
          <div className="flex shrink-0 flex-col gap-2 pt-2 text-[14px]">
            <span className="flex items-center gap-2"><Box on={!form.night} solid />주간</span>
            <span className="flex items-center gap-2"><Box on={Boolean(form.night)} solid />야간</span>
          </div>
          <div className={cn("grid flex-1 grid-cols-3 border-t border-l border-slate-300 text-center text-[15px] [&>*]:border-r [&>*]:border-b [&>*]:border-slate-300 [&>*]:px-3 [&>*]:py-1.5", timeChg && "[&>*:nth-child(n+4)]:bg-[#fff4c2]")}>
            <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">일자</div>
            <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">시작</div>
            <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">종료</div>
            {/* 칸마다 테두리를 그리므로 줄을 감싸는 상자 없이 칸을 바로 넣는다 */}
            {form.days.map((d) => (
              <Fragment key={d}>
                <div className="font-mono">{d}</div>
                {from ? (
                  <>
                    <div className="font-mono">{from}</div>
                    <div className="font-mono">{to}</div>
                  </>
                ) : (
                  <div className="col-span-2">{permit.workTime}</div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
        {timeChg && rev && <div className="mt-1 text-right text-[13px]"><Was v={`1차: ${first.workTime}`} /></div>}
      </Section>

      <Section n={3} title="유해위험요소 / 추가전달사항" sub="작업부서 작성">
        <div className={cn("space-y-1 border border-slate-300 px-3 py-2.5 text-[15px] leading-relaxed", hazardChg && CHANGED)}>
          {rev && hazardChg && (
            <div className="mb-1.5 space-y-0.5 text-[13px]">
              {noticeOf(base, false).map((l) => <del key={l} className="block text-legal">{l}</del>)}
            </div>
          )}
          {noticeOf(detail, Boolean(rev)).map((l) => <div key={l}>{l}</div>)}
        </div>
      </Section>

      <Section n={4} title="추가정보" sub="작업부서 작성">
        <div className="border border-slate-300">
          <div className="flex items-center gap-2 border-b border-slate-300 bg-slate-50 px-3 py-2 text-[15px] font-semibold">
            <Box on={form.confined} solid />밀폐구역출입
          </div>
          <div className="grid grid-cols-3">
            <Tick label="출입현황판 설치" on={form.confined && checks.entryBoard} changed={checkChg("entryBoard")} />
            <Tick label="출입감시자 배치" on={form.confined && checks.watchman} changed={checkChg("watchman")} />
            <Tick label="환기" on={form.confined && checks.ventilation} changed={checkChg("ventilation")} />
            <Tick label="가스측정" on={form.confined && gasOn(detail.gasMeasurement)} changed={gasChg} />
            <Tick label="조명설치" on={form.confined && checks.lighting} changed={checkChg("lighting")} />
          </div>
          {form.extra && (
            <div className="flex flex-wrap border-t border-slate-300">
              {form.extra.map((x) => <Tick key={x} label={x} on />)}
            </div>
          )}
        </div>
      </Section>

      <Section n={5} title="발행">
        <div className="grid grid-cols-[110px_1fr_1fr_1fr] border-t border-l border-slate-300 text-[15px] [&>*]:border-r [&>*]:border-b [&>*]:border-slate-300 [&>*]:px-3 [&>*]:py-2">
          <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">구분</div>
          <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">성명</div>
          <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">일시</div>
          <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">서명</div>
          <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">허가신청</div>
          <div>{detail.applicant}</div>
          <div className="font-mono">11/7 {first.receivedAt}</div>
          <div>{detail.applicant} (전자서명)</div>
          <div className="bg-slate-50 text-[14px] font-semibold text-slate-600">전산승인</div>
          {detail.supervisor === "미지정" ? (
            <div className="col-span-3 text-slate-400">관리자 미지정 — 전산승인 전</div>
          ) : (
            <>
              <div className={cn(supChg && CHANGED)}>{detail.supervisor}</div>
              <div className="font-mono">11/7 {first.receivedAt}</div>
              <div>{detail.supervisor} (전자서명)</div>
            </>
          )}
        </div>
      </Section>

      <Section n={6} title="추가조치 요청사항" sub="안전부서 작성" className="flex flex-1 flex-col">
        <div className="min-h-20 flex-1 border border-slate-300 px-3 py-2.5 text-[15px] leading-relaxed whitespace-pre-line">
          {request ?? ""}
        </div>
      </Section>
    </article>
  )
}

const DOC_W = 860 // 원문을 그리는 실제 폭 (px). 넓게 그려 세로로 덜 길쭉하게(한 장 맞춤 때 더 크게 보이게) 한다
// 배율 숫자는 '한 장 맞춤'을 100%로 놓고 센다 (실제 문서 크기 기준이 아님)
const Z_MIN = 0.3 // 칸이 아주 작을 때 맞춤 배율의 바닥값 (실제 크기 기준)
const Z_MAX = 3, Z_STEP = 0.15 // 맞춤 기준 최대 300% · 한 번에 15%씩

// 허가서 원문 보기: 기본은 칸에 한 장이 통째로 들어오게 '맞춤', [+]/[−]·Ctrl(⌘)+휠로 확대·축소.
// 축소는 처음 보이는 '한 장 맞춤' 크기까지만 (그보다 작게 줄일 이유가 없다)
// resubmittedAt: 보완 후 다시 접수된 시각 (있으면 1차·2차 전환과 '바뀐 곳 표시'가 생긴다)
// grade: 승인한 허가구분 · request: 지금 보완 요청 내용 · firstRequest: 2차 접수 건의 1차 때 보낸 보완 요청
export function PermitDocumentViewer({
  permit,
  resubmittedAt,
  grade,
  request,
  firstRequest,
  decidedAt,
  firstRequestAt,
  onFitWidth,
  fitMode = "page",
}: {
  permit: ReviewPermit
  resubmittedAt?: string
  grade?: PermitGrade
  request?: string
  firstRequest?: string
  /** 지금 결정(승인·보완 요청)한 시각 · 2차 접수 건의 1차 보완 요청 시각 (원문 서명란 '허가' 줄) */
  decidedAt?: string
  firstRequestAt?: string
  /** 칸 높이에 한 장이 꼭 맞는 칸 폭(px). 바깥에서 원문 칸 폭으로 쓴다 */
  onFitWidth?: (w: number) => void
  /** 옆 패널에서는 가로 폭에 맞춰 읽고 세로로 스크롤한다. fill = 칸 폭에 꼭 맞추고 문서 마지막 칸을 늘려 칸 높이도 꼭 채운다 */
  fitMode?: "page" | "width" | "fill"
}) {
  const [version, setVersion] = useState<1 | 2>(resubmittedAt ? 2 : 1)
  const [highlight, setHighlight] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const doc = useRef<HTMLDivElement>(null)
  const nat = useRef<HTMLDivElement>(null) // fill: 늘리지 않은 원래 높이를 재는 숨은 사본
  const [docW, setDocW] = useState(DOC_W)
  const [fit, setFit] = useState(1)
  const [docH, setDocH] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null) // null = 맞춤
  const scale = zoom ?? fit
  // 확대 중에는 스크롤 막대가 생겨 칸이 살짝 좁아지는데, 그때 맞춤 배율을 다시 재면 축소 한계가 내려간다.
  // 그래서 맞춤 배율은 '한 장 맞춤' 상태(스크롤 막대 없음)에서만 잰다.
  const zoomed = useRef(false)
  useLayoutEffect(() => {
    zoomed.current = zoom !== null // 스크롤 막대가 생기기 전에(그리기 직전) 바꿔 둔다
  }, [zoom])

  // 문서 높이는 언제나 잰다 (확대 중에도 자리 크기에 필요). 맞춤 배율만 '한 장 맞춤' 상태에서 잰다.
  const measure = useRef(() => {})
  const onFit = useRef(onFitWidth)
  useLayoutEffect(() => {
    onFit.current = onFitWidth
  })
  useEffect(() => {
    const b = box.current, d = doc.current
    if (!b || !d) return
    measure.current = () => {
      setDocH(d.offsetHeight)
      if (fitMode === "fill") {
        // 상하좌우 여백을 뺀 자리에 원래 문서가 다 들어가는 배율을 고르고,
        // 남는 쪽(가로면 문서 폭, 세로면 마지막 칸)을 늘려 네 변 여백을 똑같이 맞춘다
        const cw = b.clientWidth - FILL_PAD * 2, ch = b.clientHeight - FILL_PAD * 2
        setBoxH(ch)
        const n = nat.current
        if (zoomed.current || !n || !n.offsetHeight) return
        const s = Math.max(Z_MIN, Math.min(cw / DOC_W, ch / n.offsetHeight))
        setFit(s)
        setDocW(cw / s)
        return
      }
      setBoxH(b.clientHeight)
      const padY = 32 // 위아래 여백만 둔다 (양옆은 0 → 문서가 칸 폭에 꼭 맞음)
      const byHeight = (b.clientHeight - padY) / d.offsetHeight
      // 높이에 맞춘 배율로 그린 문서 폭 + 칸 왼쪽 테두리 1px — 원문 칸 폭으로 쓰면 양옆 빈 곳이 없다
      onFit.current?.(Math.ceil(byHeight * d.offsetWidth) + 1)
      if (zoomed.current) return
      setFit(
        Math.max(
          Z_MIN,
          fitMode === "width" ? Math.min(1, (b.clientWidth - 32) / d.offsetWidth) : Math.min(b.clientWidth / d.offsetWidth, byHeight),
        ),
      )
    }
    const ro = new ResizeObserver(() => measure.current())
    ro.observe(b)
    ro.observe(d)
    if (nat.current) ro.observe(nat.current)
    const raf = requestAnimationFrame(() => measure.current())
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [fitMode])
  // '한 장 맞춤'으로 돌아오면 다시 잰다 (확대 중에 창 크기가 바뀌었을 수 있음)
  useEffect(() => {
    if (zoom !== null) return
    const raf = requestAnimationFrame(() => measure.current())
    return () => cancelAnimationFrame(raf)
  }, [zoom])

  useEffect(() => {
    const b = box.current
    if (!b) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => clampZoom((z ?? fit) * Math.exp(-e.deltaY * 0.01), fit))
    }
    b.addEventListener("wheel", onWheel, { passive: false })
    return () => b.removeEventListener("wheel", onWheel)
  }, [fit])

  const sheet = (minHeight?: number) => {
    const { intake, was } = sheetOf(permit, version, Boolean(resubmittedAt) && highlight)
    if (!intake) return <div className="p-6 text-[15px] text-muted-foreground">첨부된 허가서 원문이 없습니다.</div>
    // 서명란·추가조치요청사항에 들어갈 결정: 1차 화면이면 그때 보낸 보완 요청, 아니면 지금 결정
    const note = resubmittedAt && version === 1 ? firstRequest : request
    const decision: Decision | undefined = grade
      ? { status: "승인 완료", grade, at: decidedAt ?? "", note: "" }
      : note
        ? { status: "보완 대기", grade: permit.recommendedGrade, at: (resubmittedAt && version === 1 ? firstRequestAt : decidedAt) ?? "", note }
        : undefined
    return <PermitFormSheet permit={intake} decision={decision} was={was} minHeight={minHeight} />
  }

  const step = (dir: 1 | -1) => setZoom(clampZoom(scale + dir * Z_STEP * fit, fit))
  const btn = "grid size-8 place-items-center border-l text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-5 py-2.5">
        <FileText className="size-4 text-primary" />
        {/* 제목과 문서번호는 글자 바닥선(baseline)을 맞춘다. 글꼴·크기가 달라 상자 가운데로 맞추면 번호가 떠 보인다 */}
        <div className="flex items-baseline gap-2">
          <h3 className="text-[17px] font-semibold">허가서 원문</h3>
          <span className="font-mono text-[14px] text-muted-foreground">{permit.id}</span>
        </div>
        {resubmittedAt && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex h-8 items-center overflow-hidden rounded-full border bg-background text-[13px]">
              {([1, 2] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVersion(v)}
                  className={cn("h-full px-3.5 font-semibold", version === v ? "rounded-full bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
                >
                  {v}차
                </button>
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={highlight}
              onClick={() => setHighlight((h) => !h)}
              className="flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold hover:bg-muted"
            >
              <span className={cn("relative h-3.5 w-6 rounded-full transition-colors", highlight ? "bg-foreground" : "bg-slate-300")}>
                <span className={cn("absolute top-0.5 size-2.5 rounded-full bg-white transition-all", highlight ? "right-0.5" : "left-0.5")} />
              </span>
              바뀐 곳 표시
            </button>
          </div>
        )}
      </div>
      {/* 확대·축소: 제목 줄이 한 줄에 들어가도록 원문 오른쪽 아래에 띄운다 */}
      <div className="absolute right-4 bottom-4 z-10 flex items-center border bg-background shadow-md">
        <button type="button" aria-label="축소" className={cn(btn, "border-l-0")} disabled={zoom === null} onClick={() => step(-1)}>
          <Minus className="size-4" />
        </button>
        <span className="grid h-8 w-14 place-items-center border-l font-mono text-[13px] tabular-nums">{Math.round((scale / fit) * 100)}%</span>
        <button type="button" aria-label="확대" className={btn} disabled={scale >= Z_MAX * fit - 0.005} onClick={() => step(1)}>
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="한 장 맞춤"
          title="한 장 맞춤"
          onClick={() => setZoom(null)}
          className={cn(btn, zoom === null ? "text-foreground" : "text-muted-foreground")}
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
      <div
        ref={box}
        aria-label="허가서 원문 내용"
        tabIndex={0}
        className={cn("min-h-0 flex-1 overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40", fitMode === "fill" ? "p-3" : "py-4", zoom === null && (fitMode === "page" || (fitMode === "fill" && docH * scale <= boxH + 1)) ? "overflow-hidden" : "overflow-auto")}
      >
        {/* 줄인·키운 크기만큼 자리를 잡고, 안에서 원래 크기 문서를 scale로 그린다 */}
        <div className="mx-auto" style={{ width: docW * scale, height: docH * scale }}>
          <div ref={doc} className="origin-top-left" style={{ width: docW, transform: `scale(${scale})` }}>
            {sheet(fitMode === "fill" && boxH && fit ? Math.floor(boxH / fit) : undefined)}
          </div>
        </div>
      </div>
      {fitMode === "fill" && (
        <div aria-hidden className="pointer-events-none h-0 shrink-0 overflow-hidden">
          <div ref={nat} className="invisible" style={{ width: DOC_W }}>
            {sheet()}
          </div>
        </div>
      )}
    </>
  )
}

// fill 모드에서 문서 상하좌우에 두는 여백 (p-3과 같아야 함)
const FILL_PAD = 12

// 맞춤 크기 이하로 내려가면 다시 '맞춤'(null)으로 돌아간다
const clampZoom = (z: number, fit: number) => {
  const v = Math.min(Z_MAX * fit, Math.round(z * 1000) / 1000)
  return v <= fit + 0.005 ? null : v
}
