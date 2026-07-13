import * as React from 'react'
import { IActionsBranchRuleList } from '../../lib/actions-branch-rules'
import {
  ActionsBranchRulesError,
  ActionsStore,
  getActionsRepositoryKey,
} from '../../lib/stores/actions-store'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'

interface IBranchRulesProps {
  readonly repository: Repository
  readonly currentBranch: string | null
  readonly actionsStore: ActionsStore
}

type BranchRulesStatus = 'idle' | 'loading' | 'loaded' | 'error'

interface IBranchRulesState {
  readonly open: boolean
  readonly status: BranchRulesStatus
  readonly result: IActionsBranchRuleList | null
  readonly error: Error | null
  readonly message: string | null
}

const initialState = (open: boolean = false): IBranchRulesState => ({
  open,
  status: 'idle',
  result: null,
  error: null,
  message: null,
})

function scopeKey(props: IBranchRulesProps): string {
  return `${getActionsRepositoryKey(props.repository)}#branch:${
    props.currentBranch ?? 'detached'
  }`
}

function errorStateLabel(error: Error): string {
  if (!(error instanceof ActionsBranchRulesError)) {
    return 'Unavailable'
  }
  switch (error.kind) {
    case 'authentication':
      return 'Sign-in required'
    case 'permission':
      return 'Permission required'
    case 'unsupported':
      return 'Unsupported provider'
    case 'rate-limit':
      return 'Rate limited'
    case 'not-found':
      return 'Not found'
    case 'service':
      return 'Provider error'
    case 'invalid-response':
      return 'Invalid response'
  }
}

export class BranchRules extends React.Component<
  IBranchRulesProps,
  IBranchRulesState
> {
  private controller: AbortController | null = null
  private generation = 0

  public constructor(props: IBranchRulesProps) {
    super(props)
    this.state = initialState()
  }

  public componentDidUpdate(prevProps: IBranchRulesProps) {
    if (scopeKey(prevProps) !== scopeKey(this.props)) {
      const open = this.state.open
      this.cancelActiveRequest()
      this.setState(initialState(open), () => {
        if (open && this.props.currentBranch !== null) {
          this.loadRules()
        }
      })
    }
  }

  public componentWillUnmount() {
    this.cancelActiveRequest()
  }

  private cancelActiveRequest() {
    this.generation++
    this.controller?.abort()
    this.controller = null
  }

  private toggle = () => {
    if (this.state.open) {
      this.cancelActiveRequest()
      this.setState(initialState())
      return
    }
    this.setState(initialState(true), () => {
      if (this.props.currentBranch !== null) {
        this.loadRules()
      }
    })
  }

  private loadRules = () => {
    const branch = this.props.currentBranch
    if (branch === null) {
      return
    }

    this.cancelActiveRequest()
    const controller = new AbortController()
    const generation = ++this.generation
    const requestScope = scopeKey(this.props)
    this.controller = controller
    this.setState({
      status: 'loading',
      result: null,
      error: null,
      message: null,
    })

    void this.props.actionsStore
      .fetchBranchRules(this.props.repository, branch, controller.signal)
      .then(result => {
        if (this.isCurrent(controller, generation, requestScope)) {
          this.setState({ status: 'loaded', result, error: null })
        }
      })
      .catch(error => {
        if (!this.isCurrent(controller, generation, requestScope)) {
          return
        }
        if ((error as Error)?.name === 'AbortError') {
          this.setState({
            status: 'idle',
            message: 'Branch rule request canceled.',
          })
        } else {
          this.setState({
            status: 'error',
            result: null,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      })
      .finally(() => {
        if (this.controller === controller) {
          this.controller = null
        }
      })
  }

  private isCurrent(
    controller: AbortController,
    generation: number,
    requestScope: string
  ): boolean {
    return (
      this.controller === controller &&
      this.generation === generation &&
      requestScope === scopeKey(this.props)
    )
  }

  private cancelLoad = () => {
    this.cancelActiveRequest()
    this.setState({
      status: 'idle',
      message: 'Branch rule request canceled.',
    })
  }

  private renderContent() {
    const branch = this.props.currentBranch
    if (!this.state.open) {
      return null
    }
    if (branch === null) {
      return (
        <p className="actions-branch-rules-note" role="status">
          Check out a local branch to inspect its effective rules.
        </p>
      )
    }
    if (this.state.status === 'loading') {
      return (
        <div className="actions-branch-rules-progress" role="status">
          <span>Inspecting effective rules…</span>
          <Button size="small" onClick={this.cancelLoad}>
            Cancel inspection
          </Button>
        </div>
      )
    }
    if (this.state.status === 'error' && this.state.error !== null) {
      return (
        <div className="actions-branch-rules-error" role="alert">
          <span className="actions-branch-rules-state">
            {errorStateLabel(this.state.error)}
          </span>
          <p>{this.state.error.message}</p>
          <Button size="small" onClick={this.loadRules}>
            Retry inspection
          </Button>
        </div>
      )
    }
    if (this.state.result !== null) {
      const { rules, capped } = this.state.result
      return (
        <div className="actions-branch-rules-result">
          <p role="status">
            {rules.length === 0
              ? 'No active rules were returned for this branch.'
              : `${rules.length} active ${
                  rules.length === 1 ? 'rule applies' : 'rules apply'
                } to this branch.`}
            {capped
              ? ' The 500-record application safety limit was reached.'
              : ''}
          </p>
          {rules.length > 0 && (
            <ul aria-label={`Effective rules for ${branch}`}>
              {rules.map((rule, index) => (
                <li key={`${rule.rulesetId}:${rule.type}:${index}`}>
                  <div>
                    <strong>{rule.label}</strong>
                    <span>{rule.description}</span>
                  </div>
                  <small>
                    Ruleset #{rule.rulesetId}
                    {rule.sourceType !== null ? ` · ${rule.sourceType}` : ''}
                    {rule.source !== null ? ` · ${rule.source}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }
    return this.state.message === null ? null : (
      <p className="actions-branch-rules-note" role="status">
        {this.state.message}
      </p>
    )
  }

  public render() {
    return (
      <section
        className="actions-branch-rules"
        aria-labelledby="actions-branch-rules-heading"
      >
        <header>
          <div>
            <span className="eyebrow">Repository policy</span>
            <h2 id="actions-branch-rules-heading">Effective branch rules</h2>
            <p>
              Current branch:{' '}
              {this.props.currentBranch === null ? (
                <span>Detached HEAD</span>
              ) : (
                <code>{this.props.currentBranch}</code>
              )}
            </p>
          </div>
          <Button size="small" onClick={this.toggle}>
            {this.state.open ? 'Hide rules' : 'Inspect rules'}
          </Button>
        </header>
        {this.renderContent()}
      </section>
    )
  }
}
