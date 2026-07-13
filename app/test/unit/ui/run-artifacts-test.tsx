import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { IAPIWorkflowRun } from '../../../src/lib/api'
import {
  ActionsArtifactMaximumDownloadBytes,
  IActionsArtifact,
  IActionsArtifactList,
} from '../../../src/lib/actions-artifacts'
import { IActionsArtifactDownloadResult } from '../../../src/lib/actions-artifact-download'
import { ActionsStore } from '../../../src/lib/stores/actions-store'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { RunArtifacts } from '../../../src/ui/actions/run-artifacts'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const longName =
  'Windows-package-with-a-deliberately-very-long-name-that-must-wrap-without-overlapping-or-requiring-sideways-scrolling'
const digest = `sha256:${'a'.repeat(64)}`

const gitHubRepository = new GitHubRepository(
  'desktop-material',
  new Owner('owner', 'https://api.github.com', 1),
  1
)
const repository = new Repository(
  'C:/desktop-material',
  1,
  gitHubRepository,
  false
)

const run = (id: number = 7): IAPIWorkflowRun => ({
  id,
  workflow_id: 3,
  cancel_url: 'https://api.github.com/cancel',
  created_at: '2026-07-13T10:00:00Z',
  logs_url: 'https://api.github.com/logs',
  name: 'CI',
  rerun_url: 'https://api.github.com/rerun',
  check_suite_id: 9,
  event: 'push',
  display_title: 'Build',
  run_number: 42,
  run_attempt: 2,
  head_branch: 'feature/artifact-browser',
  head_sha: 'b'.repeat(40),
})

const artifact = (
  overrides: Partial<IActionsArtifact> = {}
): IActionsArtifact => ({
  id: 19,
  name: longName,
  sizeInBytes: 1024,
  expired: false,
  createdAt: new Date('2026-07-13T10:00:00Z'),
  expiresAt: new Date('2099-10-11T10:00:00Z'),
  updatedAt: new Date('2026-07-13T10:01:00Z'),
  digest,
  workflowRun: {
    id: 7,
    headBranch: 'feature/artifact-browser',
    headSha: 'b'.repeat(40),
  },
  ...overrides,
})

const list = (
  artifacts: ReadonlyArray<IActionsArtifact>,
  totalCount: number = artifacts.length
): IActionsArtifactList => ({
  artifacts,
  totalCount,
  truncated: totalCount > artifacts.length,
})

interface IStoreOverrides {
  readonly fetchArtifacts?: (
    repository: Repository,
    runId: number,
    signal?: AbortSignal
  ) => Promise<IActionsArtifactList>
  readonly fetchArtifactAttestationPresence?: (
    repository: Repository,
    digest: string,
    signal?: AbortSignal
  ) => Promise<boolean>
  readonly downloadArtifact?: ActionsStore['downloadArtifact']
}

function store(overrides: IStoreOverrides = {}): ActionsStore {
  return {
    fetchArtifacts: overrides.fetchArtifacts ?? (async () => list([])),
    fetchArtifactAttestationPresence:
      overrides.fetchArtifactAttestationPresence ?? (async () => false),
    downloadArtifact:
      overrides.downloadArtifact ??
      (async () => {
        throw new Error('Unexpected download.')
      }),
  } as unknown as ActionsStore
}

const downloadResult = (
  path: string,
  matchesGitHubDigest: boolean | null = true
): IActionsArtifactDownloadResult => ({
  path,
  bytes: 1024,
  localDigest: digest,
  matchesGitHubDigest,
})

describe('Actions run artifacts', () => {
  it('renders long names, bounded listing, digest, and run provenance', async () => {
    render(
      <RunArtifacts
        repository={repository}
        run={run()}
        actionsStore={store({
          fetchArtifacts: async () => list([artifact()], 120),
        })}
      />
    )

    assert.ok(await screen.findByRole('heading', { name: longName }))
    assert.ok(screen.getByText(digest))
    assert.ok(screen.getByText(/#42 · attempt 2 · push/))
    assert.ok(screen.getByText(/feature\/artifact-browser · b{12}/))
    assert.ok(screen.getByText(/Showing the first 1 of 120 artifacts/))
    assert.ok(
      screen.getByRole('button', { name: `Download artifact: ${longName}` })
    )
  })

  it('shows empty, signed-out, unsupported, and permission states', async () => {
    const cases = [
      'No artifacts were returned for this workflow run.',
      'Sign in to https://api.github.com to use Actions.',
      'GitHub Actions is not available on this GitHub Enterprise version.',
      'GitHub denied permission to load artifacts for this workflow run.',
    ]

    for (const [index, message] of cases.entries()) {
      const view = render(
        <RunArtifacts
          repository={repository}
          run={run(index + 1)}
          actionsStore={store({
            fetchArtifacts: async () => {
              if (index === 0) {
                return list([])
              }
              throw new Error(message)
            },
          })}
        />
      )
      assert.ok(await screen.findByText(message))
      view.unmount()
    }
  })

  it('labels attestation presence as unverified context', async () => {
    render(
      <RunArtifacts
        repository={repository}
        run={run()}
        actionsStore={store({
          fetchArtifacts: async () => list([artifact()]),
          fetchArtifactAttestationPresence: async () => true,
        })}
      />
    )

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Check attestation records: ${longName}`,
      })
    )
    assert.ok(
      await screen.findByText(
        /Presence only—cryptographic verification of the signature, signer, timestamp, and policy is still required/
      )
    )
    assert.equal(screen.queryByText(/provenance verified/i), null)
  })

  it('handles picker cancellation, verified local digest, and reveal', async () => {
    let choices = 0
    let revealed = ''
    let chosenName = ''
    const path = 'C:\\Downloads\\Windows package.zip'
    render(
      <RunArtifacts
        repository={repository}
        run={run()}
        actionsStore={store({
          fetchArtifacts: async () => list([artifact()]),
          downloadArtifact: async (
            _repository,
            _artifact,
            destination,
            _signal,
            onProgress
          ) => {
            onProgress?.({ receivedBytes: 512, totalBytes: 1024 })
            onProgress?.({ receivedBytes: 1024, totalBytes: 1024 })
            return downloadResult(destination)
          },
        })}
        chooseDestination={async (_artifact, defaultName) => {
          chosenName = defaultName
          choices++
          return choices === 1 ? null : path
        }}
        reveal={async value => {
          revealed = value
        }}
      />
    )

    const download = await screen.findByRole('button', {
      name: `Download artifact: ${longName}`,
    })
    fireEvent.click(download)
    assert.ok(
      await screen.findByText('Artifact download canceled before transfer.')
    )
    fireEvent.click(download)

    assert.ok(
      await screen.findByText(
        /locally computed SHA-256 matches GitHub’s artifact digest/
      )
    )
    assert.equal(chosenName.endsWith('.zip'), true)
    assert.ok(screen.getByText('Locally computed archive digest'))
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    await waitFor(() => assert.equal(revealed, path))
  })

  it('cancels an active transfer and exposes expired and oversized guidance', async () => {
    let downloadSignal: AbortSignal | undefined
    const available = artifact()
    const expired = artifact({ id: 20, name: 'old package', expired: true })
    const oversized = artifact({
      id: 21,
      name: 'huge package',
      sizeInBytes: ActionsArtifactMaximumDownloadBytes + 1,
    })
    render(
      <RunArtifacts
        repository={repository}
        run={run()}
        actionsStore={store({
          fetchArtifacts: async () => list([available, expired, oversized]),
          downloadArtifact: async (
            _repository,
            _artifact,
            _destination,
            signal
          ) => {
            downloadSignal = signal
            return await new Promise<IActionsArtifactDownloadResult>(
              (_resolve, reject) =>
                signal.addEventListener(
                  'abort',
                  () => {
                    const error = new Error('canceled')
                    error.name = 'AbortError'
                    reject(error)
                  },
                  { once: true }
                )
            )
          },
        })}
        chooseDestination={async () => 'C:\\Downloads\\artifact.zip'}
      />
    )

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Download artifact: ${longName}`,
      })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel download' })
    )
    assert.ok(
      await screen.findByText(
        'Artifact download canceled. The partial file was removed.'
      )
    )
    assert.equal(downloadSignal?.aborted, true)
    assert.equal(
      screen
        .getByRole('button', { name: 'Download artifact: old package' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.ok(screen.getByText(/no longer serves expired artifact archives/))
    assert.equal(
      screen
        .getByRole('button', { name: 'Download artifact: huge package' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.ok(screen.getByText(/exceeds the app’s 5 GiB download safety limit/))
  })

  it('aborts and ignores a stale provider/run listing', async () => {
    let firstSignal: AbortSignal | undefined
    let resolveFirst: ((value: IActionsArtifactList) => void) | undefined
    const nextGitHubRepository = new GitHubRepository(
      'desktop-material',
      new Owner('owner', 'https://github.enterprise.test/api/v3', 2),
      2
    )
    const nextRepository = new Repository(
      'C:/desktop-material',
      2,
      nextGitHubRepository,
      false
    )
    let latestEndpoint = ''
    const actionsStore = store({
      fetchArtifacts: async (value, runId, signal) => {
        latestEndpoint = value.gitHubRepository?.endpoint ?? ''
        if (runId === 7) {
          firstSignal = signal
          return await new Promise(resolve => (resolveFirst = resolve))
        }
        return list([
          artifact({ id: 22, name: 'new run package', workflowRun: null }),
        ])
      },
    })
    const view = render(
      <RunArtifacts
        repository={repository}
        run={run(7)}
        actionsStore={actionsStore}
      />
    )
    await waitFor(() => assert.ok(firstSignal))
    view.rerender(
      <RunArtifacts
        repository={nextRepository}
        run={run(8)}
        actionsStore={actionsStore}
      />
    )
    assert.ok(await screen.findByText('new run package'))
    assert.equal(firstSignal?.aborted, true)
    assert.equal(latestEndpoint, nextGitHubRepository.endpoint)
    resolveFirst?.(list([artifact({ name: 'stale package' })]))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(screen.queryByText('stale package'), null)
  })
})
