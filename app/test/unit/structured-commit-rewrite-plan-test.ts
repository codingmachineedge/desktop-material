import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  createStructuredCommitRewritePlan,
  IStructuredCommitRewriteInspection,
  renderStructuredCommitRewriteTodo,
  sanitizeStructuredCommitSummary,
  StructuredCommitRewriteAction,
  StructuredCommitRewriteError,
  validateStructuredCommitRewritePlan,
} from '../../src/lib/git/structured-commit-rewrite'

const base = '0'.repeat(40)
const first = '1'.repeat(40)
const second = '2'.repeat(40)
const third = '3'.repeat(40)

const inspection: IStructuredCommitRewriteInspection = {
  branchName: 'feature/review',
  upstreamName: 'origin/main',
  baseSha: base,
  headSha: third,
  commits: [
    { sha: first, summary: 'First' },
    { sha: second, summary: 'Second' },
    { sha: third, summary: 'Third' },
  ],
}

function assertPlanError(fn: () => void, code: string) {
  assert.throws(fn, error => {
    assert(error instanceof StructuredCommitRewriteError)
    assert.equal(error.code, code)
    return true
  })
}

describe('structured commit rewrite plan', () => {
  it('starts with a complete oldest-first pick plan', () => {
    assert.deepStrictEqual(createStructuredCommitRewritePlan(inspection), [
      { sha: first, action: 'pick' },
      { sha: second, action: 'pick' },
      { sha: third, action: 'pick' },
    ])
  })

  it('requires a real reviewed change and a retained fold target', () => {
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(
          inspection,
          createStructuredCommitRewritePlan(inspection)
        ),
      'unchanged-plan'
    )
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(inspection, [
          { sha: first, action: 'fixup' },
          { sha: second, action: 'pick' },
          { sha: third, action: 'pick' },
        ]),
      'invalid-plan'
    )
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(inspection, [
          { sha: first, action: 'drop' },
          { sha: second, action: 'drop' },
          { sha: third, action: 'drop' },
        ]),
      'invalid-plan'
    )
  })

  it('rejects missing, duplicate, foreign, and command-like actions', () => {
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(inspection, [
          { sha: first, action: 'pick' },
          { sha: second, action: 'drop' },
        ]),
      'invalid-plan'
    )
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(inspection, [
          { sha: first, action: 'pick' },
          { sha: first, action: 'drop' },
          { sha: third, action: 'pick' },
        ]),
      'invalid-plan'
    )
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(inspection, [
          { sha: first, action: 'pick' },
          { sha: second, action: 'drop' },
          { sha: 'f'.repeat(40), action: 'pick' },
        ]),
      'invalid-plan'
    )
    assertPlanError(
      () =>
        validateStructuredCommitRewritePlan(inspection, [
          { sha: first, action: 'pick' },
          {
            sha: second,
            action: 'exec' as StructuredCommitRewriteAction,
          },
          { sha: third, action: 'pick' },
        ]),
      'invalid-plan'
    )
  })

  it('never writes commit metadata into the trusted rebase todo', () => {
    const hostileInspection: IStructuredCommitRewriteInspection = {
      ...inspection,
      commits: [
        {
          sha: first,
          summary: 'title\nexec powershell secret@example.invalid',
        },
        ...inspection.commits.slice(1),
      ],
    }
    const todo = renderStructuredCommitRewriteTodo(hostileInspection, [
      { sha: second, action: 'pick' },
      { sha: first, action: 'fixup' },
      { sha: third, action: 'drop' },
    ])

    assert.equal(todo, `pick ${second}\nfixup ${first}\ndrop ${third}\n`)
    assert.doesNotMatch(todo, /title|exec|powershell|example\.invalid/)
  })

  it('bounds and normalizes the display-only summary', () => {
    assert.equal(
      sanitizeStructuredCommitSummary('  title\twith\u0007controls\nbody  '),
      'title with controls'
    )
    const bounded = sanitizeStructuredCommitSummary('界'.repeat(2_000))
    assert(Buffer.byteLength(bounded, 'utf8') <= 2 * 1024 + 3)
    assert.match(bounded, /…$/)
  })
})
