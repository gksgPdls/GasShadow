import type { ReactNode } from "react"
import { Pause, Play, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

const SPEEDS = [
  { v: 1, label: "1초=1초" },
  { v: 10, label: "1초=10초" },
  { v: 60, label: "1초=1분" },
]

interface Props {
  playing: boolean
  speed: number
  outage: boolean
  onPlaying: (on: boolean) => void
  onSpeed: (v: number) => void
  onReset: () => void
  onOutage: (on: boolean) => void
}

const DemoButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-strip-foreground transition-colors hover:bg-white/10 [&_svg]:size-3.5"
  >
    {children}
  </button>
)

// 발표·시연용 조작. 화면 기능이 아니다 (?demo=0 이면 숨김)
export function DemoBar({ playing, speed, outage, onPlaying, onSpeed, onReset, onOutage }: Props) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto bg-strip px-5 text-[13px] whitespace-nowrap text-strip-foreground">
      <span className="rounded border border-strip-line px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.08em] text-strip-muted">
        DEMO
      </span>
      <span className="text-strip-muted">데모 제어</span>
      <span className="h-4 w-px bg-strip-line" />
      <DemoButton onClick={() => onPlaying(!playing)}>
        {playing ? <Pause /> : <Play />}
        {playing ? "일시정지" : "재생"}
      </DemoButton>
      <div className="flex rounded-md border border-strip-line p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s.v}
            type="button"
            onClick={() => onSpeed(s.v)}
            className={cn(
              "rounded px-2 py-0.5 transition-colors",
              speed === s.v ? "bg-white/15 text-white" : "text-strip-muted hover:text-white",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <DemoButton onClick={onReset}>
        <RotateCcw /> 처음부터
      </DemoButton>
      <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/10">
        <input type="checkbox" checked={outage} onChange={(e) => onOutage(e.target.checked)} className="accent-warn" />
        통신 장애
      </label>
      <span className="ml-auto text-strip-muted">
        시연용 합성 데이터
      </span>
    </div>
  )
}
