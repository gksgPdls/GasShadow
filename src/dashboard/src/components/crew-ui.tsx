import { useId, type ReactNode } from "react"
import { Flame, PaintRoller, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CrewMember } from "@/data/crew"
import type { PermitForm } from "@/data/permits"

// 출입현황 패널 · 작업자 관리가 같이 쓰는 작업자 표시 (증명사진 실루엣 · 출입증 · 허가서 양식 배지)

/** 증명사진 자리: 안전모(턱끈)를 쓰고 작업복 위에 반사띠 조끼를 입은 작업자 실루엣 */
export function Avatar({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 60 76" className={cn("shrink-0 overflow-hidden rounded-md border bg-muted", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef3f2" />
          <stop offset="1" stopColor="#dbe5e2" />
        </linearGradient>
      </defs>
      <rect width="60" height="76" fill={`url(#${id})`} />
      {/* 작업복 + 반사띠 조끼 */}
      <path d="M5 76c0-13.5 10.5-21.5 25-21.5S55 62.5 55 76z" fill="#4f6166" />
      <path d="M13 76V61.5c3-2.6 6.6-4.3 10.5-5.2L27 76zM47 76V61.5c-3-2.6-6.6-4.3-10.5-5.2L33 76z" fill="#e7843a" />
      <path d="M13 67.5h11.6M35.4 67.5H47" stroke="#e9edf0" strokeWidth="2.6" />
      <path d="M25.5 53h9v5.5c0 2.6-2 4.3-4.5 4.3s-4.5-1.7-4.5-4.3z" fill="#c7d2cf" />
      {/* 얼굴 · 턱끈 */}
      <ellipse cx="30" cy="38" rx="9.6" ry="11.2" fill="#c7d2cf" />
      <path d="M20.6 36.5c.6 6.5 4.2 11.6 9.4 12.3 5.2-.7 8.8-5.8 9.4-12.3" fill="none" stroke="#3e4f52" strokeWidth="1.3" />
      {/* 안전모: 둥근 머리 + 가운데 줄 + 챙 */}
      <path d="M17.8 33c0-8.6 5.4-14.4 12.2-14.4S42.2 24.4 42.2 33z" fill="#f2c230" />
      <path d="M30 18.8V33" stroke="#d9a400" strokeWidth="2.2" />
      <rect x="14.5" y="31.4" width="31" height="3.4" rx="1.7" fill="#e0b21f" />
    </svg>
  )
}

/** 허가서 양식 배지 (화기 · 도장/세척 · 기타위험 …). 작업허가 검토의 FormChip과 같은 옅은 회색 칩에 양식 아이콘 */
const FORM_ICON: Partial<Record<PermitForm, typeof Flame>> = { 화기: Flame, "도장/세척": PaintRoller }

export function FormBadge({ form, className }: { form: PermitForm; className?: string }) {
  const Icon = FORM_ICON[form] ?? TriangleAlert
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-medium text-foreground", className)}>
      <Icon className="size-3 text-muted-foreground" />
      {form}
    </span>
  )
}

/** 승인 전 허가서로 들어간 출입 표시 (무허가 의심과 같은 색) */
export function UnapprovedBadge({ className }: { className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md bg-unauth px-1.5 py-0.5 text-[12px] font-semibold text-white", className)}>미승인</span>
}

/** 작업자 안/밖: 3D 출입현황판에 출입증이 걸렸는지(구역 안) · 작업 시간이 시작됐는데 안 걸렸는지(밖·대기) · 시작 전.
 * 작업자 관리 표(WorkersPage의 PresenceChip)와 같은 글자·색 */
export type Presence = "in" | "out" | "before"
const PRESENCE: Record<Presence, { label: string; cls: string; dot?: string }> = {
  in: { label: "구역 안", cls: "bg-accent text-accent-foreground", dot: "bg-ok" },
  out: { label: "밖 · 대기", cls: "bg-muted text-foreground ring-1 ring-border ring-inset", dot: "bg-muted-foreground/60" },
  before: { label: "작업 전", cls: "text-muted-foreground ring-1 ring-border ring-inset" },
}
export function PresenceChip({ p, className }: { p: Presence; className?: string }) {
  const s = PRESENCE[p]
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium whitespace-nowrap", s.cls, className)}>
      {s.dot && <i className={cn("size-1.5 rounded-full", s.dot)} />}
      {s.label}
    </span>
  )
}

/** 현장 출입증 모양: 위 끈 구멍 · 사진 · 소속(Company) · 성명(Name) · 연락처(C.P). badge = 오른쪽 위 (예: 안/밖) */
export function EntryCard({ m, foot, badge }: { m: CrewMember; foot?: string; badge?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="relative flex items-center justify-between gap-2 border-b bg-muted/60 px-4 pt-3 pb-2">
        <span className="absolute top-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-border" />
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[13px] font-semibold text-foreground">밀폐공간 출입증</span>
          <span className="truncate text-[11px] tracking-wide text-muted-foreground">Confined Space Entry Card</span>
        </span>
        {badge}
      </div>
      <div className="flex gap-4 px-4 py-3">
        <Avatar className="h-[84px] w-[66px]" />
        <dl className="min-w-0 flex-1 space-y-1.5">
          <Field label="소속" en="Company">
            <div className="font-medium">{m.dept}</div>
            <div className="text-muted-foreground">{m.company}</div>
          </Field>
          <Field label="성명" en="Name">
            <span className="text-[18px] leading-none font-semibold">{m.name}</span>
          </Field>
          <Field label="연락처" en="C.P">
            <span className="font-mono tabular-nums">{m.phone}</span>
          </Field>
        </dl>
      </div>
      {foot && <div className="border-t px-4 py-1.5 text-[12.5px] text-muted-foreground">{foot}</div>}
    </div>
  )
}

function Field({ label, en, children }: { label: string; en: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-baseline gap-2 text-[14px]">
      <dt className="text-[12.5px] leading-tight whitespace-nowrap text-muted-foreground">
        {label}
        <span className="block text-[10.5px] opacity-70">({en})</span>
      </dt>
      <dd className="min-w-0 leading-snug">{children}</dd>
    </div>
  )
}
