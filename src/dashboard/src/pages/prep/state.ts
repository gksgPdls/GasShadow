import { useEffect, useState } from "react"

// 다른 탭에 다녀와도 전날 준비에서 한 일이 남도록 화면 밖에 둔다 (새로고침하면 처음으로)
const kept = new Map<string, unknown>()

export function useKept<T>(key: string, init: () => T) {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : init()))
  useEffect(() => {
    kept.set(key, value)
  }, [key, value])
  return [value, setValue] as const
}

// D-1 시계: 11/7(토) 14:46:20에서 실제 시간만큼 흐른다. 마감은 15:00 (현장 운영 설정값)
const D1_START = 14 * 3600 + 46 * 60 + 20
export const DEADLINE_SEC = 15 * 3600
const t0 = Date.now()
const nowSec = () => D1_START + Math.floor((Date.now() - t0) / 1000)

export function useD1Clock() {
  const [sec, setSec] = useState(nowSec)
  useEffect(() => {
    const id = setInterval(() => setSec(nowSec()), 1000)
    return () => clearInterval(id)
  }, [])
  return sec
}

const pad = (n: number) => String(n).padStart(2, "0")
export const hms = (sec: number) => `${pad(Math.floor(sec / 3600) % 24)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`
export const hm = (sec: number) => hms(sec).slice(0, 5)
