import { useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { CalendarDays, Check, ChevronLeft, ChevronRight, FileWarning, Printer, Search, X } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useRecords } from "@/lib/records"
import { fmtTime, type Status } from "@/lib/sim"
import { cn } from "@/lib/utils"
import { ME } from "@/pages/prep/model"
import { useKept } from "@/pages/prep/state"
import { CAL_YEAR, DAYS, FIRST_DAY, TODAY, dayIndex, type DayKey } from "@/pages/history/archive"
import { allDays, docsFor, docsForIncident, matches, reportPages, tokensOf, zoneHistories, type IncidentResult, type Rec } from "@/pages/history/days"
import { DayHeader, FitPreview, IncidentDetail, MonthCalendar, Rail, RecDetail, RecRow, ReportSheet, ZoneHistoryCard, type CalDay } from "@/pages/history/ui"
import type { PageProps } from "@/pages/types"

// 안전 일지: 날짜 하나 = 일지 한 장.
// 왼쪽은 그날 기록과 관리자가 적는 조치 결과, 오른쪽은 그날 일일 안전 보고서 미리보기(→ PDF).
// 검색은 날짜와 상관없이 전체 기간에서 찾고, 결과를 누르면 그날 보고서로 바뀐다.
// 오늘은 관제 시뮬레이션, 지난 날은 합성 기록(archive.ts).

// 전날 허가 검토 기록은 일지에 넣지 않는다 (보고서 '전날 확정' 한 줄로 충분, 허가 결정은 허가 검토 탭에서)
const isIncidentRec = (r: Rec) => r.kind === "사건" || r.kind === "조치"
// 빠른 시각부터. 같은 분이면 원인(사건) → 조치 순
const RANK: Record<Rec["kind"], number> = { 사건: 0, 조치: 1, "허가 결정": 2, "측정·작업": 3 }
// 최근 기록이 위로 (실시간으로 쌓이는 로그를 맨 위에서 바로 본다)
const order = (a: Rec, b: Rec) => b.t - a.t || RANK[a.kind] - RANK[b.kind]

const WORK_KEYS = DAYS.filter((d) => !d.off).map((d) => d.key)
const monthOf = (k: DayKey) => Number(k.slice(0, 2))
const FIRST_MONTH = monthOf(FIRST_DAY)
const LAST_MONTH = monthOf(TODAY)

// 인쇄할 때는 앱 화면 대신 그날 보고서 한 장만
const PRINT_CSS = `#history-print { display: none; }
@media print {
  #root { display: none !important; }
  #history-print { display: block !important; }
  /* 보고서 한 장(760×1075px)을 A4 한 쪽에 맞춘다 */
  #history-print .print-page { zoom: 0.94; break-after: page; }
  #history-print .print-page:last-child { break-after: auto; }
  @page { size: A4; margin: 10mm; }
}`

export function HistoryPage({ view, onTodo }: PageProps) {
  const records = useRecords()
  const days = useMemo(() => allDays(view, records), [view, records])
  const byKey = useMemo(() => new Map(days.map((d) => [d.key, d])), [days])

  const [day, setDay] = useKept<DayKey>("history.day", () => TODAY)
  const [query, setQuery] = useKept("history.query", () => "")
  const [results, setResults] = useKept<Record<string, IncidentResult | undefined>>("history.results", () => ({}))
  const [onlyIncidents, setOnlyIncidents] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [calMonth, setCalMonth] = useState(LAST_MONTH)

  const cur = byKey.get(day) ?? byKey.get(TODAY)!
  const tokens = tokensOf(query)
  const searching = tokens.length > 0
  const pool = (searching ? days.flatMap((d) => d.recs).filter((r) => matches(r.hay, tokens)) : cur.recs).filter((r) => !r.prep)
  const shown = onlyIncidents ? pool.filter(isIncidentRec) : pool
  const groups = (searching ? days : [cur])
    .filter((d) => !d.off)
    .map((d) => {
      const recs = shown.filter((r) => r.day === d.key)
      return { d, recs: recs.sort(order) }
    })
    .filter((g) => g.recs.length > 0)
    .reverse() // 여러 날 검색 결과도 최근 날부터

  // 구역 이력: 고른 날까지의 7일
  const end = Math.max(6, dayIndex(cur.key))
  const windowDefs = DAYS.slice(end - 6, end + 1)
  const histories = searching ? zoneHistories(windowDefs.map((d) => byKey.get(d.key)!), tokens) : []

  const goDay = (k: DayKey) => {
    setDay(k)
    setPage(0)
    setOpenKey(null)
  }
  const stepDay = (dir: -1 | 1) => goDay(WORK_KEYS[WORK_KEYS.indexOf(cur.key) + dir] ?? cur.key)
  const toggle = (r: Rec) => {
    if (openKey === r.key) return setOpenKey(null)
    setOpenKey(r.key)
    if (r.day !== cur.key) {
      setDay(r.day) // 검색 결과를 누르면 오른쪽 보고서도 그날로
      setPage(0)
    }
  }
  const missing = cur.incidents.filter((i) => !(results[i.id] ?? i.result))
  const left = missing.length
  // 결과가 다 적히지 않은 보고서는 출력하지 않는다
  const [blocked, setBlocked] = useState(false)
  const print = () => (left ? setBlocked(true) : window.print())
  // 사건이 많아 보고서가 여러 쪽이면 미리보기에서 쪽을 넘긴다
  const pages = cur.off ? 0 : reportPages(cur)
  const [pageState, setPage] = useState(0)
  const page = Math.min(pageState, Math.max(0, pages - 1))
  const save = (id: string, r: Pick<IncidentResult, "outcome" | "memo">) => setResults({ ...results, [id]: { ...r, at: fmtTime(view.t), by: ME } })
  const openDoc = (d: { title: string }) => onTodo(`${d.title} 원문 보기`)

  const calDays = useMemo(
    () =>
      new Map<DayKey, CalDay>(
        days.map((d) => [
          d.key,
          { key: d.key, off: d.off, marks: [d.nums.legal && "legal", d.nums.missing && "missing", d.nums.warn && "warn"].filter(Boolean) as Status[] },
        ]),
      ),
    [days],
  )

  const detail = (r: Rec) => {
    const d = byKey.get(r.day)!
    const inc = d.incidents.find((i) => i.zoneId === r.zoneId)
    return inc ? (
      <IncidentDetail inc={inc} label={d.label} docs={docsForIncident(inc, d)} onDoc={openDoc} />
    ) : (
      <RecDetail rec={r} docs={docsFor([d]).filter((x) => x.kind === "허가서" && x.title.includes(r.title))} onDoc={openDoc} />
    )
  }

  return (
    <main className="safety-log flex min-h-0 flex-1 flex-col overflow-y-auto bg-card xl:overflow-hidden">
      <style>{PRINT_CSS}</style>

      {/* 왼쪽 칸(날짜·검색 줄 + 기록) | 오른쪽 칸(보고서 미리보기, 위 끝까지) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_clamp(520px,calc(var(--app-w,100vw)*0.38),720px)]">
      <div className="flex min-h-0 flex-col">
      {/* 날짜·검색 줄: 보통 테두리 · 높이 h-11. 이 화면은 검색이 주라 검색창은 줄 끝까지 */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b px-5 py-3">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="size-11" aria-label="전날" disabled={WORK_KEYS.indexOf(cur.key) <= 0} onClick={() => stepDay(-1)}>
            <ChevronLeft />
          </Button>
          <Popover
            open={calOpen}
            onOpenChange={(o) => {
              setCalOpen(o)
              if (o) setCalMonth(monthOf(cur.key))
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-11 min-w-[148px] cursor-pointer items-center justify-center gap-2 rounded-md border-[1.5px] border-primary bg-card px-4 text-[17px] font-semibold shadow-xs transition-colors hover:bg-muted/60",
                  calOpen && "bg-muted",
                )}
              >
                <CalendarDays className="size-4.5 text-muted-foreground" />
                {cur.label}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[360px] gap-3 p-3">
              <MonthCalendar
                year={CAL_YEAR}
                month={calMonth}
                days={calDays}
                today={TODAY}
                isSelected={(k) => k === cur.key}
                isInRange={() => false}
                onPick={(k) => {
                  goDay(k)
                  setCalOpen(false)
                }}
                onMonth={(dir) => setCalMonth(calMonth + dir)}
                canPrev={calMonth > FIRST_MONTH}
                canNext={calMonth < LAST_MONTH}
              />
              <p className="border-t pt-2.5 text-[13px] text-muted-foreground">기록은 {DAYS[0].label}부터 있습니다 · 점은 법정 초과·센서 결측·경고가 있던 날</p>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" className="size-11" aria-label="다음 날" disabled={WORK_KEYS.indexOf(cur.key) >= WORK_KEYS.length - 1} onClick={() => stepDay(1)}>
            <ChevronRight />
          </Button>
          <Button variant="outline" className="h-11 px-4 text-[15px]" disabled={cur.key === TODAY} onClick={() => goDay(TODAY)}>
            오늘
          </Button>
        </div>
        <label className="flex h-11 min-w-[300px] flex-1 items-stretch overflow-hidden rounded-md border-[1.5px] border-primary bg-card shadow-xs transition-shadow focus-within:ring-3 focus-within:ring-primary/20">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpenKey(null)
            }}
            placeholder="전체 기간에서 찾기 · 허가번호 · 구역 · 작업명 · 가스"
            style={{ outline: "none" }} // 포커스 표시는 검색창 바깥 테두리(ring)로 대신한다
            className="min-w-0 flex-1 bg-transparent px-4 text-[16px] placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => {
                setQuery("")
                setOpenKey(null)
              }}
              className="cursor-pointer px-3 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4.5" />
            </button>
          )}
          {/* 검색 단추 자리 (입력하는 대로 찾으므로 누를 필요는 없다) */}
          <span className="grid w-12 shrink-0 place-items-center bg-primary text-primary-foreground" aria-hidden>
            <Search className="size-5" strokeWidth={2.25} />
          </span>
        </label>
      </header>

        <section className="min-h-0 flex-1 px-5 pt-4 pb-10 xl:overflow-y-auto">
          {searching && (
            <>
              {histories.map((h) => (
                <ZoneHistoryCard key={h.zoneId} h={h} days={windowDefs} />
              ))}
              <p className="mb-3 text-[15px] text-muted-foreground">
                전체 기간 검색 결과 <b className="font-semibold text-foreground">{pool.length}건</b> · 기록을 누르면 그날 보고서가 오른쪽에 보입니다
              </p>
            </>
          )}

          <div className="flex items-center">
            <button type="button" onClick={() => setOnlyIncidents(!onlyIncidents)} className="flex cursor-pointer items-center gap-2 text-[16px] font-medium">
              <span className={cn("grid size-4.5 place-items-center border-[1.5px] border-foreground", onlyIncidents && "bg-foreground text-background")}>
                {onlyIncidents && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              사건·조치만 보기
              <span className="font-mono text-[14px] text-muted-foreground tabular-nums">{pool.filter(isIncidentRec).length}</span>
            </button>
            {/* 날짜는 위 날짜 칸에 있으므로 목록 위에 다시 쓰지 않는다. 오늘이면 실시간 표시만 */}
            {!searching && cur.live && <span className="ml-auto text-[14px] font-medium text-ok">● 실시간</span>}
          </div>

          {groups.map(({ d, recs }) => (
            <div key={d.key} className={searching ? undefined : "mt-3 border-t pt-1"}>
              {/* 여러 날을 한꺼번에 보는 검색 결과일 때만 날짜 머리 */}
              {searching && <DayHeader label={d.label} live={d.live} />}
              <Rail>
                {recs.map((r) => (
                  <RecRow key={r.key} rec={r} tokens={tokens} open={openKey === r.key} onClick={() => toggle(r)}>
                    {openKey === r.key && detail(r)}
                  </RecRow>
                ))}
              </Rail>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="mt-6 border px-6 py-10 text-center text-[16px] text-muted-foreground">
              {!searching && cur.off ? "휴무일이라 기록이 없습니다." : "조건에 맞는 기록이 없습니다."}
            </p>
          )}
        </section>
      </div>

        {/* 오른쪽은 보고서 한 장. 결과는 보고서의 '결과' 칸을 눌러 그 자리에서 적는다 (보이는 그대로 출력) */}
        <aside className="flex min-h-[720px] flex-col border-t bg-muted/50 xl:min-h-0 xl:border-t-0 xl:border-l">
          <div className="flex items-center gap-3 px-5 pt-4 pb-1">
            <h2 className="text-[22px] font-semibold">보고서 미리보기</h2>
            {!cur.off && cur.incidents.length > 0 && (
              <span className={cn("text-[16px]", left ? "font-medium text-warn-ink" : "text-ok")}>{left ? `결과 미입력 ${left}건` : "결과 모두 입력됨"}</span>
            )}
            {pages > 1 && (
              <span className="ml-auto flex items-center gap-1 text-[15px]">
                <Button variant="ghost" size="icon" className="size-8" aria-label="이전 쪽" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft />
                </Button>
                <span className="font-mono tabular-nums">
                  {page + 1} / {pages}
                </span>
                <Button variant="ghost" size="icon" className="size-8" aria-label="다음 쪽" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                  <ChevronRight />
                </Button>
              </span>
            )}
            <Button variant="outline" className={cn("h-9 px-3.5 text-[15px]", pages > 1 ? "ml-2" : "ml-auto")} disabled={cur.off} onClick={print}>
              <Printer /> PDF로 출력
            </Button>
          </div>
          {cur.off ? (
            <p className="m-5 border bg-card px-6 py-10 text-center text-[16px] text-muted-foreground">휴무일이라 보고서가 없습니다.</p>
          ) : (
            <FitPreview>
              <ReportSheet d={cur} results={results} onSave={save} page={page} />
            </FitPreview>
          )}
        </aside>
      </div>

      <AlertDialog open={blocked} onOpenChange={setBlocked}>
        <AlertDialogContent className="w-auto max-w-none gap-4 p-5 data-[size=default]:max-w-none data-[size=default]:sm:max-w-none" aria-describedby={undefined}>
          <div className="flex items-start gap-2.5">
            <FileWarning className="mt-0.5 size-5 shrink-0 text-warn" />
            <AlertDialogTitle className="text-[17px] leading-snug font-semibold whitespace-nowrap">조치 결과를 모두 입력하지 않아 출력할 수 없습니다</AlertDialogTitle>
          </div>
          <div className="flex justify-end">
            <AlertDialogAction className="h-9 px-5 text-[15px]">확인</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {createPortal(<div id="history-print">{Array.from({ length: pages }, (_, i) => (
            <ReportSheet key={i} d={cur} results={results} page={i} className="print-page" />
          ))}</div>, document.body)}
    </main>
  )
}
