import type { Status } from "@/lib/sim"

// Tailwind가 찾을 수 있도록 상태별 클래스 이름을 그대로 적어 둔다
export const statusText: Record<Status, string> = {
  legal: "text-legal",
  unauth: "text-unauth",
  missing: "text-missing",
  warn: "text-warn-ink",
  ok: "text-ok",
  idle: "text-muted-foreground",
}
export const statusBg: Record<Status, string> = {
  legal: "bg-legal",
  unauth: "bg-unauth",
  missing: "bg-missing",
  warn: "bg-warn",
  ok: "bg-ok",
  idle: "bg-idle",
}
/** 옅은 바탕 + 진한 글씨 (상태 칩) */
export const statusSoft: Record<Status, string> = {
  legal: "bg-legal-soft text-legal",
  unauth: "bg-unauth-soft text-unauth",
  missing: "bg-missing-soft text-missing",
  warn: "bg-warn-soft text-warn-ink",
  ok: "bg-ok-soft text-ok",
  idle: "bg-muted text-muted-foreground",
}
