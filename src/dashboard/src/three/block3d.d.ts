import type { Person, Status } from "@/lib/sim"

export interface Block3DApi {
  /** 구역별 상태와 시뮬레이션 시각(자정 이후 분), 측정요원·관리감독자 목록을 그림에 반영한다. */
  update(list: { id: string; status: Status }[], labels: Record<Status, string>, t?: number, people?: Person[]): void
  /** 블록을 고르고 가까이 간다. zoneId를 주면 그 구역 출입현황판이 보이는 각도로. null이면 선택 해제. */
  select(id: string | null, zoneId?: string, silent?: boolean): void
  /** 공정 바로가기: "all" | "assembly" | "outfit" | "paint" | "pe" | "erect" */
  goto(key: string): void
  /** 블록 위에 말풍선을 잠깐 띄운다 (ms 뒤 사라짐) */
  say(blockId: string, text: string, tone?: "info" | "ok" | "warn" | "legal" | "missing" | "unauth", ms?: number): void
  /** 3D를 덮는 왼쪽 창 폭(px). 그만큼 보이는 가운데를 오른쪽으로 부드럽게 옮긴다 */
  setInsets(left: number): void
  dispose(): void
}

export function mountBlock3D(
  host: HTMLElement,
  opts?: {
    onSelect?: (id: string | null) => void
    onZone?: (zoneId: string) => void
    /** 밀폐구역 안 출입현황판을 눌렀을 때 */
    onBoard?: (zoneId: string) => void
    /** 현황판에 걸린 출입증(작업자 번호)이나 작업 시작 여부(started)가 바뀔 때 */
    onCrew?: (zoneId: string, ns: number[], started: boolean) => void
    onTodo?: (text: string) => void
    /** false면 3D 안 블록 패널을 띄우지 않는다 */
    panel?: boolean
  },
): Block3DApi | null
