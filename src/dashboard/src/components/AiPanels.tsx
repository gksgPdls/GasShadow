import { cn } from "@/lib/utils"
import { predictionText } from "@/lib/prediction"
import type { Prediction } from "@/lib/server"

export function PredictionLine({ p, className }: { p: Prediction | undefined; className?: string }) {
  const t = predictionText(p)
  if (!t) return null
  return (
    <div className={cn("flex items-baseline gap-2 text-[14px]", className)}>
      <span className="shrink-0 rounded border px-1.5 text-[12px] font-semibold text-muted-foreground">예측</span>
      <span className={cn("truncate", t.hot ? "font-semibold text-warn-ink" : "text-muted-foreground")}>{t.text}</span>
    </div>
  )
}
