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
import { CommitMessage } from '../../../src/ui/changes/commit-message'
import { Button } from '../../../src/ui/lib/button'
import { translate } from '../../../src/lib/i18n'
import type { CheapLfsAutoPinPhase } from '../../../src/lib/cheap-lfs/operations'

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
