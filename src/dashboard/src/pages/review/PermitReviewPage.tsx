import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  RotateCcw,
  Inbox,
  Link2,
  PenLine,
  Send,
  UserRoundCheck,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { AgentMascot } from "@/components/AgentMascot"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { addRecord } from "@/lib/records"
import { type PageProps } from "@/pages/types"
import { ME } from "@/pages/prep/model"
import { DEADLINE_SEC, hm, hms, useKept } from "@/pages/prep/state"
import { AnalysisRun } from "@/pages/review/ai/AnalysisRun"
import { INTAKE, RESULTS, STEPS } from "@/pages/review/ai/data"
import { IntakeView } from "@/pages/review/ai/IntakeView"
import { PermitDocumentViewer } from "@/pages/review/PermitDocumentDialog"
import {
  GRADE_INFO,
  REVIEW_PERMITS,
  REVISIONS,
  revisedPermit,
  type Decision,
  type PermitGrade,
  type ReviewPermit,
  type ReviewStatus,
} from "@/pages/review/data"
import { Panel, SearchBox, Segmented, Tag } from "@/pages/review/ai/ui"
import "@/pages/review/review.css"

import { AI_CATEGORIES, classifyPermit, statusOf, type AiCategory } from "./classification"

// 기본 분류는 처리 상태(관리자가 할 일), AI 분류는 순서와 보조 선택으로만 쓴다
type Filter = "전체" | ReviewStatus
const STATUSES: ReviewStatus[] = ["검토 필요", "보완 대기", "승인 완료"]
/** 보완 후 다시 접수된 기록: 요청 시각 · 재접수 시각 */
type Resubmit = { requestedAt: string; at: string; note: string }
type Resubmits = Record<string, Resubmit>
const RESUBMIT_DELAY_MS = 10_000 // 시연: 보완 요청 10초 뒤 작업부서가 고쳐서 다시 낸다

// 2차 접수본 기준으로 본 허가서: 장소·시간 등은 고친 값, 누락 항목은 아직 반영 안 된 것만, 해결된 AI 지적은 뺀다
function viewOf(permit: ReviewPermit, resubmits: Resubmits): ReviewPermit {
  const rev = REVISIONS[permit.id]
  if (!resubmits[permit.id] || !rev) return permit
  return {
    ...revisedPermit(permit),
    missing: rev.checks.filter((c) => !c.ok).map((c) => c.item),
    findings: permit.findings.filter((f) => !rev.resolvedFindings.includes(f.id)),
  }
}

const FILTERS: Filter[] = ["전체", ...STATUSES]
const GRADES: PermitGrade[] = ["전산허가", "안전대면허가", "안전현장허가"]
const AI_TEXT: Record<AiCategory, string> = {
  "우선 확인": "text-warn-ink",
  "확인 권장": "text-primary",
  "쟁점 없음": "text-muted-foreground",
}
/** AI 분류: 관리자 처리 상태와 구분되도록 상자 없이 글자만 */
function AiLabel({ permit, className }: { permit: ReviewPermit; className?: string }) {
  const category = classifyPermit(permit)
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 text-[13.5px] font-medium whitespace-nowrap", AI_TEXT[category], className)}>
      {category}
    </span>
  )
}

// 처리 상태: 다른 탭과 같은 옅은 바탕 Tag (검토 필요 = 주의, 보완 대기 = 회색, 승인 완료 = 초록)
const statusTone = { "검토 필요": "warn", "보완 대기": "muted", "승인 완료": "ok" } as const

const levelTone = { "필수 확인": "legal", "확인 권장": "warn", 참고: "primary" } as const

// AI 판단과 관계없이 모든 허가서는 관리자 결정 전에는 승인 대기다.
const initialDecisions = (): Record<string, Decision> => ({})

function StatusBadge({ status }: { status: ReviewStatus }) {
  return <Tag tone={statusTone[status]}>{status}</Tag>
}

function ResubmitChip() {
  return <Tag tone="primary" className="bg-accent text-accent-foreground">2차 접수</Tag>
}

// 보완 요청 → 재접수: 요청한 항목마다 원문에서 무엇이 바뀌었고 반영됐는지 (관리자가 가장 먼저 볼 곳)
function RevisionCheck({ permit, resubmit }: { permit: ReviewPermit; resubmit: Resubmit }) {
  const rev = REVISIONS[permit.id]
  const ok = rev.checks.filter((c) => c.ok).length
  return (
    <Panel
      title="보완 요청 반영 확인"
      right={
        <span>
          {resubmit.requestedAt} 요청 → {resubmit.at} 재접수 · 반영 <b className="text-foreground">{ok}/{rev.checks.length}</b>
        </span>
      }
    >
      <ul className="divide-y">
        {rev.checks.map((c) => (
          <li key={c.item} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{c.item}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[14.5px]">
                {c.ok ? (
                  <>
                    <del className="text-legal">{c.before}</del>
                    <span className="text-muted-foreground">→</span>
                    <span className="rounded-sm bg-accent px-1">{c.after}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{c.after}</span>
                )}
              </div>
            </div>
            <Tag tone={c.ok ? "ok" : "legal"}>{c.ok ? "반영됨" : "미반영"}</Tag>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function PermitList({
  permits,
  selected,
  decisions,
  resubmits,
  onSelect,
}: {
  permits: ReviewPermit[]
  selected: string
  decisions: Record<string, Decision>
  resubmits: Resubmits
  onSelect: (id: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {permits.map((first) => {
        const permit = viewOf(first, resubmits)
        const resub = resubmits[permit.id]
        const rev = resub ? REVISIONS[permit.id] : undefined
        const status = statusOf(permit, decisions)
        const active = permit.id === selected
        return (
          <button
            type="button"
            key={permit.id}
            onClick={() => onSelect(permit.id)}
            className={cn(
              "relative block w-full border-b px-4 py-3 text-left transition-colors",
              active ? "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary" : "bg-card hover:bg-muted/60",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13.5px] leading-6 text-muted-foreground">{permit.id}</span>
              <StatusBadge status={status} />
              {/* 보완 대기: 언제 요청을 보냈는지 */}
              {status === "보완 대기" && decisions[permit.id] && <span className="text-[13.5px] text-muted-foreground">{decisions[permit.id].at} 요청</span>}
              <AiLabel permit={permit} className="ml-auto" />
            </div>
            <div className={cn("mt-1 line-clamp-2 text-[16px] leading-snug", active ? "font-semibold" : "font-medium")}>{permit.task}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[14px] text-muted-foreground">
              {rev && status === "검토 필요" ? (
                <>
                  {/* 윗줄은 번호·상태·확인 수로 꽉 차므로 '2차 접수'는 아랫줄에 */}
                  <span className="flex min-w-0 items-center gap-2">
                    <ResubmitChip />
                    <span className="truncate">보완 반영 {rev.checks.filter((c) => c.ok).length}/{rev.checks.length}</span>
                  </span>
                  <span className="shrink-0">{resub!.at} 재접수</span>
                </>
              ) : (
                <>
                  <span className="truncate">{permit.place}</span>
                  <span className="shrink-0">{permit.receivedAt} 접수</span>
                </>
              )}
            </div>
          </button>
        )
      })}
      {permits.length === 0 && <div className="grid h-40 place-items-center text-[15px] text-muted-foreground">해당 상태의 허가서가 없습니다.</div>}
    </div>
  )
}

// 신청 내용: 허가서 요약과 관련 부서 협의 결과를 한 장으로 (자세한 내용은 오른쪽 원문)
function RequestSummary({ permit, coordination }: { permit: ReviewPermit; coordination: ReviewPermit["coordination"] }) {
  const rows = [
    ["작업부서", permit.department],
    ["작업장소", permit.place],
    ["작업일시", `${permit.workDate} · ${permit.workTime}`],
    ["투입인원", `${permit.workers}명`],
  ]
  return (
    <div className="space-y-8">
      <Panel title="허가서 요약" right={<Tag tone="muted">{permit.form}</Tag>}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 pt-3 text-[15px] 2xl:grid-cols-4">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[14px] text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <Panel
        title="관련 부서 협의 결과"
        right={
          <span className={cn("flex items-center gap-1 text-[14px] font-medium", coordination.confirmed === false ? "text-warn-ink" : "text-ok")}>
            {coordination.confirmed === false ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {coordination.confirmed === false ? "협의 필요" : "협의 완료"}
          </span>
        }
      >
        <p className="pt-3 text-[15px] leading-relaxed">{coordination.summary}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {coordination.transitions.map((item) => <Tag key={item} tone="muted">{item}</Tag>)}
          {coordination.transitions.length === 0 && <span className="text-[14px] text-legal">전환조건 미기재</span>}
          <span className="ml-auto flex items-center gap-2 text-[13.5px] text-muted-foreground">
            <Clock3 className="size-3.5" />{coordination.completedAt}
            <span className="h-3 w-px bg-border" />
            {coordination.participants.join(" · ")}
          </span>
        </div>
      </Panel>
    </div>
  )
}

// 가운데 칸 흐름: 신청 내용(작업부서) → AI 분석(AI) → 관리자 결정(사람, 아래에 늘 붙어 있음)
// 분석 내용은 안전 에이전트 캐릭터로 식별하고, 배경색은 절제한다.
function AiZone({ children }: { children: ReactNode }) {
  return (
    <section className="mt-10">
      <header className="flex items-center gap-2 pb-3">
        <AgentMascot className="h-6 shrink-0" />
        <h3 className="text-[16px] font-semibold text-primary">안전 에이전트 분석</h3>
        <span className="h-px flex-1 bg-primary/25" aria-hidden />
      </header>
      <div className="space-y-8 border-l-2 border-primary/25 pl-4">{children}</div>
    </section>
  )
}

// AI 추천 등급과 아직 부족한 정보 (관리자 결정 칸에서 옮겨 옴)
function AiRecommendation({ permit }: { permit: ReviewPermit }) {
  return (
    <section>
      <div className="text-[14px] font-medium text-primary">추천 허가등급</div>
      <div className="mt-1 text-[20px] leading-7 font-semibold">{permit.recommendedGrade}</div>
      <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{permit.recommendationReason}</p>
      {permit.missing.length > 0 && (
        <div className="mt-3 rounded-md bg-legal-soft px-3 py-2.5 text-[15px] text-legal">
          <b>현재 부족한 정보</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{permit.missing.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

function AiReview({ permit }: { permit: ReviewPermit }) {
  return (
    <Panel title="안전 검토 결과" right={permit.findings.length > 0 ? <span>확인 항목 {permit.findings.length}</span> : undefined}>

      {permit.relatedWork.length > 0 && (
        <div className="flex items-start gap-3 border-b py-3 text-[15px]">
          <span className="flex h-[1lh] shrink-0 items-center"><Link2 className="size-4 text-primary" /></span>
          <div><b>연관 작업</b>{permit.relatedWork.map((work) => <div key={work} className="mt-0.5 text-muted-foreground">{work}</div>)}</div>
        </div>
      )}

      <div className="divide-y">
        {permit.findings.map((finding) => (
          <article key={finding.id} className="py-4">
            <div className="flex items-start gap-3">
              <span className="flex h-6 shrink-0 items-center"><AlertTriangle className={cn("size-4", finding.level === "필수 확인" ? "text-legal" : finding.level === "확인 권장" ? "text-warn" : "text-primary")} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex min-h-6 flex-wrap items-center gap-2">
                  <Tag tone={levelTone[finding.level]}>{finding.level}</Tag>
                  <h4 className="text-[16px] font-semibold">{finding.title}</h4>
                </div>
                <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{finding.description}</p>
                <div className="mt-2.5 space-y-1">
                  {finding.evidence.map((evidence) => (
                    <div key={`${finding.id}-${evidence.source}-${evidence.text}`} className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-[14px]">
                      <span className="flex h-[1lh] shrink-0 items-center"><BookOpenText className="size-3.5 text-muted-foreground" /></span>
                      <span className="shrink-0 font-semibold">{evidence.source}</span>
                      <span className="text-muted-foreground">{evidence.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
        {permit.findings.length === 0 && (
          <div className="flex items-center gap-2.5 py-4 text-[15px] text-ok"><CheckCircle2 className="size-4.5" />AI가 발견한 추가 쟁점은 없습니다. 원문과 작업조건 확인 후 관리자가 최종 승인하세요.</div>
        )}
      </div>
    </Panel>
  )
}

function DecisionPanel({
  permit,
  selectedGrade,
  decision,
  onGrade,
  onDecision,
  onCancelApproval,
}: {
  permit: ReviewPermit
  selectedGrade: PermitGrade
  decision?: Decision
  onGrade: (grade: PermitGrade) => void
  onDecision: (status: "승인 완료" | "보완 대기", note: string) => void
  onCancelApproval: () => void
}) {
  const [pendingAction, setPendingAction] = useState<"approve" | "request" | "cancelApproval" | null>(null)
  const [editingDecision, setEditingDecision] = useState(false)
  // 보완 요청 내용: 관리자가 직접 쓰거나 [AI 초안 작성]으로 채운 뒤 고쳐서 그대로 작업부서에 보낸다
  const [requestText, setRequestText] = useState("")
  const draftItems = [...permit.missing.map((m) => `${m} 기재`), ...permit.findings.filter((f) => f.level !== "참고").map((f) => f.title)]
  const aiDraft = draftItems.length ? `다음 내용을 보완해 주세요.\n${draftItems.map((x) => `· ${x}`).join("\n")}` : "AI 확인항목에 대한 작업부서 답변 요청"
  const isApproved = decision?.status === "승인 완료"
  const locked = Boolean(decision) && !editingDecision
  const isCancelingApproval = pendingAction === "cancelApproval"

  const beginEdit = () => setEditingDecision(true)

  const cancelEdit = () => {
    if (decision) onGrade(decision.grade)
    setEditingDecision(false)
    setRequestText("")
    setPendingAction(null)
  }

  const openRequestConfirmation = () => {
    // 이미 보완 요청했던 건을 고칠 때는 보냈던 내용부터, 처음이면 빈 칸 (AI 초안은 관리자가 눌러서 채움)
    setRequestText(decision?.status === "보완 대기" ? decision.note.replace("\n관리자 메모: ", "\n") : "")
    setPendingAction("request")
  }

  const confirmDecision = () => {
    if (pendingAction === "approve") onDecision("승인 완료", `${selectedGrade}로 승인`)
    if (pendingAction === "request" && requestText.trim()) onDecision("보완 대기", requestText.trim())
    if (pendingAction === "cancelApproval") onCancelApproval()
    setPendingAction(null)
    setEditingDecision(false)
    setRequestText("")
  }

  return (
    <>
      {/* 가운데 칸의 아래 여백(p-5)만큼 내려 붙여, 막대 아래로 내용이 비치지 않게 한다 */}
      {/* 가운데 칸 맨 아래에 붙는 결정 막대 (아래 여백 pb-5만큼 내려 붙여 내용이 비치지 않게). 가는 선 + 옅은 그림자로만 나눈다 */}
      <aside className="sticky -bottom-5 z-10 -mx-8 -mb-5 mt-6 border-t bg-card px-8 pt-3 pb-4 shadow-[0_-4px_12px_rgb(16_24_40/0.05)]">
        <div className="flex items-center gap-2">
          <UserRoundCheck className="size-4 text-muted-foreground" />
          <h3 className="text-[16px] font-semibold">관리자 최종 결정</h3>
          {editingDecision ? (
            <span className="ml-auto text-[14px] font-medium text-primary">기존 결정을 수정 중입니다. 새로운 처리를 선택해 확정하세요.</span>
          ) : (
            !decision && <span className="ml-auto text-[13.5px] text-muted-foreground">AI 분류와 추천 등급을 확인한 뒤 최종 승인해 주세요.</span>
          )}
        </div>
        {/* 최종 허가등급: 세 칸을 한 줄로 */}
        <fieldset className="mt-2.5 grid grid-cols-3 gap-2" disabled={locked}>
          <legend className="sr-only">최종 허가등급</legend>
          {GRADES.map((grade) => (
            <label
              key={grade}
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 transition-colors",
                locked ? "cursor-default" : "cursor-pointer",
                selectedGrade === grade ? "bg-accent ring-2 ring-primary ring-inset" : cn("ring-1 ring-border ring-inset", locked ? "opacity-45" : "hover:bg-muted/60"),
              )}
            >
              <input type="radio" className="mt-[3px] accent-[var(--primary)]" checked={selectedGrade === grade} onChange={() => onGrade(grade)} />
              <span className="min-w-0">
                <span className={cn("block text-[15px] leading-5 break-keep", selectedGrade === grade ? "font-semibold text-primary" : "font-medium")}>{grade}</span>
                <span className="mt-0.5 line-clamp-2 block text-[13px] leading-4 text-muted-foreground">{GRADE_INFO[grade].short}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {decision && (
          <div className={cn("mt-2.5 rounded-md px-3", isApproved ? "bg-ok-soft py-1.5 text-ok" : "bg-warn-soft py-2 text-warn-ink")}>
            <div className="flex flex-wrap items-center gap-x-2">
              {isApproved ? <CheckCircle2 className="size-4.5" /> : <Send className="size-4.5" />}
              <b className="text-[15px]">{isApproved ? "검토 승인 완료" : "보완 요청 완료"}</b>
              <span className="text-[14px] font-medium">{decision.at}</span>
              {decision.revised && <span className="rounded-md bg-background/70 px-2 py-0.5 text-[14px] font-semibold">수정됨</span>}
              <span className="ml-auto text-[14px] opacity-75">결정 이력에 저장되었습니다.</span>
            </div>
            {decision.previous && <div className="mt-0.5 text-[13.5px] opacity-75">이전 결정: {decision.previous}</div>}
            {!isApproved && <div className="mt-0.5 line-clamp-2 whitespace-pre-line text-[14px] leading-relaxed">{decision.note}</div>}
          </div>
        )}

        <div className={cn("mt-2.5 grid gap-2", decision ? (isApproved && locked ? "grid-cols-4" : "grid-cols-3") : "grid-cols-2")}>
          <Button variant="outline" size="lg" className="text-[16px]" disabled={locked} onClick={openRequestConfirmation}>
            {!isApproved && locked ? <CheckCircle2 /> : null}{!isApproved && locked ? "보완 요청 완료" : "보완 요청"}
          </Button>
          <Button size="lg" className="text-[16px]" disabled={locked} onClick={() => setPendingAction("approve")}>
            {isApproved && locked ? <CheckCircle2 /> : <FileCheck2 />}{isApproved && locked ? "검토 승인 완료" : "최종 승인"}
          </Button>
          {isApproved && locked && (
            <Button variant="destructive" size="lg" className="text-[16px]" onClick={() => setPendingAction("cancelApproval")}>
              <CircleAlert />승인 취소
            </Button>
          )}
          {decision && (
            <Button variant="outline" size="lg" className="text-[16px]" onClick={editingDecision ? cancelEdit : beginEdit}>
              <PenLine />{editingDecision ? "수정 취소" : "수정"}
            </Button>
          )}
        </div>
      </aside>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent className="max-w-[440px] p-5 sm:max-w-[440px]">
          <AlertDialogHeader>
            <AlertDialogMedia className={isCancelingApproval ? "bg-legal-soft text-legal" : pendingAction === "approve" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}>
              {isCancelingApproval ? <CircleAlert /> : pendingAction === "approve" ? <FileCheck2 /> : <Send />}
            </AlertDialogMedia>
            <AlertDialogTitle className="text-[20px]">
              {isCancelingApproval
                ? "승인을 취소할까요?"
                : editingDecision
                ? pendingAction === "approve" ? "승인 결정으로 수정할까요?" : "보완 요청으로 수정할까요?"
                : pendingAction === "approve" ? "이 작업을 승인할까요?" : "보완을 요청할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isCancelingApproval
                ? "확정하면 승인 상태가 해제되고 작업은 다시 검토 필요 상태로 돌아갑니다."
                : editingDecision ? "확정하면 기존 결정이 새 결정으로 변경되고 수정 이력이 저장됩니다." : "확정하면 결정 이력이 저장되고 작업부서에 처리 상태가 공유됩니다."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg border bg-muted/50 p-3 text-[16px]">
            <div className="font-mono font-semibold text-primary">{permit.id}</div>
            <div className="mt-1 text-[17px] font-semibold">{permit.task}</div>
            <div className="mt-3 grid grid-cols-[76px_1fr] gap-y-1.5 text-muted-foreground">
              <span>처리</span><b className="text-foreground">{isCancelingApproval ? "승인 취소" : pendingAction === "approve" ? "검토 승인" : "보완 요청"}</b>
              <span>허가등급</span><b className="text-foreground">{selectedGrade}</b>
              {pendingAction !== "request" && (
                <>
                  <span>내용</span><b className="text-foreground">{isCancelingApproval ? `${selectedGrade} 승인 해제 · 재검토 필요` : `${selectedGrade}로 승인`}</b>
                </>
              )}
            </div>
          </div>

          {pendingAction === "request" && (
            <div>
              <div className="flex items-center gap-2">
                <label htmlFor="manager-request-text" className="text-[16px] font-semibold">보완 요청 내용 <span className="text-legal">*</span></label>
                {/* AI 안전 검토 제목과 같은 모양: 파란 네모 아이콘 + 굵은 글씨 */}
                <button
                  type="button"
                  onClick={() => setRequestText(aiDraft)}
                  className="ml-auto flex items-center gap-2 rounded-md px-1.5 py-1 text-[16px] font-semibold hover:bg-muted"
                >
                  <AgentMascot className="h-7 shrink-0" />
                  AI 초안 작성
                </button>
              </div>
              <Textarea
                id="manager-request-text"
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                placeholder="작업부서가 보완해야 할 내용을 입력하세요."
                className="mt-1.5 min-h-28 resize-none bg-background text-[16px]"
                maxLength={300}
                autoFocus
              />
              <div className="mt-1 flex items-center justify-between text-[15px] text-muted-foreground">
                <span>이 내용 그대로 작업부서에 전달됩니다.</span>
                <span>{requestText.trim().length}/300</span>
              </div>
            </div>
          )}

          <AlertDialogFooter className="-mx-5 -mb-5 p-4">
            <AlertDialogCancel onClick={() => setPendingAction(null)}>돌아가기</AlertDialogCancel>
            <AlertDialogAction
              className={isCancelingApproval ? "bg-legal text-white hover:bg-legal/90" : pendingAction === "request" ? "bg-warn text-white hover:bg-warn/90" : undefined}
              onClick={confirmDecision}
              disabled={pendingAction === "request" && !requestText.trim()}
            >
              {isCancelingApproval ? "승인 취소 확정" : pendingAction === "approve" ? "승인 확정" : "보완 요청 확정"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ReviewWorkspace({ clock, runId, onReplay }: { clock: number; runId: number; onReplay: () => void }) {
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  }, [clock])
  const [filter, setFilter] = useState<Filter>("전체")
  const [aiFilter, setAiFilter] = useState<"전체" | AiCategory>("전체")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState(REVIEW_PERMITS[0].id)
  // 허가서 원문 칸 펼침 (기본: 펼침, 다른 탭에 다녀와도 유지)
  const [docOpen, setDocOpen] = useKept("review.docOpen", () => true)
  const [decisions, setDecisions] = useKept<Record<string, Decision>>(`review.${runId}.decisions`, initialDecisions)
  const [grades, setGrades] = useKept<Record<string, PermitGrade>>(
    `review.${runId}.grades`,
    () => Object.fromEntries(REVIEW_PERMITS.map((permit) => [permit.id, permit.recommendedGrade])),
  )
  const [resubmits, setResubmits] = useKept<Resubmits>(`review.${runId}.resubmits`, () => ({}))

  // 시연 흐름: 보완 대기인 허가서 중 2차 접수본이 준비된 건은 10초 뒤 작업부서가 다시 낸다.
  // 다시 들어오면 보완 요청 결정은 처리 기록으로 넘기고, 상태는 '검토 필요'(2차 접수)로 돌아온다.
  useEffect(() => {
    const waiting = Object.entries(decisions).filter(([id, d]) => d.status === "보완 대기" && REVISIONS[id] && !resubmits[id])
    if (!waiting.length) return
    const timers = waiting.map(([id, d]) =>
      setTimeout(() => {
        const at = hm(clockRef.current)
        setResubmits((prev) => ({ ...prev, [id]: { requestedAt: d.at, at, note: d.note } }))
        setDecisions((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        const permit = REVIEW_PERMITS.find((x) => x.id === id)
        addRecord({ day: "11/7", time: at, kind: "기타", who: permit?.department ?? "작업부서", target: id, text: "보완 후 재접수 (2차)" })
        toast(`${id} 보완본이 다시 접수됐습니다`, { description: "보완 요청 반영 여부를 확인하세요" })
      }, RESUBMIT_DELAY_MS),
    )
    return () => timers.forEach(clearTimeout)
  }, [decisions, resubmits, setDecisions, setResubmits])

  const permits = useMemo(
    // 처리 상태(남은 일 먼저) → 같은 상태 안에서는 다시 들어온 2차 접수 먼저 → AI가 정한 순서(우선 확인 → 확인 권장 → 쟁점 없음)
    () =>
      REVIEW_PERMITS.filter(
        (permit) =>
          (filter === "전체" || statusOf(permit, decisions) === filter) &&
          (aiFilter === "전체" || classifyPermit(viewOf(permit, resubmits)) === aiFilter) &&
          `${permit.id} ${permit.task} ${permit.place} ${permit.form} ${permit.department}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ).sort(
        (a, b) =>
          STATUSES.indexOf(statusOf(a, decisions)) - STATUSES.indexOf(statusOf(b, decisions)) ||
          Number(Boolean(REVISIONS[b.id] && resubmits[b.id])) - Number(Boolean(REVISIONS[a.id] && resubmits[a.id])) ||
          AI_CATEGORIES.indexOf(classifyPermit(viewOf(a, resubmits))) - AI_CATEGORIES.indexOf(classifyPermit(viewOf(b, resubmits))),
      ),
    [filter, aiFilter, decisions, query, resubmits],
  )
  const selected = permits.find((permit) => permit.id === selectedId) ?? permits[0] ?? REVIEW_PERMITS[0]
  const selectedGrade = grades[selected.id] ?? selected.recommendedGrade
  const resubmit = REVISIONS[selected.id] ? resubmits[selected.id] : undefined
  const view = viewOf(selected, resubmits) // 2차 접수본이면 고친 값 기준
  const counts = Object.fromEntries(STATUSES.map((status) => [status, REVIEW_PERMITS.filter((p) => statusOf(p, decisions) === status).length])) as Record<ReviewStatus, number>
  const aiCounts = Object.fromEntries(AI_CATEGORIES.map((category) => [category, REVIEW_PERMITS.filter((p) => classifyPermit(viewOf(p, resubmits)) === category).length])) as Record<AiCategory, number>

  const decide = (status: "승인 완료" | "보완 대기", note: string) => {
    const at = hm(clock)
    const previous = decisions[selected.id]
    const next: Decision = {
      status,
      grade: selectedGrade,
      at,
      note,
      revised: Boolean(previous),
      previous: previous ? `${previous.status} · ${previous.grade}` : undefined,
    }
    setDecisions({ ...decisions, [selected.id]: next })
    addRecord({
      day: "11/7",
      time: at,
      kind: "기타",
      who: ME,
      target: selected.id,
      text: `${previous ? `결정 수정 · ${previous.status}/${previous.grade} → ` : ""}${status === "보완 대기" ? "보완 요청" : status} · ${selectedGrade} · ${note}`,
    })
    const historyDescription = previous ? `${previous.status} → ${status} · 수정 이력 저장` : `${selectedGrade} · 결정 이력 저장`
    if (status === "승인 완료") toast.success(`${selected.id} 검토를 승인했습니다`, { description: historyDescription })
    else toast.warning(`${selected.id} 보완을 요청했습니다`, { description: previous ? historyDescription : note })
  }

  const cancelApproval = () => {
    const previous = decisions[selected.id]
    if (!previous || previous.status !== "승인 완료") return
    const next = { ...decisions }
    delete next[selected.id]
    setDecisions(next)
    const at = hm(clock)
    addRecord({
      day: "11/7",
      time: at,
      kind: "기타",
      who: ME,
      target: selected.id,
      text: `승인 취소 · ${previous.grade} · 재검토 필요`,
    })
    toast.error(`${selected.id} 승인을 취소했습니다`, { description: `${previous.grade} 승인 해제 · 취소 이력 저장` })
  }

  return (
    <main className="permit-review flex min-h-0 flex-1 flex-col bg-background">
      {/* 검토함 | 검토 내용(AI 검토 → 안전관리자 결정) | 허가서 원문. 원문은 세로로 긴 한 장이라 칸이 넓으면 양옆이 비므로, 원문 칸 폭을 한 장에 맞춘다 */}
      {/* 세 칸 사이는 좁은 틈(바탕색보다 조금 진한 회색)으로 나눈다 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border xl:grid-cols-[clamp(320px,calc(var(--app-w,100vw)*0.24),440px)_minmax(0,1fr)_auto] xl:overflow-hidden">
        <section className="flex min-h-[360px] flex-col bg-card">
          {/* 검토함 제목은 목록 위에 (화면 전체가 아니라 이 목록의 이름) */}
          <h1 className="flex h-14 items-center gap-2.5 border-b px-4 text-[18px] font-semibold tracking-[-0.01em]">
            <Inbox className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            작업허가 검토함
            <button type="button" title="접수부터 다시 보기" onClick={onReplay} className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-sans text-[14px] font-medium tracking-normal text-muted-foreground hover:bg-muted hover:text-foreground">
              <RotateCcw className="size-3.5" />
              다시 보기
            </button>
          </h1>
          {/* 처리 상태 필터 · AI 분류 · 검색 (다른 탭과 같은 회색 알약 필터 · 검색 칸) */}
          <div className="space-y-2.5 border-b px-3 py-3">
            <Segmented fill items={FILTERS.map((item) => ({ key: item, label: item, count: item === "전체" ? REVIEW_PERMITS.length : counts[item] }))} value={filter} onChange={setFilter} />
            <div className="flex gap-2">
              <select
                aria-label="AI 분류"
                value={aiFilter}
                onChange={(event) => setAiFilter(event.target.value as typeof aiFilter)}
                className={cn(
                  "h-9 w-[132px] shrink-0 rounded-lg bg-card px-2 text-[14.5px] shadow-xs ring-1 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  aiFilter !== "전체" ? "font-medium text-primary ring-primary" : "text-foreground ring-border",
                )}
              >
                <option value="전체">AI 분류 전체</option>
                {AI_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c} {aiCounts[c]}
                  </option>
                ))}
              </select>
              <SearchBox value={query} onChange={setQuery} placeholder="작업·구역·유형·허가번호" className="min-w-0 flex-1" />
            </div>
          </div>
          <PermitList key={`${filter}-${aiFilter}-${query}`} permits={permits} selected={selected.id} decisions={decisions} resubmits={resubmits} onSelect={setSelectedId} />
        </section>

        {/* 다른 작업을 고르면 가운데·원문 모두 맨 위부터 보이게 key로 새로 그린다 */}
        {permits.length > 0 ? (
          <section key={`review-${selected.id}`} className="min-h-0 overflow-y-auto bg-card px-8 pt-6 pb-5">
            <div className="mb-8">
              {/* 번호·상태·AI 분류·접수 시각: 모두 같은 높이(28px) 칸에 넣고 세로 가운데로 맞춘다.
                  (바닥선 맞춤은 배지 상자 아래 여백 때문에 AI 분류 글자가 떠 보인다) */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[14px] leading-6 text-muted-foreground">{selected.id}</span>
                <StatusBadge status={statusOf(selected, decisions)} />
                {resubmit && statusOf(selected, decisions) === "검토 필요" && <ResubmitChip />}
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                <AiLabel permit={view} />
                {/* 2차 접수면 시각은 목록·반영 확인에 있으므로 머리글에서는 뺀다 */}
                {!resubmit && (
                  <span className="ml-auto inline-flex h-6 items-center gap-1.5 text-[14px] text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    {selected.receivedAt} 접수
                  </span>
                )}
              </div>
              <h2 className="mt-1.5 text-[24px] leading-8 font-semibold tracking-[-0.01em]">{selected.task}</h2>
            </div>

            <RequestSummary permit={view} coordination={selected.coordination} />
            {/* AI가 한 일은 파란 구역 하나에: 추천 등급 → (2차 접수면) 반영 확인 → 안전 검토 결과 */}
            <AiZone>
              <AiRecommendation permit={view} />
              {resubmit && <RevisionCheck permit={selected} resubmit={resubmit} />}
              <AiReview permit={view} />
            </AiZone>
            <div className="mt-8 flex items-start gap-2 border-t pt-3 text-[13.5px] leading-relaxed text-muted-foreground">
              <span className="flex h-[1lh] shrink-0 items-center">
                <Send className="size-3.5" />
              </span>
              승인 후 선택한 등급에 따라 전산허가, 안전요원 대면·접수, 안전요원 현장 확인 절차로 이어집니다.
            </div>
            {/* 관리자 결정은 가운데 칸 맨 아래에 붙어서, AI 분석을 내려 보는 동안에도 늘 보인다 */}
            <DecisionPanel
              key={`${selected.id}-${resubmit?.at ?? 1}`}
              permit={view}
              selectedGrade={selectedGrade}
              decision={decisions[selected.id]}
              onGrade={(grade) => setGrades({ ...grades, [selected.id]: grade })}
              onDecision={decide}
              onCancelApproval={cancelApproval}
            />
          </section>
        ) : (
          <section className="grid min-h-[300px] place-items-center bg-card p-8 text-[15px] text-muted-foreground">조건에 맞는 허가서가 없습니다. 처리 상태나 AI 분류를 바꿔 보세요.</section>
        )}

        {/* 원문 칸 폭 = 화면 높이로 정한 고정 폭 (허가서마다 세 칸 나눔이 바뀌지 않게).
            가장 긴 양식(폭 860px일 때 높이 약 1,280px)도 칸 높이(화면 높이 - 상단 막대·원문 제목 약 110px)에 다 들어가는 폭이라
            끌지 않고 한 장이 다 보인다. 짧은 양식은 마지막 칸을 늘려 빈 곳 없이 채운다 */}
        {/* 원문 칸 왼쪽 막대를 누르면 원문이 오른쪽으로 밀려 접히고(가운데 칸이 넓어짐), 다시 누르면 펼쳐진다.
            접혀도 원문은 펼친 폭 그대로 두고 칸만 줄여서, 밀려 나가듯 보이고 다시 잴 필요가 없다 */}
        {permits.length > 0 && (
          <section
            className={cn(
              "relative flex min-h-[480px] overflow-hidden bg-slate-100 transition-[width] duration-300 ease-out xl:min-h-0",
              docOpen ? "xl:w-[calc((var(--app-h,100dvh)-110px)*0.65+20px)]" : "xl:w-5",
            )}
          >
            <button
              type="button"
              onClick={() => setDocOpen(!docOpen)}
              aria-label={docOpen ? "허가서 원문 접기" : "허가서 원문 펼치기"}
              title={docOpen ? "허가서 원문 접기" : "허가서 원문 펼치기"}
              className="group flex w-5 shrink-0 cursor-pointer items-center justify-center border-r bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="flex flex-col items-center gap-1.5">
                <span className="h-6 w-1 rounded-full bg-border group-hover:bg-muted-foreground/50" />
                {docOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                <span className="h-6 w-1 rounded-full bg-border group-hover:bg-muted-foreground/50" />
              </span>
            </button>
            <div className="relative flex min-h-0 w-full shrink-0 flex-col xl:w-[calc((var(--app-h,100dvh)-110px)*0.65)]" aria-hidden={!docOpen}>
            <PermitDocumentViewer
              key={`${selected.id}-${resubmit?.at ?? 1}`}
              permit={selected}
              resubmittedAt={resubmit?.at}
              grade={decisions[selected.id]?.status === "승인 완료" ? decisions[selected.id].grade : undefined}
              request={decisions[selected.id]?.status === "보완 대기" ? decisions[selected.id].note : undefined}
              firstRequest={resubmit?.note}
              decidedAt={decisions[selected.id]?.at}
              firstRequestAt={resubmit?.requestedAt}
              fitMode="fill"
            />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

// 접수 목록 확인 → 관리자 접수 확정 → AI 사전 검토 → 검토함. 시계 대기 없이 시작한다.

type Phase = "intake" | "analyzing" | "done"

export function PermitReviewPage(_props: PageProps) {
  const [phase, setPhase] = useKept<Phase>("review.phase", () => "intake")
  const [runId, setRunId] = useKept<number>("review.run", () => 0)
  const clock = DEADLINE_SEC
  const received = INTAKE

  const start = () => {
    setPhase("analyzing")
    addRecord({ day: "11/7", time: hm(clock), kind: "AI 체크", who: ME, target: "작업허가 사전 검토", text: `접수 확정 · AI 사전 검토 실행 (${INTAKE.length}건)` })
  }

  const finish = useCallback(() => {
    const needs = INTAKE.filter((p) => RESULTS[p.id].verdict === "직접 판단").length
    setPhase("done")
    addRecord({
      day: "11/7",
      time: hms(clock).slice(0, 5),
      kind: "AI 체크",
      who: "AI 사전 검토",
      target: "작업허가 사전 검토",
      text: `${INTAKE.length}건 검토 · 검토 완료 ${INTAKE.length - needs} · 직접 판단 ${needs}`,
    })
  }, [clock, setPhase])

  if (phase === "done") return <ReviewWorkspace key={runId} clock={clock} runId={runId} onReplay={() => { setRunId(value => value + 1); setPhase("intake") }} />

  return (
    <main className="permit-review flex min-h-0 flex-1 flex-col bg-card">
      {phase === "intake" && (
        <IntakeView
          received={received}
          onStart={start}
        />
      )}
      {phase === "analyzing" && (
        // 진행 화면은 가로·세로 모두 화면 가운데 (m-auto)
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <AnalysisRun count={INTAKE.length} steps={STEPS} onDone={finish} />
        </div>
      )}
    </main>
  )
}
