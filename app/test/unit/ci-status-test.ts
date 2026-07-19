import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getLabelForCheck } from '../../src/ui/branches/ci-status'
import { APICheckConclusion } from '../../src/lib/api'

const branchDropdownSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'toolbar', 'branch-dropdown.tsx'),
  'utf8'
)
const appSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'app.tsx'),
  'utf8'
)

describe('repository CI status', () => {
  it('uses concise accessible labels for the CI logo', () => {
    assert.equal(
      getLabelForCheck({ conclusion: APICheckConclusion.Success }),
      'successful'
    )
    assert.equal(
      getLabelForCheck({ conclusion: APICheckConclusion.Failure }),
      'failed'
    )
    assert.equal(getLabelForCheck({ conclusion: null }), 'in progress')
  })

  it('shows the current commit status without requiring a pull request', () => {
    assert.match(
      branchDropdownSource,
      /renderBranchStatus\(\)[\s\S]*?renderPullRequestInfo\(\)[\s\S]*?tip\.branch\.tip\.sha/
    )
    assert.match(branchDropdownSource, /className="repository-ci-status"/)
  })

  it('shows real updater download state in the top progress bar', () => {
    assert.match(
      appSource,
      /updateState\.status !== UpdateStatus\.UpdateAvailable[\s\S]*?className="update-download-progress"[\s\S]*?t\('update\.downloadingLabel'\)/
    )
  })
})
