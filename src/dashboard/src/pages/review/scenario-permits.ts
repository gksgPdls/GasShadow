import SITE from '@/data/site.json'
import type { PermitForm, Extra } from '@/data/permits'
import type { ReviewPermit } from './data'
import type { AiResult, IntakePermit, Finding } from './ai/types'

// 시연용 합성 작업계획. site.json의 실제 화면 구획에 공정별 작업을 배치한다.
// 등급·시간·협의조건·AI 의견은 모델 출력이나 실제 허가 기록이 아닌 시나리오다.
type Profile = { form: PermitForm; task: string; team: string; tools: string[]; hazards: string[]; measures: string[]; inside?: boolean; argon?: boolean }
const profiles: Record<string, Profile> = {
  weld: { form: '화기', task: '보강재 취부·용접', team: '대조립', tools: ['CO₂ 용접기', '그라인더'], hazards: ['용접 흄', '화재', '불티'], measures: ['불받이포 설치', '화기감시자 배치', '주변 가연물 제거'] },
  rt: { form: 'RT', task: '용접부 방사선 투과검사', team: '비파괴검사', tools: ['방사선 조사기', '개인 선량계'], hazards: ['방사선 노출'], measures: ['관리구역 통제', '구역 내 잔류인원 확인', '경광등·경고표지 설치'] },
  lift: { form: '중량물', task: '블록 반전·정반 안착', team: '운반', tools: ['크레인', '와이어 로프', '샤클'], hazards: ['낙하', '협착', '충돌'], measures: ['인양 반경 출입 통제', '신호수 배치', '중량·줄걸이 확인'] },
  scaffold: { form: '족장', task: '외판 작업발판 설치', team: '족장', tools: ['족장재', '달줄', '안전대'], hazards: ['추락', '낙하물'], measures: ['하부 통행 통제', '추락방지 설비 확인', '설치 후 사용 전 점검'] },
  argon: { form: '기타위험', task: 'SUS 배관 아르곤 백퍼지 용접', team: '배관', tools: ['TIG 용접기', '아르곤 호스', '송풍기'], hazards: ['산소결핍', '용접 흄'], measures: ['아르곤 호스 결속 확인', '하부 산소농도 측정', '출입감시자 배치'], inside: true, argon: true },
  pressure: { form: '압력Test', task: '냉각수 배관 수압시험', team: '배관시험', tools: ['수압 펌프', '압력계', '시험용 블라인드'], hazards: ['잔압', '배관 파열', '비산'], measures: ['배관 내 작업자 철수 확인', '격리·시건 확인', '시험구역 출입 통제'] },
  electric: { form: '전기', task: '임시 분전반·케이블 절연 점검', team: '전장', tools: ['절연저항계', '검전기'], hazards: ['감전', '걸림'], measures: ['전원 차단·시건', '무전압 확인', '통행로 케이블 보호'] },
  support: { form: '화기', task: '배관 서포트 취부 용접', team: '선행의장', tools: ['CO₂ 용접기', '불받이포'], hazards: ['화재', '용접 흄', '산소결핍'], measures: ['환기 유지', '작업 전 가스측정', '인접 구획 가연물 확인'], inside: true },
  paint: { form: '도장/세척', task: '내부 에폭시 도장·터치업', team: '도장', tools: ['붓·롤러', '방폭 송풍기'], hazards: ['유기용제 증기', '화재', '산소결핍'], measures: ['방폭 환기 유지', '화기작업 시간 분리', '출입감시자 배치'], inside: true },
  clean: { form: '도장/세척', task: '도장 전 탈지·용제 세척', team: '도장', tools: ['세척용 용제', '방폭 조명', '송풍기'], hazards: ['유기용제 증기', '화재'], measures: ['MSDS·보호구 확인', '인접 화기 통제', '환기·가스측정'], inside: true },
  inspect: { form: '기타위험', task: '내부 도막·배관 육안검사', team: '품질', tools: ['도막 두께계', '방폭 조명', '휴대용 가스측정기'], hazards: ['산소결핍', '협소 통로'], measures: ['출입 전 가스측정', '출입인원 관리', '환기 유지'], inside: true },
  light: { form: '전기', task: '외부 통로 임시 조명 설치', team: '전장', tools: ['임시 조명등', '케이블 보호대'], hazards: ['감전', '넘어짐'], measures: ['전원 차단', '조명 고정 확인', '통행로 확보'] },
  seam: { form: '화기', task: '탑재 이음부 용접·그라인딩', team: '탑재', tools: ['용접기', '그라인더', '불받이포'], hazards: ['화재', '용접 흄', '추락'], measures: ['불티 하부 낙하 통제', '작업발판 점검', '화기감시자 배치'] },
}
profiles.join = { ...profiles.seam, task: 'PE 블록 접합부 용접·그라인딩', team: 'PE' }
const byStage: Record<string, string[]> = {
  assembly: ['weld', 'rt', 'lift', 'scaffold'],
  outfit: ['argon', 'pressure', 'electric', 'support'],
  paint: ['paint', 'inspect', 'scaffold', 'clean'],
  pe: ['lift', 'join', 'rt'],
  erect: ['seam', 'electric', 'scaffold'],
}
const times = ['08:00–10:00', '10:30–12:00', '13:00–15:00', '15:30–17:00']
const pad = (n: number) => String(n).padStart(2, '0')

export interface ScenarioPermit { intake: IntakePermit; review: ReviewPermit; result: AiResult; measures: string[] }

export const SCENARIO_PERMITS: ScenarioPermit[] = SITE.blocks.flatMap((block, blockIndex) => {
  // 앞 12개 블록 4건 + 나머지 4개 블록 3건 = 60건.
  const tasks = byStage[block.stage].slice(0, blockIndex < 12 ? 4 : 3)
  // RT-화기, 인양-화기, 도장-출입이 실제로 겹치는 시연 쌍만 만든다.
  const paired = blockIndex % 4 === 0 || block.stage === 'pe'
  const ids = tasks.map((_, i) => `PTW-2541-${String(600 + blockIndex * 4 + i + 1).padStart(4, '0')}`)
  const compartments = block.comps.filter((comp) => comp.zone)
  return tasks.map((key, taskIndex): ScenarioPermit => {
    const p = profiles[key]
    const id = ids[taskIndex]
    const comp = compartments[taskIndex % Math.max(1, compartments.length)] ?? block.comps[0]
    const location = p.inside ? comp.name : key === 'rt' ? '외판 용접부 검사구역' : key === 'lift' ? '정반·인양 반경' : key === 'pressure' ? '냉각수 배관 시험구역' : key === 'electric' ? '임시 분전반·케이블 통로' : key === 'seam' ? '탑재 블록 이음부' : key === 'join' ? 'PE 블록 접합부' : key === 'weld' ? '외판 보강재 용접구역' : '외판·외부 작업발판'
    const place = `${block.name} · ${location}`
    const conflict = paired && taskIndex < 2
    const relatedId = ids[taskIndex === 0 ? 1 : 0]
    const partner = profiles[tasks[taskIndex === 0 ? 1 : 0]]
    const workTime = conflict && taskIndex === 1 ? '09:00–11:00' : times[taskIndex]
    const missingGas = p.inside === true && blockIndex % 5 === 2 && taskIndex === 0
    const hazards = p.hazards
    const extras: Extra[] = p.inside ? ['밀폐구역출입', '환기', ...(missingGas ? [] : ['가스측정'] as Extra[]), ...(p.argon ? ['아르곤가스'] as Extra[] : [])] : []
    const receivedMinutes = 9 * 60 + blockIndex * 18 + taskIndex * 7
    const receivedAt = `${pad(Math.floor(receivedMinutes / 60))}:${pad(receivedMinutes % 60)}`
    const department = `${p.team} ${blockIndex % 5 + 1}반`
    const pairReason = [p.form, partner.form].includes('RT') ? 'RT 방사선 관리구역에 다른 작업자의 접근 가능' : [p.form, partner.form].includes('중량물') ? '크레인 인양 반경 안에서 화기작업 진행' : [p.form, partner.form].includes('도장/세척') ? '용제 증기 발생 중 같은 블록의 내부 검사·출입 진행' : '아르곤 작업과 배관시험의 격리구역·공용 출입동선 중첩'
    const missing = missingGas ? ['작업 전 가스측정 담당자·측정계획'] : []
    const findings: ReviewPermit['findings'] = []
    if (conflict) findings.push({
      id: `${id}-SIMOPS`, level: '필수 확인', title: `${partner.task}과 작업시간 겹침`,
      description: `${block.name}에서 ${p.task}과 ${partner.task}의 통제구역 또는 출입동선이 09:00–10:00에 겹칩니다. ${pairReason}. 시간 분리와 작업부서 간 인계가 필요합니다.`,
      evidence: [{ source: '허가서 원문', text: `${id} ${workTime} / ${relatedId} ${taskIndex === 0 ? '09:00–11:00' : times[0]}` }, { source: '협의 기록', text: '합성 작업계획: 작업구역 공동 사용 · 시간 분리 협의 미완료' }],
    })
    if (missingGas) findings.push({ id: `${id}-GAS`, level: '필수 확인', title: '밀폐구역 출입인데 가스측정 계획 미기재', description: `${comp.name} 출입 전 측정계획과 담당자를 보완해야 합니다.`, evidence: [{ source: '허가서 원문', text: '밀폐구역출입·환기 체크 / 가스측정 미체크' }] })
    const grade = conflict ? '안전현장허가' : p.inside || ['RT', '중량물', '압력Test'].includes(p.form) ? '안전대면허가' : '전산허가'
    const reason = conflict ? '병행작업 통제구역·출입동선 중첩 확인 필요' : p.inside ? `${comp.name} 밀폐구역 출입·${p.argon ? '아르곤 하부 잔류' : p.form === '도장/세척' ? '유기용제·환기' : '가스측정'} 확인` : `${p.form} 작업의 ${hazards.join('·')} 관리계획 확인`
    const intake: IntakePermit = { id, form: p.form, task: `${block.name} ${p.task}`, department, place, block: block.id, workDate: '11/9(월)', workTime, workers: key === 'lift' ? 6 : key === 'scaffold' ? 4 : 2 + taskIndex % 2, extras, hazards, tools: p.tools, channel: blockIndex % 7 === 0 && taskIndex === 2 ? '수기' : '전산', jsp: `JSP-${key.toUpperCase()}-${pad(blockIndex + 1)}`, receivedAt: `${receivedAt}:00` }
    const aiFindings: Finding[] = findings.map((f) => ({ step: f.id.endsWith('SIMOPS') ? 2 : 1, kind: f.id.endsWith('SIMOPS') ? '작업 간 충돌' : '기재 누락', title: f.title, body: f.description, related: f.id.endsWith('SIMOPS') ? [relatedId] : undefined, evidence: f.evidence.map((e) => ({ source: e.source === '허가서 원문' ? '허가서 원문' : '허가 이력', text: e.text })) }))
    return { intake, measures: p.measures,
      review: { id, form: p.form, task: intake.task, department, place, workDate: intake.workDate, workTime, workers: intake.workers, receivedAt, initialStatus: '검토 필요', coordination: { confirmed: !conflict, completedAt: receivedAt, participants: [department, '생산조정'], summary: conflict ? '병행작업 시간 분리 미협의 · 관리자 판단 필요' : `${place} 작업구역·동선과 작업 전 조치를 작업부서가 확인`, transitions: conflict ? [] : p.measures }, relatedWork: conflict ? [`${relatedId} · ${partner.task} · ${taskIndex === 0 ? '09:00–11:00' : times[0]}`] : [], missing, recommendedGrade: grade, recommendationReason: reason, findings },
      result: { verdict: findings.length ? '직접 판단' : '검토 완료', grade, gradeReason: reason, headline: findings[0]?.title ?? '추가 확인사항 없음', summary: findings.length ? findings.map((f) => f.description).join(' ') : `${place}의 작업유형·작업시간·안전조치를 대조했습니다. 이 합성 시나리오에서 추가 쟁점이 발견되지 않았습니다.`, missing, findings: aiFindings },
    }
  })
})
