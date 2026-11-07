import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { fmtTime } from "@/lib/sim"
import type { LogEntry } from "@/data/scenario"

// (C) 사건·조치 로그: 메인에 타임라인을 두지 않고 오른쪽 패널로 연다
export function LogSheet({ open, onOpenChange, log }: { open: boolean; onOpenChange: (o: boolean) => void; log: LogEntry[] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="font-heading text-[20px] tracking-[-0.01em]">사건·조치 로그</SheetTitle>
          <SheetDescription>최근 것부터 · {log.length}건</SheetDescription>
        </SheetHeader>
        <ol className="flex-1 overflow-y-auto">
          {log.map((e, i) => (
            <li key={i} className="grid grid-cols-[60px_1fr] gap-x-3 gap-y-0.5 border-b px-5 py-3.5 text-[15px]">
              <span className="row-span-2 pt-px font-mono text-[14px] text-muted-foreground tabular-nums">{fmtTime(e.t)}</span>
              <b className="font-semibold">{e.zone}</b>
              <span className="text-foreground/75">{e.text}</span>
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  )
}
