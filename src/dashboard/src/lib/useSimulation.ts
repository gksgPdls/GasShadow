import { useEffect, useReducer, useRef, useState } from "react"
import { toast } from "sonner"
import { SIM_START } from "@/data/scenario"
import { Simulation, type PersonRole } from "@/lib/sim"
import { predictionText } from "@/lib/prediction"
import {
  connect,
  fetchState,
  postAck,
  postVent,
  postControl,
  type Prediction,
  type ServerMsg,
} from "@/lib/server"

const TICK_MS = 250

// ?start=0912 처럼 시작 시각을 바꿀 수 있다 (데모·스크린샷용)
function startFromUrl() {
  const p = new URLSearchParams(location.search).get("start") || ""
  return /^\d{4}$/.test(p) ? Number(p.slice(0, 2)) * 60 + Number(p.slice(2)) : SIM_START
}

// 서버(재생기)가 화면과 다른 구역 목록을 보내면 옛 코드로 떠 있는 것이다 (구역 대부분이 '센서 결측'으로 보임). 한 번 알린다
let zonesWarned = false
function warnIfZonesDiffer(sim: Simulation, serverZones: Record<string, unknown>) {
  const missing = sim.zones.filter((z) => !(z.id in serverZones)).length
  if (!missing || zonesWarned) return
  zonesWarned = true
  console.warn(`서버가 모르는 구역 ${missing}곳: 메인 서버·재생기를 이 코드로 다시 띄우세요`)
  toast.error(`서버가 화면과 다른 구역 목록을 보내고 있어요 (${missing}곳 없음). 메인 서버와 재생기를 다시 켜 주세요`)
}

/** 데이터 출처: server = 메인 서버(재생기 → FastAPI → WebSocket), local = 브라우저 안 시뮬레이션 (서버 없이 시연할 때) */
export type DataSource = "connecting" | "server" | "local"

export function useSimulation() {
  // 시뮬레이션 객체는 처음 한 번 만들고 안에서 바뀐다. 다시 그릴 때는 rerender()를 부른다
  const [sim] = useState(() => new Simulation(startFromUrl()))

  const [source, setSource] = useState<DataSource>(new URLSearchParams(location.search).get("data") === "local" ? "local" : "connecting")
  const [wsOpen, setWsOpen] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(10) // 실제 1초 = 시뮬레이션 10초
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({})
  const [aiOk, setAiOk] = useState<boolean | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const runId = useRef("")
  const refetching = useRef(false)
  // 예측 모델이 '곧 넘을 수 있음'으로 본 구역 (새로 들어온 구역만 에이전트가 알린다)
  const hot = useRef(new Set<string>())
  // 서버 모드에서 값이 끊겼는지: 마지막 값을 받은 실제 시각(ms)과 끊김 여부
  const lastTickAt = useRef(0)
  const [stale, setStale] = useState(false)

  // 처음: 메인 서버가 있으면 서버 모드, 없으면 브라우저 시뮬레이션
  useEffect(() => {
    if (source !== "connecting") return
    let cancelled = false
    fetchState().then((s) => {
      if (cancelled) return
      if (!s) {
        setSource("local")
        return
      }
      runId.current = s.run_id
      sim.serverReset(s.t, s.zones)
      warnIfZonesDiffer(sim, s.zones)
      setPlaying(s.control.playing)
      setSpeed(s.control.speed)
      setPredictions(s.predictions)
      setAiOk(s.ai_ok)
      setSource("server")
    })
    return () => {
      cancelled = true
    }
  }, [sim, source])

  // 브라우저 시뮬레이션 중에도 5초마다 서버를 찾아서, 서버가 뜨면 서버 모드로 넘어간다 (?data=local이면 안 찾음)
  useEffect(() => {
    if (source !== "local" || new URLSearchParams(location.search).get("data") === "local") return
    const id = setInterval(() => {
      fetchState().then((s) => s && setSource("connecting"))
    }, 5000)
    return () => clearInterval(id)
  }, [source])

  // 서버 모드: WebSocket으로 10초(시연 시각)마다 값이 온다
  useEffect(() => {
    if (source !== "server") return
    const onMsg = async (m: ServerMsg) => {
      if (m.type === "reset" || (m.type === "tick" && m.run_id !== runId.current)) {
        // 새 시연: 상태를 한 번만 다시 받는다 (받는 동안 오는 tick은 무시)
        if (refetching.current) return
        refetching.current = true
        const s = await fetchState().finally(() => (refetching.current = false))
        if (!s) return
        runId.current = s.run_id
        sim.serverReset(s.t, s.zones)
        warnIfZonesDiffer(sim, s.zones)
        hot.current.clear()
        setPredictions(s.predictions)
      } else if (m.type === "tick") {
        sim.serverTick(m.t, m.readings, m.assess)
        lastTickAt.current = performance.now()
      } else if (m.type === "predictions") {
        Object.entries(m.predictions).forEach(([id, p]) => {
          const pt = predictionText(p)
          if (!pt?.hot) return void hot.current.delete(id)
          if (hot.current.has(id)) return
          hot.current.add(id)
          const z = sim.zones.find((x) => x.id === id)
          sim.note(id, `예측 · ${z?.name ?? id}: ${pt.text}`)
        })
        setPredictions(m.predictions)
        setAiOk(true)
      } else if (m.type === "control") {
        setPlaying(m.control.playing)
        setSpeed(m.control.speed)
      } else if (m.type === "ai_status") {
        setAiOk(m.ok)
      }
      rerender()
    }
    return connect(onMsg, setWsOpen)
  }, [sim, source])

  // 서버 모드: 연결이 끊겼거나 5초 넘게 값이 안 오면 끊김으로 본다 (일시정지 중에도 재생기는 값을 보낸다)
  useEffect(() => {
    if (source !== "server") return
    lastTickAt.current = performance.now()
    const id = setInterval(() => setStale(!wsOpen || performance.now() - lastTickAt.current > 5000), 1000)
    return () => clearInterval(id)
  }, [source, wsOpen])

  // 브라우저 시뮬레이션: 직접 시간을 돌린다
  useEffect(() => {
    if (source !== "local" || !playing) return
    const id = setInterval(() => {
      sim.advance((speed * TICK_MS) / 1000 / 60)
      rerender()
    }, TICK_MS)
    return () => clearInterval(id)
  }, [sim, source, playing, speed])

  // 새 경보 토스트는 띄우지 않는다 (알람 배너로 충분). 쌓이지 않게 비우기만 한다
  useEffect(() => {
    sim.drainNotices()
  })

  const server = source === "server"

  return {
    view: sim.view(),
    source,
    wsOpen,
    /** 서버 값이 끊김 (화면 값은 마지막으로 받은 때 기준) */
    stale: source === "server" && stale,
    /** 서버를 다시 찾아 처음부터 붙는다 */
    reconnect() {
      setSource("connecting")
    },
    playing,
    setPlaying(on: boolean) {
      setPlaying(on)
      if (server) postControl({ playing: on })
    },
    speed,
    setSpeed(v: number) {
      setSpeed(v)
      if (server) postControl({ speed: v })
    },
    reset() {
      if (server) {
        postControl({ reset: true, playing: true })
        return
      }
      sim.reset(sim.outage)
      setPlaying(true)
      rerender()
    },
    setOutage(on: boolean) {
      if (server) postControl({ outage: on })
      sim.setOutage(on)
      rerender()
    },
    ack(zoneId: string) {
      if (server) postAck(zoneId)
      sim.ack(zoneId)
      rerender()
    },
    /** 측정요원·관리감독자 호출 → 결과 문장 */
    call(role: PersonRole, zoneId: string) {
      const text = sim.call(role, zoneId)
      rerender()
      return text
    },
    /** 송풍기 하나 켜기/끄기 → 결과 문장. 환기 강화가 새로 시작되면 서버에도 알린다 (서버는 강화 시작만 받는다) */
    setBlower(zoneId: string, i: number, on: boolean) {
      const before = sim.ventAt.has(zoneId)
      const text = sim.setBlower(zoneId, i, on)
      if (server && !before && sim.ventAt.has(zoneId)) postVent(zoneId)
      rerender()
      return text
    },
    /** 사건·조치 로그와 현장 이벤트에 한 줄 */
    logAction(zoneId: string, text: string) {
      sim.logAction(zoneId, text)
      rerender()
    },
    release(personId: string) {
      sim.release(personId)
      rerender()
    },
    /** 구역 상세 (렌더 중에 불러도 됨) */
    zoneDetail: (zoneId: string) => sim.zoneDetail(zoneId),
    /** 5가스 위험예측 모델 결과 (서버 모드에서만 있다) */
    ai: { predictions, ok: aiOk },
  }
}
