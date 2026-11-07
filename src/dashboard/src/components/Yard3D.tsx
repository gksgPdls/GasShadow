import { useEffect, useRef, type RefObject } from "react"
import { mountBlock3D, type Block3DApi } from "@/three/block3d"
import { STATUS_LABELS, type Person, type Status } from "@/lib/sim"

interface Props {
  zoneStatus: { id: string; status: Status }[]
  t: number
  /** 측정요원·관리감독자 (3D에서 출동·도착 위치로 움직인다) */
  people: Person[]
  apiRef: RefObject<Block3DApi | null>
  /** 블록 위 상태 이름표·말풍선을 숨기고 구역 색으로만 상태를 보여준다 (index.css .color-only) */
  colorOnly?: boolean
  onSelect: (id: string | null) => void
  onZone: (zoneId: string) => void
  onBoard: (zoneId: string) => void
  onCrew: (zoneId: string, ns: number[], started: boolean) => void
  onTodo: (what: string) => void
  onUnavailable: () => void
}

// three.js 장면(block3d.js)을 React 안에 올린다. 안쪽 DOM은 block3d.js가 직접 관리하므로 React는 빈 div만 둔다.
export function Yard3D({ zoneStatus, t, people, apiRef, colorOnly, onSelect, onZone, onBoard, onCrew, onTodo, onUnavailable }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handlers = useRef({ onSelect, onZone, onBoard, onCrew, onTodo, onUnavailable })

  useEffect(() => {
    handlers.current = { onSelect, onZone, onBoard, onCrew, onTodo, onUnavailable }
  })

  useEffect(() => {
    const api = mountBlock3D(hostRef.current!, {
      onSelect: (id) => handlers.current.onSelect(id),
      onZone: (id) => handlers.current.onZone(id),
      onBoard: (id) => handlers.current.onBoard(id),
      onCrew: (id, ns, started) => handlers.current.onCrew(id, ns, started),
      onTodo: (what) => handlers.current.onTodo(what),
      panel: false, // 블록·구역 정보는 왼쪽 구역 상세가 보여준다
    })
    apiRef.current = api
    if (!api) handlers.current.onUnavailable()
    return () => {
      api?.dispose()
      apiRef.current = null
    }
  }, [apiRef]) // 처음 한 번만 올린다 (apiRef는 바뀌지 않음)

  useEffect(() => {
    apiRef.current?.update(zoneStatus, STATUS_LABELS, t, people)
  })

  return <div ref={hostRef} className={colorOnly ? "b3 color-only" : "b3"} />
}
