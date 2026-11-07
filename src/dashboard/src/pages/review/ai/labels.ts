import type { FindingKind, IntakePermit } from "@/pages/review/ai/types"

// AI 사전 검토 화면 문구·색 (컴포넌트 파일과 분리: fast refresh)

/** 화면에 보일 이름은 label (짧게) */
export const KIND_STYLE: Record<FindingKind, { label: string; className: string; bar: string }> = {
  "과소 신청 의심": { label: "과소 신청 의심", className: "bg-legal-soft text-legal", bar: "bg-legal" },
  "작업 간 충돌": { label: "작업 겹침", className: "bg-legal-soft text-legal", bar: "bg-legal" },
  "기재 누락": { label: "기재 누락", className: "bg-warn-soft text-warn-ink", bar: "bg-warn" },
  "체크 항목 모순": { label: "체크 오류", className: "bg-warn-soft text-warn-ink", bar: "bg-warn" },
  "판단 필요": { label: "판단 필요", className: "bg-warn-soft text-warn-ink", bar: "bg-warn" },
  "과거 유사 사고": { label: "유사 사고", className: "bg-accent text-primary", bar: "bg-primary" },
  참고: { label: "참고", className: "bg-muted text-muted-foreground", bar: "bg-border" },
}

export const toSec = (hms: string) => {
  const [h, m, s = "0"] = hms.split(":")
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** 검색어가 허가번호·작업명·장소·부서·작업 유형·공구 중 하나에 들어 있나 */
export const matches = (p: IntakePermit, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [p.id, p.task, p.place, p.department, p.form, ...p.tools].some((v) => v.toLowerCase().includes(q))
}
