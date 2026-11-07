import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowUp, BrainCircuit, FileSearch, ListOrdered, LoaderCircle, MapPin, RotateCcw, TrendingUp, UserSearch, WifiOff, X, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtTime, type SimView } from "@/lib/sim"
import { AgentMascot } from "@/components/AgentMascot"
import { RunBody } from "@/components/AgentRun"
import { RUN_MS, TRIGGER_DOT, TRIGGER_TEXT, useElapsed } from "@/lib/agentRun"
import { TRIGGER_LABEL } from "@/lib/agentTeam"
import type { AgentTeam } from "@/lib/useAgentTeam"
import { localAnswer, suggestions, type Suggestion, type SuggestionKind } from "@/lib/agent"
import type { Prediction } from "@/lib/server"
import { ZONES } from "@/data/scenario"

// 안전 에이전트 (오늘 관제 오른쪽 아래에 떠 있는 캐릭터).
// 대화는 없다. 알람 배너의 '에이전트 팀 분석'을 누르면 그 구역을 분석해 말풍선으로 보여 준다 (정보 제공까지만).
// 송풍기 가동·호출 같은 조치는 구역 화면(ZoneDetail) 아래 단추로 한다.

/** 배너 안 '에이전트 팀 분석' 단추: 분석 전 → 분석 중 → 결과 보기 (상태가 나빠지면 다시 분석) */
export function AgentButton({ team, zoneId, className, onRequest }: { team: AgentTeam; zoneId: string; className?: string; /** 누를 때 함께 할 일 (예: 구역 열고 3D 확대) */ onRequest?: () => void }) {
  const c = team.cases[zoneId]
  const ms = useElapsed(c?.run.startedAt ?? null)
  const running = !!c && ms < RUN_MS
  const stale = team.stale(zoneId)
  const label = !c ? "에이전트 팀 분석" : running ? "분석 중" : stale ? "다시 분석" : "분석 결과 보기"
  const filled = !c || stale
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        team.request(zoneId)
        onRequest?.()
      }}
      className={cn(
        "flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-[14px] font-semibold whitespace-nowrap transition-colors",
        running ? "bg-muted text-navy" : filled ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-2 border-primary bg-card text-primary hover:bg-accent",
        className,
      )}
      title={stale ? `${TRIGGER_LABEL[team.triggerNow(zoneId)]}로 바뀜 · 다시 분석` : undefined}
    >
      {running ? <LoaderCircle className="size-4 animate-spin" /> : stale ? <RotateCcw className="size-4" /> : <BrainCircuit className="size-4" />}
      {label}
    </button>
  )
}

/** 오른쪽 아래 캐릭터 + 말풍선. 평소엔 인사·요약, 캐릭터를 누르면 대화창, 배너에서 분석을 부르면 그 분석 */
export function AgentDock({ team, view, predictions, onOpenZone }: { team: AgentTeam; view: SimView; predictions: Record<string, Prediction>; onOpenZone: (zoneId: string) => void }) {
  const [mode, setMode] = useState<"intro" | "chat">("intro")
  const intro = mode === "intro"
  const [chat, setChat] = useState<Msg[]>([])
  // 이미 누른 추천 질문 종류. 누른 건 추천에서 뺀다
  const [asked, setAsked] = useState<SuggestionKind[]>([])
  const lastT = useRef(view.t)
  // 시연을 처음부터 다시 돌리면 대화도 비운다
  useEffect(() => {
    if (view.t < lastT.current - 0.5) {
      setChat([])
      setAsked([])
    }
    lastT.current = view.t
  }, [view.t])
  const c = team.openId ? team.cases[team.openId] : undefined
  const ms = useElapsed(c?.run.startedAt ?? null)
  const running = !!c && ms < RUN_MS
  const names = new Map(view.blocks.flatMap((b) => b.zones.map((z) => [z.id, z.name] as const)))
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [c?.run.key])

  // 캐릭터를 누르면 대화창 (분석 말풍선이 떠 있으면 닫고 대화창으로). 대화창이 떠 있으면 다시 인사로
  const onMascot = () => {
    if (!c && mode === "chat") return setMode("intro")
    team.setOpenId(null)
    setMode("chat")
  }

  return (
    // 말풍선은 캐릭터 바로 위, 오른쪽 끝을 캐릭터와 맞춘다. 아래쪽 꼬리가 캐릭터 머리를 가리킨다
    <div className="pointer-events-none absolute top-3 right-3 bottom-14 z-[5] flex flex-col items-end justify-end gap-6">
      <style>{`
        @keyframes dock-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        .dock-float { animation: dock-float 3.2s ease-in-out infinite }
        /* 대화창: 캐릭터 쪽(오른쪽 아래 꼬리)에서 확 커지며 튀어나온다 */
        @keyframes dock-pop { 0% { transform: scale(0.12); opacity: 0 } 55% { transform: scale(1.05); opacity: 1 } 78% { transform: scale(0.985) } 100% { transform: scale(1) } }
        .dock-pop { transform-origin: calc(100% - 44px) 100%; animation: dock-pop 0.46s cubic-bezier(.2,.9,.3,1) both }
        /* 작은 인사 말풍선: 다시 나타날 때 살짝 */
        @keyframes dock-in { from { transform: translateY(6px) scale(0.94); opacity: 0 } to { transform: none; opacity: 1 } }
        .dock-in { transform-origin: calc(100% - 44px) 100%; animation: dock-in 0.25s ease-out both }
        @media (prefers-reduced-motion: reduce) { .dock-float, .dock-pop, .dock-in { animation: none } }
      `}</style>

      {c ? (
        // 분석 말풍선: 넉넉하게 크게. 머리(구역·경보·시각·닫기) + 본문(스크롤)
        // 가장 길 때 윗변이 3D 위 공정 바로가기 줄 윗변(top-3)과 같은 높이
        <div className="pointer-events-auto relative flex min-h-0 flex-col">
        <div className="flex min-h-0 w-[min(420px,calc(var(--app-w,100vw)-2rem))] flex-col overflow-hidden rounded-[28px] border-2 border-navy/80 bg-card shadow-xl">
          <div className="flex items-start gap-2.5 border-b px-4 pt-3 pb-2.5">
            <span className={cn("mt-2 size-2.5 shrink-0 rounded-full", TRIGGER_DOT[c.trigger])} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[18px] font-semibold">{names.get(c.zoneId) ?? c.zoneId}</span>
                <span className="ml-auto shrink-0 font-mono text-[13px] text-muted-foreground">{fmtTime(c.t)} 분석</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[14px]">
                <span className={cn("font-semibold", TRIGGER_TEXT[c.trigger])}>{TRIGGER_LABEL[c.trigger]}</span>
                {running ? (
                  <span className="flex items-center gap-1 font-semibold text-navy">
                    <LoaderCircle className="size-3.5 animate-spin" /> 에이전트 팀 분석 중
                  </span>
                ) : (
                  team.stale(c.zoneId) && (
                    <button type="button" onClick={() => team.start(c.zoneId)} className="flex items-center gap-1 font-semibold text-primary hover:underline">
                      <RotateCcw className="size-3.5" /> {TRIGGER_LABEL[team.triggerNow(c.zoneId)]}로 바뀜 · 다시 분석
                    </button>
                  )
                )}
              </div>
            </div>
            <button type="button" aria-label="분석 닫기" onClick={() => team.setOpenId(null)} className="-mr-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-5" />
            </button>
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
            <RunBody key={c.run.key} run={c.run} onOpenZone={() => onOpenZone(c.zoneId)} />
          </div>
        </div>
          <Tail />
        </div>
      ) : mode === "chat" ? (
        <ChatBubble
          chat={chat}
          suggest={suggestions(view).filter((s) => !asked.includes(s.kind))}
          onClose={() => setMode("intro")}
          onAsk={(text, kind) => {
            if (kind) setAsked((a) => [...a, kind])
            // 시연용으로 정해 둔 질문·답: 미승인 허가서 0491과 파이프덕트 3 2번 칸 출입 대조
            if (/0491/.test(text)) {
              setChat((m) => [...m, { me: true, text }, { me: false, text: ANSWER_0491 }])
              return
            }
            // 구역을 물으면 에이전트 팀이 그 구역을 분석해 분석 말풍선으로 보여 준다
            const z = /요약|순서|측정요원|인력/.test(text) ? null : zoneIn(text)
            if (z) {
              setChat((m) => [...m, { me: true, text }, { me: false, text: `${z.name} 분석을 에이전트 팀에 맡겼어요. 분석 말풍선으로 보여 드릴게요.` }])
              team.start(z.id)
              return
            }
            const local = localAnswer(text, view, predictions)
            setChat((m) => [...m, { me: true, text }, { me: false, text: local ?? "이 질문은 아직 답할 수 없어요. 아래 추천 질문을 눌러 보거나, 구역 이름을 넣어 물으면 에이전트 팀이 분석해 드려요." }])
          }}
        />
      ) : (
        intro && (
          // 평소: 인사. 이 말풍선이나 캐릭터를 누르면 사라지고 대화창이 뜬다 (대화창을 닫으면 다시 나타남)
          // 폭은 글자 길이만큼(w-fit). 꼬리 위치는 테두리 바깥 기준이라, 테두리는 안쪽 칸에 둔다 (분석 말풍선과 같은 구조)
          <div role="button" tabIndex={0} onClick={onMascot} onKeyDown={(e) => e.key === "Enter" && onMascot()} className="dock-in pointer-events-auto relative w-fit max-w-[min(420px,calc(var(--app-w,100vw)-2rem))] cursor-pointer">
            <div className="rounded-[28px] border-2 border-navy/80 bg-card px-5 py-3.5 shadow-lg">
            <div className="text-[16px] font-semibold">안녕하세요, 안전관리자님!</div>
            <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">무엇을 도와드릴까요?</p>
            </div>
            <Tail />
          </div>
        )
      )}

      <button type="button" onClick={onMascot} aria-label={c ? "분석 닫기" : mode === "chat" ? "대화 닫기" : "안전 에이전트와 대화"} className="pointer-events-auto dock-float shrink-0 cursor-pointer">
        <AgentMascot wave={running || (!c && mode === "intro")} className="h-24 drop-shadow-md" />
      </button>
    </div>
  )
}

type Msg = { me: boolean; text: string }

// 시연 질문 "0491 허가서랑 들어간 사람 맞아?"에 대한 정해 둔 답 (허가서·출입현황판·승인 상태 대조). 첫 줄 제목, 나머지는 "이름: 내용" 목록
const ANSWER_0491 = [
  "아니요, 승인 전 허가서로 들어간 걸로 보여요.",
  "허가서: PTW-2541-0491 배관 관통부 취부 용접·그라인딩 · 의장 6반 · 2명 — 아직 승인 전",
  "출입현황판: 파이프덕트 3 2번 칸에 출입증 2명 · 09:09 입장",
  "오늘 승인된 허가: 이 칸은 0건",
  "가스: 입장 뒤 CO 2 → 12 ppm, 용접·그라인딩 흔적과 맞아요",
  "권장: 작업 중지 · 출입자 퇴거 · 의장 6반 관리감독자 현장 확인",
].join("\n")

// 질문에 든 구역 (이름 전체, 또는 'PD-4'처럼 숫자가 든 짧은 이름)
function zoneIn(q: string) {
  const key = (name: string) => name.split(" ").filter((w) => /\d/.test(w) && !w.startsWith("(") && !/^\d+번$/.test(w))
  return ZONES.find((z) => q.includes(z.name)) ?? ZONES.find((z) => z.permit && key(z.name).some((w) => q.includes(w)))
}

/** 대화창: 분석 말풍선과 같은 모양, 크기는 더 작게 (폭 360px · 높이 440px). 위 인사 → 대화 → 추천 질문 → 입력 칸 */
function ChatBubble({ chat, suggest, onClose, onAsk }: { chat: Msg[]; suggest: Suggestion[]; onClose: () => void; onAsk: (text: string, kind?: SuggestionKind) => void }) {
  const [input, setInput] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })
  }, [chat.length])
  const send = () => {
    const text = input.trim()
    if (!text) return
    setInput("")
    onAsk(text)
  }
  return (
    // 높이는 내용에 비해 넉넉한 정도(500px, 추천 질문 카드까지 들어가게)로 고정, 화면이 낮으면 그만큼 줄어든다. 폭은 배너·구역 상세와 같은 420px
    <div className="dock-pop pointer-events-auto relative flex h-[440px] max-h-full min-h-0 flex-col">
      <div className="flex min-h-0 w-[min(360px,calc(var(--app-w,100vw)-2rem))] flex-1 flex-col overflow-hidden rounded-[28px] border-2 border-navy/80 bg-card shadow-xl">
        <div className="flex items-center gap-2.5 border-b px-5 pt-3 pb-2.5">
          <span className="text-[18px] font-semibold">안전 에이전트</span>
          <button type="button" aria-label="대화 닫기" onClick={onClose} className="-mr-2 ml-auto grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>
        <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4 text-[15px] leading-relaxed break-keep">
          {/* 인사: 예전 오른쪽 에이전트 창 첫 화면과 같은 모양(큰 캐릭터 · 인사)을 회색으로 흐리게. 대화 전에는 창 한가운데, 대화가 생기면 맨 위 */}
          {/* 캐릭터는 창 밖 오른쪽 아래 캐릭터와 같은 크기(h-24), 두 문장은 붙여서 작게 */}
          <div className={cn("flex shrink-0 flex-col items-center px-2 pb-1 text-center opacity-40 grayscale", suggest.length ? "pt-1" : "pt-6", !chat.length && "my-auto")}>
            <AgentMascot className="h-24" />
            <div className="mt-2 text-[16px] font-semibold">안녕하세요, 안전관리자님!</div>
            <p className="text-[14px] leading-snug text-muted-foreground">무엇을 도와드릴까요?</p>
          </div>
          {chat.map((m, i) =>
            m.me ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-navy px-3.5 py-2 whitespace-pre-line text-white">{m.text}</div>
              </div>
            ) : (
              <BotMsg key={i}>
                <ReplyBody text={m.text} />
              </BotMsg>
            ),
          )}
          {/* 추천 질문: 대화 맨 아래(입력 칸 바로 위). 누르면 그 질문을 보내고, 누른 것은 빠진다 */}
          {suggest.length > 0 && <Suggest items={suggest} onAsk={onAsk} />}
        </div>
        <form
          className="m-3 mt-0 flex items-end gap-2 rounded-[22px] border bg-card py-1.5 pr-1.5 pl-4 transition-colors focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/15"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="에이전트에게 물어보세요"
            style={{ outline: "none" }}
            className="block max-h-32 min-h-8 w-full flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed [field-sizing:content] placeholder:text-muted-foreground"
          />
          <button type="submit" disabled={!input.trim()} className="grid size-8 shrink-0 place-items-center rounded-full! bg-primary text-primary-foreground transition-opacity disabled:bg-muted-foreground/40" aria-label="보내기">
            <ArrowUp className="size-4" />
          </button>
        </form>
      </div>
      <Tail />
    </div>
  )
}

/** 추천 질문: 아이콘 붙은 둥근 알약, 늘 한 줄에 두 개씩. 두 알약이 줄을 꽉 채워 위아래 줄의 양 끝이 맞고, 폭은 글자 길이에 비례 (label을 보여 주고 누르면 text를 보낸다) */
const SUGGEST_ICON: Record<SuggestionKind, LucideIcon> = {
  summary: ListOrdered,
  permit: FileSearch,
  zone: MapPin,
  forecast: TrendingUp,
  missing: WifiOff,
  crew: UserSearch,
}
function Suggest({ items, onAsk }: { items: Suggestion[]; onAsk: (text: string, kind?: SuggestionKind) => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      {Array.from({ length: Math.ceil(items.length / 2) }, (_, r) => (
        <div key={r} className="flex flex-wrap gap-1.5">
          {items.slice(r * 2, r * 2 + 2).map((s) => {
        const Icon = SUGGEST_ICON[s.kind]
        return (
          <button
            key={s.kind}
            type="button"
            onClick={() => onAsk(s.text, s.kind)}
            title={s.text}
            className="inline-flex flex-auto shrink-0 items-center justify-center gap-1 rounded-full! border bg-card px-2.5 py-1.5 text-left text-[12.5px] leading-snug whitespace-nowrap transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <Icon className={cn("size-3.5 shrink-0", s.kind === "zone" ? "text-legal" : "text-muted-foreground")} />
            <span>{s.label}</span>
          </button>
        )
          })}
        </div>
      ))}
    </div>
  )
}

/** 캐릭터가 보낸 채팅 한 칸: 왼쪽에 작은 캐릭터, 오른쪽에 글자 길이만큼의 말칸 */
function BotMsg({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <AgentMascot className="mt-0.5 h-9 shrink-0" />
      <div className="w-fit max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">{children}</div>
    </div>
  )
}

// 답변: 여러 줄이면 첫 줄은 제목, 나머지는 목록. "이름: 내용"은 이름을 굵게
function ReplyBody({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean)
  const row = (l: string) => {
    const clean = l.replace(/^\d+\.\s*/, "")
    const i = clean.indexOf(": ")
    return i > 0 ? (
      <>
        <b className="font-semibold">{clean.slice(0, i)}</b>
        <span className="text-foreground/80"> · {clean.slice(i + 2)}</span>
      </>
    ) : (
      clean
    )
  }
  if (lines.length === 1) return <p>{row(lines[0])}</p>
  const [head, ...items] = lines
  return (
    <div>
      <p className="font-semibold">{head}</p>
      <ol className="mt-1.5 space-y-1">
        {items.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-foreground/40" />
            <span className="min-w-0">{row(l)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * 말풍선 꼬리: 아래쪽 오른편에서 바로 밑 캐릭터 머리를 가리킨다.
 * 말풍선 테두리(2px) 위에 겹쳐 그 구간의 테두리를 흰 바탕으로 덮고, 테두리에서 그대로 이어지는 곡선 두 개로 끝을 모은다
 */
function Tail() {
  return (
    <svg viewBox="0 0 36 16" className="absolute right-[26px] -bottom-[14px] h-4 w-9 overflow-visible text-navy/80" aria-hidden>
      <path d="M0 -0.5 H36 V1 C28 1 22 4 18 15 C14 4 8 1 0 1 Z" className="fill-card" />
      <rect x="1.5" y="-0.5" width="33" height="2.5" className="fill-card" />
      <path d="M0 1 C8 1 14 4 18 15 C22 4 28 1 36 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
