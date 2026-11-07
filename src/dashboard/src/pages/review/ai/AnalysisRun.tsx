import { useEffect, useRef, useState, type RefObject } from "react"
import { Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentMascot } from "@/components/AgentMascot"
import type { StepDef } from "@/pages/review/ai/types"

// AI 사전 검토 진행 화면. 4단계가 차례로 진행되고, 진행 중인 단계는 처리 문구가 바뀐다.
// 결과는 미리 정해져 있고(합성), 여기서는 시간에 맞춰 보여 주기만 한다.

const TICK_MS = 70

export function AnalysisRun({ steps, onDone }: { count?: number; steps: StepDef[]; onDone: (elapsedMs: number) => void }) {
  const startedAt = useRef(performance.now())
  const area = useRef<HTMLDivElement>(null)
  const col = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const [now, setNow] = useState(() => performance.now())
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const total = steps.reduce((sum, s) => sum + s.ms, 0)
  const elapsed = now - startedAt.current

  // 지금 몇 번째 단계이고 그 단계가 얼마나 진행됐나
  let stepIndex = steps.length
  let stepPct = 1
  for (let i = 0, acc = 0; i < steps.length; acc += steps[i].ms, i++) {
    if (elapsed < acc + steps[i].ms) {
      stepIndex = i
      stepPct = Math.max(0, (elapsed - acc) / steps[i].ms)
      break
    }
  }

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // 마지막 단계가 끝나면 잠깐 100%를 보여 준 뒤 결과 화면으로
  const finished = stepIndex >= steps.length
  useEffect(() => {
    if (!finished) return
    const id = setTimeout(() => onDoneRef.current(Math.round(performance.now() - startedAt.current)), 600)
    return () => clearTimeout(id)
  }, [finished])

  const overall = Math.min(100, (elapsed / total) * 100)

  return (
    <div ref={area} className="relative flex flex-1">
      <div ref={col} className="m-auto w-full max-w-[760px] px-8 py-10">
        <div className="flex items-center gap-5 rounded-xl border bg-card px-5 py-4 shadow-sm">
          <AgentMascot wave={!finished} className="h-16 shrink-0" />
          {/* 설명 줄 없이 제목 한 줄만: 마스코트·퍼센트와 세로 가운데로 맞춘다 */}
          <h1 className="min-w-0 text-[24px] leading-8 font-semibold tracking-[-0.01em] text-foreground">{finished ? "안전 에이전트 검토 완료" : "안전 에이전트가 검토 중입니다"}</h1>
          <div className="ml-auto font-mono text-[30px] leading-9 font-semibold text-primary tabular-nums">
            {Math.floor(overall)}
            <span className="text-[16px] text-muted-foreground">%</span>
          </div>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${overall}%` }} />
        </div>

        <ol ref={list} className="mt-8">
          {steps.map((s, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "wait"
            const log = s.logs[Math.min(s.logs.length - 1, Math.floor(stepPct * s.logs.length))]
            return (
              <li key={s.step} className="flex items-start gap-4 border-t border-border py-5 first:border-t-0">
                <span
                  className={cn(
                    "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                    state === "done" && "bg-navy text-white",
                    state === "active" && "text-foreground ring-[1.5px] ring-primary",
                    state === "wait" && "text-muted-foreground ring-1 ring-border",
                  )}
                >
                  {state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : state === "active" ? <Loader2 className="size-4 animate-spin" /> : s.step}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[16px] font-semibold", state === "wait" ? "text-muted-foreground" : "text-foreground")}>{s.title}</div>
                  <div key={state === "active" ? log : s.sub} className={cn("mt-0.5 text-[14px] animate-in fade-in duration-300", state === "active" ? "text-foreground" : "text-muted-foreground")}>
                    {state === "active" ? log : s.sub}
                  </div>
                </div>
                <div className="shrink-0 pt-0.5 text-right text-[14px]">
                  {state === "done" && <span className="font-medium text-foreground">{s.result}</span>}
                  {state === "active" && <span className="font-mono text-muted-foreground tabular-nums">{Math.floor(stepPct * 100)}%</span>}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
      <MascotVisit area={area} col={col} list={list} />
    </div>
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// 마스코트 동작 속도: 검토 진행(약 6초) 안에 빼꼼 → 걸어 나와 뽀잉·인사 → 퇴장이 끝나도록 원래 동작 시간에 곱한다
const PACE = 0.63
const T = (ms: number) => Math.round(ms * PACE)

/**
 * 검토가 시작되면 마스코트가 오른쪽 끝에서 얼굴 반만 빼꼼 내밀었다 쏙 들어간 뒤,
 * 뒤뚱뒤뚱 걸어 나와 '뽀잉' 튀며 손을 흔들고 다시 들어간다 (한 번만).
 * 키는 단계 목록 높이에 맞추고, 목록 오른쪽 빈 곳 가운데에 선다. 자리가 모자라면 줄이고, 너무 좁으면 나오지 않는다.
 */
function MascotVisit({ area, col, list }: { area: RefObject<HTMLDivElement | null>; col: RefObject<HTMLDivElement | null>; list: RefObject<HTMLOListElement | null> }) {
  const walker = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ left: number; top: number; h: number; from: number } | null>(null)
  const [waving, setWaving] = useState(false)
  const [gone, setGone] = useState(false)

  // 자리 재기 (처음 한 번, 화면이 그려진 다음)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      // 페이지 전체를 줄여 보이게 한 경우(index.html zoom): 잰 값을 CSS px로 되돌린다 (잰 폭 ÷ 원래 폭 = 줄인 비율)
      const k = area.current ? area.current.getBoundingClientRect().width / area.current.offsetWidth || 1 : 1
      const css = (el: HTMLElement | null) => {
        const r = el?.getBoundingClientRect()
        return r && { left: r.left / k, right: r.right / k, top: r.top / k, bottom: r.bottom / k, width: r.width / k, height: r.height / k }
      }
      const a = css(area.current), c = css(col.current), l = css(list.current)
      if (!a || !c || !l || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setGone(true)
      const contentRight = c.right - 32 // 칸의 px-8 안쪽 끝
      const space = a.right - contentRight
      let h = l.height
      if ((h * 96) / 104 > space - 48) h = ((space - 48) * 104) / 96
      if (h < 140) return setGone(true)
      const w = (h * 96) / 104
      const left = contentRight - a.left + (space - w) / 2
      setSpot({ left, top: l.bottom - a.top - h, h, from: a.width - left + 16 })
    })
    return () => cancelAnimationFrame(raf)
  }, [area, col, list])

  // 빼꼼 → 걸어 나오기 → 뽀잉 → 손 흔들기 → 들어가기
  useEffect(() => {
    const wk = walker.current, bd = body.current
    if (!spot || !wk || !bd) return
    let alive = true
    const running: Animation[] = []
    const play = (el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      const an = el.animate(frames, opts)
      running.push(an)
      return an.finished
    }
    const waddle: Keyframe[] = [
      { transform: "translateY(0) rotate(0deg)" },
      { transform: "translateY(-6%) rotate(-6deg)", offset: 0.25 },
      { transform: "translateY(0) rotate(0deg)", offset: 0.5 },
      { transform: "translateY(-6%) rotate(6deg)", offset: 0.75 },
      { transform: "translateY(0) rotate(0deg)" },
    ]
    const walk = (from: number, to: number, easing: string) =>
      Promise.all([
        play(wk, [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: T(1300), easing, fill: "forwards" }),
        play(bd, waddle, { duration: T(650), iterations: 2, easing: "ease-in-out" }),
      ])
    const boing = (lift: number) =>
      play(
        bd,
        [
          { transform: "translateY(0) scale(1, 1)" },
          { transform: "translateY(0) scale(1.14, 0.84)", offset: 0.2 },
          { transform: `translateY(-${lift}%) scale(0.92, 1.1)`, offset: 0.5 },
          { transform: "translateY(0) scale(1.06, 0.94)", offset: 0.78 },
          { transform: "translateY(0) scale(1, 1)" },
        ],
        { duration: T(700), easing: "ease-out" },
      )
    ;(async () => {
      try {
        await sleep(T(400))
        if (!alive) return
        // 빼꼼: 몸의 45%(얼굴 왼쪽 절반)만 화면 끝에서 내밀고 살짝 기울인 채 잠깐 보다가 쏙 들어간다
        const peekX = spot.from - 16 - ((spot.h * 96) / 104) * 0.45
        const peek = [
          wk.animate([{ transform: `translateX(${spot.from}px)` }, { transform: `translateX(${peekX}px)` }], { duration: T(450), easing: "cubic-bezier(.2,.9,.3,1.15)", fill: "forwards" }),
          bd.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(-10deg)" }], { duration: T(450), easing: "ease-out", fill: "forwards" }),
        ]
        running.push(...peek)
        await Promise.all(peek.map((an) => an.finished))
        await sleep(T(900))
        if (!alive) return
        const hide = [
          wk.animate([{ transform: `translateX(${peekX}px)` }, { transform: `translateX(${spot.from}px)` }], { duration: T(260), easing: "cubic-bezier(.6,0,.8,.4)", fill: "forwards" }),
          bd.animate([{ transform: "rotate(-10deg)" }, { transform: "rotate(0deg)" }], { duration: T(260), easing: "ease-in", fill: "forwards" }),
        ]
        running.push(...hide)
        await Promise.all(hide.map((an) => an.finished))
        ;[...peek, ...hide].forEach((an) => an.cancel()) // 자리는 원래(화면 밖) 그대로
        await sleep(T(700))
        if (!alive) return
        await walk(spot.from, 0, "cubic-bezier(.25,.8,.4,1)")
        await boing(12)
        if (!alive) return
        setWaving(true)
        await sleep(T(1800))
        if (!alive) return
        setWaving(false)
        await boing(6)
        await walk(0, spot.from, "cubic-bezier(.6,0,.75,.2)")
        if (alive) setGone(true)
      } catch {
        // 화면을 떠나 애니메이션이 취소됨
      }
    })()
    return () => {
      alive = false
      running.forEach((an) => an.cancel())
    }
  }, [spot])

  if (gone || !spot) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={walker} className="absolute" style={{ left: spot.left, top: spot.top, height: spot.h, transform: `translateX(${spot.from}px)` }}>
        <div ref={body} className="h-full origin-bottom">
          <AgentMascot wave={waving} waveMs={420} className="h-full" />
        </div>
      </div>
    </div>
  )
}
