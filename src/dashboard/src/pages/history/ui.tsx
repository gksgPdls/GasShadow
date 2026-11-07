import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, PenLine, Scale, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { LIMITS, SITE, blockName } from "@/data/scenario"
import { STATUS, fmtTime, gasLabel, type Status } from "@/lib/sim"
import { statusBg, statusText } from "@/lib/status-classes"
import { cn } from "@/lib/utils"
import type { DayDef, DayKey } from "@/pages/history/archive"
import { FIRST_SLOTS, NEXT_SLOTS, OUTCOMES, actionsOf, reportPages, type DayData, type DayIncident, type DocItem, type GasTrace, type IncidentResult, type Outcome, type Rec, type TagTone, type ZoneHistory } from "@/pages/history/days"
import { ADVICE, zoneDef } from "@/pages/history/model"

// ---------- 공통 ----------

// 태그 색: 상태 색은 상태를 말할 때만. 사람이 한 조치 = 진한 회색 · 보완 요청 = 회색 · 그 밖 = 옅은 회색
const TAG: Record<TagTone, string> = {
  legal: "bg-legal-soft text-legal",
  unauth: "bg-unauth-soft text-unauth",
  missing: "bg-missing-soft text-missing",
  warn: "bg-warn-soft text-warn-ink",
  ok: "bg-ok-soft text-ok",
  idle: "bg-muted text-muted-foreground",
  act: "bg-slate-700 text-white",
  wait: "bg-slate-200 text-slate-700",
  plain: "bg-muted text-muted-foreground",
}

export function Tag({ tone, children, className }: { tone: TagTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-block rounded-md px-2 py-0.5 text-[13px] leading-5 font-semibold whitespace-nowrap", TAG[tone], className)}>{children}</span>
}

/** 검색어와 맞는 글자에 노란 표시 */
export function Hl({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length) return <>{text}</>
  // 공백·아래첨자를 무시하고 찾기 위해 글자마다 원래 위치를 기억한다
  const map: number[] = []
  let flat = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/\s/.test(c)) continue
    flat += c === "₂" ? "2" : c.toLowerCase()
    map.push(i)
  }
  const marks = new Array(text.length).fill(false)
  tokens.forEach((tk) => {
    let from = 0
    for (;;) {
      const at = flat.indexOf(tk, from)
      if (at < 0) break
      for (let i = map[at]; i <= map[at + tk.length - 1]; i++) marks[i] = true
      from = at + tk.length
    }
  })
  const out: ReactNode[] = []
  let i = 0
  while (i < text.length) {
    const on = marks[i]
    let j = i
    while (j < text.length && marks[j] === on) j++
    const part = text.slice(i, j)
    out.push(on ? <mark key={i} className="rounded-sm bg-yellow-200/80 px-px text-inherit">{part}</mark> : part)
    i = j
  }
  return <>{out}</>
}

// ---------- 기록 목록 ----------

/** 접힌 줄에는 첫 문장만 (뒤 보충 설명·괄호 표기는 펼쳤을 때) */
const brief = (text: string) => text.split(/(?<=[.다])\s+/)[0].replace(/\s*\((규칙층|모델)\)$/, "").replace(/\.$/, "")

// 노선도 정거장 점: 상황은 상태 색으로 채우고, 사람이 한 조치는 진한 회색, 그 밖은 빈 원
const NODE: Record<TagTone, string> = {
  legal: "bg-legal border-legal",
  unauth: "bg-unauth border-unauth",
  missing: "bg-missing border-missing",
  warn: "bg-warn border-warn",
  ok: "bg-ok border-ok",
  idle: "bg-card border-muted-foreground",
  act: "bg-slate-700 border-slate-700",
  wait: "bg-card border-slate-500",
  plain: "bg-card border-muted-foreground",
}

/** 노선도 한 정거장: 시각 | 세로선 위 점 + 짧은 가지 | 내용. 누르면 아래로 상세가 펼쳐진다 */
export function RecRow({ rec, tokens, open, onClick, children }: { rec: Rec; tokens: string[]; open: boolean; onClick: () => void; children?: ReactNode }) {
  const big = rec.kind === "사건" || rec.kind === "조치"
  return (
    <li className="grid grid-cols-[64px_36px_minmax(0,1fr)]">
      <span className="pt-2 font-mono text-[14px] leading-6 text-muted-foreground tabular-nums">{fmtTime(rec.t)}</span>
      <span className="relative">
        <span className={cn("absolute rounded-full border-2 ring-4 ring-card", big ? "top-[15px] left-[5px] size-3.5" : "top-[16px] left-[6px] size-3", NODE[rec.tone])} />
        <span className="absolute top-[21px] left-[19px] h-0.5 w-[17px] bg-muted-foreground/55" />
      </span>
      <div className={cn("mb-1 min-w-0 rounded-md transition-colors", open ? "bg-muted/60" : "hover:bg-muted/50")}>
        <button type="button" onClick={onClick} aria-expanded={open} className="flex w-full cursor-pointer items-baseline gap-2.5 px-3 py-2 text-left">
          {/* 태그 칸 폭을 고정해 본문 시작 위치를 줄마다·펼친 내용과 맞춘다 */}
          <span className="w-[100px] shrink-0">
            <Tag tone={rec.tone} className="text-[13px] leading-5">
              {rec.tag}
            </Tag>
          </span>
          <span className={cn("min-w-0 flex-1 text-[16px] leading-6", !open && "truncate")}>
            <b className="font-semibold">
              <Hl text={rec.title} tokens={tokens} />
            </b>
            <span className="text-muted-foreground"> · </span>
            <Hl text={open ? rec.text : brief(rec.text)} tokens={tokens} />
          </span>
          {open ? <ChevronUp className="size-4 shrink-0 self-center text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 self-center text-muted-foreground" />}
        </button>
        {open && children && <div className="pr-3 pb-3 pl-[122px]">{children}</div>}
      </div>
    </li>
  )
}

/** 하루치 정거장 묶음: 왼쪽에 세로선 하나 */
export function Rail({ children }: { children: ReactNode }) {
  return <ul className="relative pt-2 before:absolute before:top-0 before:bottom-0 before:left-[75px] before:w-0.5 before:bg-muted-foreground/55">{children}</ul>
}

export function DayHeader({ label, summary, live }: { label: string; summary?: string; live?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-b-2 border-foreground pt-5 pb-1.5">
      <h3 className="text-[18px] font-semibold">{label}</h3>
      {summary && <span className="text-[14px] text-muted-foreground">{summary}</span>}
      {live && <span className="ml-auto text-[14px] font-medium text-ok">실시간</span>}
    </div>
  )
}

const DOC_ICON = { 허가서: FileText, "보완 요청": FileText, 법령: Scale, "사내 세칙": Scale }

export function DocRow({ doc, tokens, onOpen }: { doc: DocItem; tokens: string[]; onOpen: () => void }) {
  const Icon = DOC_ICON[doc.kind]
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 border-b px-2 py-3 text-left hover:bg-muted/50">
        <Icon className="mt-0.5 size-4.5 text-muted-foreground" />
        <span className="min-w-0">
          <b className="block text-[16px] leading-snug font-semibold">
            <Hl text={doc.title} tokens={tokens} />
          </b>
          <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">
            <Hl text={doc.sub} tokens={tokens} />
          </span>
        </span>
        <span className="pt-0.5 text-[14px] text-muted-foreground">
          {doc.kind}
          {doc.day && ` · ${doc.day}`}
        </span>
      </button>
    </li>
  )
}

// ---------- 구역 이력 ----------

export function ZoneHistoryCard({ h, days }: { h: ZoneHistory; days: DayDef[] }) {
  return (
    <section className="mb-4 border">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
        <h3 className="text-[18px] font-semibold">{h.name}</h3>
        <span className="text-[15px] text-muted-foreground">{blockName(h.block)} · 구역 이력</span>
      </header>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inc = h.byDay[d.key]
          return (
            <div key={d.key} className={cn("min-h-[58px] px-3 py-2 text-[14px]", i > 0 && "border-l", d.off && "bg-muted/60")}>
              <div className="font-medium text-muted-foreground">{d.short}</div>
              {d.off ? (
                <span className="text-[13px] text-muted-foreground">휴무</span>
              ) : inc ? (
                <Tag tone={inc.worst} className="mt-0.5">
                  {STATUS[inc.worst].label === "법정 초과" ? "법정" : inc.worst === "warn" ? "경고" : STATUS[inc.worst].label}
                  {inc.trace ? ` ${gasLabel(inc.trace.gas)}` : ""}
                </Tag>
              ) : (
                <span className="text-[13px] text-muted-foreground">—</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-start gap-2.5 border-t border-primary/20 bg-accent/60 px-4 py-3 text-[15px] leading-relaxed text-primary">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span>{h.summary}</span>
      </div>
    </section>
  )
}

// ---------- 가스 그래프 ----------

export function GasChart({ trace, tone, since }: { trace: GasTrace; tone: Status; since: number | null }) {
  const L = LIMITS[trace.gas]
  const W = 520
  const H = 180
  const pl = 40
  const pr = 66
  const pt = 14
  const pb = 26
  const ts = trace.points.map((p) => p[0])
  const vs = trace.points.map((p) => p[1])
  const t0 = Math.min(...ts)
  const t1 = Math.max(...ts, t0 + 1)
  const lines = [
    L.legal !== undefined && { v: L.legal, label: `법정 ${L.legal}`, cls: "text-legal" },
    L.warn !== undefined && { v: L.warn, label: `경계 ${L.warn}`, cls: "text-warn" },
    L.legalLow !== undefined && { v: L.legalLow, label: `법정 ${L.legalLow}`, cls: "text-legal" },
    L.warnLow !== undefined && { v: L.warnLow, label: `경계 ${L.warnLow}`, cls: "text-warn" },
  ].filter(Boolean) as { v: number; label: string; cls: string }[]
  const vmax = Math.max(...vs, ...lines.map((l) => l.v)) * 1.12 || 1
  const vmin = trace.gas === "O2" ? Math.min(...vs, ...lines.map((l) => l.v)) * 0.96 : 0
  const x = (t: number) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr)
  const y = (v: number) => pt + (1 - (v - vmin) / (vmax - vmin)) * (H - pt - pb)
  const path = trace.points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const ticks = [...new Set([t0, since ?? t0, t1].map((t) => Math.round(t)))].filter((t, i, a) => i === 0 || t - a[i - 1] >= 12)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full border bg-card" role="img" aria-label={`${gasLabel(trace.gas)} 변화`}>
      <text x={6} y={14} className="fill-muted-foreground text-[11px]">
        {gasLabel(trace.gas)} ({L.unit})
      </text>
      {lines.map((l) => (
        <g key={l.label} className={l.cls}>
          <line x1={pl} x2={W - pr} y1={y(l.v)} y2={y(l.v)} stroke="currentColor" strokeDasharray="5 4" strokeWidth={1.2} />
          <text x={W - pr + 6} y={y(l.v) + 4} fill="currentColor" className="text-[11px] font-semibold">
            {l.label}
          </text>
        </g>
      ))}
      {since !== null && since >= t0 && <line x1={x(since)} x2={x(since)} y1={pt} y2={H - pb} stroke="currentColor" className="text-border" strokeWidth={1} />}
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" className={statusText[tone]} />
      <line x1={pl} x2={W - pr} y1={H - pb} y2={H - pb} stroke="currentColor" className="text-border" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fill-muted-foreground font-mono text-[11px]">
          {fmtTime(t)}
        </text>
      ))}
    </svg>
  )
}

// ---------- 펼친 상세 (목록 안) ----------

function Docs({ docs, onOpen }: { docs: DocItem[]; onOpen: (d: DocItem) => void }) {
  if (!docs.length) return null
  return (
    <section>
      <h4 className="mb-1 text-[15px] font-semibold">관련 문서</h4>
      <ul className="border-t bg-card">
        {docs.map((d) => (
          <DocRow key={d.key} doc={d} tokens={[]} onOpen={() => onOpen(d)} />
        ))}
      </ul>
    </section>
  )
}

/** 사건 상세: 그래프 · 조치 순서 · 관련 문서 */
export function IncidentDetail({ inc, label, docs, onDoc }: { inc: DayIncident; label: string; docs: DocItem[]; onDoc: (d: DocItem) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        {inc.trace ? (
          <GasChart trace={inc.trace} tone={inc.worst} since={inc.since} />
        ) : (
          <div className="border bg-card px-4 py-6 text-center text-[15px] text-muted-foreground">측정기 신호가 끊긴 구간이라 그래프가 없습니다 · 휴대용 측정값으로 확인</div>
        )}
        <dl className="mt-3 grid grid-cols-[48px_1fr] gap-x-3 gap-y-1 text-[15px]">
          <dt className="text-muted-foreground">작업</dt>
          <dd>{inc.work ?? "허가 없음"}</dd>
          <dt className="text-muted-foreground">처음</dt>
          <dd>{inc.since !== null ? `${label} ${fmtTime(inc.since)}` : "—"}</dd>
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <section>
          <h4 className="mb-1 text-[15px] font-semibold">조치 순서</h4>
          <ol className="border-t bg-card">
            {inc.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[48px_1fr] gap-2 border-b px-3 py-1.5 text-[14px] leading-snug">
                <span className="font-mono text-muted-foreground tabular-nums">{fmtTime(s.t)}</span>
                <span className={cn(s.who && "font-medium")}>
                  {s.text}
                  {s.who && s.who !== "조치" && <span className="text-muted-foreground"> · {s.who}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <Docs docs={docs} onOpen={onDoc} />
      </div>
    </div>
  )
}

export function RecDetail({ rec, docs, onDoc }: { rec: Rec; docs: DocItem[]; onDoc: (d: DocItem) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {(rec.sub || rec.who) && <p className="text-[15px] text-muted-foreground">{rec.sub ?? rec.who}</p>}
      <Docs docs={docs} onOpen={onDoc} />
    </div>
  )
}

// ---------- 결과 정리 (관리자 입력) ----------

function ResultEditor({ result, onSave, onCancel }: { result?: IncidentResult; onSave: (r: Pick<IncidentResult, "outcome" | "memo">) => void; onCancel: () => void }) {
  const [outcome, setOutcome] = useState<Outcome | null>(result?.outcome ?? null)
  const [memo, setMemo] = useState(result?.memo ?? "")
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOutcome(o)}
            className={cn(
              "cursor-pointer rounded-md border-2 px-2.5 py-1 text-[14px] font-semibold whitespace-nowrap transition-colors",
              outcome === o ? "border-foreground bg-card" : "border-transparent bg-muted hover:border-foreground/30",
            )}
          >
            {o}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="결과 한 줄 (예: LEL 3.1% 확인 후 10:20 재개)"
          className="h-9 min-w-0 flex-1 rounded-md border bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus:border-foreground"
        />
        <Button size="sm" className="h-9 px-3.5 text-[14px]" disabled={!outcome} onClick={() => outcome && onSave({ outcome, memo: memo.trim() })}>
          저장
        </Button>
        <Button size="sm" variant="ghost" className="h-9 text-[14px]" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  )
}

/** 보고서 '결과' 칸: 누르면 그 자리에서 결과를 입력하는 창이 뜬다 (보고서 = 입력 화면) */
export function ResultCell({ inc, result, onSave }: { inc: DayIncident; result?: IncidentResult; onSave: (r: Pick<IncidentResult, "outcome" | "memo">) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {result ? (
          <button type="button" className="group cursor-pointer text-left hover:underline hover:decoration-foreground/40 hover:underline-offset-4">
            <b className="font-semibold">{result.outcome}</b>
            {result.memo && <span> — {result.memo}</span>}
            <PenLine className="ml-1.5 inline size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        ) : (
          <button
            type="button"
            // 아직 안 적은 결과: 채운 주황 단추로 눈에 띄게 (적으면 이 자리에 결과 글자만 남는다)
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-[1.5px] border-warn bg-warn-soft px-2.5 text-[14px] leading-[21px] font-semibold text-warn-ink shadow-sm transition-colors hover:bg-warn hover:text-white"
          >
            <PenLine className="size-3.5" />
            결과 입력
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[440px] p-4">
        <div className="text-[15px]">
          <b className="font-semibold">{inc.name}</b>
          <span className="text-muted-foreground"> · {STATUS[inc.worst].label}</span>
        </div>
        <ResultEditor
          result={result}
          onSave={(r) => {
            onSave(r)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

// ---------- 일일 보고서 ----------

/** 보고서 한 장 크기 (A4 비율). 날짜가 바뀌어도 칸 위치가 그대로이도록 높이를 고정한다 */
export const SHEET_W = 760
export const SHEET_H = 1075
/** 사건 한 건 높이와 쪽마다 들어가는 건수. 넘치면 사건을 쪼개지 않고 다음 쪽으로 넘긴다 */
const ROW_H = 96

type Results = Record<string, IncidentResult | undefined>
type Save = (id: string, r: Pick<IncidentResult, "outcome" | "memo">) => void

function Section({ title, aside, className, style, children }: { title: string; aside?: ReactNode; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col", className)} style={style}>
      <h4 className="flex h-9 shrink-0 items-baseline gap-2 border-b-2 border-foreground text-[17px] font-semibold">
        {title}
        {aside && <span className="ml-auto text-[14px] font-normal text-muted-foreground">{aside}</span>}
      </h4>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
}

/** 사건 한 건: 시각 | 이름표(조치·결과) | 내용. 세 줄 모두 글자 바닥선 기준으로 맞춘다 */
function IncidentLine({ inc, res, onSave }: { inc: DayIncident; res?: IncidentResult; onSave?: Save }) {
  const acts = actionsOf(inc)
  const actText = acts.length ? acts.map((a) => `${fmtTime(a.t)} ${brief(a.text)}`).join(" → ") : "없음"
  return (
    <li style={{ height: ROW_H }} className="grid grid-cols-[64px_44px_minmax(0,1fr)] content-center items-baseline gap-y-1.5 border-b text-[15px] leading-6">
      <span className="font-mono text-[14px] text-muted-foreground tabular-nums">{inc.since !== null ? fmtTime(inc.since) : "—"}</span>
      <span className="col-span-2 truncate">
        <b className="font-semibold">{inc.name}</b>
        <span className={cn("ml-2 text-[14px] font-semibold", statusText[inc.worst])}>{STATUS[inc.worst].label}</span>
      </span>
      <span />
      <span className="text-[14px] text-muted-foreground">조치</span>
      <span className="truncate text-[14px]" title={actText}>
        {actText}
      </span>
      <span />
      <span className="text-[14px] text-muted-foreground">결과</span>
      <span className="truncate text-[14px]">
        {onSave ? (
          <ResultCell key={res?.at ?? "none"} inc={inc} result={res} onSave={(r) => onSave(inc.id, r)} />
        ) : res ? (
          <>
            <b className="font-semibold">{res.outcome}</b>
            {res.memo && ` — ${res.memo}`}
          </>
        ) : (
          <span className="text-muted-foreground">미입력</span>
        )}
      </span>
    </li>
  )
}

function SheetHeader({ d, title }: { d: DayData; title: string }) {
  return (
    // 제목 | 날짜 , 공장·호선 | 기준 시각 — 두 줄 모두 좌우 글자 바닥선을 맞춘다
    <header className="grid h-[72px] shrink-0 grid-cols-[1fr_auto] items-baseline gap-x-4">
      <h2 className="font-heading text-[28px] leading-9 font-semibold tracking-[-0.02em]">{title}</h2>
      <span className="justify-self-end text-[20px] leading-9 font-semibold">{d.label}</span>
      <span className="text-[15px] leading-6 text-muted-foreground">
        {SITE.shop} · {SITE.ship}
      </span>
      <span className="justify-self-end text-[15px] leading-6 text-muted-foreground">{d.asOf}</span>
    </header>
  )
}

/**
 * 일일 안전 보고서 한 쪽. onSave가 있으면 화면용(결과 칸을 눌러 입력), 없으면 인쇄용(글자만).
 * 칸 위치·크기는 고정이고, 내용이 없으면 그 자리를 비워 둔다. 사건이 많으면 page 1, 2…에 이어서 싣는다.
 */
export function ReportSheet({ d, results, onSave, page = 0, className }: { d: DayData; results: Results; onSave?: Save; page?: number; className?: string }) {
  const total = reportPages(d)
  const incs = [...d.incidents].sort((x, y) => (x.since ?? 1e9) - (y.since ?? 1e9))
  const lines = page === 0 ? incs.slice(0, FIRST_SLOTS) : incs.slice(FIRST_SLOTS + (page - 1) * NEXT_SLOTS, FIRST_SLOTS + page * NEXT_SLOTS)
  const list = (
    <ul>
      {lines.map((inc) => (
        <IncidentLine key={inc.id} inc={inc} res={results[inc.id] ?? inc.result} onSave={onSave} />
      ))}
    </ul>
  )
  const pageNo = total > 1 && <span className="mr-auto font-mono">{page + 1} / {total}</span>

  if (page > 0)
    return (
      <article style={{ width: SHEET_W, height: SHEET_H }} className={cn("flex flex-col bg-card px-10 py-9", className)}>
        <SheetHeader d={d} title="일일 안전 보고서 (계속)" />
        <Section className="mt-7 shrink-0" style={{ height: 36 + NEXT_SLOTS * ROW_H + 4 }} title="사건별 조치와 결과 (계속)" aside={page < total - 1 ? "다음 쪽에 계속" : undefined}>
          {list}
        </Section>
        <footer className="mt-auto flex h-12 shrink-0 items-end border-t text-[14px] leading-6 text-muted-foreground">{pageNo}</footer>
      </article>
    )

  const advice = d.live
    ? ADVICE
    : d.incidents
        .filter((i) => i.worst === "missing")
        .map((i) => ({ sensor: zoneDef(i.zoneId)?.sensor ?? "", zone: i.name, why: "통신 두절", todo: "배터리·무선 중계 점검" }))
  const nums: { label: string; value: number; tone?: Status }[] = [
    { label: "법정 초과", value: d.nums.legal, tone: "legal" },
    { label: "센서 결측", value: d.nums.missing, tone: "missing" },
    { label: d.live ? "경계 (지금)" : "경계", value: d.nums.warn, tone: "warn" },
    { label: "책임자 확인", value: d.nums.acks },
    { label: "인력 호출", value: d.nums.calls },
    { label: "허가 작업", value: d.nums.works },
  ]
  return (
    <article style={{ width: SHEET_W, height: SHEET_H }} className={cn("flex flex-col bg-card px-10 py-9", className)}>
      <SheetHeader d={d} title="일일 안전 보고서" />

      {/* 숫자 한 줄: 칸마다 상자를 두지 않고 세로선으로만 나눈다 */}
      <div className="mt-6 grid h-[76px] shrink-0 grid-cols-6 border-y">
        {nums.map((n, i) => (
          <div key={n.label} className={cn("flex flex-col justify-center gap-1.5 px-3", i > 0 && "border-l")}>
            <span className="text-[13px] leading-4 text-muted-foreground">{n.label}</span>
            <span className={cn("font-mono text-[26px] leading-7 font-medium tabular-nums", n.value > 0 && n.tone && statusText[n.tone])}>{n.value}</span>
          </div>
        ))}
      </div>

      <Section
        className="mt-7 shrink-0"
        style={{ height: 36 + FIRST_SLOTS * ROW_H + 4 }}
        title={`사건별 조치와 결과 · ${d.incidents.length}건`}
        aside={total > 1 ? "다음 쪽에 계속" : undefined}
      >
        {lines.length ? list : <p className="pt-3 text-[15px] leading-6 text-muted-foreground">기준을 넘은 구역이 없습니다.</p>}
      </Section>

      <div className="mt-7 grid h-[200px] shrink-0 grid-cols-2 gap-8">
        <Section title={`전날 확정${d.prepDay ? ` · ${d.prepDay}` : ""}`}>
          <p className="pt-3 text-[14px] leading-6">{d.prepLine}</p>
        </Section>
        <Section title="점검 권고">
          {advice.length ? (
            <ul className="pt-3">
              {advice.map((a) => (
                <li key={a.sensor + a.zone} className="mb-2 text-[14px] leading-6">
                  <div className="truncate">
                    <b className="font-mono font-semibold">{a.sensor}</b> {a.zone}
                  </div>
                  <div className="truncate text-muted-foreground">{a.why}</div>
                  <div className="truncate font-medium">→ {a.todo}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pt-3 text-[14px] leading-6 text-muted-foreground">없음</p>
          )}
        </Section>
      </div>

      <footer className="mt-auto flex h-12 shrink-0 items-end justify-end gap-10 border-t text-[14px] leading-6 text-muted-foreground">
        {pageNo}
        <span>
          작성 안전관리자 <span className="inline-block w-28 border-b border-foreground/30 align-baseline" />
        </span>
        <span>
          확인 <span className="inline-block w-28 border-b border-foreground/30 align-baseline" />
        </span>
      </footer>
    </article>
  )
}

/** 보고서 한 장을 영역 크기에 맞춰 줄여 보여 준다 (스크롤 없이) */
export function FitPreview({ children, width = SHEET_W }: { children: ReactNode; width?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  useLayoutEffect(() => {
    const b = box.current
    const p = page.current
    if (!b || !p) return
    const fit = () => setScale(Math.min(1, (b.clientWidth - 24) / p.offsetWidth, (b.clientHeight - 24) / p.offsetHeight))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(b)
    ro.observe(p)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute top-3 left-1/2 origin-top" style={{ transform: `translateX(-50%) scale(${scale})` }}>
        <div ref={page} style={{ width }} className="shadow-[0_6px_24px_rgb(16_24_40/0.12)] ring-1 ring-border">
          {children}
        </div>
      </div>
    </div>
  )
}

// ---------- 달력 ----------

export interface CalDay {
  key: DayKey
  off?: boolean
  marks: Status[]
}

/** 한 달 달력. 기록이 있는 날만 누를 수 있고, 사건이 있던 날은 색 점으로 보인다 */
export function MonthCalendar({
  year,
  month,
  days,
  today,
  isSelected,
  isInRange,
  onPick,
  onMonth,
  canPrev,
  canNext,
}: {
  year: number
  month: number
  days: Map<DayKey, CalDay>
  today: DayKey
  isSelected: (k: DayKey) => boolean
  isInRange: (k: DayKey) => boolean
  onPick: (k: DayKey) => void
  onMonth: (dir: -1 | 1) => void
  canPrev: boolean
  canNext: boolean
}) {
  const first = new Date(year, month - 1, 1).getDay()
  const last = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)]
  const key = (d: number) => `${String(month).padStart(2, "0")}/${String(d).padStart(2, "0")}`
  const navBtn = "grid size-8 cursor-pointer place-items-center rounded-md hover:bg-muted disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
  return (
    <div>
      <div className="mb-2 flex items-center">
        <button type="button" aria-label="이전 달" className={navBtn} disabled={!canPrev} onClick={() => onMonth(-1)}>
          <ChevronLeft className="size-4" />
        </button>
        <span className="flex-1 text-center text-[16px] font-semibold">
          {month}월
        </span>
        <button type="button" aria-label="다음 달" className={navBtn} disabled={!canNext} onClick={() => onMonth(1)}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[13px] text-muted-foreground">
        {"일월화수목금토".split("").map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />
          const k = key(d)
          const info = days.get(k)
          const disabled = !info || info.off
          const sel = isSelected(k)
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onPick(k)}
              className={cn(
                "flex h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md text-[15px] tabular-nums transition-colors",
                disabled ? "cursor-default text-muted-foreground/40" : "hover:bg-muted",
                isInRange(k) && !disabled && "bg-muted",
                sel && "ring-2 ring-foreground ring-inset font-semibold",
                k === today && "font-semibold underline underline-offset-4",
              )}
            >
              {d}
              <span className="flex h-1.5 gap-0.5">
                {(info?.marks ?? []).slice(0, 3).map((m, j) => (
                  <span key={j} className={cn("size-1.5", statusBg[m])} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
