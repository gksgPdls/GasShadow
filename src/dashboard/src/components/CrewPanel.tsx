import { Building2, Clock, FileText, Gauge, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ZONES } from "@/data/scenario"
import { crewOf, permitInfo } from "@/data/crew"
import { PanelHeader } from "@/components/Panel"
import { EntryCard, FormBadge, PresenceChip, UnapprovedBadge, type Presence } from "@/components/crew-ui"
import { useCrewState } from "@/lib/crew-state"

interface Props {
  zoneId: string
  /** 지금 현황판에 걸린 출입증 (작업자 번호). 3D가 알려준다 */
  tagged: number[]
  onClose: () => void
  /** 같은 구역의 가스 정보(구역 상세)로 */
  onGas: () => void
}

// 3D에서 밀폐구역 앞 출입현황판을 눌렀을 때: 무슨 작업인지 · 지금 안에 몇 명인지 크게 · 작업자 출입증마다 안/밖 (안에 있는 사람 먼저)
// 구역 상세(ZoneDetail)와 같은 틀: 제목 줄 → 이름·작업 → 큰 숫자 → 정보 줄 → 목록
export function CrewPanel({ zoneId, tagged, onClose, onGas }: Props) {
  const started = useCrewState().started[zoneId] ?? false
  const zone = ZONES.find((z) => z.id === zoneId)
  const info = permitInfo(zoneId)
  if (!zone || !info) return null
  const crew = crewOf(zoneId)
  const inside = crew.filter((m) => tagged.includes(m.n))
  const presenceOf = (n: number): Presence => (tagged.includes(n) ? "in" : started ? "out" : "before")
  const ORDER: Record<Presence, number> = { in: 0, out: 1, before: 2 }
  const listed = [...crew].sort((a, b) => ORDER[presenceOf(a.n)] - ORDER[presenceOf(b.n)] || a.n - b.n)
  const total = info.workers
  const n = inside.length

  return (
    <section className="minimal-side flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <PanelHeader>
        <button
          type="button"
          onClick={onClose}
          className="-ml-1.5 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[16px] leading-none font-semibold hover:bg-muted"
        >
          <X className="size-4 text-muted-foreground" /> 닫기
        </button>
      </PanelHeader>
      <div className="border-b px-5 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.02em]">{zone.name}</h2>
          <span className="mt-1 shrink-0 rounded-md bg-accent px-2 py-1 text-[14px] font-semibold text-accent-foreground">출입현황</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {info.unapproved && <UnapprovedBadge />}
          <FormBadge form={info.form} />
          <span className="truncate text-[15px] text-muted-foreground">{info.task}</span>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* 지금 구역 안 인원: 크게 + 허가 인원만큼 사람 모양 (안에 있으면 채움) */}
        <div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-[22px] font-semibold text-muted-foreground">구역 안</span>
              <span className="font-mono text-[44px] leading-none font-semibold tracking-[-0.03em] text-primary tabular-nums">{n}</span>
              <span className="text-[17px] text-muted-foreground">{info.unapproved ? `명 / 허가 0명 · 출입증 ${total}장` : `명 / 허가 ${total}명`}</span>
            </div>
            <div className="flex flex-wrap gap-0.5">
              {Array.from({ length: total }, (_, k) => (
                <Person key={k} on={k < n} />
              ))}
            </div>
          </div>
        </div>

        <dl className="divide-y rounded-xl border text-[15px]">
          <Row icon={<FileText />} label="허가서">
            <span className="font-mono">{info.no}</span>
            {info.unapproved && <span className="ml-1.5 text-unauth">승인 전</span>}
          </Row>
          <Row icon={<Clock />} label="시간">
            <span className="font-mono">{info.time.replace("-", " – ")}</span>
          </Row>
          <Row icon={<Building2 />} label="업체">
            {crew[0]?.company ?? "—"}
          </Row>
          <Row icon={<Users />} label="작업반">
            {info.team}
          </Row>
        </dl>

        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[15px] font-semibold">작업자 출입 현황</span>
            <span className="font-mono text-[14px] text-muted-foreground tabular-nums">{crew.length}</span>
          </div>
          {crew.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">등록된 작업자가 없어요</p>
          ) : (
            <div className="space-y-2">
              {listed.map((m) => (
                <EntryCard key={m.n} m={m} badge={<PresenceChip p={presenceOf(m.n)} />} />
              ))}
            </div>
          )}
        </div>

        <Button size="lg" variant="outline" className="h-11 w-full text-[15px]" onClick={onGas}>
          <Gauge /> 이 구역 가스 정보 보기
        </Button>
      </div>
    </section>
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <dt className="w-14 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-semibold">{children}</dd>
    </div>
  )
}

// 사람 모양 (머리 + 어깨). on = 안에 있음
function Person({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 30" className={cn("h-7 w-[22px]", on ? "text-primary" : "text-idle")} aria-hidden>
      <circle cx="12" cy="8" r="6" fill="currentColor" />
      <path d="M1 30c0-7.5 5-12 11-12s11 4.5 11 12z" fill="currentColor" />
    </svg>
  )
}
