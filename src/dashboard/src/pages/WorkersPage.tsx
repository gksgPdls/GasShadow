import { useMemo, useState } from "react"
import { ArrowRight, Building2, Clock, FileText, MapPin, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { STATUS, type Status } from "@/lib/sim"
import { statusText } from "@/lib/status-classes"
import { focusCrew, useCrewState } from "@/lib/crew-state"
import { STAGE_NAME, todayCrew, type CrewRow } from "@/data/crew"
import { Avatar, EntryCard, FormBadge, UnapprovedBadge } from "@/components/crew-ui"
import { PanelHeader } from "@/components/Panel"
import { SearchBox, Segmented, StatRow } from "@/pages/review/ai/ui"
import type { PageProps } from "@/pages/types"

// 작업자 관리: 오늘 작업허가서 기준 전체 작업자. 검색 · 협력업체/공정/양식/상태로 거르기 · 허가서/협력업체/공정/블록으로 묶어 보기
// 안/밖은 3D 출입현황판(출입증이 걸렸는지)과 같은 값이다. 화면 틀은 작업허가 접수(IntakeView)와 같다: 제목 · 숫자 칸 · 필터 · 표

type Presence = "in" | "out" | "before"
const PRESENCE: Record<Presence, { label: string; cls: string; dot?: string }> = {
  in: { label: "구역 안", cls: "bg-accent text-accent-foreground", dot: "bg-ok" },
  out: { label: "밖 · 대기", cls: "bg-muted text-foreground", dot: "bg-muted-foreground/60" },
  before: { label: "작업 전", cls: "text-muted-foreground ring-1 ring-border ring-inset" },
}
const RISKY: Status[] = ["legal", "unauth", "missing", "warn"]

type GroupBy = "permit" | "company" | "stage" | "block" | "none"

interface Row extends CrewRow {
  presence: Presence
  zoneStatus: Status
}

const ALL_CREW = todayCrew()
const uniq = <T,>(xs: T[]) => [...new Set(xs)]

export function WorkersPage({ view, navigate }: PageProps) {
  const crewState = useCrewState()
  const zoneStatus = useMemo(() => new Map(view.zoneStatus.map((z) => [z.id, z.status])), [view.zoneStatus])
  const rows: Row[] = ALL_CREW.map((r) => ({
    ...r,
    presence: crewState.tagged[r.zoneId]?.includes(r.n) ? "in" : crewState.started[r.zoneId] ? "out" : "before",
    zoneStatus: zoneStatus.get(r.zoneId) ?? "idle",
  }))

  const [q, setQ] = useState("")
  const [company, setCompany] = useState("")
  const [stage, setStage] = useState<CrewRow["stage"] | "">("")
  const [form, setForm] = useState("")
  const [presence, setPresence] = useState<Presence | "all">("all")
  // 묶음은 작업허가서 기준 하나로 둔다 (고르는 칸 대신 협력업체·공정·양식 거르기)
  const groupBy = "permit" as GroupBy
  const [picked, setPicked] = useState<string | null>(null)

  const companies = uniq(ALL_CREW.map((r) => r.company)).sort()
  const stages = uniq(ALL_CREW.map((r) => r.stage))
  const forms = uniq(ALL_CREW.map((r) => r.form))

  const needle = q.trim().replace(/\s+/g, "").toLowerCase()
  const shown = rows.filter((r) => {
    if (company && r.company !== company) return false
    if (stage && r.stage !== stage) return false
    if (form && r.form !== form) return false
    if (presence !== "all" && r.presence !== presence) return false
    if (!needle) return true
    const hay = [r.name, r.company, r.dept, r.team, r.permitNo, r.task, r.zoneName, r.blockName, r.phone, `작업자${r.n}`].join("|").replace(/\s+/g, "").toLowerCase()
    return hay.includes(needle)
  })

  // 묶기
  const keyOf = (r: Row) => (groupBy === "permit" ? r.permitNo : groupBy === "company" ? r.company : groupBy === "stage" ? r.stage : groupBy === "block" ? r.block : "all")
  const groups = new Map<string, Row[]>()
  shown.forEach((r) => groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]))
  const order: Record<Presence, number> = { in: 0, out: 1, before: 2 }
  groups.forEach((g) => g.sort((a, b) => order[a.presence] - order[b.presence] || a.n - b.n))
  // 위험한 구역 · 안에 사람이 많은 구역이 위로
  const RANK: Record<Status, number> = { legal: 0, unauth: 1, missing: 2, warn: 3, ok: 4, idle: 5 }
  const inCount = (g: Row[]) => g.filter((r) => r.presence === "in").length
  const sorted = [...groups.entries()].sort(([, a], [, b]) => RANK[a[0].zoneStatus] - RANK[b[0].zoneStatus] || inCount(b) - inCount(a))

  const sel = rows.find((r) => r.key === picked) ?? null
  const count = (p: Presence) => rows.filter((r) => r.presence === p).length
  const riskyIn = rows.filter((r) => r.presence === "in" && RISKY.includes(r.zoneStatus))

  const openBoard = (zoneId: string) => {
    focusCrew(zoneId)
    navigate("today")
  }

  return (
    <main className="workers-page flex min-h-0 flex-1 flex-col bg-card">
      <div className={cn("grid min-h-0 flex-1 grid-cols-1", sel && "xl:grid-cols-[minmax(0,1fr)_480px]")}>
        <div className="min-h-0 overflow-y-auto px-8 pt-6 pb-10">
          {/* 숫자 칸: 작업허가 접수와 같은 모양 (StatRow) */}
          <StatRow
            items={[
              { label: "오늘 작업자", value: rows.length },
              { label: "지금 밀폐구역 안", value: count("in") },
              { label: "밖 · 대기", value: count("out") },
              { label: "작업 시작 전", value: count("before") },
              { label: "위험 구역 안", value: riskyIn.length, tone: riskyIn.length ? "legal" : undefined, note: uniq(riskyIn.map((r) => r.zoneName)).join(" · ") || undefined },
            ]}
          />

          {/* 안/밖 토글 · 묶어 보기 · 큰 검색 칸 */}
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <h2 className="mr-2 text-[18px] font-semibold">작업자 목록</h2>
            <Segmented
              items={[
                { key: "all" as const, label: "전체" },
                { key: "in" as const, label: "구역 안" },
                { key: "out" as const, label: "밖 · 대기" },
                { key: "before" as const, label: "작업 전" },
              ]}
              value={presence}
              onChange={setPresence}
            />
            <div className="ml-auto flex items-center gap-2">
              <Pick label="협력업체" value={company} onChange={setCompany} options={companies.map((c) => [c, c])} />
              <Pick label="공정" value={stage} onChange={(v) => setStage(v as CrewRow["stage"] | "")} options={stages.map((st) => [st, STAGE_NAME[st]])} />
              <Pick label="허가서 양식" value={form} onChange={setForm} options={forms.map((f) => [f, f])} />
            </div>
          </div>
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="이름 · 협력업체 · 허가서 번호 · 구역 · 작업 · 연락처 끝자리로 찾기"
            className="mt-4 w-full"
            inputClassName="h-11 text-[15px] pl-9"
          />

          {/* 작업(구역)마다 한 묶음: 제목 줄(큰 굵은 구역 이름 · 작업 · 인원 · 출입현황판) + 아래 굵은 선, 그 밑에 작업자 줄.
              칸 머리글 없이, 작업자 줄은 칸 폭을 정해 왼쪽부터 붙인다 */}
          <div className="mt-6">
            {sorted.map(([k, g]) => (
              <section key={k} className="mt-8 first:mt-0">
                <GroupHead groupBy={groupBy} rows={g} onBoard={openBoard} />
                <ul>
                  {g.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        aria-pressed={r.key === picked}
                        onClick={() => setPicked(r.key === picked ? null : r.key)}
                        className={cn(
                          "grid w-full grid-cols-[minmax(180px,240px)_minmax(200px,320px)_170px_auto] items-center gap-4 border-b px-2 py-3 text-left text-[15px]",
                          r.key === picked ? "bg-accent" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-11 w-9" />
                          <span className="truncate text-[16px] font-semibold">{r.name}</span>
                          {r.unapproved && <UnapprovedBadge />}
                        </span>
                        <span className="truncate">
                          {r.company} <span className="text-[14px] text-muted-foreground">· {r.dept}</span>
                        </span>
                        <span className="font-mono text-[14px] text-muted-foreground tabular-nums">{r.phone}</span>
                        <PresenceChip p={r.presence} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {shown.length === 0 && <div className="grid h-40 place-items-center text-[14px] text-muted-foreground">조건에 맞는 작업자가 없습니다.</div>}
        </div>

        {/* 고른 작업자 (오른쪽 칸) */}
        {sel && (
          <aside className="flex min-h-0 flex-col border-l bg-card">
            <PanelHeader>
              <PresenceChip p={sel.presence} />
              <button type="button" onClick={() => setPicked(null)} className="ml-auto flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[15px] font-semibold hover:bg-muted">
                <X className="size-4 text-muted-foreground" /> 닫기
              </button>
            </PanelHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <EntryCard m={sel} foot={`작업자 ${sel.n} · ${sel.team}`} />
              <div>
                <div className="flex items-center gap-2">
                  {sel.unapproved && <UnapprovedBadge />}
                  <FormBadge form={sel.form} />
                  <span className="font-mono text-[13px] text-muted-foreground">{sel.permitNo}</span>
                </div>
                <h3 className="mt-1.5 text-[20px] leading-tight font-semibold tracking-[-0.01em]">{sel.task}</h3>
              </div>
              <dl className="divide-y rounded-xl border text-[14.5px]">
                <InfoRow icon={<MapPin />} label="위치">
                  {sel.zoneName} · {sel.blockName} · <span className={statusText[sel.zoneStatus]}>{STATUS[sel.zoneStatus].label}</span>
                </InfoRow>
                <InfoRow icon={<Clock />} label="시간">
                  <span className="font-mono">{sel.time.replace("-", " – ")}</span>
                </InfoRow>
                <InfoRow icon={<Building2 />} label="작업반">
                  {sel.team}
                </InfoRow>
                <InfoRow icon={<FileText />} label="허가서">
                  {sel.unapproved && <span className="text-unauth">승인 전 · </span>}
                  {rows.filter((r) => r.permitNo === sel.permitNo).length}명 · 지금 안 {rows.filter((r) => r.permitNo === sel.permitNo && r.presence === "in").length}명
                </InfoRow>
              </dl>
              <Button className="h-11 w-full gap-2 rounded-xl text-[15px] font-semibold" onClick={() => openBoard(sel.zoneId)}>
                실시간 관제에서 출입현황판 보기 <ArrowRight className="size-4" />
              </Button>
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 rounded-lg bg-card px-2.5 text-[14px] shadow-xs ring-1 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-primary",
        value ? "font-medium text-primary ring-primary" : "text-foreground ring-border",
      )}
    >
      <option value="">{label} 전체</option>
      {options.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  )
}

function PresenceChip({ p }: { p: Presence }) {
  const s = PRESENCE[p]
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium whitespace-nowrap", s.cls)}>
      {s.dot && <i className={cn("size-1.5 rounded-full", s.dot)} />}
      {s.label}
    </span>
  )
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <dt className="w-12 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  )
}

// 작업 제목 줄: 구역 이름(크게 · 굵게) · 양식·작업 ··· 구역 안 N/N명 · 출입현황판. 아래 굵은 검은 선으로 작업자 줄과 나눈다 (색 바탕 없음)
function GroupHead({ rows, onBoard }: { groupBy: GroupBy; rows: Row[]; onBoard: (zoneId: string) => void }) {
  const r = rows[0]
  const inside = rows.filter((x) => x.presence === "in").length
  return (
    <header className="flex items-end gap-3 border-b-2 border-foreground px-2 pb-2.5">
      <h3 className="shrink-0 text-[18px] leading-7 font-semibold tracking-[-0.01em]">{r.zoneName}</h3>
      <span className="flex min-w-0 items-center gap-1.5 pb-0.5 text-[15px] text-muted-foreground">
        {r.unapproved && <UnapprovedBadge className="text-[13px]" />}
        <FormBadge form={r.form} className="text-[13px]" />
        <span className="truncate">{r.task}</span>
      </span>
      <span className="ml-auto shrink-0 pb-0.5 text-[14px] text-muted-foreground">
        구역 안 <b className="text-[17px] font-semibold text-foreground tabular-nums">{inside}</b> / {rows.length}명
      </span>
      <button type="button" onClick={() => onBoard(r.zoneId)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[14px] font-medium text-primary hover:bg-accent">
        출입현황판 <ArrowRight className="size-3.5" />
      </button>
    </header>
  )
}
