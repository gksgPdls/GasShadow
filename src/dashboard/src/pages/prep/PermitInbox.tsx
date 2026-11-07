import { useState } from "react"
import { ArrowRight, ChevronDown, CircleCheck, FileText, MapPin, PenLine, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { BLOCKS, ZONES, blockName } from "@/data/scenario"
import { AI_CHECKS, MISSING_TEAMS, ZONE_META, checksOf, type AiCheck } from "@/data/permits"
import { AiFindings } from "@/pages/prep/AiFindings"
import { isConfined, unresolvedOf, zoneOf, type AiStates, type AiStatus, type EffectivePermit, type Mappings } from "@/pages/prep/model"
import { DEADLINE_SEC, hms, useKept } from "@/pages/prep/state"
import { ExtrasIcons, FormTag, Kpi, Panel, PanelHead, Segmented } from "@/pages/prep/ui"

type View = "confined" | "all" | "ai"

interface Props {
  list: EffectivePermit[]
  ai: AiStates
  maps: Mappings
  clock: number
  onAi: (check: AiCheck, status: Exclude<AiStatus, "미처리"> | null, reason?: string) => void
  onMap: (no: string, block: string, zoneId: string) => void
  onRun: () => void
  onTodo: (what: string) => void
}

// 허가서 접수함 (전날): 위 AI 확인 필요·접수 현황 / 왼쪽 허가서 목록 / 오른쪽 고른 허가서의 AI 체크 검토·구역 매핑
export function PermitInbox({ list, ai, maps, clock, onAi, onMap, onRun, onTodo }: Props) {
  const [view, setView] = useKept<View>("prep.view", () => "confined")
  const [selected, setSelected] = useKept("prep.selected", () => "PTW-2541-0483")

  const unresolved = unresolvedOf(ai)
  const openOf = (no: string) => unresolvedOf(ai, no).length
  const confined = list.filter(isConfined)
  const aiPermits = confined.filter((p) => openOf(p.no) > 0)

  // AI가 '확인 필요'를 짚은 허가서를 위로, 그다음 접수 시각 늦은 순 (처리해도 자리는 그대로)
  const flagged = (no: string) => AI_CHECKS.some((c) => c.permit === no && c.level === "확인 필요")
  const shown = (view === "all" ? list : view === "ai" ? aiPermits : confined)
    .slice()
    .sort((a, b) => Number(flagged(b.no)) - Number(flagged(a.no)) || b.receivedAt.localeCompare(a.receivedAt))

  const sel = list.find((p) => p.no === selected) ?? shown[0]
  const kinds = unresolved.reduce<Record<string, number>>((m, c) => {
    m[c.kind] = (m[c.kind] ?? 0) + 1
    return m
  }, {})
  const notes = AI_CHECKS.filter((c) => c.level === "참고" && !ai[c.id]).length
  const left = DEADLINE_SEC - clock

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        {/* 위 숫자 칸 */}
        <div className="minimal-prep-summary grid shrink-0 grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))] gap-4">
          <button
            type="button"
            onClick={() => setView(view === "ai" ? "confined" : "ai")}
            className={cn(
              "flex min-w-0 items-center gap-5 rounded-xl border-2 px-5 py-4 text-left transition-colors",
              unresolved.length ? "border-warn/50 bg-warn-soft hover:bg-warn-soft/70" : "border-ok/30 bg-ok-soft",
            )}
          >
            <span
              className={cn(
                "grid size-14 shrink-0 place-items-center rounded-full",
                unresolved.length ? "bg-warn text-white" : "bg-ok text-white",
              )}
            >
              {unresolved.length ? <Sparkles className="size-7" /> : <CircleCheck className="size-7" />}
            </span>
            <div className="min-w-0 shrink-0">
              <div className="text-[15px] font-semibold">AI가 찾은 확인 필요</div>
              <div className={cn("font-mono text-[40px] leading-none font-semibold tabular-nums", unresolved.length ? "text-warn-ink" : "text-ok")}>
                {unresolved.length}
                <span className="ml-1 font-sans text-[18px] font-medium text-foreground/70">건</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(kinds).map(([k, n]) => (
                  <span key={k} className="rounded-md bg-card/80 px-2 py-0.5 text-[14px] whitespace-nowrap">
                    {k} <b className="font-mono">{n}</b>
                  </span>
                ))}
                {!unresolved.length && <span className="text-[15px]">모두 처리했습니다</span>}
              </div>
              <div className="text-[14px] text-muted-foreground">
                참고 {notes}건 · {view === "ai" ? "전체 목록으로 돌아가기" : "눌러서 해당 허가서만 보기"}
              </div>
            </div>
          </button>
          <Kpi label="접수 허가서" value={list.length} sub={`밀폐구역 출입 ${confined.length} · 아르곤 ${list.filter((p) => p.extras.includes("아르곤가스")).length}`} />
          <Kpi label="미접수 반" value={MISSING_TEAMS.length} sub={MISSING_TEAMS.join(" · ")} tone={MISSING_TEAMS.length ? "warn" : undefined} />
          <Kpi
            label={left > 0 ? "신고 마감까지" : "신고 마감"}
            value={left > 0 ? hms(left) : "마감"}
            sub="마감 15:00"
            tone={left > 0 && left < 30 * 60 ? "warn" : undefined}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(420px,0.78fr)] gap-4">
          {/* 허가서 목록 */}
          <Panel>
            <PanelHead
              title="허가서"
              aside={
                <Segmented<View>
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "confined", label: <>밀폐구역 출입 <Count n={confined.length} /></> },
                    { value: "ai", label: <>AI 확인 필요 <Count n={aiPermits.length} warn /></> },
                    { value: "all", label: <>전체 <Count n={list.length} /></> },
                  ]}
                />
              }
            />
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full table-fixed text-left text-[15px]">
                <colgroup>
                  <col className="w-[88px]" />
                  <col />
                  <col className="w-[116px]" />
                  <col className="w-[152px]" />
                  <col className="w-[124px]" />
                </colgroup>
                <thead className="sticky top-0 z-[1] bg-card text-[13px] text-muted-foreground">
                  <tr className="border-b">
                    {["승인번호", "작업 · 구역", "양식", "추가정보", "AI 검토"].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap first:pl-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr
                      key={p.no}
                      onClick={() => setSelected(p.no)}
                      onDoubleClick={() => onTodo(`허가서 원문 ${p.no}`)}
                      className={cn(
                        "h-[68px] cursor-pointer border-b transition-colors hover:bg-muted/50",
                        sel?.no === p.no && "bg-accent/70 shadow-[inset_4px_0_0_var(--primary)] hover:bg-accent/70",
                      )}
                    >
                      <td className="pr-3 pl-5 font-mono text-[15px] font-semibold whitespace-nowrap">{p.no.replace("PTW-2541-", "")}</td>
                      <td className="px-3 py-2">
                        <div className="truncate font-semibold">{p.task}</div>
                        <div className="truncate text-[13px] text-muted-foreground">
                          {p.block ? (
                            `${blockName(p.block)} · ${zoneOf(p.zoneId)?.name ?? p.placeText}`
                          ) : isConfined(p) ? (
                            <span className="font-semibold text-legal">구역 미매핑 · "{p.placeText}"</span>
                          ) : (
                            p.placeText
                          )}
                        </div>
                      </td>
                      <td className="px-3">
                        <FormTag form={p.form} ai={p.aiForm} />
                      </td>
                      <td className="px-3">
                        <ExtrasIcons extras={p.extras} aiExtras={p.aiExtras} />
                      </td>
                      <td className="px-3 whitespace-nowrap">
                        <AiBadge open={openOf(p.no)} checks={checksOf(p.no)} ai={ai} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <div className="p-8 text-center text-[15px] text-muted-foreground">해당하는 허가서가 없습니다</div>}
            </div>
          </Panel>

          {sel ? (
            <SelectedPermit key={sel.no} p={sel} list={list} ai={ai} maps={maps} onAi={onAi} onMap={onMap} />
          ) : (
            <Panel className="grid place-items-center text-[15px] text-muted-foreground">허가서를 고르세요</Panel>
          )}
        </div>
      </div>

      {/* 하단 */}
      <footer className="flex h-[76px] shrink-0 items-center gap-3 border-t bg-card px-5">
        <Button variant="outline" size="lg" className="h-11 px-4 text-[15px]" onClick={() => onTodo("수기 허가서 입력")}>
          <PenLine /> 수기 허가서 입력
        </Button>
        <Button variant="outline" size="lg" className="h-11 px-4 text-[15px]" onClick={() => sel && onTodo(`허가서 원문 ${sel.no}`)}>
          <FileText /> 허가서 원문
        </Button>
        <span className={cn("ml-auto text-[15px]", unresolved.length ? "font-semibold text-warn-ink" : "text-muted-foreground")}>
          {unresolved.length ? `AI 확인 필요 ${unresolved.length}건 남음` : "AI 확인 필요 모두 처리"}
        </span>
        <Button size="lg" className="h-11 px-5 text-[16px]" onClick={onRun}>
          측정 대상 선별 실행 <ArrowRight />
        </Button>
      </footer>
    </>
  )
}

const Count = ({ n, warn }: { n: number; warn?: boolean }) => (
  <span className={cn("rounded-md px-1.5 font-mono text-[13px]", warn && n ? "bg-warn-soft text-warn-ink" : "bg-muted text-muted-foreground")}>{n}</span>
)

function AiBadge({ open, checks, ai }: { open: number; checks: AiCheck[]; ai: AiStates }) {
  if (open)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn px-3 py-1 text-[14px] font-semibold text-white">
        <Sparkles className="size-4" /> 확인 {open}
      </span>
    )
  const notes = checks.filter((c) => c.level === "참고" && !ai[c.id]).length
  if (notes) return <span className="rounded-full bg-muted px-3 py-1 text-[14px] text-muted-foreground">참고 {notes}</span>
  if (checks.length)
    return (
      <span className="inline-flex items-center gap-1 text-[14px] text-ok">
        <CircleCheck className="size-4" /> 처리
      </span>
    )
  return <span className="text-muted-foreground/50">—</span>
}

// 고른 허가서: AI 체크 검토 → 체크 항목 → 구역 매핑 → (펼치면) 허가서 내용
function SelectedPermit({
  p,
  list,
  ai,
  maps,
  onAi,
  onMap,
}: Pick<Props, "list" | "ai" | "maps" | "onAi" | "onMap"> & { p: EffectivePermit }) {
  const checks = checksOf(p.no)
  const open = unresolvedOf(ai, p.no).length
  const zone = zoneOf(p.zoneId)

  return (
    <Panel>
      <header className="shrink-0 border-b px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[22px] font-semibold tracking-[-0.01em]">{p.no}</span>
          <FormTag form={p.form} ai={p.aiForm} className="text-[14px]" />
        </div>
        <div className="mt-1 text-[17px] leading-snug font-semibold break-keep">{p.task}</div>
        <div className="mt-0.5 text-[14px] text-muted-foreground">
          {zone ? `${blockName(p.block)} · ${zone.name}` : `"${p.placeText}"`} · {p.workers}명 · {p.period} {p.time}
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <section>
          <h3 className="mb-3 flex items-center gap-2 font-heading text-[19px] font-semibold tracking-[-0.01em]">
            <Sparkles className="size-5 text-primary" /> AI 체크 검토
            {checks.length > 0 && (
              <span className={cn("ml-auto text-[14px] font-medium", open ? "text-warn-ink" : "text-muted-foreground")}>
                {open ? `확인 필요 ${open}건 남음` : `${checks.length}건 · 처리됨`}
              </span>
            )}
          </h3>
          <AiFindings checks={checks} ai={ai} onAct={onAi} />
        </section>

        {/* 체크 항목: AI 제안을 반영하면 파란 점선으로 바로 보인다 */}
        <section className="space-y-3 rounded-xl border px-4 py-3.5">
          <div className="flex items-center gap-4">
            <span className="w-20 shrink-0 text-[14px] text-muted-foreground">추가정보</span>
            <ExtrasIcons extras={p.extras} aiExtras={p.aiExtras} large />
          </div>
          <div className="flex items-start gap-4">
            <span className="w-20 shrink-0 pt-1 text-[14px] text-muted-foreground">유해위험</span>
            <div className="flex flex-wrap gap-1.5">
              {p.hazards.length === 0 && <span className="pt-0.5 text-[15px] font-semibold text-legal">미기재</span>}
              {p.hazards.map((h) => (
                <span
                  key={h}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[14px]",
                    p.aiHazards.includes(h) && "border-dashed border-primary bg-accent font-semibold text-primary",
                  )}
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
          {(p.aiExtras.length > 0 || p.aiHazards.length > 0 || p.aiForm) && (
            <div className="text-[13px] text-primary">파란 점선 = AI 제안 반영 · 관리자 확인</div>
          )}
        </section>

        {isConfined(p) && <ZoneMapping p={p} maps={maps} onMap={onMap} />}

        <PermitDetails p={p} list={list} />
      </div>
    </Panel>
  )
}

// 구역 매핑: 작업장소 글을 블록·밀폐구역으로 (시스템 제안 → 관리자 확정)
function ZoneMapping({ p, maps, onMap }: { p: EffectivePermit; maps: Mappings; onMap: Props["onMap"] }) {
  const [block, setBlock] = useState(p.block ?? "")
  const zones = ZONES.filter((z) => z.block === block)
  const zone = zoneOf(p.zoneId)
  const meta = p.zoneId ? ZONE_META[p.zoneId] : undefined
  const m = maps[p.no]

  return (
    <section className={cn("rounded-xl border px-4 py-3.5", !zone && "border-legal/40 bg-legal-soft/60")}>
      <div className="mb-2.5 flex items-center gap-2 text-[16px] font-semibold">
        <MapPin className="size-4" /> 구역 매핑
        <span className="ml-auto truncate text-[13px] font-normal text-muted-foreground">작업장소 "{p.placeText}"</span>
      </div>
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2">
        <Select value={block} onValueChange={setBlock}>
          <SelectTrigger className="h-10 w-full bg-card font-mono text-[15px] data-[size=default]:h-10">
            <SelectValue placeholder="블록" />
          </SelectTrigger>
          <SelectContent>
            {BLOCKS.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-[15px]">
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          key={block}
          value={block === p.block ? (p.zoneId ?? undefined) : undefined}
          onValueChange={(z) => onMap(p.no, block, z)}
          disabled={!block}
        >
          <SelectTrigger className="h-10 w-full bg-card text-[15px] data-[size=default]:h-10">
            <SelectValue placeholder="밀폐구역 선택" />
          </SelectTrigger>
          <SelectContent>
            {zones.map((z) => (
              <SelectItem key={z.id} value={z.id} className="text-[15px]">
                {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-2.5 text-[14px] text-muted-foreground">
        {zone && meta ? (
          <>
            용적 약 {meta.volume} m³ · {meta.openings} · 측정기 <span className="font-mono text-foreground">{zone.sensor}</span>
          </>
        ) : (
          <span className="font-semibold text-legal">구역을 정해야 측정 대상 선별에 들어갑니다</span>
        )}
      </div>
      {m && (
        <div className="mt-1 text-[13px] text-primary">
          관리자 매핑 · {m.by} {m.at}
        </div>
      )}
    </section>
  )
}

// 허가서 내용 (평소엔 접어 둠)
function PermitDetails({ p, list }: { p: EffectivePermit; list: EffectivePermit[] }) {
  const sameBlock = list.filter((q) => q.no !== p.no && isConfined(q) && q.block && q.block === p.block)
  return (
    <details className="group rounded-xl border">
      <summary className="flex h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
        허가서 내용
        {sameBlock.length > 0 && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[13px] font-normal text-muted-foreground">같은 블록 동시 작업 {sameBlock.length}</span>
        )}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 border-t px-4 py-3.5 text-[15px]">
        <dt className="text-[14px] text-muted-foreground">작업부서</dt>
        <dd className="break-keep">{p.dept}</dd>
        <dt className="text-[14px] text-muted-foreground">책임자</dt>
        <dd>정 OOO · 부 OOO</dd>
        <dt className="text-[14px] text-muted-foreground">작업일시</dt>
        <dd className="font-mono text-[14px]">
          {p.period} {p.time}
        </dd>
        {sameBlock.length > 0 && (
          <>
            <dt className="text-[14px] text-muted-foreground">같은 블록</dt>
            <dd className="space-y-1">
              {sameBlock.map((q) => (
                <div key={q.no} className="break-keep">
                  <span className="font-mono text-[14px]">{q.no.replace("PTW-2541-", "")}</span> {q.task}
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
    </details>
  )
}
