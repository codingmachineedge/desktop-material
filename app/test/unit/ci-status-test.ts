import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as React from 'react'
import { CIStatus, getLabelForCheck } from '../../src/ui/branches/ci-status'
import { APICheckConclusion, APICheckStatus } from '../../src/lib/api'
import { Dispatcher } from '../../src/ui/dispatcher'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { render, screen, waitFor } from '../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../src/lib/i18n'

const branchDropdownSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'toolbar', 'branch-dropdown.tsx'),
  'utf8'
)
const appSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'app.tsx'),
  'utf8'
)
const submoduleBackButtonSource = readFileSync(
  join(
    process.cwd(),
    'app',
    'src',
    'ui',
    'submodules',
    'submodule-back-button.tsx'
  ),
  'utf8'
)
const repositorySettingsSource = readFileSync(
  join(
    process.cwd(),
    'app',
    'src',
    'ui',
    'repository-settings',
    'repository-settings.tsx'
  ),
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

  it('keeps submodule navigation semantic while accessible names stay concise', () => {
    assert.match(
      submoduleBackButtonSource,
      /accessibleLabel = translateForAccessibleName\([\s\S]*?'submodule\.backToParent'/
    )
    assert.match(
      submoduleBackButtonSource,
      /<LocalizedText[\s\S]*?translationKey="submodule\.backToParent"/
    )
    assert.match(appSource, /<SubmoduleBackButton/)
    assert.match(
      appSource,
      /aria-label=\{translateForAccessibleName\([\s\S]*?'submodule\.navigation'/
    )
    assert.match(appSource, /translationKey="submodule\.viewingContext"/)
    assert.match(
      repositorySettingsSource,
      /<LocalizedText translationKey="submodule\.title" \/>/
    )
  })

  it('reacts to live English, Cantonese, and bilingual Appearance changes', async () => {
    const check = {
      status: APICheckStatus.Completed,
      conclusion: APICheckConclusion.Success,
      checks: [{}],
    }
    const dispatcher = {
      tryGetCommitStatus: () => check,
      subscribeToCommitStatus: () => ({ dispose: () => undefined }),
    } as unknown as Dispatcher
    const repository = new GitHubRepository(
      'material',
      new Owner('desktop', 'https://api.github.com', 1),
      1
    )

    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const view = render(
      React.createElement(CIStatus, {
        dispatcher,
        repository,
        commitRef: 'abc123',
      })
    )

    try {
      assert.ok(screen.getByLabelText('CI checks: successful'))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByLabelText('CI 檢查：成功，掂晒'))
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() => {
        assert.ok(screen.getByLabelText('CI checks: successful'))
        assert.equal(
          screen.queryByLabelText(
            'CI checks: successful · CI 檢查：成功，掂晒'
          ),
          null
        )
      })
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
      localStorage.removeItem('language-mode-v1')
    }
  })
})
