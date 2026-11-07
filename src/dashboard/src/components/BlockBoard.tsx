import type { ReactNode, RefObject } from "react"
import { Box, Info } from "lucide-react"
import { fmtClock, type SimView } from "@/lib/sim"
import type { Block3DApi } from "@/three/block3d"
import { Legend } from "@/components/status"
import { Yard3D } from "@/components/Yard3D"

interface Props {
  view: SimView
  has3d: boolean
  yardRef: RefObject<Block3DApi | null>
  onSelect: (id: string | null) => void
  onZone: (zoneId: string) => void
  onBoard: (zoneId: string) => void
  onCrew: (zoneId: string, ns: number[], started: boolean) => void
  onTodo: (what: string) => void
  onNo3d: () => void
  /** 서버 값이 끊김 → 구역 색은 마지막으로 받은 때 기준 */
  stale: boolean
  /** 3D 위에 띄울 것 (알람 배너) */
  children?: ReactNode
}

// 가운데: 3D(건조 공정 흐름 위 블록과 밀폐구역). 제목 줄 없이 3D만, 블록 위 이름표·말풍선 없이 구역 색으로만 상태를 보여준다
export function BlockBoard({ view, has3d, yardRef, onSelect, onZone, onBoard, onCrew, onTodo, onNo3d, stale, children }: Props) {
  return (
    <section className="minimal-board flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="relative min-h-[380px] flex-1">
        {has3d ? (
          <>
            <Yard3D
              zoneStatus={view.zoneStatus}
              t={view.t}
              people={view.people}
              apiRef={yardRef}
              colorOnly
              onSelect={onSelect}
              onZone={onZone}
              onBoard={onBoard}
              onCrew={onCrew}
              onTodo={onTodo}
              onUnavailable={onNo3d}
            />
            {children}
            {stale && (
              <div className="absolute bottom-3 left-1/2 z-[4] -translate-x-1/2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-1.5 text-[13px] whitespace-nowrap text-warn-ink">
                값이 끊겨서 구역 색은 <b className="font-mono tabular-nums">{view.lastRecv !== null ? fmtClock(view.lastRecv) : "—"}</b> 기준이에요
              </div>
            )}
            {/* 색 범례 + 조작법(평소엔 작은 단추로 접어 두고 마우스를 올리면 펼친다) */}
            <Legend className="absolute right-3 bottom-3 z-[3] hidden flex-nowrap rounded-lg border bg-white/90 px-3 py-1.5 text-[12.5px] whitespace-nowrap shadow-sm xl:flex" />
            <div className="b3-info group absolute bottom-3 left-3 z-[3] flex items-end gap-2">
              <span className="grid size-8 cursor-help place-items-center rounded-full border bg-white/90 text-muted-foreground shadow-sm">
                <Info className="size-4" />
              </span>
              <span className="rounded-lg border bg-white/90 px-3 py-1.5 text-[12.5px] text-muted-foreground shadow-sm group-hover:hidden">
                센서 수신{" "}
                <b className={view.sensorOk < view.zoneStatus.length ? "font-mono text-missing tabular-nums" : "font-mono text-ok tabular-nums"}>
                  {view.sensorOk}/{view.zoneStatus.length}
                </b>{" "}
                · 마지막 수신 <span className="font-mono text-foreground tabular-nums">{view.lastRecv !== null ? fmtClock(view.lastRecv) : "—"}</span>
              </span>
              <p className="pointer-events-none hidden rounded-lg border bg-white/95 px-3 py-2 text-[14px] text-muted-foreground shadow-sm group-hover:block">
                끌어서 회전 · 오른쪽 끌기 이동 · 휠 확대 · 블록이나 구역을 누르면 왼쪽에 상세 · 구역 안 출입현황판을 누르면 작업자 현황
              </p>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/50 text-[15px] text-muted-foreground">
            <Box className="size-7" />
            이 브라우저에서는 3D를 표시할 수 없습니다
          </div>
        )}
      </div>
    </section>
  )
}
