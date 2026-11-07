import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { BlockBoard } from "@/components/BlockBoard"
import { AgentDock } from "@/components/AgentDock"
import { useAgentTeam } from "@/lib/useAgentTeam"
import { AlertBanners } from "@/components/AlertBanners"
import { ZoneDetail } from "@/components/ZoneDetail"
import { CrewPanel } from "@/components/CrewPanel"
import { addRecord } from "@/lib/records"
import { focusCrew, setCrew, useCrewState } from "@/lib/crew-state"
import { cn } from "@/lib/utils"
import { STATUS, fmtTime } from "@/lib/sim"
import type { Block3DApi } from "@/three/block3d"
import type { PageProps } from "@/pages/types"
import { blockName } from "@/data/scenario"

// MN-01 관리자 메인 (오늘 관제). 평소에는 3D를 넓게. 알람은 3D 위 배너로 뜨고,
// 배너나 3D의 구역을 누르면 그때만 왼쪽에 구역 상세(흰 칸)가 열린다. 구역 안 출입현황판을 누르면 왼쪽에 작업자 현황.
// 안전 에이전트는 3D 오른쪽 아래 캐릭터: 배너의 '에이전트 팀 분석'을 누르면 말풍선으로 분석을 보여 준다 (조치는 구역 상세 아래 단추)
export function TodayPage({ view, sim, onTodo, ackZoneId, onAckZone: setAckZoneId }: PageProps & { ackZoneId: string | null; onAckZone: (id: string | null) => void }) {
  const [zoneId, setZoneId] = useState<string | null>(null)
  const [has3d, setHas3d] = useState(true)
  // 출입현황판: 연 구역 · 구역마다 지금 걸린 출입증 (3D가 바뀔 때마다 crew-state에 넣는다)
  const [crewZone, setCrewZone] = useState<string | null>(null)
  const crew = useCrewState()
  const yard = useRef<Block3DApi | null>(null)
  const team = useAgentTeam(view, sim.ai.predictions, sim.zoneDetail)

  const zoneBlock = (zid: string) => view.blocks.find((b) => b.zones.some((z) => z.id === zid))?.def.id ?? null
  // 블록의 가장 나쁜 구역
  const worstZone = (bid: string) => {
    const b = view.blocks.find((x) => x.def.id === bid)
    return b ? [...b.zones].sort((x, y) => STATUS[x.status].rank - STATUS[y.status].rank)[0]?.id ?? null : null
  }

  // 3D에서 블록이 골라지면 그 블록의 가장 나쁜 구역을 연다 (구역 부피를 눌렀으면 onZone이 덮어씀)
  const onSelect = (bid: string | null) => {
    setCrewZone((cur) => (bid === null || (cur && zoneBlock(cur) !== bid) ? null : cur))
    setZoneId((cur) => (bid === null ? null : cur && zoneBlock(cur) === bid ? cur : worstZone(bid)))
  }
  // 3D만 그 구역(출입현황판이 보이는 각도)으로 확대하고 왼쪽 구역 상세는 열지 않는다 (배너의 '에이전트 팀 분석')
  const focusZone = (zid: string) => {
    const bid = zoneBlock(zid)
    if (bid) yard.current?.select(bid, zid, true)
  }
  const openZone = (zid: string) => {
    const bid = zoneBlock(zid)
    if (bid) yard.current?.select(bid, zid)
    setCrewZone(null)
    setZoneId(zid)
  }
  // 작업자 관리에서 "현황판 보기"를 눌렀을 때: 그 블록으로 가서 현황판을 연다
  useEffect(() => {
    if (!crew.focus) return
    const zid = crew.focus
    focusCrew(null)
    const bid = zoneBlock(zid)
    if (bid) yard.current?.select(bid, zid)
    setZoneId(zid)
    setCrewZone(zid)
  }, [crew.focus]) // eslint-disable-line react-hooks/exhaustive-deps -- focus가 들어올 때만
  const back = () => {
    setZoneId(null)
    setCrewZone(null)
    yard.current?.goto("all")
  }

  // 【AI ①】 규칙상 아직 정상·작업 없음이지만 예측 모델이 60분 안 초과를 예측한 구역
  const early = view.zoneStatus
    .filter((z) => (z.status === "ok" || z.status === "idle") && ["IMMINENT", "WATCH"].includes(sim.ai.predictions[z.id]?.forecast_state ?? ""))
    .flatMap((z) => view.blocks.flatMap((b) => b.zones.filter((x) => x.id === z.id).map((x) => ({ id: x.id, name: x.name, block: b.def.id }))))

  const detail = zoneId ? sim.zoneDetail(zoneId) : null
  // 왼쪽 창(420px + 여백)이 3D를 가리는 만큼 3D가 보는 가운데를 오른쪽으로 옮긴다
  const sideOpen = !!(zoneId || crewZone)
  useEffect(() => {
    yard.current?.setInsets(sideOpen && window.innerWidth > 1100 ? 432 : 0) // 좁은 화면은 창이 3D 위가 아니라 위아래로 쌓인다
  }, [sideOpen])
  const siblings = detail ? view.blocks.find((b) => b.def.id === detail.zone.block)?.zones ?? [] : []
  const ackZone = view.focus.find((f) => f.zone.id === ackZoneId)?.zone

  return (
    <>
      <main
        className={cn(
          // 왼쪽 구역 상세·출입현황은 3D 위에 겹쳐 띄운다 (minimal.css .minimal-side). 3D 크기가 그대로라 화면이 뚝 바뀌지 않는다
          "minimal-today relative grid min-h-0 flex-1 grid-cols-1 gap-3 p-3",
        )}
      >
        {crewZone ? (
          <CrewPanel key={crewZone} zoneId={crewZone} tagged={crew.tagged[crewZone] ?? []} onClose={back} onGas={() => openZone(crewZone)} />
        ) : detail ? (
          <ZoneDetail
            key={detail.zone.id}
            detail={detail}
            t={view.t}
            siblings={siblings}
            pending={view.pending.some((z) => z.id === detail.zone.id)}
            onBack={back}
            onZone={openZone}
            onAck={() => setAckZoneId(detail.zone.id)}
            prediction={sim.ai.predictions[detail.zone.id]}
            onBlower={(i, on) => toast(sim.setBlower(detail.zone.id, i, on))}
            onCall={(role) => toast(sim.call(role, detail.zone.id))}
          />
        ) : null}
        <BlockBoard
          view={view}
          has3d={has3d}
          yardRef={yard}
          onSelect={onSelect}
          onZone={openZone}
          onBoard={(zid) => {
            setZoneId(zid)
            setCrewZone(zid)
          }}
          onCrew={setCrew}
          onTodo={onTodo}
          onNo3d={() => setHas3d(false)}
          stale={sim.stale}
        >
          {/* 상세를 보는 동안에는 배너를 숨긴다 (닫으면 다시) */}
          {!detail && !crewZone && (
            <AlertBanners
              items={view.focus}
              early={early}
              predictions={sim.ai.predictions}
              selectedZone={zoneId}
              onPick={openZone}
              onFocus={focusZone}
              onAck={setAckZoneId}
              team={team}
            />
          )}
          <AgentDock team={team} view={view} predictions={sim.ai.predictions} onOpenZone={openZone} />
        </BlockBoard>
      </main>

      <AlertDialog open={!!ackZone} onOpenChange={(o) => !o && setAckZoneId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[20px]">{ackZone?.name} 법정 기준 초과</AlertDialogTitle>
            <AlertDialogDescription className="text-[15px]">
              책임자 확인과 작업 중지 지시를 기록합니다. 경보는 기준 아래로 내려갈 때까지 유지됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="lg">취소</AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              className="bg-legal text-white hover:bg-legal/90"
              onClick={() => {
                if (!ackZone) return
                sim.ack(ackZone.id)
                addRecord({
                  day: "11/9", time: fmtTime(view.t), kind: "경보", who: "안전관리자",
                  target: `${ackZone.name} · ${blockName(ackZone.block)}`, text: "책임자 확인 · 작업 중지 지시",
                })
              }}
            >
              확인 · 작업 중지 지시
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
