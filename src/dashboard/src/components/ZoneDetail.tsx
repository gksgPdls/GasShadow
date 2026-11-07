import { useState } from "react"
import { Fan, HardHat, PhoneCall, Radio, Siren, Wind, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { BLOCKS, type Gas, blockName } from "@/data/scenario"
import { STATUS, fmtTime, type PersonRole, type Simulation, type Status } from "@/lib/sim"
import { statusBg, statusText } from "@/lib/status-classes"
import { GasChart } from "@/components/GasChart"
import { PanelHeader, PanelMeta } from "@/components/Panel"
import { PredictionLine } from "@/components/AiPanels"
import type { Prediction } from "@/lib/server"

type Detail = NonNullable<ReturnType<Simulation["zoneDetail"]>>

const STAGE: Record<string, string> = { assembly: "대조립", outfit: "선행의장", paint: "선행도장", pe: "PE장", erect: "탑재 (도크)" }
const SOFT: Record<Status, string> = {
  legal: "bg-legal-soft text-legal",
  unauth: "bg-unauth-soft text-unauth",
  missing: "bg-missing-soft text-missing",
  warn: "bg-warn-soft text-warn-ink",
  ok: "bg-ok-soft text-ok",
  idle: "bg-muted text-muted-foreground",
}

interface Props {
  detail: Detail
  t: number
  /** 같은 블록의 다른 밀폐구역 (바꿔 보기) */
  siblings: { id: string; name: string; status: Status }[]
  pending: boolean
  onBack: () => void
  onZone: (id: string) => void
  onAck: () => void
  /** 【AI ①】 이 구역 위험예측 */
  prediction?: Prediction
  /** 조치 (아래 단추): 송풍기 ON/OFF · 측정요원·관리감독자 호출. 에이전트는 정보만 주고 조치는 여기서 한다 */
  onBlower: (i: number, on: boolean) => void
  onCall: (role: PersonRole) => void
}

// 클릭한 밀폐구역: 지금 값을 크게, 최근 40분 그래프, 환기·센서·현장 인력, 측정 기록
export function ZoneDetail({ detail, t, siblings, pending, onBack, onZone, onAck, prediction, onBlower, onCall }: Props) {
  const { zone, assessment: a, gases } = detail
  const critical: Gas = a.status !== "missing" ? a.gas : "O2"
  const [gas, setGas] = useState<Gas>(critical)
  const g = gases.find((x) => x.gas === gas)!
  const block = BLOCKS.find((b) => b.id === zone.block)
  const status = a.status

  const blowers = detail.blowers
  const running = blowers.filter(Boolean).length
  const ventStopped = zone.vent && t >= zone.vent.stopAt && !blowers[0]
  const trend = Math.abs(g.slope) < 0.005 ? "안정" : g.slope > 0 ? "상승 중" : "하락 중"
  const rising = gas === "O2" ? g.slope < -0.005 : g.slope > 0.005

  return (
    <section className="minimal-side flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
      <PanelHeader>
        <button
          type="button"
          onClick={onBack}
          className="-ml-1.5 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[16px] leading-none font-semibold hover:bg-muted"
        >
          <X className="size-4 text-muted-foreground" /> 닫기
        </button>
        <PanelMeta className="font-mono">
          {blockName(zone.block)} · {block ? STAGE[block.stage] : ""}
        </PanelMeta>
      </PanelHeader>
      <div className="border-b px-5 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.02em]">{zone.name}</h2>
          <span className={cn("mt-1 shrink-0 rounded-full px-3 py-1 text-[15px] font-bold", SOFT[status])}>
            {STATUS[status].label}
          </span>
        </div>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {zone.permit ? `${zone.permit.task} · 작업 ${zone.permit.workers}명` : "오늘 작업 없음"}
        </p>
        {siblings.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {siblings.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onZone(s.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[14px]",
                  s.id === zone.id ? "border-foreground bg-foreground text-white" : "hover:bg-muted",
                )}
              >
                <span className={cn("size-2.5 rounded-full", statusBg[s.status])} />
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {status === "legal" && (
          <div className="flex items-center gap-3 rounded-xl border border-legal/30 bg-legal-soft px-4 py-3 text-legal">
            <Siren className="size-7 shrink-0" />
            <div className="flex-1">
              <div className="text-[17px] font-bold">법정 기준 초과</div>
              <div className="text-[14px] text-foreground/80">즉시 작업 중지 · 대피 · 환기</div>
            </div>
            {pending ? (
              <Button size="lg" className="bg-legal text-[15px] text-white hover:bg-legal/90" onClick={onAck}>
                경보 처리
              </Button>
            ) : (
              <span className="text-[14px] font-semibold text-muted-foreground">책임자 확인됨</span>
            )}
          </div>
        )}
        {status === "missing" && (
          <div className="flex items-center gap-3 rounded-xl border-2 border-missing bg-missing-soft px-4 py-3 text-missing">
            <Radio className="size-6 shrink-0" />
            <div className="flex-1">
              <div className="text-[17px] font-bold">센서 신호 없음</div>
              <div className="text-[14px]">
                {detail.lastRecv !== null ? `마지막 수신 ${fmtTime(detail.lastRecv)} · ` : ""}측정요원 확인이 필요합니다
              </div>
            </div>
          </div>
        )}

        {/* 지금 값 (크게): 가스 이름 · 값 · 단위를 한 줄에 */}
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-semibold text-muted-foreground">{g.label}</span>
            <span className={cn("font-mono text-[44px] leading-none font-semibold tracking-[-0.03em]", statusText[status === "missing" ? "idle" : g.status])}>
              {g.text}
            </span>
            <span className="text-[17px] text-muted-foreground">{g.unit}</span>
            {status !== "missing" && (
              <span className={cn("ml-auto text-[15px] font-semibold", rising ? statusText[g.status === "ok" ? "warn" : g.status] : "text-muted-foreground")}>
                {g.slope > 0.005 ? "▲" : g.slope < -0.005 ? "▼" : "■"} {trend}
              </span>
            )}
          </div>
          {status === "missing" && (
            <div className="mt-1 text-[14px] text-muted-foreground">마지막 값{detail.lastRecv !== null ? ` (${fmtTime(detail.lastRecv)})` : ""}</div>
          )}
          {status !== "missing" && g.status !== "legal" && g.eta !== null && (
            <div className="mt-1.5 text-[15px] font-semibold text-legal">지금 추세면 약 {Math.round(g.eta)}분 뒤 법정 기준</div>
          )}
          {status !== "missing" && <PredictionLine p={prediction} className="mt-1.5" />}
        </div>

        <div className="rounded-xl border bg-background/60 px-2 pt-2">
          <GasChart gas={gas} limit={g.limit} history={detail.history} now={t} status={status === "missing" ? "missing" : g.status} slope={g.slope} eta={g.status === "legal" ? null : g.eta} />
        </div>

        {/* 5가스: 누르면 그래프가 바뀐다 */}
        <div className="grid grid-cols-5 gap-2">
          {gases.map((x) => (
            <button
              key={x.gas}
              type="button"
              onClick={() => setGas(x.gas)}
              className={cn(
                "rounded-lg border px-2 py-2 text-left transition",
                x.gas === gas ? "border-primary bg-accent ring-1 ring-primary" : "hover:border-foreground/30",
              )}
            >
              {/* 상태는 이름 옆 점과 값 색으로만 (윗면 굵은 띠 없음) */}
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                <i className={cn("size-1.5 shrink-0 rounded-full", statusBg[status === "missing" ? "idle" : x.status])} />
                {x.label}
              </div>
              <div className={cn("mt-0.5 font-mono text-[16px] leading-tight font-semibold tracking-[-0.03em] whitespace-nowrap tabular-nums", statusText[status === "missing" ? "idle" : x.status])}>{x.text}</div>
              <div className="text-[12px] text-muted-foreground">{x.unit}</div>
            </button>
          ))}
        </div>

        {/* 환기 · 센서 · 현장 인력 */}
        <dl className="divide-y rounded-xl border text-[15px]">
          <div className="flex items-center gap-3 px-4 py-3">
            <Wind className="size-5 text-muted-foreground" />
            <dt className="w-16 text-muted-foreground">환기</dt>
            <dd className={cn("font-semibold", ventStopped && "text-legal")}>
              {!blowers.length
                ? "송풍기 없음"
                : ventStopped
                  ? `송풍기 1 정지 의심 (${fmtTime(zone.vent!.stopAt)}) · ${blowers.length}대 중 ${running}대 가동`
                  : `송풍기 ${blowers.length}대 중 ${running}대 가동`}
            </dd>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Radio className="size-5 text-muted-foreground" />
            <dt className="w-16 text-muted-foreground">센서</dt>
            <dd className="font-semibold">
              <span className="font-mono">{zone.sensor}</span> · 구역 하단 ·{" "}
              {detail.lastRecv === null ? "수신 없음" : t - detail.lastRecv < 0.5 ? "방금 수신" : `마지막 ${fmtTime(detail.lastRecv)}`}
            </dd>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <HardHat className="mt-0.5 size-5 text-muted-foreground" />
            <dt className="w-16 shrink-0 text-muted-foreground">현장</dt>
            <dd className="font-semibold">
              {detail.people.length === 0
                ? "출동한 인력 없음"
                : detail.people.map((p) => (
                    <div key={p.id}>
                      {p.role === "측정요원" ? `측정요원 ${p.name}` : p.name} ·{" "}
                      <span className={p.status === "현장 도착" ? "text-ok" : "text-primary"}>
                        {p.status === "현장 도착" ? "현장 도착" : `이동 중 (${fmtTime(p.arriveAt ?? t)} 도착 예정)`}
                      </span>
                    </div>
                  ))}
            </dd>
          </div>
        </dl>

        {detail.events.length > 0 && (
          <div>
            <div className="mb-2 text-[15px] font-semibold">측정 기록</div>
            <ol className="space-y-2">
              {detail.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-[14px] leading-snug">
                  <span className="shrink-0 pt-px font-mono text-muted-foreground">{fmtTime(e.t)}</span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* 조치: 모든 구역 (송풍기는 있는 구역만). 호출은 늘 누를 수 있다 */}
      {(
        <div className="space-y-2 border-t bg-card px-5 pt-3 pb-4">
          {/* 송풍기: 대마다 ON/OFF만 (최대 2대) */}
          {blowers.length > 0 && (
            <div className="space-y-2">
              {blowers.map((on, i) => (
                <div key={i} className="flex h-11 items-center justify-between gap-2 rounded-md border pr-1 pl-3">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold whitespace-nowrap">
                    <Fan className={cn("size-4 shrink-0", on ? "animate-spin text-primary" : "text-muted-foreground")} style={on ? { animationDuration: "2.4s" } : undefined} />
                    송풍기 {i + 1}
                  </span>
                  <span className="flex shrink-0 overflow-hidden rounded-md border" role="group" aria-label={`송풍기 ${i + 1}`}>
                    {([true, false] as const).map((v) => (
                      <button
                        key={String(v)}
                        type="button"
                        aria-pressed={on === v}
                        onClick={() => on !== v && onBlower(i, v)}
                        className={cn(
                          "h-8 w-11 text-[13px] font-bold transition-colors",
                          on === v ? (v ? "bg-primary text-primary-foreground" : "bg-foreground/80 text-background") : "bg-card text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {v ? "ON" : "OFF"}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {/* 호출은 늘 누를 수 있다 (이미 가는 중이면 알림으로 알려 준다) */}
            {(["측정요원", "관리감독자"] as const).map((role) => (
              <Button key={role} size="lg" variant="outline" onClick={() => onCall(role)} className="h-11 border-2 border-primary text-[15px] font-semibold text-primary hover:bg-accent">
                <PhoneCall />
                {role} 호출
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
