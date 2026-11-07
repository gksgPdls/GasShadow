import { Fragment, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PermitForm } from "@/data/permits"
import { cn } from "@/lib/utils"
import { FORM_ORDER } from "@/pages/review/ai/forms"
import { matches, toSec } from "@/pages/review/ai/labels"
import { PermitFormDialog } from "@/pages/review/ai/PermitFormDialog"
import type { IntakePermit } from "@/pages/review/ai/types"
import { FormChip, SearchBox, Segmented } from "@/pages/review/ai/ui"

// 접수된 하루치 허가서를 확인하고, 관리자가 확정하면 바로 AI 사전 검토를 시작한다.


type SortKey = "receivedAt" | "form" | "task" | "workTime"
type Sort = { key: SortKey; dir: 1 | -1 }

const SORT_VALUE: Record<SortKey, (p: IntakePermit) => string | number> = {
  receivedAt: (p) => toSec(p.receivedAt),
  form: (p) => FORM_ORDER.indexOf(p.form),
  task: (p) => p.task,
  workTime: (p) => p.workTime,
}

const compare = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ko")

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
  return (
    <th className={className}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.key === k && "text-foreground")}>
        {label}
        <Icon className={cn("size-3", sort.key !== k && "opacity-40")} />
      </button>
    </th>
  )
}

export function IntakeView({ received, onStart }: { received: IntakePermit[]; onStart: () => void }) {
  const [type, setType] = useState<PermitForm | "전체">("전체")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>({ key: "receivedAt", dir: -1 })
  const [docId, setDocId] = useState<string | null>(null)

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "receivedAt" ? -1 : 1 }))

  const typeItems = useMemo(
    () => [
      { key: "전체" as const, label: "전체", count: received.length },
      ...FORM_ORDER.map((f) => ({ key: f, label: f, count: received.filter((p) => p.form === f).length })).filter((t) => t.count > 0),
    ],
    [received],
  )

  const rows = received
    .filter((p) => (type === "전체" || p.form === type) && matches(p, query))
    .sort((a, b) => sort.dir * compare(SORT_VALUE[sort.key](a), SORT_VALUE[sort.key](b)) || toSec(b.receivedAt) - toSec(a.receivedAt))
  const doc = received.find((p) => p.id === docId)
  const docIndex = rows.findIndex((p) => p.id === docId)


  return (
    <>
      {/* 다른 탭과 같은 흰 바탕 · 같은 여백(px-8 pt-6). 접수된 허가서 표 하나, 머리 줄 오른쪽 끝에 다음 할 일(접수 확정·AI 검토 시작) */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-card px-8 pt-6 pb-10">
        <section className="border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
            <h2 className="mr-2 text-[18px] font-semibold">접수된 허가서</h2>
            <Segmented items={typeItems} value={type} onChange={setType} />
            {/* 검색 · 시작 단추는 한 묶음: 좁은 화면에서 줄이 넘어가도 함께 오른쪽에 */}
            <div className="ml-auto flex items-center gap-3">
              <SearchBox value={query} onChange={setQuery} placeholder="작업명 · 장소 · 부서 · 허가번호" className="w-[clamp(200px,calc(var(--app-w,100vw)*0.18),300px)]" inputClassName="h-10 text-[15px]" />
              <Button className="h-11 shrink-0 gap-2 rounded-xl px-6 text-[16px] font-semibold" onClick={onStart}>
                접수 확정·AI 검토 시작 <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>

          <table className="w-full text-left text-[16px]">
            <thead className="sticky top-0 z-10 bg-muted text-[14px] text-foreground">
              {/* 세로 구분선 없이 행 구분선만 (진하게) */}
              <tr className="border-b border-foreground/30 [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-semibold">
                <SortHead label="접수" k="receivedAt" sort={sort} onSort={onSort} className="w-[110px] pl-5!" />
                <SortHead label="작업명" k="task" sort={sort} onSort={onSort} />
                <SortHead label="유형" k="form" sort={sort} onSort={onSort} className="w-[132px]" />
                <th className="w-[244px]">작업부서</th>
                <SortHead label="작업시간" k="workTime" sort={sort} onSort={onSort} className="w-[164px] pr-5! text-right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const groupStart = sort.key === "form" && (i === 0 || rows[i - 1].form !== p.form)
                return (
                  <Fragment key={p.id}>
                    {groupStart && (
                      <tr className="border-b border-foreground/25 bg-muted/50">
                        <td colSpan={5} className="px-5 pt-4 pb-2 text-[16px] font-semibold text-foreground">
                          {p.form} <span className="ml-1 font-normal text-muted-foreground">{rows.filter((r) => r.form === p.form).length}</span>
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-foreground/25 last:border-b-0 hover:bg-accent/60 [&>td]:px-3 [&>td]:py-5">
                      <td className="pl-5! font-mono text-[14px] text-muted-foreground">{p.receivedAt.slice(0, 5)}</td>
                      <td>
                        <button type="button" onClick={() => setDocId(p.id)} title="허가서 원문 보기" className="text-left font-semibold text-foreground hover:underline">
                          {p.task}
                        </button>
                        <div className="mt-1 text-[14px] text-muted-foreground">
                          <span className="font-mono">{p.id}</span> · {p.place}
                        </div>
                      </td>
                      <td>
                        <FormChip form={p.form} className="text-[13px]" />
                      </td>
                      <td className="text-[15px] text-foreground">{p.department}</td>
                      <td className="pr-5! text-right font-mono text-[14px] text-muted-foreground">{p.workTime}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="grid h-40 place-items-center text-[14px] text-muted-foreground">조건에 맞는 허가서가 없습니다.</div>}
        </section>
      </div>

      {doc && <PermitFormDialog permit={doc} open onOpenChange={(open) => !open && setDocId(null)} position={docIndex + 1} total={rows.length} onPrevious={() => setDocId(rows[docIndex - 1]?.id ?? docId)} onNext={() => setDocId(rows[docIndex + 1]?.id ?? docId)} />}
    </>
  )
}
