import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ActionsArtifactMaximumPages,
  ActionsArtifactPageSize,
  appendActionsArtifactPage,
  getActionsArtifactDefaultFileName,
  parseActionsArtifactAttestationPresence,
  parseActionsArtifactList,
} from '../../src/lib/actions-artifacts'

const digest = `sha256:${'A'.repeat(64)}`

const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 19,
  name: 'Windows package',
  size_in_bytes: 2048,
  expired: false,
  created_at: '2026-07-13T10:00:00Z',
  expires_at: '2026-10-11T10:00:00Z',
  updated_at: '2026-07-13T10:01:00Z',
  digest,
  workflow_run: {
    id: 7,
    head_branch: 'main',
    head_sha: 'a'.repeat(40),
  },
  ...overrides,
})

describe('GitHub Actions artifact contracts', () => {
  it('normalizes a bounded artifact page and its provenance context', () => {
    const parsed = parseActionsArtifactList(
      { total_count: 2, artifacts: [artifact()] },
      7
    )

    assert.equal(parsed.totalCount, 2)
    assert.equal(parsed.truncated, true)
    assert.equal(parsed.page, 1)
    assert.equal(parsed.nextPage, 2)
    assert.equal(parsed.capped, false)
    assert.equal(parsed.artifacts[0].digest, digest.toLowerCase())
    assert.deepEqual(parsed.artifacts[0].workflowRun, {
      id: 7,
      headBranch: 'main',
      headSha: 'a'.repeat(40),
    })
    assert.equal(
      parsed.artifacts[0].expiresAt?.toISOString(),
      '2026-10-11T10:00:00.000Z'
    )
  })

  it('appends contiguous pages and rejects duplicates or provider churn', () => {
    const first = parseActionsArtifactList(
      {
        total_count: 101,
        artifacts: Array.from({ length: 100 }, (_, id) =>
          artifact({ id: id + 1 })
        ),
      },
      7
    )
    const second = parseActionsArtifactList(
      { total_count: 101, artifacts: [artifact({ id: 101 })] },
      7,
      2
    )
    const merged = appendActionsArtifactPage(first, second)

    assert.equal(merged.artifacts.length, 101)
    assert.equal(merged.page, 2)
    assert.equal(merged.nextPage, null)
    assert.equal(merged.truncated, false)

    assert.throws(() =>
      appendActionsArtifactPage(
        first,
        parseActionsArtifactList(
          { total_count: 101, artifacts: [artifact({ id: 1 })] },
          7,
          2
        )
      )
    )
    assert.throws(() =>
      appendActionsArtifactPage(
        first,
        parseActionsArtifactList(
          { total_count: 102, artifacts: [artifact({ id: 101 })] },
          7,
          2
        )
      )
    )
  })

  it('caps pagination after ten bounded pages', () => {
    const page = parseActionsArtifactList(
      {
        total_count: ActionsArtifactMaximumPages * ActionsArtifactPageSize + 1,
        artifacts: Array.from({ length: 100 }, (_, id) =>
          artifact({ id: id + 901 })
        ),
      },
      7,
      ActionsArtifactMaximumPages
    )

    assert.equal(page.nextPage, null)
    assert.equal(page.truncated, true)
    assert.equal(page.capped, true)
    assert.throws(() =>
      parseActionsArtifactList(
        { total_count: 0, artifacts: [] },
        7,
        ActionsArtifactMaximumPages + 1
      )
    )
  })

  it('accepts old artifacts without a digest or embedded run', () => {
    const parsed = parseActionsArtifactList(
      {
        total_count: 1,
        artifacts: [artifact({ digest: null, workflow_run: null })],
      },
      7
    )
    assert.equal(parsed.artifacts[0].digest, null)
    assert.equal(parsed.artifacts[0].workflowRun, null)
  })

  it('rejects malformed, duplicate, cross-run, and unbounded results', () => {
    assert.throws(() =>
      parseActionsArtifactList(
        { total_count: 1, artifacts: [artifact({ digest: 'md5:bad' })] },
        7
      )
    )
    assert.throws(() =>
      parseActionsArtifactList(
        { total_count: 2, artifacts: [artifact(), artifact()] },
        7
      )
    )
    assert.throws(() =>
      parseActionsArtifactList(
        {
          total_count: 1,
          artifacts: [
            artifact({
              workflow_run: {
                id: 8,
                head_branch: 'main',
                head_sha: 'a'.repeat(40),
              },
            }),
          ],
        },
        7
      )
    )
    assert.throws(() =>
      parseActionsArtifactList(
        {
          total_count: ActionsArtifactPageSize + 1,
          artifacts: Array.from(
            { length: ActionsArtifactPageSize + 1 },
            (_, id) => artifact({ id: id + 1 })
          ),
        },
        7
      )
    )
  })

  it('reports attestation presence without interpreting the bundle', () => {
    assert.equal(
      parseActionsArtifactAttestationPresence({ attestations: [] }),
      false
    )
    assert.equal(
      parseActionsArtifactAttestationPresence({
        attestations: [{ bundle: { opaque: true } }],
      }),
      true
    )
    assert.throws(() =>
      parseActionsArtifactAttestationPresence({ attestations: [{}, {}] })
    )
  })

  it('builds Windows-safe, bounded archive names', () => {
    assert.equal(
      getActionsArtifactDefaultFileName('release: windows / x64.zip'),
      'release_ windows _ x64.zip'
    )
    assert.equal(getActionsArtifactDefaultFileName('CON'), '_CON.zip')
    assert.equal(getActionsArtifactDefaultFileName('...'), 'artifact.zip')
    assert.ok(getActionsArtifactDefaultFileName('x'.repeat(400)).length <= 184)
  })
})
