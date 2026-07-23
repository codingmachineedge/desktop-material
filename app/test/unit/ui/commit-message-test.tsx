import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import * as React from 'react'

import { Account } from '../../../src/models/account'
import { DefaultCommitMessage } from '../../../src/models/commit-message'
import { DiffSelection, DiffSelectionType } from '../../../src/models/diff'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { RepoRulesInfo } from '../../../src/models/repo-rules'
import { Repository } from '../../../src/models/repository'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../../src/models/status'
import {
  advanceCheapLfsTransferTiming,
  CommitMessage,
  type ICheapLfsTransferTimingSample,
} from '../../../src/ui/changes/commit-message'
import { Button } from '../../../src/ui/lib/button'
import { translate } from '../../../src/lib/i18n'
import type {
  CheapLfsAutoPinPhase,
  ICheapLfsAutoPinProgress,
} from '../../../src/lib/cheap-lfs/operations'
import { fireEvent, render } from '../../helpers/ui/render'

const PreviewFeaturesEnv = 'GITHUB_DESKTOP_PREVIEW_FEATURES'
const previousPreviewFeatures = process.env[PreviewFeaturesEnv]

type CommitMessageProps = React.ComponentProps<typeof CommitMessage>
type CopilotButtonProps = {
  readonly ariaLabel?: string
  readonly disabled?: boolean
}
type TestButtonProps = React.ComponentProps<typeof Button> & {
  readonly children?: React.ReactNode
}

type CommitMessageTestInstance = {
  readonly renderCopilotButton: () => React.ReactElement | null
  readonly renderCommitProgress: () => React.ReactElement | null
  readonly getButtonText: () => React.ReactNode
  readonly getButtonTitle: () => string
  readonly onCopilotButtonClick: (
    event: Pick<React.MouseEvent<HTMLButtonElement>, 'preventDefault'>
  ) => Promise<void>
}

type CommitMessageLifecycleTestInstance = CommitMessageTestInstance & {
  props: CommitMessageProps
  state: { isCommittingStatusMessage: string }
  setState: (state: { isCommittingStatusMessage: string }) => void
  componentDidUpdate: (
    previousProps: CommitMessageProps,
    previousState: unknown
  ) => Promise<void>
  updateRepoRuleFailures: () => Promise<void>
}

type CheapLfsTimingTestInstance = CommitMessageTestInstance & {
  props: CommitMessageProps
  state: {
    cheapLfsTransferTiming: ICheapLfsTransferTimingSample | null
  }
  setState: (
    state:
      | Partial<{
          cheapLfsTransferTiming: ICheapLfsTransferTimingSample | null
        }>
      | ((state: {
          cheapLfsTransferTiming: ICheapLfsTransferTimingSample | null
        }) => Partial<{
          cheapLfsTransferTiming: ICheapLfsTransferTimingSample | null
        }> | null),
    callback?: () => void
  ) => void
  componentWillReceiveProps: (nextProps: CommitMessageProps) => void
  tickCheapLfsTiming: () => void
}

function installCheapLfsTimingSetState(component: CheapLfsTimingTestInstance) {
  component.setState = update => {
    const value =
      typeof update === 'function' ? update(component.state) : update
    if (value !== null) {
      Object.assign(component.state, value)
    }
  }
}

function createAccount() {
  return new Account(
    'mona',
    'https://api.github.com',
    'token',
    [],
    '',
    1,
    'Mona Lisa',
    'free',
    'https://copilot-proxy.githubusercontent.com',
    true,
    ['desktop_copilot_generate_commit_message']
  )
}

function createRepository() {
  const owner = new Owner('octocat', 'https://api.github.com', 1)
  const gitHubRepository = new GitHubRepository(
    'desktop',
    owner,
    99,
    false,
    'https://github.com/octocat/desktop'
  )

  return new Repository('/tmp/desktop-fixture', 123, gitHubRepository, false)
}

function createSelectedFile(path: string) {
  return new WorkingDirectoryFileChange(
    path,
    { kind: AppFileStatusKind.Modified },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

function createProps(
  overrides: Partial<CommitMessageProps> = {}
): CommitMessageProps {
  const account = createAccount()
  const repository = createRepository()
  const filesSelected = [createSelectedFile('src/index.ts')]

  return {
    onCreateCommit: async () => false,
    branch: 'main',
    commitAuthor: null,
    anyFilesSelected: true,
    filesToBeCommittedCount: filesSelected.length,
    showPromptForCommittingFileHiddenByFilter: false,
    isShowingModal: false,
    isShowingFoldout: false,
    anyFilesAvailable: true,
    filesSelected,
    focusCommitMessage: false,
    commitMessage: DefaultCommitMessage,
    repository,
    repositoryAccount: null,
    autocompletionProviders: [],
    isCommitting: false,
    commitOperationPhase: null,
    hookProgress: null,
    onShowCommitProgress: undefined,
    onManualCheapLfsUpload: () => {},
    onCancelCheapLfsCommit: () => {},
    isGeneratingCommitMessage: true,
    shouldShowGenerateCommitMessageCallOut: false,
    commitToAmend: null,
    placeholder: 'Summary',
    prepopulateCommitSummary: false,
    showBranchProtected: false,
    repoRulesInfo: new RepoRulesInfo(),
    aheadBehind: null,
    showNoWriteAccess: false,
    showCoAuthoredBy: false,
    showInputLabels: false,
    coAuthors: [],
    shouldNudge: false,
    commitSpellcheckEnabled: false,
    showCommitLengthWarning: false,
    mostRecentLocalCommit: null,
    onCoAuthorsUpdated: () => {},
    onShowCoAuthoredByChanged: () => {},
    onConfirmCommitWithUnknownCoAuthors: () => {},
    onGenerateCommitMessage: () => {},
    onCancelGenerateCommitMessage: () => {},
    onCommitMessageFocusSet: () => {},
    onRefreshAuthor: () => {},
    onShowPopup: () => {},
    onShowFoldout: () => {},
    onCommitSpellcheckEnabledChanged: () => {},
    onStopAmending: () => {},
    onShowCreateForkDialog: () => {},
    accounts: [account],
    skipCommitHooks: false,
    signOffCommits: false,
    allowEmptyCommit: false,
    showAllowEmptyCommitOption: true,
    onUpdateCommitOptions: () => {},
    ...overrides,
  }
}

function toTestInstance(component: CommitMessage): CommitMessageTestInstance {
  return component as unknown as CommitMessageTestInstance
}

function isButtonElement(
  node: React.ReactNode
): node is React.ReactElement<TestButtonProps> {
  return React.isValidElement(node) && node.type === Button
}

function getCommitProgressButtons(component: CommitMessageTestInstance) {
  const progress = component.renderCommitProgress()
  if (progress === null) {
    throw new Error('Expected commit progress to render')
  }

  return React.Children.toArray(progress.props.children).filter(isButtonElement)
}

function isElementWithCopilotButtonProps(
  node: React.ReactNode
): node is React.ReactElement<
  CopilotButtonProps & { readonly className?: string }
> {
  return React.isValidElement(node) && node.props.className === 'copilot-button'
}

function getCopilotButtonProps(
  component: CommitMessageTestInstance
): CopilotButtonProps {
  const button = component.renderCopilotButton()
  if (button === null) {
    throw new Error('Expected Copilot button to render')
  }

  const buttonElement = React.Children.toArray(button.props.children).find(
    isElementWithCopilotButtonProps
  )
  if (buttonElement === undefined) {
    throw new Error('Expected Copilot button element to render')
  }

  return buttonElement.props
}

async function clickCopilotButton(component: CommitMessageTestInstance) {
  await component.onCopilotButtonClick({
    preventDefault: () => {},
  })
}

afterEach(() => {
  if (previousPreviewFeatures === undefined) {
    delete process.env[PreviewFeaturesEnv]
  } else {
    process.env[PreviewFeaturesEnv] = previousPreviewFeatures
  }
})

describe('CommitMessage', () => {
  it('names cheap-LFS preprocessing instead of claiming Git is committing to main', () => {
    const preparing = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'preparing',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: 'windows.iso',
              transferredBytes: 0,
              totalBytes: 200,
            },
          },
        })
      )
    )
    assert.equal(
      preparing.getButtonText(),
      'Preparing 1 large file for cheap LFS'
    )
    assert.doesNotMatch(preparing.getButtonTitle(), /Committing.*main/)

    const uploading = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'uploading',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: 'windows.iso',
              transferredBytes: 101,
              totalBytes: 200,
            },
          },
        })
      )
    )
    assert.equal(
      uploading.getButtonText(),
      'Uploading 1 large file to cheap LFS (50%)'
    )

    const verifying = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'verifying',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: 'windows.iso',
              transferredBytes: 200,
              totalBytes: 200,
            },
          },
        })
      )
    )
    assert.equal(
      verifying.getButtonText(),
      'Verifying 1 large file for cheap LFS'
    )

    const committingPointer = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'git-commit',
            cheapLfsPointerCount: 1,
          },
        })
      )
    )
    assert.equal(
      committingPointer.getButtonText(),
      'Committing 1 cheap-LFS pointer to main'
    )
  })

  it('describes every cheap-LFS transfer and manual handoff stage honestly', () => {
    const textFor = (
      phase: CheapLfsAutoPinPhase,
      transferredBytes = 0,
      totalBytes = 200
    ) =>
      toTestInstance(
        new CommitMessage(
          createProps({
            isCommitting: true,
            isGeneratingCommitMessage: false,
            commitOperationPhase: {
              kind: 'cheap-lfs',
              progress: {
                phase,
                completedFiles: 0,
                totalFiles: 2,
                currentPath: 'windows.iso',
                transferredBytes,
                totalBytes,
              },
            },
          })
        )
      ).getButtonText()

    assert.equal(textFor('hashing'), 'Hashing 2 large files for cheap LFS (0%)')
    assert.equal(
      textFor('hashing', 101),
      'Hashing 2 large files for cheap LFS (50%)'
    )
    assert.equal(
      textFor('release'),
      'Preparing the GitHub Release for 2 large files'
    )
    assert.equal(
      textFor('uploading'),
      'Starting the cheap-LFS upload for 2 large files'
    )
    assert.doesNotMatch(String(textFor('uploading')), /0%/)
    assert.equal(
      textFor('uploading', 101),
      'Uploading 2 large files to cheap LFS (50%)'
    )
    assert.equal(
      textFor('verifying', 200),
      'Verifying 2 large files for cheap LFS'
    )
    assert.equal(
      textFor('manual-preparing'),
      'Preparing the manual upload handoff (0%)'
    )
    assert.equal(
      textFor('manual-preparing', 101),
      'Preparing the manual upload handoff (50%)'
    )
    assert.equal(
      textFor('manual-waiting'),
      'Upload all prepared files and save the GitHub release'
    )
    assert.equal(textFor('manual-verifying'), 'Checking your manual upload')
    assert.equal(
      textFor('manual-detected'),
      'Manual upload detected and verified'
    )
  })

  it('offers manual upload and an explicit cancel control during cheap-LFS work', () => {
    let manualUploadCount = 0
    let cancelCount = 0
    const component = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          onManualCheapLfsUpload: () => {
            manualUploadCount++
          },
          onCancelCheapLfsCommit: () => {
            cancelCount++
          },
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'uploading',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: 'windows.iso',
              transferredBytes: 0,
              totalBytes: 200,
            },
          },
        })
      )
    )

    const buttons = getCommitProgressButtons(component)
    assert.equal(buttons.length, 2)
    assert.equal(buttons[0].props.children, 'Manual upload')
    assert.equal(buttons[1].props.children, 'Cancel')

    buttons[0].props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    buttons[1].props.onClick?.({} as React.MouseEvent<HTMLButtonElement>)
    assert.equal(manualUploadCount, 1)
    assert.equal(cancelCount, 1)
  })

  it('renders a bounded, sanitized three-lane mini terminal below the commit button', () => {
    const component = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'hashing',
              completedFiles: 1,
              succeededFiles: 1,
              failedFiles: 0,
              totalFiles: 4,
              currentPath: 'ignored-legacy-path.iso',
              transferredBytes: 150,
              totalBytes: 400,
              selectedStorageProvider: 'release',
              recommendedStorageProvider: 'ghcr',
              storageRecommendationReason: 'github-registry-large-batch',
              estimatedRegistryLayers: 4,
              activeFiles: [
                {
                  relativePath: 'images/alpha\nsecret.iso',
                  phase: 'uploading',
                  processedBytes: 50,
                  totalBytes: 100,
                },
                {
                  relativePath: 'images/beta.iso',
                  phase: 'hashing',
                  processedBytes: 25,
                  totalBytes: 100,
                },
                {
                  relativePath: 'images/gamma.iso',
                  phase: 'verifying',
                  processedBytes: 75,
                  totalBytes: 100,
                },
                {
                  relativePath: 'images/not-rendered.iso',
                  phase: 'uploading',
                  processedBytes: 0,
                  totalBytes: 100,
                },
              ],
            },
          },
        })
      )
    )

    const progress = component.renderCommitProgress()
    if (progress === null) {
      throw new Error('Expected Cheap LFS progress to render')
    }

    const view = render(progress)
    const terminal = view.container.querySelector('.cheap-lfs-mini-terminal')
    const rows = view.container.querySelectorAll(
      '.cheap-lfs-terminal-active-file'
    )
    const progressBar = view.container.querySelector(
      '.cheap-lfs-terminal-progress[role="progressbar"]'
    )

    assert.ok(terminal)
    assert.equal(terminal.getAttribute('role'), 'region')
    assert.equal(rows.length, 3)
    assert.match(rows[0].textContent ?? '', /images\/alpha secret\.iso/)
    assert.doesNotMatch(terminal.textContent ?? '', /not-rendered/)
    assert.match(rows[0].textContent ?? '', /Uploading/)
    assert.match(
      terminal.textContent ?? '',
      /Using GitHub published prerelease · recommended GHCR · one OCI image · estimated 4 OCI layers/
    )
    assert.match(terminal.textContent ?? '', /Workers: 3 active · 0 waiting/)
    assert.match(terminal.textContent ?? '', /Observed 0s/)
    assert.doesNotMatch(terminal.textContent ?? '', /ETA/)
    assert.match(
      terminal.textContent ?? '',
      /large GitHub batch benefits from reusable GHCR layers/
    )
    assert.equal(progressBar?.getAttribute('aria-valuenow'), '37')

    // Aggregate hashing must not hide the manual fallback while a lane uploads.
    assert.deepEqual(
      getCommitProgressButtons(component).map(button => button.props.children),
      ['Manual upload', 'Cancel']
    )
  })

  it('reports renderer-observed throughput, ETA, and waiting work', () => {
    const previousNow = Date.now
    let now = 10_000
    Date.now = () => now

    try {
      const initialProps = createProps({
        isCommitting: true,
        isGeneratingCommitMessage: false,
        commitOperationPhase: {
          kind: 'cheap-lfs',
          progress: {
            phase: 'uploading',
            completedFiles: 0,
            totalFiles: 3,
            currentPath: 'images/alpha.iso',
            transferredBytes: 0,
            totalBytes: 400,
            selectedStorageProvider: 'release',
            activeFiles: [
              {
                relativePath: 'images/alpha.iso',
                phase: 'uploading',
                processedBytes: 0,
                totalBytes: 200,
              },
            ],
          },
        },
      })
      const component = new CommitMessage(
        initialProps
      ) as unknown as CheapLfsTimingTestInstance
      installCheapLfsTimingSetState(component)

      assert.ok(component.renderCommitProgress())
      now += 2_000
      const progressedProps = createProps({
        ...initialProps,
        commitOperationPhase: {
          kind: 'cheap-lfs',
          progress: {
            phase: 'uploading',
            completedFiles: 0,
            totalFiles: 3,
            currentPath: 'images/alpha.iso',
            transferredBytes: 200,
            totalBytes: 400,
            selectedStorageProvider: 'release',
            activeFiles: [
              {
                relativePath: 'images/alpha.iso',
                phase: 'uploading',
                processedBytes: 200,
                totalBytes: 200,
              },
            ],
          },
        },
      })
      component.componentWillReceiveProps(progressedProps)
      component.props = progressedProps

      const progress = component.renderCommitProgress()
      assert.ok(progress)
      const text = render(progress).container.textContent ?? ''
      assert.match(text, /Workers: 1 active · 2 waiting/)
      assert.match(text, /Observed 2s · 100 B\/s · ETA 2s/)
      assert.match(text, /Destination GitHub published prerelease/)

      const inactiveProps = createProps({
        isCommitting: false,
        commitOperationPhase: null,
      })
      component.componentWillReceiveProps(inactiveProps)
      component.props = inactiveProps
      assert.equal(component.renderCommitProgress(), null)
      now += 5_000
      const freshProps = createProps({
        isCommitting: true,
        isGeneratingCommitMessage: false,
        commitOperationPhase: {
          kind: 'cheap-lfs',
          progress: {
            phase: 'uploading',
            completedFiles: 0,
            totalFiles: 1,
            currentPath: 'fresh.iso',
            transferredBytes: 100,
            totalBytes: 200,
          },
        },
      })
      component.componentWillReceiveProps(freshProps)
      component.props = freshProps
      const freshProgress = component.renderCommitProgress()
      assert.ok(freshProgress)
      assert.match(
        render(freshProgress).container.textContent ?? '',
        /Observed 0s · measuring speed · ETA pending/
      )
    } finally {
      Date.now = previousNow
    }
  })

  it('resets rate samples without losing the operation observation clock', () => {
    const upload = (overrides: Partial<ICheapLfsAutoPinProgress> = {}) => ({
      phase: 'uploading' as const,
      completedFiles: 0,
      totalFiles: 2,
      currentPath: 'archive.bin',
      transferredBytes: 0,
      totalBytes: 1_000,
      ...overrides,
    })

    const initial = advanceCheapLfsTransferTiming(null, 123, upload(), 1_000)
    assert.ok(initial)
    const advanced = advanceCheapLfsTransferTiming(
      initial,
      123,
      upload({ transferredBytes: 400 }),
      3_000
    )
    assert.ok(advanced)
    assert.equal(advanced.operationStartedAt, 1_000)
    assert.equal(advanced.rateStartedAt, 1_000)

    const rollback = advanceCheapLfsTransferTiming(
      advanced,
      123,
      upload({ transferredBytes: 100 }),
      4_000
    )
    assert.ok(rollback)
    assert.equal(rollback.operationStartedAt, 1_000)
    assert.equal(rollback.rateStartedAt, 4_000)
    assert.equal(rollback.rateInitialTransferredBytes, 100)

    const completionRebound = advanceCheapLfsTransferTiming(
      rollback,
      123,
      upload({ completedFiles: 1, transferredBytes: 500 }),
      5_000
    )
    assert.ok(completionRebound)
    assert.equal(completionRebound.operationStartedAt, 1_000)
    assert.equal(completionRebound.rateStartedAt, 5_000)
    assert.equal(completionRebound.rateInitialTransferredBytes, 500)

    const changedOciTotal = advanceCheapLfsTransferTiming(
      completionRebound,
      123,
      upload({
        completedFiles: 1,
        transferredBytes: 500,
        totalBytes: 2_000,
      }),
      6_000
    )
    assert.ok(changedOciTotal)
    assert.equal(changedOciTotal.operationStartedAt, 1_000)
    assert.equal(changedOciTotal.rateStartedAt, 6_000)

    const switchedRepository = advanceCheapLfsTransferTiming(
      changedOciTotal,
      456,
      upload({ transferredBytes: 100, totalBytes: 2_000 }),
      7_000
    )
    assert.ok(switchedRepository)
    assert.equal(switchedRepository.operationStartedAt, 7_000)

    assert.equal(
      advanceCheapLfsTransferTiming(switchedRepository, 456, null, 8_000),
      null
    )
    const restarted = advanceCheapLfsTransferTiming(
      null,
      456,
      upload({ transferredBytes: 100, totalBytes: 2_000 }),
      9_000
    )
    assert.equal(restarted?.operationStartedAt, 9_000)
  })

  it('contains invalid clocks and formats very slow upload rates honestly', () => {
    const progress: ICheapLfsAutoPinProgress = {
      phase: 'uploading',
      completedFiles: 0,
      totalFiles: 1,
      currentPath: 'slow.bin',
      transferredBytes: 0,
      totalBytes: 10,
    }
    const initial = advanceCheapLfsTransferTiming(null, 123, progress, 10_000)
    assert.ok(initial)
    const invalid = advanceCheapLfsTransferTiming(
      initial,
      123,
      { ...progress, transferredBytes: 1 },
      Number.NaN
    )
    assert.equal(invalid?.lastObservedAt, 10_000)
    assert.equal(invalid?.rateStartedAt, 10_000)
    const backward = advanceCheapLfsTransferTiming(
      invalid,
      123,
      { ...progress, transferredBytes: 1 },
      9_000
    )
    assert.equal(backward?.lastObservedAt, 10_000)

    const previousNow = Date.now
    let now = 20_000
    Date.now = () => now
    try {
      const initialProps = createProps({
        isCommitting: true,
        isGeneratingCommitMessage: false,
        commitOperationPhase: { kind: 'cheap-lfs', progress },
      })
      const component = new CommitMessage(
        initialProps
      ) as unknown as CheapLfsTimingTestInstance
      installCheapLfsTimingSetState(component)
      now += 2_000
      const nextProps = createProps({
        ...initialProps,
        commitOperationPhase: {
          kind: 'cheap-lfs',
          progress: { ...progress, transferredBytes: 1 },
        },
      })
      component.componentWillReceiveProps(nextProps)
      component.props = nextProps
      const rendered = component.renderCommitProgress()
      assert.ok(rendered)
      assert.match(render(rendered).container.textContent ?? '', /<1 B\/s/)
    } finally {
      Date.now = previousNow
    }
  })

  it('shows manual handoff work without bogus worker queues or rate estimates', () => {
    const cases = [
      {
        phase: 'manual-waiting' as const,
        completedFiles: 0,
        expected: /Files awaiting your action: 3/,
      },
      {
        phase: 'manual-verifying' as const,
        completedFiles: 1,
        expected: /Files left to verify: 2/,
      },
      {
        phase: 'manual-detected' as const,
        completedFiles: 3,
        expected: /Manual upload verified/,
      },
    ]

    for (const manual of cases) {
      const component = toTestInstance(
        new CommitMessage(
          createProps({
            isCommitting: true,
            isGeneratingCommitMessage: false,
            commitOperationPhase: {
              kind: 'cheap-lfs',
              progress: {
                phase: manual.phase,
                completedFiles: manual.completedFiles,
                totalFiles: 3,
                currentPath: 'manual-upload',
                transferredBytes: 0,
                totalBytes: 600,
              },
            },
          })
        )
      )
      const progress = component.renderCommitProgress()
      assert.ok(progress)
      const text = render(progress).container.textContent ?? ''
      assert.match(text, manual.expected)
      assert.match(text, /Observed 0s/)
      assert.doesNotMatch(text, /Workers:|ETA|speed|Current file:/)
    }
  })

  it('keeps renderer-observed elapsed time moving while progress stalls', () => {
    const previousNow = Date.now
    let now = 1_000
    Date.now = () => now
    try {
      const component = new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'manual-waiting',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: null,
              transferredBytes: 0,
              totalBytes: 600,
            },
          },
        })
      ) as unknown as CheapLfsTimingTestInstance
      installCheapLfsTimingSetState(component)
      now = 4_000
      component.tickCheapLfsTiming()
      const progress = component.renderCommitProgress()
      assert.ok(progress)
      assert.match(render(progress).container.textContent ?? '', /Observed 3s/)
    } finally {
      Date.now = previousNow
    }
  })

  it('keeps nested provider recommendations compact and singular in bilingual mode', () => {
    const previousLanguageMode = localStorage.getItem('language-mode-v1')
    localStorage.setItem('language-mode-v1', 'bilingual')

    try {
      const component = toTestInstance(
        new CommitMessage(
          createProps({
            isCommitting: true,
            isGeneratingCommitMessage: false,
            commitOperationPhase: {
              kind: 'cheap-lfs',
              progress: {
                phase: 'uploading',
                completedFiles: 0,
                totalFiles: 1,
                currentPath: 'archive.bin',
                transferredBytes: 1024 ** 3,
                totalBytes: 2 * 1024 ** 3,
                selectedStorageProvider: 'ghcr',
                recommendedStorageProvider: 'ghcr',
                estimatedRegistryLayers: 1,
              },
            },
          })
        )
      )
      const progress = component.renderCommitProgress()
      if (progress === null) {
        throw new Error('Expected Cheap LFS progress to render')
      }

      const text = render(progress).container.textContent ?? ''
      assert.equal(text.match(/GHCR · one OCI image/g)?.length, 1)
      assert.equal(text.match(/GHCR · 一個 OCI image/g)?.length, 1)
      assert.match(text, /estimated 1 OCI layer/)
      assert.doesNotMatch(text, /estimated 1 OCI layers/)
      assert.match(text, /Workers: 1 active · 0 waiting/)
      assert.match(text, /工作線：1 條做緊 · 0 個等緊/)
      assert.match(text, /measuring speed/)
      assert.match(text, /量度緊速度/)
    } finally {
      if (previousLanguageMode === null) {
        localStorage.removeItem('language-mode-v1')
      } else {
        localStorage.setItem('language-mode-v1', previousLanguageMode)
      }
    }
  })

  it('exposes a keyboard-focusable storage recommendation disclosure', () => {
    const component = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'uploading',
              completedFiles: 0,
              totalFiles: 2,
              currentPath: 'archive.bin',
              transferredBytes: 0,
              totalBytes: 1024,
              selectedStorageProvider: 'release',
              recommendedStorageProvider: 'ghcr',
              storageRecommendationReason: 'github-registry-large-batch',
              estimatedRegistryLayers: 2,
            },
          },
        })
      )
    )
    const progress = component.renderCommitProgress()
    if (progress === null) {
      throw new Error('Expected Cheap LFS progress to render')
    }

    const view = render(progress)
    const recommendation = view.container.querySelector<HTMLDetailsElement>(
      'details.cheap-lfs-terminal-recommendation'
    )
    const disclosure = recommendation?.querySelector<HTMLElement>('summary')

    assert.ok(recommendation)
    assert.ok(disclosure)
    assert.equal(disclosure.tabIndex, 0)
    disclosure.focus()
    assert.equal(document.activeElement, disclosure)
    assert.equal(recommendation.open, false)
    fireEvent.click(disclosure)
    assert.equal(recommendation.open, true)
    assert.match(
      disclosure.textContent ?? '',
      /large GitHub batch benefits from reusable GHCR layers/
    )
  })

  it('keeps cancel available after switching to the manual handoff', () => {
    const component = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'manual-waiting',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: 'windows.iso',
              transferredBytes: 0,
              totalBytes: 200,
            },
          },
        })
      )
    )

    const buttons = getCommitProgressButtons(component)
    assert.equal(buttons.length, 1)
    assert.equal(buttons[0].props.children, 'Cancel')
  })

  it('offers manual fallback only during the automatic upload phase', () => {
    const phasesWithoutManualFallback: ReadonlyArray<CheapLfsAutoPinPhase> = [
      'preparing',
      'hashing',
      'release',
      'verifying',
      'manual-preparing',
      'manual-waiting',
      'manual-verifying',
      'manual-detected',
    ]

    for (const phase of phasesWithoutManualFallback) {
      const component = toTestInstance(
        new CommitMessage(
          createProps({
            isCommitting: true,
            isGeneratingCommitMessage: false,
            commitOperationPhase: {
              kind: 'cheap-lfs',
              progress: {
                phase,
                completedFiles: 0,
                totalFiles: 1,
                currentPath: 'windows.iso',
                transferredBytes: 0,
                totalBytes: 200,
              },
            },
          })
        )
      )

      const buttons = getCommitProgressButtons(component)
      assert.deepEqual(
        buttons.map(button => button.props.children),
        ['Cancel'],
        `unexpected manual fallback in ${phase}`
      )
    }
  })

  it('keeps browser fallback off for OCI publishing', () => {
    for (const selectedStorageProvider of ['ghcr', 'docker-hub'] as const) {
      const component = toTestInstance(
        new CommitMessage(
          createProps({
            isCommitting: true,
            isGeneratingCommitMessage: false,
            commitOperationPhase: {
              kind: 'cheap-lfs',
              progress: {
                phase: 'uploading',
                selectedStorageProvider,
                completedFiles: 0,
                totalFiles: 1,
                currentPath: 'windows.iso',
                transferredBytes: 100,
                totalBytes: 200,
              },
            },
          })
        )
      )

      assert.deepEqual(
        getCommitProgressButtons(component).map(
          button => button.props.children
        ),
        ['Cancel']
      )
    }
  })

  it('provides Hong Kong Cantonese copy for manual upload controls', () => {
    assert.equal(translate('cheapLfs.manualUpload', 'cantonese'), '手動上載')
    assert.equal(translate('cheapLfs.cancel', 'cantonese'), '取消')
    assert.equal(
      translate('cheapLfs.progress.manualWaiting', 'cantonese'),
      '喺 GitHub 上載晒準備好嘅檔案，跟住撳儲存 Release'
    )
    assert.equal(
      translate('cheapLfs.manualUpload', 'bilingual'),
      'Manual upload · 手動上載'
    )
  })

  it('uses amend-aware cheap-LFS progress and pointer wording', () => {
    const amendingUpload = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitToAmend: {} as CommitMessageProps['commitToAmend'],
          commitOperationPhase: {
            kind: 'cheap-lfs',
            progress: {
              phase: 'uploading',
              completedFiles: 0,
              totalFiles: 1,
              currentPath: 'windows.iso',
              transferredBytes: 100,
              totalBytes: 200,
            },
          },
        })
      )
    )
    assert.equal(
      amendingUpload.getButtonText(),
      'Uploading 1 large file to cheap LFS (50%) before amending'
    )

    const amendingPointer = toTestInstance(
      new CommitMessage(
        createProps({
          isCommitting: true,
          isGeneratingCommitMessage: false,
          commitToAmend: {} as CommitMessageProps['commitToAmend'],
          commitOperationPhase: {
            kind: 'git-commit',
            cheapLfsPointerCount: 1,
          },
        })
      )
    )
    assert.equal(
      amendingPointer.getButtonText(),
      'Amending last commit with 1 cheap-LFS pointer'
    )
  })

  it('announces the visible upload-to-verification transition', async () => {
    const uploadingProps = createProps({
      isCommitting: true,
      isGeneratingCommitMessage: false,
      commitOperationPhase: {
        kind: 'cheap-lfs',
        progress: {
          phase: 'uploading',
          completedFiles: 0,
          totalFiles: 1,
          currentPath: 'windows.iso',
          transferredBytes: 100,
          totalBytes: 200,
        },
      },
    })
    const verifyingProps = createProps({
      ...uploadingProps,
      commitOperationPhase: {
        kind: 'cheap-lfs',
        progress: {
          phase: 'verifying',
          completedFiles: 0,
          totalFiles: 1,
          currentPath: 'windows.iso',
          transferredBytes: 200,
          totalBytes: 200,
        },
      },
    })
    const component = new CommitMessage(
      uploadingProps
    ) as unknown as CommitMessageLifecycleTestInstance
    const previousState = component.state

    component.props = verifyingProps
    component.setState = state => Object.assign(component.state, state)
    component.updateRepoRuleFailures = async () => undefined

    await component.componentDidUpdate(uploadingProps, previousState)

    assert.equal(
      component.state.isCommittingStatusMessage,
      'Verifying 1 large file for cheap LFS'
    )
  })

  it('does not allow cancelling commit message generation when the Copilot SDK is disabled', async () => {
    delete process.env[PreviewFeaturesEnv]

    let cancelCount = 0
    const component = toTestInstance(
      new CommitMessage(
        createProps({
          onCancelGenerateCommitMessage: () => {
            cancelCount++
          },
        })
      )
    )

    const buttonProps = getCopilotButtonProps(component)

    assert.equal(buttonProps.ariaLabel, 'Generating commit details…')
    assert.equal(buttonProps.disabled, true)

    await clickCopilotButton(component)

    assert.equal(cancelCount, 0)
  })

  it('allows cancelling commit message generation when the Copilot SDK is enabled', async () => {
    process.env[PreviewFeaturesEnv] = '1'

    let cancelCount = 0
    const component = toTestInstance(
      new CommitMessage(
        createProps({
          onCancelGenerateCommitMessage: () => {
            cancelCount++
          },
        })
      )
    )

    const buttonProps = getCopilotButtonProps(component)

    assert.equal(buttonProps.ariaLabel, 'Cancel generating commit details')
    assert.equal(buttonProps.disabled, false)

    await clickCopilotButton(component)

    assert.equal(cancelCount, 1)
  })
})
