import * as React from 'react'
import { Branch, BranchType } from '../../models/branch'
import { Repository } from '../../models/repository'
import {
  IReviewedBranchDeletion,
  IReviewedBranchDeletionResult,
  MaximumReviewedBranchDeletions,
} from '../../lib/git'
import { Button } from '../lib/button'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { LocalizedText } from '../lib/localized-text'

interface ILocalizedMessage {
  readonly key: TranslationKey
  readonly variables?: TranslationVariables
}

class ReviewedBranchListChangedError extends Error {}

interface IBulkBranchDeleteDispatcher {
  readonly deleteReviewedBranches: (
    repository: Repository,
    reviewed: ReadonlyArray<IReviewedBranchDeletion>
  ) => Promise<ReadonlyArray<IReviewedBranchDeletionResult>>
}

interface IBulkBranchDeleteProps {
  readonly repository: Repository
  readonly allBranches: ReadonlyArray<Branch>
  readonly currentBranch: Branch | null
  readonly defaultBranch: Branch | null
  readonly dispatcher: IBulkBranchDeleteDispatcher
}

interface IBulkBranchDeleteState {
  readonly expanded: boolean
  readonly reviewedNames: ReadonlySet<string>
  readonly confirming: boolean
  readonly busy: boolean
  readonly results: ReadonlyArray<IReviewedBranchDeletionResult>
  readonly error: ILocalizedMessage | string | null
  readonly languageMode: LanguageMode
}

export class BulkBranchDelete extends React.Component<
  IBulkBranchDeleteProps,
  IBulkBranchDeleteState
> {
  public constructor(props: IBulkBranchDeleteProps) {
    super(props)
    this.state = {
      expanded: false,
      reviewedNames: new Set(),
      confirming: false,
      busy: false,
      results: [],
      error: null,
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount(): void {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount(): void {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private accessibleText(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translateForAccessibleName(key, variables, this.state.languageMode)
  }

  private renderMessage(message: ILocalizedMessage): JSX.Element {
    return (
      <LocalizedText
        translationKey={message.key}
        variables={message.variables}
        languageMode={this.state.languageMode}
      />
    )
  }

  public componentDidUpdate(prevProps: IBulkBranchDeleteProps): void {
    if (
      prevProps.repository.id !== this.props.repository.id ||
      prevProps.allBranches !== this.props.allBranches
    ) {
      const candidates = new Set(this.candidates.map(branch => branch.name))
      this.setState(state => ({
        reviewedNames: new Set(
          [...state.reviewedNames].filter(name => candidates.has(name))
        ),
        confirming: false,
      }))
    }
  }

  private get candidates(): ReadonlyArray<Branch> {
    return this.props.allBranches.filter(
      branch =>
        branch.type === BranchType.Local &&
        branch.name !== this.props.currentBranch?.name &&
        branch.name !== this.props.defaultBranch?.name
    )
  }

  private toggleExpanded = () =>
    this.setState(state => ({
      expanded: !state.expanded,
      confirming: false,
      error: null,
    }))

  private onReviewedChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const name = event.currentTarget.dataset.branchName
    if (name === undefined) {
      return
    }
    const reviewedNames = new Set(this.state.reviewedNames)
    if (event.currentTarget.checked) {
      if (reviewedNames.size >= MaximumReviewedBranchDeletions) {
        this.setState({
          error: {
            key: 'bulkBranchDelete.limitError',
            variables: { count: String(MaximumReviewedBranchDeletions) },
          },
        })
        return
      }
      reviewedNames.add(name)
    } else {
      reviewedNames.delete(name)
    }
    this.setState({ reviewedNames, confirming: false, error: null })
  }

  private selectAll = () =>
    this.setState({
      reviewedNames: new Set(
        this.candidates
          .slice(0, MaximumReviewedBranchDeletions)
          .map(branch => branch.name)
      ),
      confirming: false,
      error: null,
    })

  private selectNone = () =>
    this.setState({
      reviewedNames: new Set(),
      confirming: false,
      error: null,
    })

  private requestConfirmation = () =>
    this.setState({ confirming: true, error: null })
  private cancelConfirmation = () => this.setState({ confirming: false })

  private confirmDelete = async () => {
    try {
      const candidates = new Map(
        this.candidates.map(branch => [branch.name, branch] as const)
      )
      const reviewed = [...this.state.reviewedNames].map(name => {
        const branch = candidates.get(name)
        if (branch === undefined) {
          throw new ReviewedBranchListChangedError()
        }
        return { name, expectedSha: branch.tip.sha }
      })
      this.setState({ busy: true, confirming: false, error: null, results: [] })
      const results = await this.props.dispatcher.deleteReviewedBranches(
        this.props.repository,
        reviewed
      )
      this.setState({
        busy: false,
        reviewedNames: new Set(),
        results,
      })
    } catch (error) {
      this.setState({
        busy: false,
        error:
          error instanceof ReviewedBranchListChangedError
            ? { key: 'bulkBranchDelete.reviewChangedError' }
            : error instanceof Error
            ? error.message
            : { key: 'bulkBranchDelete.deleteError' },
      })
    }
  }

  public render() {
    const count = this.state.reviewedNames.size
    const countVariables = { count: String(count) }
    return (
      <section
        className="bulk-branch-delete"
        aria-label={this.accessibleText('bulkBranchDelete.aria')}
      >
        <Button
          size="small"
          ariaExpanded={this.state.expanded}
          onClick={this.toggleExpanded}
        >
          <LocalizedText
            translationKey={
              this.state.expanded
                ? 'bulkBranchDelete.closeAction'
                : 'bulkBranchDelete.openAction'
            }
            languageMode={this.state.languageMode}
          />
        </Button>
        {this.state.expanded ? (
          <div className="bulk-branch-delete-panel">
            <header>
              <div>
                <strong>
                  <LocalizedText
                    translationKey="bulkBranchDelete.reviewTitle"
                    languageMode={this.state.languageMode}
                  />
                </strong>
                <span>
                  <LocalizedText
                    translationKey="bulkBranchDelete.protectedDescription"
                    languageMode={this.state.languageMode}
                  />
                </span>
              </div>
              <div>
                <Button size="small" onClick={this.selectAll}>
                  <LocalizedText
                    translationKey="bulkBranchDelete.selectAll"
                    languageMode={this.state.languageMode}
                  />
                </Button>
                <Button size="small" onClick={this.selectNone}>
                  <LocalizedText
                    translationKey="bulkBranchDelete.selectNone"
                    languageMode={this.state.languageMode}
                  />
                </Button>
              </div>
            </header>
            {this.candidates.length === 0 ? (
              <p>
                <LocalizedText
                  translationKey="bulkBranchDelete.empty"
                  languageMode={this.state.languageMode}
                />
              </p>
            ) : (
              <div
                className="bulk-branch-delete-list"
                role="group"
                aria-label={this.accessibleText('bulkBranchDelete.listAria')}
              >
                {this.candidates.map(branch => (
                  <label key={branch.name}>
                    <input
                      type="checkbox"
                      data-branch-name={branch.name}
                      checked={this.state.reviewedNames.has(branch.name)}
                      disabled={this.state.busy}
                      onChange={this.onReviewedChanged}
                    />
                    <span>{branch.name}</span>
                    <code>{branch.tip.sha.slice(0, 12)}</code>
                  </label>
                ))}
              </div>
            )}
            <Button
              className="destructive"
              disabled={count === 0 || this.state.busy}
              onClick={this.requestConfirmation}
            >
              <LocalizedText
                translationKey="bulkBranchDelete.reviewDeletion"
                variables={countVariables}
                languageMode={this.state.languageMode}
              />
            </Button>
            {this.state.confirming ? (
              <div
                className="bulk-branch-delete-confirmation"
                role="alertdialog"
              >
                <strong>
                  <LocalizedText
                    translationKey={
                      count === 1
                        ? 'bulkBranchDelete.confirmSingular'
                        : 'bulkBranchDelete.confirmPlural'
                    }
                    variables={countVariables}
                    languageMode={this.state.languageMode}
                  />
                </strong>
                <p>
                  <LocalizedText
                    translationKey="bulkBranchDelete.remoteUnaffected"
                    languageMode={this.state.languageMode}
                  />
                </p>
                <div>
                  <Button className="destructive" onClick={this.confirmDelete}>
                    <LocalizedText
                      translationKey="bulkBranchDelete.deleteReviewed"
                      languageMode={this.state.languageMode}
                    />
                  </Button>
                  <Button onClick={this.cancelConfirmation}>
                    <LocalizedText
                      translationKey="bulkBranchDelete.goBack"
                      languageMode={this.state.languageMode}
                    />
                  </Button>
                </div>
              </div>
            ) : null}
            {this.state.busy ? (
              <p role="status">
                <LocalizedText
                  translationKey="bulkBranchDelete.deleting"
                  languageMode={this.state.languageMode}
                />
              </p>
            ) : null}
            {this.state.error !== null ? (
              <p role="alert">
                {typeof this.state.error === 'string'
                  ? this.state.error
                  : this.renderMessage(this.state.error)}
              </p>
            ) : null}
            {this.state.results.length > 0 ? (
              <ul
                className="bulk-branch-delete-results"
                aria-label={this.accessibleText('bulkBranchDelete.resultsAria')}
              >
                {this.state.results.map(result => (
                  <li key={result.name} className={result.status}>
                    <strong>{result.name}</strong> — {result.detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    )
  }
}
