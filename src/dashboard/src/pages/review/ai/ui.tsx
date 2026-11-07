import type { ReactNode } from "react"
import { Check, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Decision } from "@/pages/review/data"
import { KIND_STYLE } from "@/pages/review/ai/labels"
import type { FindingKind } from "@/pages/review/ai/types"

// 작업허가 검토 화면이 같이 쓰는 조각. Catalyst 같은 톤: 테두리 대신 여백과 머리카락 선, 배지는 옅은 색 바탕.

type Tone = "warn" | "legal" | "ok" | "primary" | "muted"

const TAG_TONE: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn-ink",
  legal: "bg-legal-soft text-legal",
  ok: "bg-ok-soft text-ok",
  primary: "bg-muted text-foreground",
  muted: "bg-muted text-muted-foreground",
}

const VALUE_TONE: Partial<Record<Tone, string>> = { warn: "text-warn-ink", legal: "text-legal", ok: "text-ok" }

export function Tag({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[13px] font-medium", TAG_TONE[tone], className)}>{children}</span>
}

export function KindChip({ kind }: { kind: FindingKind }) {
  const { label, className } = KIND_STYLE[kind]
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[12px] font-medium", className)}>{label}</span>
}

/** 작업 유형 (신청서가 고른 허가서 종류) */
export function FormChip({ form, className }: { form: string; className?: string }) {
  return <span className={cn("inline-block shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-medium text-foreground", className)}>{form}</span>
}

export function VerdictBadge({ verdict }: { verdict: "직접 판단" | "검토 완료" }) {
  return verdict === "직접 판단" ? <Tag tone="warn">확인 필요</Tag> : <Tag tone="ok">문제없음</Tag>
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  return decision.status === "승인 완료" ? <Tag tone="ok">승인</Tag> : <Tag tone="legal">보완 요청</Tag>
}

/** 화면 제목 (큰 제목 · 한 줄 설명 · 오른쪽 버튼) */
export function PageHeader({ title, sub, children, titleClassName }: { title: string; sub?: ReactNode; children?: ReactNode; titleClassName?: string }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        <h1 className={cn("text-[24px] leading-8 font-semibold tracking-[-0.01em] text-foreground", titleClassName)}>{title}</h1>
        {sub && <p className="mt-1 text-[14px] text-muted-foreground">{sub}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** 화면 위 숫자 칸 한 줄 (작업자 관리 · 작업허가 접수 공용): 테두리 상자 안 칸마다 이름 14 · 숫자 30, 칸 사이 세로선.
 *  bare = 바깥 테두리 없이 (이미 테두리 상자 안에 넣을 때) */
export function StatRow({ items, bare }: { items: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }[]; bare?: boolean }) {
  return (
    <div className={cn("grid grid-cols-2 bg-card sm:grid-cols-3", items.length > 3 && "xl:grid-cols-5", items.length <= 3 && "sm:grid-cols-3", !bare && "rounded-lg border")}>
      {items.map((it, i) => (
        <div key={it.label} className={cn("min-w-0 px-5 py-4", i > 0 && "border-l")}>
          <div className="text-[14px] font-medium text-foreground">{it.label}</div>
          <div className={cn("mt-1.5 text-[30px] leading-9 font-semibold tracking-tight tabular-nums", it.tone && VALUE_TONE[it.tone])}>{it.value}</div>
          {it.note && <div className={cn("mt-1 truncate text-[13px]", it.tone ? VALUE_TONE[it.tone] : "text-muted-foreground")}>{it.note}</div>}
        </div>
      ))}
    </div>
  )
}

/** 숫자 칸 (위에 가는 선 · 이름 · 큰 숫자 · 보충 한 줄) */
export function StatGrid({ items, className }: { items: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }[]; className?: string }) {
  return (
    <div className={cn("grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {items.map((it) => (
        <div key={it.label}>
          <hr className="border-border" />
          <div className="mt-4 text-[14px] font-medium text-foreground">{it.label}</div>
          <div className={cn("mt-1.5 text-[30px] leading-9 font-semibold tracking-tight tabular-nums text-foreground", it.tone && VALUE_TONE[it.tone])}>{it.value}</div>
          {it.note && <div className="mt-1 text-[13px] text-muted-foreground">{it.note}</div>}
        </div>
      ))}
    </div>
  )
}

/** 토글 필터: 테두리 상자 안에서 하나 고르기, 고른 칸은 청록 바탕 흰 글씨. 모든 화면의 필터는 이 모양 (개수는 선택) */
export function Segmented<T extends string>({ items, value, onChange, fill }: { items: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void; fill?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-0.5", fill ? "flex w-full" : "inline-flex flex-wrap")}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[14px] whitespace-nowrap transition-colors",
            fill && "flex-1 px-1",
            value === it.key ? "bg-primary font-semibold text-primary-foreground" : "text-foreground/80 hover:bg-muted",
          )}
        >
          {it.label}
          {it.count !== undefined && <span className={cn("ml-1.5 tabular-nums", value === it.key ? "opacity-80" : "text-muted-foreground")}>{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** 알약 모양 필터 (개수 포함) */
export function FilterTabs<T extends string>({
  items,
  value,
  onChange,
  fill,
}: {
  items: { key: T; label: string; count?: number }[]
  value: T
  onChange: (key: T) => void
  /** 칸 너비를 꽉 채워 나눈다 (좁은 목록 위) */
  fill?: boolean
}) {
  return (
    <div className={cn("gap-1", fill ? "flex w-full" : "inline-flex flex-wrap")}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={cn(
            "rounded-md py-1 text-[13px] font-medium whitespace-nowrap transition-colors",
            fill ? "flex-1 px-1" : "px-2.5",
            value === item.key ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="ml-1.5 text-muted-foreground tabular-nums">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder, className, inputClassName }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; inputClassName?: string }) {
  return (
    <label className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("h-9 w-full rounded-lg bg-card pr-8 pl-8 text-[14px] shadow-xs ring-1 ring-border ring-inset outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary", inputClassName)}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2.5 text-muted-foreground hover:text-foreground" aria-label="검색어 지우기">
          <X className="size-3.5" />
        </button>
      )}
    </label>
  )
}

/** 제목 + 가는 선으로 나눈 구역 (테두리 상자 없음) */
export function Panel({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex min-h-8 items-center gap-2 border-b border-border pb-2">
        <h3 className="text-[16px] font-semibold text-foreground">{title}</h3>
        {right && <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">{right}</div>}
      </div>
      {children}
    </section>
  )
}

const PHASES = ["허가서 접수", "AI 사전 검토", "안전과 판단", "허가 확정"]

/** 진행 단계 한 줄. current = 지금 단계(0~3), 4면 모두 끝 */
export function ProcessStrip({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {PHASES.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={label} className="flex items-center gap-3">
            {i > 0 && <span className={cn("h-px w-8", done || active ? "bg-border" : "bg-muted")} />}
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                  done ? "bg-navy text-white" : active ? "text-foreground ring-[1.5px] ring-primary" : "text-muted-foreground ring-1 ring-border",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn(active ? "font-medium text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground")}>{label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
