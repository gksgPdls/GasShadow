import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LIMITS } from "@/data/scenario"
import { fmtVal, gasLabel, type FocusItem } from "@/lib/sim"
import { statusText } from "@/lib/status-classes"
import { StatusBadge } from "@/components/status"
import { predictionText } from "@/lib/prediction"
import type { Prediction } from "@/lib/server"
import { AgentButton } from "@/components/AgentDock"
import type { AgentTeam } from "@/lib/useAgentTeam"

const SHOW = 3 // 처음에는 3건까지만 띄우고 나머지는 '외 N곳'

interface Props {
  items: FocusItem[]
  /** 규칙상 아직 정상인데 예측 모델이 60분 안 초과를 예측한 구역 */
  early: { id: string; name: string }[]
  predictions: Record<string, Prediction>
  selectedZone: string | null
  onPick: (zoneId: string) => void
  /** '에이전트 팀 분석'을 눌렀을 때: 3D만 그 구역으로 확대 (왼쪽 구역 상세는 열지 않는다) */
  onFocus: (zoneId: string) => void
  onAck: (zoneId: string) => void
  /** 배너마다 '에이전트 팀 분석' 단추 → 오른쪽 아래 에이전트가 분석을 보여 준다 */
  team: AgentTeam
}

// 3D 왼쪽 위(공정 바로가기 아래)에 뜨는 알람 배너. 짧게만 보여주고, 누르면 왼쪽에 구역 상세(흰 칸)가 열린다
export function AlertBanners({ items, early, predictions, selectedZone, onPick, onFocus, onAck, team }: Props) {
  const [open, setOpen] = useState(false)
  const all = [...items.map((f) => ({ kind: "zone" as const, f })), ...early.map((e) => ({ kind: "early" as const, e }))]
  if (!all.length) return null
  const shown = open ? all : all.slice(0, SHOW)
  const more = all.length - shown.length

  return (
    <div className="minimal-alerts absolute top-16 left-3 z-[4] flex max-h-[calc(100%-8rem)] w-[min(424px,calc(100%-1.5rem))] flex-col gap-2 overflow-y-auto">
      {shown.map((x) =>
        x.kind === "zone" ? (
          <ZoneBanner key={x.f.zone.id} f={x.f} p={predictions[x.f.zone.id]} selected={selectedZone === x.f.zone.id} onPick={onPick} onFocus={onFocus} onAck={onAck} team={team} />
        ) : (
          <div
            key={x.e.id}
            role="button"
            tabIndex={0}
            onClick={() => onPick(x.e.id)}
            onKeyDown={(e) => e.key === "Enter" && onPick(x.e.id)}
            className={cn(
              "minimal-alert relative overflow-hidden rounded-xl border bg-card py-2.5 pr-3 pl-4 text-left shadow-md transition hover:border-foreground/25",
              selectedZone === x.e.id && "ring-2 ring-primary",
            )}
          >
            <span className="absolute inset-y-0 left-0 w-1.5 bg-warn" />
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[13px] font-semibold text-warn-ink">예측</span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{x.e.name}</span>
                <span className="block truncate text-[14px] text-warn-ink">{predictionText(predictions[x.e.id])?.text}</span>
              </span>
              <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="mt-2 flex justify-end border-t pt-2">
              <AgentButton team={team} zoneId={x.e.id} className="w-[150px]" onRequest={() => onFocus(x.e.id)} />
            </div>
          </div>
        ),
      )}
      {(more > 0 || open) && all.length > SHOW && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-center gap-1 self-start rounded-full border bg-card px-3 py-1 text-[14px] font-medium shadow-sm hover:bg-muted"
        >
          {open ? "접기" : `외 ${more}곳 더 보기`}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      )}
    </div>
  )
}

function ZoneBanner({ f, p, selected, onPick, onFocus, onAck, team }: { f: FocusItem; p?: Prediction; selected: boolean; onPick: (id: string) => void; onFocus: (id: string) => void; onAck: (id: string) => void; team: AgentTeam }) {
  const z = f.zone
  const a = f.a
  const legal = f.status === "legal"
  const pred = !legal && a.status !== "missing" ? predictionText(p) : null
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPick(z.id)}
      onKeyDown={(e) => e.key === "Enter" && onPick(z.id)}
      className={cn(
        "minimal-alert relative overflow-hidden rounded-xl border bg-card py-2.5 pr-3 pl-4 text-left shadow-md transition hover:border-foreground/25",
        legal && "border-legal/40",
        f.status === "unauth" && "border-unauth/40",
        selected && "ring-2 ring-primary",
      )}
    >
      {/* 윗줄: 상태 칩 · 구역 이름 · 화살표 / 가는 선 / 아랫줄: 왼쪽은 가스 농도만 크게 | 오른쪽은 경보 처리 · 에이전트 팀 분석 */}
      <div className="flex items-center gap-2">
        <StatusBadge status={f.status} className="minimal-alert-chip" />
        <span className="min-w-0 truncate text-[16px] font-semibold">{z.name}</span>
        <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-2 flex items-center gap-3 border-t pt-2">
        {a.status === "missing" ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-[14px] text-muted-foreground">센서</span>
            <span className="text-[24px] leading-none font-semibold text-missing">신호 없음</span>
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-[14px] text-muted-foreground">{gasLabel(a.gas)}</span>
            <span className={cn("font-mono text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums", statusText[f.status])}>{fmtVal(a.gas, a.value)}</span>
            <span className="text-[14px] text-muted-foreground">{LIMITS[a.gas].unit}</span>
          </span>
        )}
        <span className="flex w-[150px] shrink-0 flex-col gap-1.5">
          {legal && !z.acked && (
            <Button
              className="h-8 w-full bg-legal text-[14px] font-semibold text-white hover:bg-legal/90"
              onClick={(e) => {
                e.stopPropagation()
                onAck(z.id)
              }}
            >
              경보 처리
            </Button>
          )}
          {/* 분석을 부르면 3D만 그 구역으로 확대한다 (분석 말풍선은 오른쪽, 왼쪽 구역 상세는 안 열림) */}
          <AgentButton team={team} zoneId={z.id} onRequest={() => onFocus(z.id)} />
        </span>
      </div>
      {pred?.hot && <div className="mt-1.5 truncate text-[13px] font-semibold text-warn-ink">예측 · {pred.text}</div>}
    </div>
  )
}
