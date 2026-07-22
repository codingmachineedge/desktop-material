import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  getUpdateFeedRepository,
  isNewerDesktopMaterialBuildInProgress,
} from '../../src/lib/desktop-material-update-build'
import { translate } from '../../src/lib/i18n'
import { About } from '../../src/ui/about/about'
import {
  IUpdateState,
  UpdateStatus,
  UpdateStore,
} from '../../src/ui/lib/update-store'
import { render, screen } from '../helpers/ui/render'

const installedSHA = '1'.repeat(40)
const buildSHA = '2'.repeat(40)
const ciRunID = 123456788
const installerRunID = 123456789
const updatesURL =
  'https://github.com/Ding-Ding-Projects/desktop-material/releases/latest/download/'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function storageSnapshot(): Map<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key !== null) {
      result.set(key, localStorage.getItem(key) ?? '')
    }
  }
  return result
}

function updateStoreAccess(store: UpdateStore) {
  return store as unknown as {
    readonly onUpdateNotAvailable: () => Promise<void>
    readonly onUpdateAvailable: () => void
  }
}

function updateState(status: UpdateStatus): IUpdateState {
  return {
    status,
    lastSuccessfulCheck: new Date(),
    isX64ToARM64ImmediateAutoUpdate: false,
    newReleases: [],
    prioritizeUpdate: false,
    prioritizeUpdateInfoUrl: undefined,
  }
}

describe('update coming soon', () => {
  it('derives only a safe GitHub repository from the configured release feed', () => {
    assert.deepEqual(getUpdateFeedRepository(updatesURL), {
      owner: 'Ding-Ding-Projects',
      name: 'desktop-material',
    })
    assert.equal(
      getUpdateFeedRepository(
        'https://example.test/Ding-Ding-Projects/desktop-material/releases/latest/download/'
      ),
      null
    )
    assert.equal(
      getUpdateFeedRepository(
        'http://github.com/Ding-Ding-Projects/desktop-material/releases/latest/download/'
      ),
      null
    )
  })

  it('uses an in-progress CI build job and compare result to prove a newer commit', async () => {
    const requests = new Array<string>()
    const fetcher = async (input: RequestInfo) => {
      const url = input.toString()
      requests.push(url)
      if (url.includes('/jobs?')) {
        return jsonResponse({
          jobs: [
            {
              name: 'Windows x64',
              status: 'in_progress',
              run_id: ciRunID,
              head_sha: buildSHA,
            },
          ],
        })
      }
      return url.includes('/compare/')
        ? jsonResponse({ status: 'ahead' })
        : jsonResponse({
            workflow_runs: [
              {
                id: ciRunID,
                status: 'in_progress',
                event: 'push',
                head_branch: 'main',
                head_sha: buildSHA,
                path: '.github/workflows/ci.yml',
              },
            ],
          })
    }

    assert.equal(
      await isNewerDesktopMaterialBuildInProgress({
        updatesURL,
        installedSHA,
        fetcher,
      }),
      true
    )
    assert.equal(requests.length, 3)
    assert.match(requests[0], /actions\/workflows\/ci\.yml\/runs\?/)
    assert.match(requests[0], /status=in_progress/)
    assert.match(requests[1], new RegExp(`/runs/${ciRunID}/jobs\\?`))
    assert.match(requests[1], /filter=latest/)
    assert.match(
      requests[2],
      new RegExp(`${installedSHA}\\.\\.\\.${buildSHA}$`)
    )
  })

  it('also recognizes an exact in-progress installer packaging job', async () => {
    const requests = new Array<string>()
    const fetcher = async (input: RequestInfo) => {
      const url = input.toString()
      requests.push(url)
      if (url.includes('/workflows/ci.yml/runs?')) {
        return jsonResponse({ workflow_runs: [] })
      }
      if (url.includes('/jobs?')) {
        return jsonResponse({
          jobs: [
            {
              name: 'Windows x64',
              status: 'in_progress',
              run_id: installerRunID,
              head_sha: buildSHA,
            },
          ],
        })
      }
      return url.includes('/compare/')
        ? jsonResponse({ status: 'ahead' })
        : jsonResponse({
            workflow_runs: [
              {
                id: installerRunID,
                status: 'in_progress',
                event: 'workflow_run',
                head_branch: 'main',
                head_sha: buildSHA,
                path: '.github/workflows/build-installers.yml',
              },
            ],
          })
    }

    assert.equal(
      await isNewerDesktopMaterialBuildInProgress({
        updatesURL,
        installedSHA,
        fetcher,
      }),
      true
    )
    assert.equal(requests.length, 4)
    assert.match(requests[0], /actions\/workflows\/ci\.yml\/runs\?/)
    assert.match(
      requests[1],
      /actions\/workflows\/build-installers\.yml\/runs\?/
    )
    assert.match(requests[2], new RegExp(`/runs/${installerRunID}/jobs\\?`))
    assert.match(
      requests[3],
      new RegExp(`${installedSHA}\\.\\.\\.${buildSHA}$`)
    )
  })

  it('fails closed for stale, malformed, or non-building provider state', async () => {
    for (const workflowRuns of [
      [
        {
          id: installerRunID,
          status: 'completed',
          event: 'workflow_run',
          head_branch: 'main',
          head_sha: buildSHA,
          path: '.github/workflows/build-installers.yml',
        },
      ],
      [
        {
          id: installerRunID,
          status: 'in_progress',
          event: 'pull_request',
          head_branch: 'feature',
          head_sha: buildSHA,
          path: '.github/workflows/build-installers.yml',
        },
      ],
      [{ status: 'in_progress', head_sha: 'not-an-object-id' }],
    ]) {
      let requests = 0
      const fetcher = async () => {
        requests++
        return jsonResponse({ workflow_runs: workflowRuns })
      }
      assert.equal(
        await isNewerDesktopMaterialBuildInProgress({
          updatesURL,
          installedSHA,
          fetcher,
        }),
        false
      )
      assert.equal(requests, 2)
    }

    assert.equal(
      await isNewerDesktopMaterialBuildInProgress({
        updatesURL,
        installedSHA: 'development-build',
        fetcher: async () => {
          throw new Error('must not request')
        },
      }),
      false
    )

    let manualRequests = 0
    assert.equal(
      await isNewerDesktopMaterialBuildInProgress({
        updatesURL,
        installedSHA,
        fetcher: async input => {
          manualRequests++
          const url = input.toString()
          if (url.includes('/workflows/ci.yml/runs?')) {
            return jsonResponse({ workflow_runs: [] })
          }
          return url.includes('/jobs?')
            ? jsonResponse({
                jobs: [
                  {
                    name: 'Verify manually dispatched release',
                    status: 'in_progress',
                    run_id: installerRunID,
                    head_sha: buildSHA,
                  },
                ],
              })
            : jsonResponse({
                workflow_runs: [
                  {
                    id: installerRunID,
                    status: 'in_progress',
                    event: 'workflow_dispatch',
                    head_branch: 'main',
                    head_sha: buildSHA,
                    path: '.github/workflows/build-installers.yml',
                  },
                ],
              })
        },
      }),
      false
    )
    assert.equal(manualRequests, 3)
  })

  it('binds CI runs and jobs to exact path, event, branch, run ID, and SHA', async () => {
    const baseRun = {
      id: ciRunID,
      status: 'in_progress',
      event: 'push',
      head_branch: 'main',
      head_sha: buildSHA,
      path: '.github/workflows/ci.yml',
    }
    for (const run of [
      { ...baseRun, event: 'pull_request' },
      { ...baseRun, head_branch: 'feature' },
      { ...baseRun, head_sha: 'not-an-object-id' },
      { ...baseRun, path: '.github/workflows/build-installers.yml' },
    ]) {
      let jobsRequested = false
      const result = await isNewerDesktopMaterialBuildInProgress({
        updatesURL,
        installedSHA,
        fetcher: async input => {
          const url = input.toString()
          if (url.includes('/jobs?')) {
            jobsRequested = true
          }
          return jsonResponse({
            workflow_runs: url.includes('/workflows/ci.yml/runs?') ? [run] : [],
          })
        },
      })
      assert.equal(result, false)
      assert.equal(jobsRequested, false)
    }

    for (const job of [
      {
        name: 'Lint',
        status: 'in_progress',
        run_id: ciRunID,
        head_sha: buildSHA,
      },
      {
        name: 'Windows x64',
        status: 'queued',
        run_id: ciRunID,
        head_sha: buildSHA,
      },
      {
        name: 'Windows x64',
        status: 'in_progress',
        run_id: ciRunID + 1,
        head_sha: buildSHA,
      },
      {
        name: 'Windows x64',
        status: 'in_progress',
        run_id: ciRunID,
        head_sha: installedSHA,
      },
    ]) {
      let compareRequested = false
      const result = await isNewerDesktopMaterialBuildInProgress({
        updatesURL,
        installedSHA,
        fetcher: async input => {
          const url = input.toString()
          if (url.includes('/compare/')) {
            compareRequested = true
          }
          if (url.includes('/workflows/ci.yml/runs?')) {
            return jsonResponse({ workflow_runs: [baseRun] })
          }
          if (url.includes('/jobs?')) {
            return jsonResponse({ jobs: [job] })
          }
          return jsonResponse({ workflow_runs: [] })
        },
      })
      assert.equal(result, false)
      assert.equal(compareRequested, false)
    }
  })

  it('keeps the transient build state out of persisted preferences', async () => {
    localStorage.removeItem('last-successful-update-check')
    const before = storageSnapshot()
    const store = new UpdateStore({
      generateReleaseSummary: async () => [],
      probeForNewerBuild: async () => true,
      subscribeToUpdaterEvents: false,
    })

    await updateStoreAccess(store).onUpdateNotAvailable()

    assert.equal(store.state.status, UpdateStatus.UpdateComingSoon)
    assert.notEqual(localStorage.getItem('last-successful-update-check'), null)
    const after = storageSnapshot()
    after.delete('last-successful-update-check')
    assert.deepEqual(after, before)
    localStorage.removeItem('last-successful-update-check')
  })

  it('does not let a slow build probe overwrite a real available release', async () => {
    let resolveProbe!: (value: boolean) => void
    const probe = new Promise<boolean>(resolve => {
      resolveProbe = resolve
    })
    const store = new UpdateStore({
      generateReleaseSummary: async () => [],
      probeForNewerBuild: async () => await probe,
      subscribeToUpdaterEvents: false,
    })
    const access = updateStoreAccess(store)

    const noUpdateTransition = access.onUpdateNotAvailable()
    access.onUpdateAvailable()
    resolveProbe(true)
    await noUpdateTransition

    assert.equal(store.state.status, UpdateStatus.UpdateAvailable)
  })

  it('renders persisted English, playful Cantonese, and bilingual status copy', () => {
    const expected = {
      english: 'New update coming soon',
      cantonese: '新版本就快焗好出爐',
      bilingual: 'New update coming soon · 新版本就快焗好出爐',
    } as const

    for (const [languageMode, message] of Object.entries(expected)) {
      localStorage.setItem(
        'appearance-customization-v1',
        JSON.stringify({ version: 1, languageMode })
      )
      localStorage.setItem('language-mode-v1', languageMode)
      const about = new About({
        onDismissed: () => undefined,
        applicationName: 'Desktop Material',
        applicationVersion: '1.0.0',
        applicationArchitecture: 'x64',
        onCheckForNonStaggeredUpdates: () => undefined,
        onShowAcknowledgements: () => undefined,
        onShowTermsAndConditions: () => undefined,
        onQuitAndInstall: () => undefined,
        updateState: updateState(UpdateStatus.UpdateComingSoon),
        allowDevelopment: true,
      })
      const details = (
        about as unknown as { readonly renderUpdateDetails: () => JSX.Element }
      ).renderUpdateDetails()
      const view = render(<div>{details}</div>)
      assert.ok(screen.getAllByText(message).length >= 1)
      assert.equal(
        translate('update.comingSoon', languageMode),
        message,
        languageMode
      )
      view.unmount()
    }

    localStorage.removeItem('appearance-customization-v1')
    localStorage.removeItem('language-mode-v1')
  })
})
