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

const PreviewFeaturesEnv = 'GITHUB_DESKTOP_PREVIEW_FEATURES'
const previousPreviewFeatures = process.env[PreviewFeaturesEnv]

type CommitMessageProps = React.ComponentProps<typeof CommitMessage>
type CopilotButtonProps = {
  readonly ariaLabel?: string
  readonly disabled?: boolean
}

type CommitMessageTestInstance = {
  readonly renderCopilotButton: () => React.ReactElement | null
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
              phase: 'uploading',
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
          phase: 'uploading',
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
