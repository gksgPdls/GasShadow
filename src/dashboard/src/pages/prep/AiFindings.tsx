import { useState } from "react"
import { Check, CircleCheck, Send, Sparkles, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { AiCheck } from "@/data/permits"
import { AI_FIX, aiStatusOf, clean, type AiStates, type AiStatus } from "@/pages/prep/model"
import { SourceChip } from "@/pages/prep/ui"

const QUICK_REASONS = ["현장 확인 완료", "작업 범위상 해당 없음", "이미 조치됨"]

const STATUS_CLS: Record<AiStatus, string> = {
  미처리: "bg-warn-soft text-warn-ink",
  "보완 요청": "bg-accent text-primary",
  반영: "bg-primary text-primary-foreground",
  "문제 없음": "bg-muted text-muted-foreground",
}

interface Props {
  checks: AiCheck[]
  ai: AiStates
  /** status null = 처리 취소 */
  onAct: (check: AiCheck, status: Exclude<AiStatus, "미처리"> | null, reason?: string) => void
  /** 근거 칸을 줄여 보여줄 때 (측정 대상 선별 오른쪽) */
  compact?: boolean
}

// AI 체크 검토: 체크·기재가 맞는지 시스템이 짚은 것. 관리자가 보완 요청 · 반영 · 문제 없음(사유)으로 처리한다
export function AiFindings({ checks, ai, onAct, compact }: Props) {
  if (!checks.length)
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-4 py-4 text-[15px] text-muted-foreground">
        <CircleCheck className="size-5 text-ok" /> 짚을 내용 없음 — 체크·기재가 유사 허가서와 맞습니다
      </div>
    )
  // 아직 처리 안 한 '확인 필요'를 위로
  const rank = (c: AiCheck) => (ai[c.id] ? 2 : c.level === "확인 필요" ? 0 : 1)
  return (
    <ul className="space-y-3">
      {[...checks]
        .sort((a, b) => rank(a) - rank(b))
        .map((c) => (
          <Finding key={c.id} c={c} ai={ai} onAct={onAct} compact={compact} />
        ))}
    </ul>
  )
}

function Finding({ c, ai, onAct, compact }: { c: AiCheck; ai: AiStates; onAct: Props["onAct"]; compact?: boolean }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState("")
  const status = aiStatusOf(ai, c.id)
  const done = ai[c.id]
  const open = status === "미처리" && c.level === "확인 필요"

  return (
    <li
      className={cn(
        "minimal-finding rounded-xl border-2 p-4",
        open ? "border-warn/55 bg-warn-soft/50" : done ? "border-border bg-card opacity-80" : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[13px] font-semibold",
            c.level === "확인 필요" ? "bg-warn text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {c.level}
        </span>
        <span className="text-[13px] text-muted-foreground">{c.kind}</span>
        <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", STATUS_CLS[status])}>
          {status}
        </span>
      </div>

      <p className="mt-2.5 text-[17px] leading-snug font-semibold break-keep">{c.title}</p>
      {c.suggest && (
        <p className="mt-2 flex gap-2 text-[15px] leading-snug text-primary break-keep">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          <span>
            <b className="font-semibold">제안</b> {c.suggest}
          </span>
        </p>
      )}

      {!compact && (
        <ul className="mt-3 space-y-2">
          {c.evidence.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[14px] leading-snug">
              <SourceChip source={e.source} />
              <span className="pt-0.5 text-foreground/80 break-keep">{clean(e.text)}</span>
            </li>
          ))}
        </ul>
      )}

      {c.confidence !== undefined && !compact && (
        <div className="mt-3 flex items-center gap-2.5 text-[13px] text-muted-foreground">
          확신도
          <span className="h-2 w-32 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${c.confidence * 100}%` }} />
          </span>
          <span className="font-mono text-[14px] font-semibold text-foreground tabular-nums">{Math.round(c.confidence * 100)}%</span>
        </div>
      )}

      {done ? (
        <div className="mt-3 flex items-center gap-2 border-t pt-3 text-[14px] text-muted-foreground">
          <Check className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {done.status} · {done.by} {done.at}
            {done.reason ? ` · ${done.reason}` : ""}
          </span>
          <Button size="lg" variant="ghost" className="h-10 text-[14px]" onClick={() => onAct(c, null)}>
            <Undo2 /> 되돌리기
          </Button>
        </div>
      ) : asking ? (
        <div className="mt-3 space-y-2.5 border-t pt-3">
          <div className="text-[14px] font-semibold">문제 없음 — 사유 (필수)</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-[14px]",
                  reason === r ? "border-primary bg-accent font-semibold text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유를 적거나 위에서 고르기" className="h-10 text-[15px] md:text-[15px]" />
          <div className="flex justify-end gap-2">
            <Button size="lg" variant="ghost" className="h-10 text-[15px]" onClick={() => setAsking(false)}>
              취소
            </Button>
            <Button size="lg" className="h-10 px-5 text-[15px]" disabled={!reason.trim()} onClick={() => onAct(c, "문제 없음", reason.trim())}>
              저장
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap gap-2 border-t pt-3.5">
          {AI_FIX[c.id] && (
            <Button size="lg" className="h-10 px-4 text-[15px]" onClick={() => onAct(c, "반영")}>
              <Sparkles /> 반영
            </Button>
          )}
          <Button size="lg" variant="outline" className="h-10 px-4 text-[15px]" onClick={() => onAct(c, "보완 요청")}>
            <Send /> 보완 요청
          </Button>
          <Button size="lg" variant="ghost" className="h-10 px-4 text-[15px]" onClick={() => setAsking(true)}>
            문제 없음
          </Button>
        </div>
      )}
    </li>
  )
}
