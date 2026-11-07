import { useState } from "react"
import { TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import { DemoBar } from "@/components/DemoBar"
import { TopNav } from "@/components/TopNav"
import { HistoryPage } from "@/pages/HistoryPage"
import { PermitReviewPage } from "@/pages/review/PermitReviewPage"
import { WorkersPage } from "@/pages/WorkersPage"
import { TodayPage } from "@/pages/TodayPage"
import { useRoute } from "@/lib/route"
import { useSimulation } from "@/lib/useSimulation"

const showDemo = new URLSearchParams(location.search).get("demo") !== "0"

export default function App() {
  const sim = useSimulation()
  const { view } = sim
  const { route, navigate } = useRoute()
  // 경보 확인 창에 띄울 구역 (위쪽 네비 '경보 처리'와 오늘 관제가 같이 쓴다)
  const [ackZoneId, setAckZoneId] = useState<string | null>(null)

  const onTodo = (what: string) => toast(`${what} 화면은 준비 중입니다`)
  const page = { view, sim, onTodo, navigate }
  // 장애 배너는 당일 화면(오늘 관제 · 작업자 관리)에만
  const live = route === "today" || route === "workers"

  return (
    <>
      <div className="minimal-app flex min-h-[var(--app-h,100dvh)] flex-col lg:h-[var(--app-h,100dvh)]">
        <TopNav
          route={route}
          view={view}
          onNavigate={navigate}
          onAlarm={() => {
            navigate("today")
            if (view.pending[0]) setAckZoneId(view.pending[0].id)
          }}
        />
        {live && view.outage && (
          <div className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn-soft px-5 py-2 text-[13px] text-warn-ink">
            <TriangleAlert className="size-4" />
            <span>
              서버·통신 장애 감지 — <b>기본 순회 모드</b>: 2시간 순회표 기준으로 측정하세요.
            </span>
            <button type="button" onClick={() => onTodo("순회표 인쇄")} className="underline underline-offset-2">
              순회표 인쇄
            </button>
          </div>
        )}

        {/* 오늘 관제는 3D 시점·선택을 유지하려고 다른 탭에서도 내리지 않고 숨긴다 */}
        <div className={route === "today" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TodayPage {...page} ackZoneId={ackZoneId} onAckZone={setAckZoneId} />
        </div>
        {route === "prep" && <PermitReviewPage {...page} />}
        {route === "workers" && <WorkersPage {...page} />}
        {route === "history" && <HistoryPage {...page} />}

        {showDemo && route !== "prep" && (
          <DemoBar
            playing={sim.playing}
            speed={sim.speed}
            outage={view.outage}
            onPlaying={sim.setPlaying}
            onSpeed={sim.setSpeed}
            onReset={sim.reset}
            onOutage={sim.setOutage}
          />
        )}
      </div>

      <Toaster position="top-center" offset={76} richColors toastOptions={{ className: "text-[15px]" }} />
    </>
  )
}
