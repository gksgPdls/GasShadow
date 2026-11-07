import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// 오늘 관제 세 칸(왼쪽 목록·구역 상세 / 가운데 3D / 오른쪽 에이전트)이 같은 높이·여백의 제목 줄을 쓰도록
export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={cn("flex h-14 shrink-0 items-center gap-3 border-b px-4", className)}>{children}</header>
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="shrink-0 text-[16px] leading-none font-semibold">{children}</h2>
}

/** 제목 줄 오른쪽 작은 회색 글씨 */
export function PanelMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("ml-auto truncate text-[13px] text-muted-foreground", className)}>{children}</span>
}
