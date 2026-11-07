import { cn } from "@/lib/utils"
import { STATUS, type Status } from "@/lib/sim"
import { statusBg } from "@/lib/status-classes"

const statusSoft: Record<Status, string> = {
  legal: "bg-legal-soft text-legal",
  unauth: "bg-unauth-soft text-unauth",
  missing: "bg-missing-soft text-missing",
  warn: "bg-warn-soft text-warn-ink",
  ok: "bg-ok-soft text-ok",
  idle: "bg-muted text-muted-foreground",
}

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px] font-semibold whitespace-nowrap",
        statusSoft[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", statusBg[status])} />
      {label ?? STATUS[status].label}
    </span>
  )
}

export function Legend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-muted-foreground", className)}>
      {(Object.keys(STATUS) as Status[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", statusBg[s])} />
          {STATUS[s].label}
        </span>
      ))}
    </div>
  )
}
