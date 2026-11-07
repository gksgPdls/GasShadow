import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { INTAKE, RESULTS, STEPS } = await server.ssrLoadModule('/src/pages/review/ai/data.ts')
  const { REVIEW_PERMITS } = await server.ssrLoadModule('/src/pages/review/data.ts')
  const { SCENARIO_PERMITS } = await server.ssrLoadModule('/src/pages/review/scenario-permits.ts')
  const { AI_CATEGORIES, classifyPermit, statusOf } = await server.ssrLoadModule('/src/pages/review/classification.ts')
  const { PermitDocument } = await server.ssrLoadModule('/src/pages/review/PermitDocumentDialog.tsx')
  assert.ok(INTAKE.length >= 60 && INTAKE.length <= 70)
  const ids = new Set(INTAKE.map(p => p.id))
  assert.equal(ids.size, INTAKE.length, 'Unique permit IDs')
  assert.equal(REVIEW_PERMITS.length, INTAKE.length)
  assert.equal(new Set(SCENARIO_PERMITS.map(p => p.intake.block)).size, 16)
  assert.equal(new Set(INTAKE.map(p => p.form)).size, 8)
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m }
  for (const review of REVIEW_PERMITS) {
    const intake = INTAKE.find(p => p.id === review.id)
    const result = RESULTS[review.id]
    assert.ok(intake && result, review.id + ': intake and analysis exist')
    for (const field of ['task', 'form', 'place', 'workTime', 'workers']) assert.equal(intake[field], review[field], review.id + ': ' + field)
    assert.equal(statusOf(review, {}), '검토 필요', 'Every permit requires a manager decision')
    const category = classifyPermit(review)
    assert.ok(AI_CATEGORIES.includes(category))
    assert.equal(category === '쟁점 없음', result.verdict === '검토 완료')
    const approved = { [review.id]: { status: '승인 완료', grade: review.recommendedGrade, at: '15:00', note: '관리자 승인' } }
    assert.equal(statusOf(review, approved), '승인 완료')
    assert.equal(classifyPermit(review), category, 'Approval does not change AI classification')
    assert.equal(statusOf(review, {}), '검토 필요', 'Revoked approval returns to pending')
    assert.equal(result.grade, review.recommendedGrade)
    assert.equal(result.verdict === '직접 판단', review.findings.length > 0)
    const html = renderToString(React.createElement(PermitDocument, { permit: review }))
    assert.ok(html.includes(review.id) && !html.includes('첨부된 허가서 원문이 없습니다'), review.id + ': document exists')
    const [start, end] = intake.workTime.split('–').map(minutes)
    assert.ok(start < end)
  }
  for (const scenario of SCENARIO_PERMITS) for (const finding of scenario.result.findings) for (const id of finding.related ?? []) {
    const other = INTAKE.find(p => p.id === id)
    assert.ok(other, 'Related permit exists: ' + id)
    assert.equal(other.block, scenario.intake.block)
    const [a, b] = scenario.intake.workTime.split('–').map(minutes)
    const [c, d] = other.workTime.split('–').map(minutes)
    assert.ok(a < d && c < b, 'SIMOPS pair times overlap')
  }
  console.log(`${INTAKE.length} permits, 16 blocks, 8 work types: intake/result/document and SIMOPS checks passed.`)
  assert.equal(classifyPermit({ missing: [], findings: [{ level: '확인 권장' }] }), '확인 권장')
  assert.equal(classifyPermit({ missing: ['측정계획'], findings: [] }), '우선 확인')
  assert.equal(classifyPermit({ missing: [], findings: [{ level: '참고' }] }), '쟁점 없음')
  console.log(Object.fromEntries(AI_CATEGORIES.map(category => [category, REVIEW_PERMITS.filter(p => classifyPermit(p) === category).length])))
  console.log(STEPS.map(p => p.result).join(' / '))
} finally { await server.close() }
