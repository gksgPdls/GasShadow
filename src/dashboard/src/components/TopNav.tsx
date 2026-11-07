import { cn } from "@/lib/utils"
import { WORK_DAY } from "@/data/permits"
import { fmtTime, type SimView } from "@/lib/sim"
import type { Route } from "@/lib/route"
import { Logo } from "@/components/Logo"

const TABS: { route: Route; label: string }[] = [
  { route: "today", label: "실시간 관제" },
  { route: "prep", label: "작업허가 검토" },
  { route: "history", label: "안전 일지" },
  { route: "workers", label: "작업자 관리" },
]

interface Props {
  route: Route
  view: SimView
  onNavigate: (r: Route) => void
  /** (지금은 안 씀: 경보 처리는 알람 배너·구역 상세에서) */
  onAlarm?: () => void
}

// 위쪽 네비 (남색): 로고 · 화면 탭 · 현장 · 날짜 · 시각 · 경보 처리
export function TopNav({ route, view, onNavigate }: Props) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 bg-navy px-5 text-cream xl:gap-6">
      <button type="button" onClick={() => onNavigate("today")} aria-label="실시간 관제로" className="shrink-0">
        <Logo />
      </button>

      <nav className="flex h-full items-stretch">
        {TABS.map((tab) => (
          <button
            key={tab.route}
            type="button"
            onClick={() => onNavigate(tab.route)}
            className={cn(
              "relative flex items-center gap-2 px-3 text-[15px] whitespace-nowrap transition-colors xl:px-4",
              tab.route === route
                ? "font-semibold text-white after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full after:bg-warn"
                : "text-navy-muted hover:text-white",
            )}
          >
            {tab.label}
            {tab.route === "today" && view.legalCount > 0 && (
              <span className="rounded-full bg-legal px-1.5 font-mono text-[11px] leading-[18px] font-bold text-white">{view.legalCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* 오른쪽 끝: 날짜·시각 (모든 탭 같게). 경보 처리는 알람 배너에서 */}
      <div className="ml-auto flex items-center gap-3 text-[14px] whitespace-nowrap">
        <span className="flex items-baseline gap-2">
          <span className="hidden text-navy-muted lg:inline">{WORK_DAY}</span>
          <span className="font-mono text-[20px] font-semibold text-white tabular-nums">{fmtTime(view.t)}</span>
        </span>
      </div>
    </header>
  )
}
