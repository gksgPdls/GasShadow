import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { Decision } from "@/pages/review/data"
import { EXTRA_INFO, FORM_SHEETS } from "@/pages/review/ai/forms"
import type { AiResult, FindingKind, IntakePermit } from "@/pages/review/ai/types"

// 허가서 원문: 위험작업허가서 양식 예시, 값은 합성.
// AI 검토가 끝난 뒤에는 걸린 칸에 검토 표시를 붙인다.

/** 원문 한 장의 본래 폭 */
const DOC_W = 820
const PAD = 16

/**
 * 허가서 한 장을 창 높이에 맞춰 줄여서 끌지 않고 한눈에 보이게 한다.
 * 줄인 폭을 onWidth로 알려 창 폭도 문서에 딱 맞춘다 (양옆 여백 없음).
 */
function FitDoc({ children, onWidth }: { children: ReactNode; onWidth: (w: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const doc = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [left, setLeft] = useState(PAD)
  useLayoutEffect(() => {
    const b = box.current
    const d = doc.current
    if (!b || !d) return
    const fit = () => {
      const s = Math.min(1, (b.clientHeight - PAD * 2) / d.offsetHeight)
      setScale(s)
      setLeft(Math.max(PAD, (b.clientWidth - DOC_W * s) / 2)) // 창이 최소 폭보다 좁아지지 않을 때는 가운데
      onWidth(Math.ceil(DOC_W * s) + PAD * 2)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(b)
    ro.observe(d)
    return () => ro.disconnect()
  }, [onWidth])
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={doc} className="absolute origin-top-left" style={{ top: PAD, left, width: DOC_W, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}

function Box({ checked, tone }: { checked: boolean; tone?: "warn" }) {
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center border",
        checked ? "border-slate-700 bg-slate-800 text-white" : tone === "warn" ? "border-warn bg-warn-soft" : "border-slate-400 bg-card",
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  )
}

function AiMark({ title }: { title: string }) {
  return (
    <span title={title} className="ml-3 shrink-0 border border-warn/60 bg-card px-1.5 py-px font-sans text-[12px] font-semibold text-warn-ink">
      검토: {title}
    </span>
  )
}

function Row({ label, en, children, mark, danger, was }: { label: string; en: string; children: ReactNode; mark?: string; danger?: boolean; was?: string }) {
  return (
    <div className={cn("grid min-h-10 grid-cols-[150px_1fr] border-b border-slate-300", mark && "bg-warn-soft/40", was !== undefined && "bg-yellow-100/70")}>
      <div className="flex flex-col justify-center border-r border-slate-300 bg-slate-50 px-3 py-1.5">
        <span className="text-[14px] font-semibold text-slate-700">{label}</span>
        <span className="text-[10px] tracking-wide text-slate-400">{en}</span>
      </div>
      <div className={cn("flex flex-wrap items-center px-3 py-1.5 text-[15px]", danger && "font-semibold text-legal")}>
        {was && <del className="mr-2 font-normal text-legal">{was}</del>}
        {children}
        {mark && <AiMark title={mark} />}
      </div>
    </div>
  )
}

function SectionTitle({ children, by }: { children: ReactNode; by: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-300 bg-slate-100 px-3 py-1.5 text-[14px] font-bold text-slate-800">
      {children}
      <span className="font-normal text-slate-500">[{by}]</span>
    </div>
  )
}

/** 2차 접수에서 바뀐 칸의 1차 값 (바뀐 곳 표시용) */
export type SheetWas = Partial<Record<"place" | "workTime" | "tools" | "hazards" | "supervisor" | "form" | "note", string>> & {
  /** 2차에서 새로 체크한 추가정보 칸(라벨) */
  checked?: string[]
}

/**
 * 허가서 원문 한 장 (위험작업허가서 양식 예시). 접수함 팝업과 검토 화면 원문 칸이 같이 쓴다.
 * minHeight를 주면 마지막 칸(추가조치요청사항)을 늘려 그 높이를 꽉 채운다.
 */
export function PermitFormSheet({ permit, result, decision, minHeight, was }: { permit: IntakePermit; result?: AiResult; decision?: Decision; minHeight?: number; was?: SheetWas }) {
  const sheet = FORM_SHEETS[permit.form]
  const markOf = (...kinds: FindingKind[]) => result?.findings.find((f) => kinds.includes(f.kind))?.title
  const [start, end] = permit.workTime.split("–")
  const night = end !== undefined && Number(start.slice(0, 2)) >= 17
  const gasMissing = permit.extras.includes("밀폐구역출입") && !permit.extras.includes("가스측정")
  const supervisor = permit.supervisor ?? (permit.channel === "수기" ? "미지정" : "이OO 직장")
  return (
    <article style={{ minHeight }} className="flex flex-col border border-slate-400 bg-card text-slate-900 shadow-sm">
      {/* 머리: 양식 제목 + 승인번호 */}
      <header className="grid grid-cols-[1fr_300px] border-b-2 border-slate-800">
        <div className={cn("flex flex-col items-center justify-center border-r border-slate-300 px-4 py-5 text-center", was?.form && "bg-yellow-100/70")}>
          {was?.form && <del className="mb-0.5 text-[14px] text-legal">{was.form}</del>}
          <h2 className="text-[26px] font-bold tracking-[-0.03em]">{sheet.title}</h2>
          <div className="mt-1 text-[12px] font-semibold tracking-[0.18em] text-slate-500">{sheet.en}</div>
        </div>
        <dl className="grid grid-cols-[128px_1fr] text-[14px]">
          {[
            ["승인번호", "PERMIT NO.", permit.id],
            ["공사/호선명", "PROJECT", ""],
            ["표준작업지도서", "JSP NO.", permit.jsp ?? ""],
          ].map(([k, en, v]) => (
            <div key={k} className="contents">
              <dt className="flex flex-col justify-center border-b border-r border-slate-300 bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-700">
                {k}
                <span className="text-[10px] font-normal tracking-wide text-slate-400">{en}</span>
              </dt>
              <dd className="flex items-center border-b border-slate-300 px-2.5 font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <Row label="작업장소" en="LOCATION" mark={!permit.block ? markOf("기재 누락") : undefined} was={was?.place}>
        {permit.place}
      </Row>
      <Row label="작업 일시" en="WORK DATE/TIME" mark={markOf("작업 간 충돌")} was={was?.workTime}>
        <span className="flex items-center gap-1.5">
          <Box checked={!night} /> 주간
        </span>
        <span className="ml-3 flex items-center gap-1.5">
          <Box checked={night} /> 야간
        </span>
        <span className="ml-5 font-mono">
          {permit.workDate} · {end === undefined ? <span className="font-sans">{start}</span> : `${start} ~ ${end}`}
        </span>
      </Row>
      <Row label="작업내용" en="TASK DESCRIPTION">
        {permit.task}
      </Row>
      <Row label="공구/기기" en="TOOLS/EQUIPMENT" mark={markOf("과소 신청 의심")} danger={permit.tools.length === 0} was={was?.tools}>
        {permit.tools.length ? permit.tools.join(", ") : "미기재"}
      </Row>
      <Row label="작업부서" en="DEPARTMENT">
        {permit.department}
      </Row>
      <Row label="작업책임자[정]" en="SUPERVISOR">
        김OO 반장
      </Row>
      <Row label="관리감독자" en="MANAGER" danger={supervisor === "미지정"} was={was?.supervisor}>
        {supervisor}
      </Row>
      <Row label="작업인원" en="NO. OF WORKER">
        {permit.workers}명
      </Row>
      <Row label="유해위험요소" en="HAZARDS" danger={permit.hazards.length === 0} mark={permit.hazards.length === 0 ? markOf("기재 누락") : undefined} was={was?.hazards}>
        {permit.hazards.length ? permit.hazards.join(", ") : "미기재"}
      </Row>
      {permit.revisionNote && (
        <Row label="보완 내용" en="REVISION" was={was?.note}>
          {permit.revisionNote}
        </Row>
      )}

      {/* 현장 확인점검사항: 작업 당일 체크하는 칸이라 전날 검토 시점에는 비어 있다 */}
      <SectionTitle by="작업부서 작성">
        현장 확인점검사항 <span className="font-normal text-slate-500">SITE SAFETY CHECKLIST</span>
      </SectionTitle>
      <div className="grid grid-cols-2 border-b border-slate-300 px-3 py-2 text-[14px]">
        {sheet.checklist.map((item) => (
          <div key={item} className="flex items-center gap-2 py-1">
            <Box checked={false} />
            {item}
          </div>
        ))}
        <div className="col-span-2 pt-1 text-[12px] text-slate-500">※ 작업 당일 작업 시작 전 체크 (대면접수 시 작성 금지)</div>
      </div>

      <SectionTitle by="작업부서 작성">
        추가정보 <span className="font-normal text-slate-500">WORK RELATED INFORMATION</span>
      </SectionTitle>
      <div className={cn("grid grid-cols-3 border-b border-slate-300 px-3 py-2 text-[14px]", gasMissing && result && "bg-warn-soft/30")}>
        {EXTRA_INFO.map((col, i) => (
          <div key={i}>
            {col.map((item) => {
              const checked = (item.extra ? permit.extras.includes(item.extra) : false) || Boolean(permit.checkedLabels?.includes(item.label))
              const flag = item.extra === "가스측정" && gasMissing && Boolean(result)
              const changed = was?.checked?.includes(item.label)
              return (
                <div key={item.label} className={cn("flex items-center gap-2 py-1", flag && "font-semibold text-warn-ink", changed && "-mx-1.5 mr-3 bg-yellow-100/70 px-1.5 font-semibold")}>
                  <Box checked={checked} tone={flag ? "warn" : undefined} />
                  {item.label}
                  {flag && markOf("체크 항목 모순") && <AiMark title="밀폐 출입인데 미체크" />}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <SectionTitle by="안전부 작성">
        작업승인 전 추가조치요청사항 <span className="font-normal text-slate-500">ADDITIONAL CONTROLS REQUIRED</span>
      </SectionTitle>
      <div className="min-h-14 flex-1 border-b border-slate-300 px-3 py-2 text-[14px] leading-relaxed">
        <div>- 표준작업 준수</div>
        {decision?.status === "보완 대기" && <div className="whitespace-pre-line text-legal">- {decision.note}</div>}
      </div>

      {/* 서명란 */}
      <div className="grid grid-cols-[110px_1fr_1fr_1fr] text-[14px]">
        {[
          ["발행", "허가신청자", "김OO 반장", `11/7 ${permit.receivedAt.slice(0, 5)}`],
          [
            "허가",
            "허가자/대면접수자",
            decision?.status === "승인 완료" ? `안전과 · ${decision.grade}` : decision ? "보완 요청" : "검토 중",
            decision ? `11/7 ${decision.at}` : "",
          ],
          ["작업완료", "작업책임자", "", ""],
        ].map(([phase, who, sign, at]) => (
          <div key={phase} className="contents">
            <div className="flex items-center justify-center border-r border-b border-slate-300 bg-slate-50 py-2.5 font-semibold text-slate-700">{phase}</div>
            <div className="flex items-center border-r border-b border-slate-300 px-3 text-slate-600">{who}</div>
            <div className={cn("flex items-center border-r border-b border-slate-300 px-3 font-semibold", sign === "검토 중" && "text-primary")}>{sign}</div>
            <div className="flex items-center border-b border-slate-300 px-3 font-mono text-slate-600">{at}</div>
          </div>
        ))}
      </div>
      <footer className="space-y-0.5 px-3 py-2.5 text-[12px] text-slate-500">
        <div>＊작업에 대한 안전규정 및 안전조치사항을 준수하여 작업을 하겠습니다.</div>
        <div>＊작업 종료 후 잔존위험을 확인하고 점검하였습니다.</div>
      </footer>
    </article>
  )
}

export function PermitFormDialog({
  permit,
  result,
  decision,
  open,
  onOpenChange,
  position,
  total,
  onPrevious,
  onNext,
}: {
  permit: IntakePermit
  /** AI 검토 결과 (검토 전이면 없음) */
  result?: AiResult
  decision?: Decision
  open: boolean
  onOpenChange: (open: boolean) => void
  position: number
  total: number
  onPrevious: () => void
  onNext: () => void
}) {
  // 창 폭 = 줄인 문서 폭 + 여백 (FitDoc이 잰다)
  const [width, setWidth] = useState(DOC_W + PAD * 2)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="permit-review max-w-none! gap-0 overflow-hidden bg-muted p-0" style={{ width: Math.max(width, 560) }} aria-describedby={undefined} showCloseButton>
        <SheetHeader className="shrink-0 border-b bg-card px-6 py-4 pr-14">
          <div className="text-[12px] font-semibold text-primary">
            {permit.channel === "수기" ? "수기 접수 · 스캔본" : "전산 접수"} · 11/7 {permit.receivedAt.slice(0, 5)}
          </div>
          <SheetTitle className="text-[20px]">
            {permit.id} · {permit.task}
          </SheetTitle>
          <div className="flex items-center gap-2 pt-2 text-[13px]">
            <button type="button" onClick={onPrevious} disabled={position <= 1} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 disabled:opacity-40"><ChevronLeft className="size-4" />이전 허가서</button>
            <span className="min-w-12 text-center font-mono text-muted-foreground">{position} / {total}</span>
            <button type="button" onClick={onNext} disabled={position >= total} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 disabled:opacity-40">다음 허가서<ChevronRight className="size-4" /></button>
          </div>
        </SheetHeader>

        <FitDoc onWidth={setWidth}>
          <PermitFormSheet permit={permit} result={result} decision={decision} />
        </FitDoc>
      </SheetContent>
    </Sheet>
  )
}
