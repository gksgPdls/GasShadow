import { cn } from "@/lib/utils"

/** 로고 마크: 밀폐구역 맨홀(타원) 안의 가스 측정 파형 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 52" className={cn("h-8 w-auto", className)} aria-hidden="true">
      <rect x="2.5" y="2.5" width="35" height="47" rx="17.5" fill="none" stroke="var(--cream)" strokeWidth="3.4" />
      <rect x="7.5" y="7.5" width="25" height="37" rx="12.5" fill="none" stroke="#6f6e69" strokeWidth="1.3" />
      <path
        d="M7.5 29.5h5.5l2.6-3.6 3.2 7.2 3.4-11.4 2.6 7.8h7.7"
        fill="none"
        stroke="var(--warn)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.2" cy="19.6" r="2.6" fill="var(--warn)" />
    </svg>
  )
}

/** 로고 전체: 마크 + GasShadow 글자 (어두운 바탕 위) */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="brand-font font-heading text-[21px] leading-none font-extrabold tracking-[-0.03em]">
        <span className="text-cream">Gas</span>
        <span className="text-warn">Shadow</span>
      </span>
    </span>
  )
}
