import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { EXTRAS, type AiSource, type Extra, type Selection } from "@/data/permits"

// 전날 준비 화면 공통 조각. 글자 크기: 보조 13px · 본문 15px · 제목 20px 이상 · 핵심 숫자 28px 이상

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card", className)}>{children}</section>
}

export function PanelHead({ title, aside, className }: { title: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-5 py-3", className)}>
      <h2 className="min-w-0 font-heading text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>
      {aside}
    </header>
  )
}

/** 위쪽 숫자 칸 */
export function Kpi({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: "warn" | "legal"
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-center gap-1.5 rounded-xl border bg-card px-5 py-4", className)}>
      <div className="text-[14px] font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono text-[32px] leading-none font-semibold tabular-nums",
          tone === "warn" && "text-warn-ink",
          tone === "legal" && "text-legal",
        )}
      >
        {value}
      </div>
      {sub && <div className="truncate text-[13px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

/** 양식 추가정보 4칸: 체크됨 = 진하게 · 빈칸 = 점선 · AI 제안 반영 = 파란 점선 */
export function ExtrasIcons({ extras, aiExtras = [], large }: { extras: Extra[]; aiExtras?: Extra[]; large?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {EXTRAS.map((e) => {
        const ai = aiExtras.includes(e.key)
        const on = extras.includes(e.key)
        return (
          <span
            key={e.key}
            title={`${e.key}${ai ? " · AI 제안 반영 (관리자 확인)" : on ? " ☑" : " ☐"}`}
            className={cn(
              "grid place-items-center rounded-md font-semibold",
              large ? "h-8 min-w-8 px-1.5 text-[14px]" : "h-7 min-w-7 px-1 text-[13px]",
              ai
                ? "border-2 border-dashed border-primary bg-accent text-primary"
                : on
                  ? "bg-foreground/85 text-white"
                  : "border border-dashed border-foreground/20 text-muted-foreground/50",
            )}
          >
            {e.short}
          </span>
        )
      })}
    </span>
  )
}

export const FormTag = ({ form, ai, className }: { form: string; ai?: boolean; className?: string }) => (
  <span
    className={cn(
      "inline-block rounded-md border px-2 py-0.5 text-[13px] whitespace-nowrap",
      ai ? "border-dashed border-primary bg-accent font-semibold text-primary" : "bg-muted/60 text-foreground/80",
      className,
    )}
    title={ai ? "AI 제안 반영 (관리자 확인)" : undefined}
  >
    {form}
  </span>
)

/** 선정 근거 칩 3색: 기본 규칙 회색 · 과거 이력 청록 · 가중 요인 주황(상태색과 다른 톤) */
const CHIP: Record<Selection["chips"][number]["kind"], string> = {
  rule: "border-border bg-muted/70 text-foreground/80",
  history: "border-[#bfe1dd] bg-[#eaf6f4] text-[#13706a]",
  weight: "border-[#f3d3bd] bg-[#fff2e9] text-[#b1531c]",
}
export function ReasonChip({ kind, text }: Selection["chips"][number]) {
  return (
    <span className={cn("inline-block rounded-md border px-2 py-0.5 text-[13px] leading-[1.45] whitespace-nowrap", CHIP[kind])}>
      {text}
    </span>
  )
}

/** AI 근거 출처 칩 */
const SOURCE: Record<AiSource, { label: string; cls: string }> = {
  규칙: { label: "규칙", cls: "border-border bg-muted/70 text-foreground/80" },
  "유사 허가서 검색": { label: "유사 허가서 검색 · RAG", cls: "border-[#bfe1dd] bg-[#eaf6f4] text-[#13706a]" },
  "사내 문서 검색": { label: "사내 문서 검색 · RAG", cls: "border-[#cfd8f6] bg-[#eef2ff] text-[#3348a8]" },
  "분류 모델": { label: "분류 모델", cls: "border-[#dfd3f3] bg-[#f5f0fd] text-[#5b3f99]" },
}
export const SourceChip = ({ source }: { source: AiSource }) => (
  <span className={cn("inline-block shrink-0 rounded-md border px-2 py-0.5 text-[13px] font-medium whitespace-nowrap", SOURCE[source].cls)}>
    {SOURCE[source].label}
  </span>
)

/** 보기 전환 (목록 필터) */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/50 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-md px-3.5 text-[14px] whitespace-nowrap transition-colors",
            value === o.value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
