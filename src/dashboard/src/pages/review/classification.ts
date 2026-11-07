import type { Decision, ReviewPermit, ReviewStatus } from './data'

export const AI_CATEGORIES = ['우선 확인', '확인 권장', '쟁점 없음'] as const
export type AiCategory = typeof AI_CATEGORIES[number]

// AI의 쟁점 분류와 관리자의 허가 결정은 독립된 상태다.
export function classifyPermit(permit: ReviewPermit): AiCategory {
  if (permit.missing.length || permit.findings.some(f => f.level === '필수 확인')) return '우선 확인'
  if (permit.findings.some(f => f.level === '확인 권장')) return '확인 권장'
  return '쟁점 없음'
}

export function statusOf(permit: ReviewPermit, decisions: Record<string, Decision>): ReviewStatus {
  return decisions[permit.id]?.status ?? '검토 필요'
}
