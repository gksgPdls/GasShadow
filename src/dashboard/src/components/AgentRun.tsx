import { useEffect, useRef } from "react"
import { ArrowRight, BookOpenText, BrainCircuit, Check, Gauge, LoaderCircle, MapPin, Search, UsersRound, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { AGENTS, type AgentId, type Flag, type Level } from "@/lib/agentTeam"
import { RUN_MS, SCHEDULE, useElapsed, type Run } from "@/lib/agentRun"

const ICON: Record<AgentId | "lead", LucideIcon> = {
  risk: Gauge,
  cause: Search,
  crew: UsersRound,
  cases: BookOpenText,
  lead: BrainCircuit,
}

const FLAG_DOT: Record<Flag, string> = { risk: "bg-legal", caution: "bg-warn", clear: "bg-ok", info: "bg-idle" }
const LEVEL: Record<Level, { box: string; text: string }> = {
  stop: { box: "border-legal/30 bg-legal-soft/50", text: "text-legal" },
  hold: { box: "border-missing/30 bg-missing-soft/50", text: "text-missing" },
  limit: { box: "border-warn/30 bg-warn-soft/50", text: "text-warn-ink" },
  watch: { box: "border-navy/20 bg-muted/60", text: "text-primary" },
  normal: { box: "border-ok/30 bg-ok-soft/50", text: "text-ok" },
}

/**
 * 에이전트 4개 진행 → 상황 설명 → 총괄 판단 · 현장 확인 · 조치 순서 · 판단 근거.
 * 에이전트는 정보만 준다 (조치 버튼 없음). 송풍기 가동·호출은 구역 화면(ZoneDetail) 아래에서 한다
 */
export function RunBody({ run, onOpenZone }: { run: Run; onOpenZone: () => void }) {
  const r = run.report
  const v = r.verdict
  const ms = useElapsed(run.startedAt)
  const finished = ms >= RUN_MS
  // 같은 사람에게 맡기는 확인은 한 줄로 묶는다
  const groups: { who: string; pending?: string; items: string[] }[] = []
  v.checks.forEach((c) => {
    const g = groups.find((x) => x.who === c.who)
    if (g) g.items.push(c.what)
    else groups.push({ who: c.who, pending: c.pending, items: [c.what] })
  })
  const state = (id: AgentId | "lead") => (ms < SCHEDULE[id][0] ? "wait" : ms < SCHEDULE[id][1] ? "run" : "done")
  // 단계가 넘어갈 때마다 끝이 보이게, 분석이 끝나면 최하단 조치 버튼까지 내려간다
  const stage = [...AGENTS.map((a) => a.id), "lead" as const].filter((id) => state(id) !== "wait").length + (finished ? 1 : 0)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: finished ? "end" : "nearest", behavior: "smooth" })
  }, [stage, finished])
  const suggest = [v.calls.includes("stop") && "작업 중지 지시", v.calls.includes("vent") && "꺼진 송풍기 가동"].filter(Boolean) as string[]

  return (
    <div className="text-[14px]">
      {/* 분석 에이전트 4개 */}
      <ol className="relative ml-3.5 space-y-0.5 border-l border-dashed border-foreground/20 pl-3">
        {AGENTS.map((a) => {
          const s = state(a.id)
          const f = r.findings.find((x) => x.id === a.id)!
          const Icon = ICON[a.id]
          return (
            <li key={a.id} className={cn("agent-step relative py-2", s === "wait" && "opacity-45")}>
              <span className={cn("absolute top-[11px] -left-[21px] grid size-4 place-items-center rounded-full border bg-card", s === "done" && "border-navy bg-navy text-white")}>
                {s === "run" ? <LoaderCircle className="size-3 animate-spin text-navy" /> : s === "done" ? <Check className="size-2.5" strokeWidth={3} /> : null}
              </span>
              <div className="flex items-center gap-1.5">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-[13px] font-semibold text-muted-foreground" title={a.question}>
                  {a.name}
                </span>
                {s === "done" && <span className={cn("size-1.5 shrink-0 rounded-full", FLAG_DOT[f.flag])} />}
                {s === "run" && <span className="agent-shimmer truncate text-[13px] text-navy">{a.doing}…</span>}
                {s === "wait" && <span className="text-[13px] text-muted-foreground">{a.id === "cases" ? "위험도·원인 결과 대기" : "대기"}</span>}
              </div>
              {s === "done" && (
                <div className="agent-in mt-0.5 pl-5">
                  <div className="leading-relaxed font-medium break-keep">{f.head}</div>
                  {f.lines.map((l) => (
                    <div key={l} className="text-[13px] leading-relaxed break-keep text-muted-foreground">
                      {l}
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {state("lead") === "run" && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-[14px] text-navy">
          <BrainCircuit className="size-4" />
          <span className="agent-shimmer">총괄 에이전트 · 4개 결과로 단계·조치 정하는 중…</span>
        </div>
      )}
      {/* 에이전트가 관리자에게 상황을 말로 설명 */}
      {finished && v.briefing.length > 0 && (
        <div className="agent-in mt-3 space-y-2 rounded-lg bg-muted px-3.5 py-3 text-[15px] leading-[1.75] break-keep">
          {v.briefing.map((b) => (
            <p key={b}>{b}</p>
          ))}
        </div>
      )}
      {finished && (
        <div className={cn("agent-in mt-2.5 rounded-lg border px-3.5 py-3", LEVEL[v.level].box)}>
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-4 shrink-0" />
            <span className="text-[13px] font-semibold text-muted-foreground">총괄 판단</span>
          </div>
          <div className={cn("mt-1 text-[17px] leading-relaxed font-bold", LEVEL[v.level].text)}>{v.title}</div>
          {suggest.length > 0 && <div className="mt-1 text-[14px] font-semibold break-keep">권장 · {suggest.join(" · ")}</div>}

          {groups.length > 0 && (
            <>
              <div className="mt-3 text-[13px] font-semibold text-muted-foreground">현장 확인 필요 · 시스템이 알 수 없는 것</div>
              <ul className="mt-1 divide-y rounded-lg border bg-card">
                {groups.map((g) => (
                  <li key={g.who} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14px] font-semibold">{g.who}</span>
                      {g.pending && <span className="text-[13px] text-muted-foreground">{g.pending}</span>}
                    </div>
                    {g.items.map((w) => (
                      <div key={w} className="mt-1 flex gap-1.5 text-[14px] leading-relaxed break-keep text-foreground/85">
                        <span className="mt-[9px] size-1 shrink-0 rounded-full bg-foreground/40" />
                        {w}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}
          {v.actions.length > 0 && (
            <>
              <div className="mt-3 text-[13px] font-semibold text-muted-foreground">권장 조치 순서</div>
              <ol className="mt-1.5 space-y-1.5">
                {v.actions.map((s, i) => (
                  <li key={s} className="flex gap-2 leading-relaxed break-keep">
                    <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-navy text-[12px] font-bold text-white">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-1.5 text-[13px] text-muted-foreground">출처: {v.from}</div>
            </>
          )}
          {/* 어느 에이전트 결과가 결론의 어디를 정했는지 */}
          <div className="mt-3 text-[13px] font-semibold text-muted-foreground">판단 근거</div>
          <ul className="mt-1.5 space-y-1.5">
            {v.trace.map((x) => {
              const Icon = ICON[x.id]
              return (
                <li key={x.id} className="flex items-start gap-1.5 text-[13px] leading-relaxed break-keep">
                  <Icon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-semibold text-muted-foreground">{AGENTS.find((a) => a.id === x.id)!.name}</span>
                  <ArrowRight className="mt-px size-3 shrink-0 text-muted-foreground" />
                  <span className="text-foreground/85">{x.effect}</span>
                </li>
              )
            })}
          </ul>
          {/* 조치는 구역 화면에서: 송풍기 가동 · 측정요원·관리감독자 호출 */}
          <button
            type="button"
            onClick={onOpenZone}
            className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-md border-2 border-primary bg-card text-[15px] font-semibold text-primary hover:bg-accent"
          >
            <MapPin className="size-4" /> 구역 화면에서 조치하기 <ArrowRight className="size-4" />
          </button>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}
