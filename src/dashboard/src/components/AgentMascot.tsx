import { cn } from "@/lib/utils"

/** 안전 에이전트 캐릭터: 로고의 맨홀 타원을 몸통으로, 머리 위 주황 점은 측정 파형 끝점. wave면 손을 흔든다 */
export function AgentMascot({ className, wave = false, waveMs }: { className?: string; wave?: boolean; /** 손 한 번 흔드는 시간 (기본 1.4초) */ waveMs?: number }) {
  return (
    <svg viewBox="0 0 96 104" className={cn("h-24 w-auto", className)} aria-hidden="true">
      <style>{`
        @keyframes gs-wave { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-22deg) } }
        @keyframes gs-blink { 0%,92%,100% { transform: scaleY(1) } 95% { transform: scaleY(0.1) } }
        @keyframes gs-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        .gs-arm { transform-box: fill-box; transform-origin: 10% 90%; animation: gs-wave 1.4s ease-in-out infinite }
        .gs-eye { transform-box: fill-box; transform-origin: center; animation: gs-blink 4s infinite }
        .gs-body { animation: gs-bob 3s ease-in-out infinite }
      `}</style>
      <ellipse cx="48" cy="99" rx="22" ry="3.5" fill="#0f1b2d" opacity="0.08" />
      <g className="gs-body">
        {/* 안테나: 파형 끝점 */}
        <path d="M48 20v-8" stroke="#0f1b2d" strokeWidth="3" strokeLinecap="round" />
        <circle cx="48" cy="9" r="5" fill="var(--warn)" />
        {/* 팔 */}
        <path d="M20 60c-6 2-9 7-9 12" stroke="#0f1b2d" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path className={wave ? "gs-arm" : undefined} style={wave && waveMs ? { animationDuration: `${waveMs}ms` } : undefined} d="M76 58c7-3 11-10 11-17" stroke="#0f1b2d" strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* 몸통 = 로고 타원 */}
        <rect x="20" y="20" width="56" height="74" rx="28" fill="var(--cream)" stroke="#0f1b2d" strokeWidth="4" />
        <rect x="28" y="30" width="40" height="38" rx="19" fill="#0f1b2d" />
        {/* 얼굴 */}
        <ellipse className="gs-eye" cx="40" cy="47" rx="3.6" ry="4.6" fill="#f3ece0" />
        <ellipse className="gs-eye" cx="56" cy="47" rx="3.6" ry="4.6" fill="#f3ece0" />
        <path d="M42 56.5c3.5 3 8.5 3 12 0" stroke="var(--warn)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <circle cx="34" cy="55" r="2.6" fill="var(--warn)" opacity="0.45" />
        <circle cx="62" cy="55" r="2.6" fill="var(--warn)" opacity="0.45" />
        {/* 배의 측정 파형 */}
        <path d="M31 80h8l3-4 4 8 4-12 3 8h12" stroke="var(--warn)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>
    </svg>
  )
}
