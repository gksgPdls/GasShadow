import { useState } from "react"
import { ArrowLeft, ArrowRight, FileDown, ListChecks, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { RULES, checksOf, type AiCheck, type Suggestion } from "@/data/permits"
import { AiFindings } from "@/pages/prep/AiFindings"
import { REASONS, zoneOf, type AiStates, type AiStatus, type SelRow } from "@/pages/prep/model"
import { useKept } from "@/pages/prep/state"
import { FormTag, Kpi, Panel, PanelHead, ReasonChip } from "@/pages/prep/ui"
import { blockName } from "@/data/scenario"

interface Props {
  rows: SelRow[]
  ai: AiStates
  onToggle: (no: string, v: "Y" | "N") => void
  onDecide: (no: string, reason: string, note: string) => void
  onAi: (check: AiCheck, status: Exclude<AiStatus, "미처리"> | null, reason?: string) => void
  onBack: () => void
  onConfirm: () => void
  onTodo: (what: string) => void
}

const SUGG_CLS: Record<Suggestion, string> = {
  Y: "bg-foreground text-white",
  검토: "border-2 border-dashed border-foreground/40 text-foreground",
  N: "bg-muted text-muted-foreground",
  보류: "border text-muted-foreground",
}
const ORANGE = "#b1531c" // 제안 ≠ 최종 표시 (상태색과 다른 주황)
const short = (no: string) => no.replace("PTW-2541-", "")

// 측정 대상 선별 (전날): 허가서마다 시스템 제안 2중점검 Y/N → 관리자 최종. 확정하면 당일 관제 목록이 된다
export function SelectionView({ rows, ai, onToggle, onDecide, onAi, onBack, onConfirm, onTodo }: Props) {
  const [selected, setSelected] = useKept("prep.sel", () => rows[0]?.sel.permit)
  const cur = rows.find((r) => r.sel.permit === selected) ?? rows[0]

  const count = (s: Suggestion) => rows.filter((r) => r.suggestion === s).length
  const finalY = rows.filter((r) => r.final === "Y")
  const byInspector = (n: string) => finalY.filter((r) => r.inspector === n).length
  const decided = rows.filter((r) => r.decision)
  const changes = decided.reduce<Record<string, number>>((m, r) => {
    const k = `${r.suggestion}→${r.final}`
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})
  const held = rows.filter((r) => r.final === null && r.suggestion === "보류")
  const blocking = rows.filter((r) => r.blocking)

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <div className="minimal-prep-summary grid shrink-0 grid-cols-4 gap-4">
          <Kpi label="선별 대상 허가서" value={rows.length} sub={`제안 Y ${count("Y")} · 검토 ${count("검토")} · N ${count("N")} · 보류 ${count("보류")}`} />
          <Kpi label="최종 2중점검 Y · 대면 점검" value={finalY.length} sub={`A동 ${byInspector("A동 김OO")} · B동 ${byInspector("B동 박OO")}`} />
          <Kpi
            label="관리자 결정"
            value={decided.length}
            sub={Object.entries(changes).map(([k, n]) => `${k} ${n}`).join(" · ") || "없음"}
          />
          <Kpi
            label="결정·사유 필요"
            value={blocking.length}
            tone={blocking.length ? "warn" : undefined}
            sub={blocking.length ? blocking.map((r) => short(r.sel.permit)).join(", ") : "모두 정함"}
            className={blocking.length ? "border-2 border-warn/50 bg-warn-soft" : undefined}
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(420px,0.62fr)] gap-4">
          <Panel>
            <PanelHead
              title="허가서별 2중점검"
              aside={
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="lg" className="h-10 px-3.5 text-[14px]">
                      <ListChecks /> 선별 기준
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[400px] p-0">
                    <div className="border-b px-4 py-3 text-[16px] font-semibold">선별 기준</div>
                    <table className="w-full text-[14px]">
                      <tbody>
                        {RULES.map((r) => (
                          <tr key={r.id} className="border-b last:border-b-0">
                            <td className="py-2.5 pr-2 pl-4 font-mono font-semibold whitespace-nowrap text-primary">{r.id}</td>
                            <td className="py-2.5 pr-2 leading-snug break-keep">{r.cond}</td>
                            <td className="py-2.5 pr-4 text-right whitespace-nowrap text-muted-foreground">{r.result}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </PopoverContent>
                </Popover>
              }
            />
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full table-fixed text-left text-[15px]">
                <colgroup>
                  <col className="w-[88px]" />
                  <col />
                  <col className="w-[34%]" />
                  <col className="w-[196px]" />
                  <col className="w-[104px]" />
                </colgroup>
                <thead className="sticky top-0 z-[1] bg-card text-[13px] text-muted-foreground">
                  <tr className="border-b">
                    {["승인번호", "작업 · 구역", "선정 근거", "제안 → 최종", "대면 점검"].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap first:pl-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const no = r.sel.permit
                    const zone = zoneOf(r.p.zoneId)
                    const open = checksOf(no).filter((c) => c.level === "확인 필요" && !ai[c.id]).length
                    const differs = r.needsReason && r.suggestion !== "검토"
                    const isCur = cur?.sel.permit === no
                    return (
                      <tr
                        key={no}
                        onClick={() => setSelected(no)}
                        className={cn("h-[72px] cursor-pointer border-b transition-colors hover:bg-muted/50", isCur && "bg-accent/70 hover:bg-accent/70")}
                        style={
                          differs || r.blocking
                            ? { boxShadow: `inset 4px 0 0 ${ORANGE}` }
                            : isCur
                              ? { boxShadow: "inset 4px 0 0 var(--primary)" }
                              : undefined
                        }
                      >
                        <td className="pr-3 pl-5 whitespace-nowrap">
                          <div className="font-mono font-semibold">{short(no)}</div>
                          {open > 0 && (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-semibold text-warn-ink">
                              <Sparkles className="size-3.5" /> AI 확인 {open}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="truncate font-semibold">{r.p.task}</div>
                          <div className="truncate text-[13px] text-muted-foreground">
                            {zone ? `${blockName(r.p.block)} · ${zone.name}` : <span className="font-semibold text-legal">구역 미매핑</span>}
                          </div>
                        </td>
                        <td className="px-3">
                          {/* 가장 앞선 근거 하나만, 나머지는 오른쪽 근거 칸에서 */}
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate">{r.chips[0] && <ReasonChip {...r.chips[0]} />}</span>
                            {r.chips.length > 1 && <span className="shrink-0 text-[13px] text-muted-foreground">+{r.chips.length - 1}</span>}
                          </div>
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className={cn("inline-grid h-8 min-w-9 place-items-center rounded-md px-1.5 text-[15px] font-semibold", SUGG_CLS[r.suggestion])}>
                              {r.suggestion}
                            </span>
                            <ArrowRight className="size-4 text-muted-foreground/60" />
                            {r.suggestion === "보류" ? (
                              <span className="text-[14px] text-muted-foreground">구역 매핑 필요</span>
                            ) : (
                              <YnToggle value={r.final} differs={differs} onChange={(v) => onToggle(no, v)} />
                            )}
                          </div>
                          <NeedLine r={r} />
                        </td>
                        <td className="px-3 text-[14px] whitespace-nowrap">
                          {r.inspector ? r.inspector : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {cur && <Evidence key={cur.sel.permit} r={cur} ai={ai} onToggle={onToggle} onDecide={onDecide} onAi={onAi} />}
        </div>
      </div>

      <footer className="flex h-[76px] shrink-0 items-center gap-3 border-t bg-card px-5">
        <Button variant="outline" size="lg" className="h-11 px-4 text-[15px]" onClick={onBack}>
          <ArrowLeft /> 허가서 접수함
        </Button>
        <Button variant="outline" size="lg" className="h-11 px-4 text-[15px]" onClick={() => onTodo("선별 근거 보고서")}>
          <FileDown /> 선별 근거 보고서
        </Button>
        <span className={cn("ml-auto text-right text-[15px]", blocking.length ? "font-semibold text-warn-ink" : "text-muted-foreground")}>
          {blocking.length ? `결정·사유 필요 ${blocking.length}건` : held.length ? `보류 ${held.length}건은 구역 매핑 후 추가` : "모든 허가서 결정 완료"}
        </span>
        <Button size="lg" className="h-11 px-5 text-[16px]" disabled={blocking.length > 0} onClick={onConfirm}>
          확정 → 당일 관제 목록 생성 <ArrowRight />
        </Button>
      </footer>
    </>
  )
}

/** 최종 Y/N 토글: 제안과 다르면 주황 테두리 */
function YnToggle({ value, differs, onChange }: { value: "Y" | "N" | null; differs: boolean; onChange: (v: "Y" | "N") => void }) {
  return (
    <span
      className="inline-flex rounded-lg border p-1"
      style={differs ? { borderColor: ORANGE, boxShadow: `0 0 0 1px ${ORANGE}` } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {(["Y", "N"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "h-8 w-10 rounded-md text-[15px] font-semibold transition-colors",
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {v}
        </button>
      ))}
    </span>
  )
}

function NeedLine({ r }: { r: SelRow }) {
  const text = r.decision ? "사유 기록됨" : r.suggestion === "검토" && r.final === null ? "Y/N 결정 필요" : r.needsReason ? "사유 필요" : null
  if (!text) return null
  return (
    <div className={cn("mt-1 text-[13px]", !r.decision && "font-semibold")} style={{ color: ORANGE }}>
      {text}
    </div>
  )
}

function Evidence({ r, ai, onToggle, onDecide, onAi }: { r: SelRow; ai: AiStates } & Pick<Props, "onToggle" | "onDecide" | "onAi">) {
  const [reason, setReason] = useState<string>()
  const [note, setNote] = useState("")
  const p = r.p
  const zone = zoneOf(p.zoneId)
  const checks = checksOf(p.no)
  const contributions = r.sel.contributions

  return (
    <Panel>
      <header className="shrink-0 border-b px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[22px] font-semibold">{p.no}</span>
          <FormTag form={p.form} ai={p.aiForm} className="text-[14px]" />
        </div>
        <div className="mt-1 text-[17px] leading-snug font-semibold break-keep">{p.task}</div>
        <div className="mt-0.5 text-[14px] text-muted-foreground">
          {zone ? `${blockName(p.block)} · ${zone.name} · 측정기 ${zone.sensor}` : "구역 미매핑"} · {p.workers}명
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* 제안 */}
        <section className="rounded-xl bg-muted/60 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[15px] text-muted-foreground">시스템 제안</span>
            <span className={cn("inline-grid h-9 min-w-12 place-items-center rounded-md px-2.5 text-[18px] font-semibold", SUGG_CLS[r.suggestion])}>
              {r.suggestion}
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-snug break-keep">
            {r.suggestion === "Y" && "대면 점검 대상 · 추가조치: 작업 전 복합가스 측정 · 환기 · 감시자 배치"}
            {r.suggestion === "N" && "상시 센서로 감시 · 대면 점검 없음"}
            {r.suggestion === "검토" && "규칙만으로 정하지 않음 — 관리자가 Y/N을 정합니다"}
            {r.suggestion === "보류" && "구역이 정해지지 않아 근거를 낼 수 없습니다 — 허가서 접수함에서 구역 매핑"}
          </p>
        </section>

        {/* 관리자 결정 */}
        {r.suggestion !== "보류" && (
          <section className={cn("rounded-xl border-2 px-4 py-3.5", r.blocking ? "border-warn/55 bg-warn-soft/50" : "border-border")}>
            <div className="flex items-center gap-3">
              <h3 className="font-heading text-[18px] font-semibold">관리자 결정</h3>
              <YnToggle value={r.final} differs={r.needsReason && r.suggestion !== "검토"} onChange={(v) => onToggle(p.no, v)} />
              <span className="ml-auto text-[14px] text-muted-foreground">
                {r.final === null ? "결정 전" : r.needsReason ? `제안 ${r.suggestion}와 다름` : "제안과 같음"}
              </span>
            </div>
            {r.decision ? (
              <div className="mt-3 rounded-lg bg-card px-3.5 py-2.5 text-[15px] leading-snug break-keep">
                <b>{r.decision.reason}</b>
                {r.decision.note && ` · ${r.decision.note}`}
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {r.decision.by} {r.decision.at} · 제안 {r.suggestion} → 최종 {r.decision.final}
                </div>
              </div>
            ) : r.needsReason ? (
              <div className="mt-3 space-y-2.5">
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="h-10 w-full bg-card text-[15px] data-[size=default]:h-10">
                    <SelectValue placeholder="사유 선택 (필수)" />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((x) => (
                      <SelectItem key={x} value={x} className="text-[15px]">
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="메모 (선택)"
                  className="min-h-16 bg-card text-[15px] md:text-[15px]"
                />
                <Button size="lg" className="h-10 w-full text-[15px]" disabled={!reason} onClick={() => reason && onDecide(p.no, reason, note.trim())}>
                  결정 저장
                </Button>
              </div>
            ) : r.final === null ? (
              <p className="mt-2.5 text-[15px] font-semibold" style={{ color: ORANGE }}>
                Y 또는 N을 고르세요
              </p>
            ) : null}
          </section>
        )}

        {/* 근거 */}
        <section>
          <h3 className="mb-3 font-heading text-[18px] font-semibold">선정 근거</h3>
          {contributions ? (
            <div className="space-y-3">
              {contributions.map((c) => {
                const w = c.value === "단독 Y" ? 100 : Math.min(100, Math.abs(parseFloat(c.value)) * 100 || 0)
                return (
                  <div key={c.rule} className="grid grid-cols-[1fr_110px_60px] items-center gap-3 text-[14px]">
                    <span className="leading-snug break-keep">
                      <b className="font-mono text-primary">{c.rule}</b> {c.label}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn("block h-full rounded-full", c.rule === "S-5" || c.rule === "S-6" ? "bg-[#d9895a]" : "bg-[#2f8f86]")}
                        style={{ width: `${w}%` }}
                      />
                    </span>
                    <span className="text-right font-mono font-semibold tabular-nums">{c.value}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {r.chips.map((c, i) => (
                <ReasonChip key={i} {...c} />
              ))}
            </div>
          )}
        </section>

        {checks.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 font-heading text-[18px] font-semibold">
              <Sparkles className="size-5 text-primary" /> AI 체크
            </h3>
            <AiFindings checks={checks} ai={ai} onAct={onAi} compact />
          </section>
        )}

        {r.sel.history && (
          <section>
            <h3 className="mb-2 font-heading text-[18px] font-semibold">과거 유사 작업</h3>
            <ul className="divide-y rounded-xl border">
              {r.sel.history.map((h) => (
                <li key={h.date + h.place} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
                  <span className="font-mono text-[14px] text-muted-foreground">{h.date}</span>
                  <span className="min-w-0 flex-1 truncate">{h.place}</span>
                  <span className={cn("font-semibold", h.result.startsWith("경계") ? "text-warn-ink" : "text-ok")}>{h.result}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Panel>
  )
}
