import * as React from 'react'
import classNames from 'classnames'

import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import {
  INotificationAutomationRule,
  NotificationAutomationAction,
  SAFE_NOTIFICATION_ARG,
  validateCommandTemplate,
  validateWebhookUrl,
} from '../../lib/notifications/automation/notification-automation'
import {
  INotificationEntry,
  NotificationCentreKind,
} from '../../models/notification-centre'
import { CloningRepository } from '../../models/cloning-repository'
import { Repository } from '../../models/repository'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { FilterModeControl } from '../lib/filter-mode-control'
import { RegexBuilder } from '../lib/regex-builder/regex-builder'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** Human-readable label for each notification kind, shown in the trigger picker. */
const kindLabels: Readonly<Record<NotificationCentreKind, string>> = {
  'pr-review-submit': 'Pull request reviews',
  'pr-comment': 'Pull request comments',
  'pr-checks-failed': 'Failed checks',
  'app-error': 'Errors',
  'clone-batch': 'Clones',
  'auto-commit': 'Automatic commits',
  'merge-all': 'Merge all',
  'auto-pull': 'Automatic pulls',
  'cheap-lfs': 'Large files',
  info: 'Information',
}

const allKinds = Object.keys(
  kindLabels
) as ReadonlyArray<NotificationCentreKind>

/** The placeholders a template may reference, shown in the body/legend copy. */
const templatePlaceholders = [
  '{title}',
  '{body}',
  '{kind}',
  '{repositoryId}',
  '{createdAt}',
] as const

type AutomationActionType = 'webhook' | 'command'
type TriggerKindMode = 'all' | 'selected'

/**
 * The editable form state for a single rule. Kept separate from
 * {@link INotificationAutomationRule} so partially-entered, not-yet-valid input
 * (an empty title pattern, a half-typed URL) can live in the UI without ever
 * being coerced into a persisted rule.
 */
interface IRuleDraft {
  readonly id: string
  readonly isNew: boolean
  readonly name: string
  readonly kindMode: TriggerKindMode
  readonly kinds: ReadonlySet<NotificationCentreKind>
  /** `null` means "any repository". */
  readonly repositoryId: number | null
  readonly titlePattern: string
  readonly actionType: AutomationActionType
  readonly url: string
  readonly bodyTemplate: string
  readonly exe: string
  readonly argTemplates: ReadonlyArray<string>
}

interface INotificationAutomationsDialogProps {
  readonly dispatcher: Dispatcher
  /** The notification the builder was opened from; seeds the repository scope. */
  readonly entry?: INotificationEntry
  readonly repositories: ReadonlyArray<Repository | CloningRepository>
  readonly onDismissed: () => void
}

interface INotificationAutomationsDialogState {
  readonly rules: ReadonlyArray<INotificationAutomationRule>
  readonly loading: boolean
  readonly query: string
  readonly queryMode: FilterMode
  readonly queryCaseSensitive: boolean
  readonly draft: IRuleDraft | null
  readonly error: string | null
  readonly regexBuilderOpen: boolean
}

/** Build a blank draft, defaulting the repository scope to the opening entry. */
function newDraft(entry?: INotificationEntry): IRuleDraft {
  return {
    id: crypto.randomUUID(),
    isNew: true,
    name: '',
    kindMode: 'all',
    kinds: new Set<NotificationCentreKind>(),
    repositoryId: entry?.repositoryId ?? null,
    titlePattern: '',
    actionType: 'webhook',
    url: '',
    bodyTemplate:
      '{\n  "title": "{title}",\n  "kind": "{kind}",\n  "body": "{body}"\n}',
    exe: '',
    argTemplates: [''],
  }
}

/** Load an existing rule into an editable draft. */
function draftFromRule(rule: INotificationAutomationRule): IRuleDraft {
  const webhook = rule.action.type === 'webhook' ? rule.action : null
  const command = rule.action.type === 'command' ? rule.action : null
  return {
    id: rule.id,
    isNew: false,
    name: rule.name,
    kindMode: rule.kinds === 'all' ? 'all' : 'selected',
    kinds:
      rule.kinds === 'all'
        ? new Set<NotificationCentreKind>()
        : new Set(rule.kinds),
    repositoryId: rule.repositoryId ?? null,
    titlePattern: rule.titlePattern ?? '',
    actionType: rule.action.type,
    url: webhook?.url ?? '',
    bodyTemplate: webhook?.bodyTemplate ?? '',
    exe: command?.exe ?? '',
    argTemplates:
      command !== null && command.argTemplates.length > 0
        ? [...command.argTemplates]
        : [''],
  }
}

/**
 * The notification-automation builder. Reachable only from a notification row's
 * context menu, it lists the saved rules (each armable per-session behind a
 * deliberate toggle) and hosts the editor for a single rule.
 *
 * SAFETY: every rule loads and saves disarmed. Arming is an explicit toggle that
 * dispatches {@link Dispatcher.setNotificationAutomationRuleEnabled}; a restored,
 * synced or imported rule is re-clamped to disabled on load and must be re-armed
 * here before it can run a webhook or command.
 */
export class NotificationAutomationsDialog extends React.Component<
  INotificationAutomationsDialogProps,
  INotificationAutomationsDialogState
> {
  private mounted = false

  public constructor(props: INotificationAutomationsDialogProps) {
    super(props)
    this.state = {
      rules: [],
      loading: true,
      query: '',
      queryMode: FilterMode.Fuzzy,
      queryCaseSensitive: false,
      draft: null,
      error: null,
      regexBuilderOpen: false,
    }
  }

  public componentDidMount() {
    this.mounted = true
    void this.reloadRules()
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private async reloadRules() {
    const rules = await this.props.dispatcher.getNotificationAutomationRules()
    if (this.mounted) {
      this.setState({ rules, loading: false })
    }
  }

  private get visibleRules(): ReadonlyArray<INotificationAutomationRule> {
    const query = this.state.query.trim()
    if (query.length === 0) {
      return this.state.rules
    }
    const { results } = matchWithMode(
      query,
      this.state.rules,
      rule => [rule.name],
      {
        mode: this.state.queryMode,
        caseSensitive: this.state.queryCaseSensitive,
      }
    )
    return results.map(match => match.item)
  }

  private onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ query: event.currentTarget.value })
  }

  private onQueryModeChange = (queryMode: FilterMode) => {
    this.setState({ queryMode })
  }

  private onQueryCaseSensitiveChange = (queryCaseSensitive: boolean) => {
    this.setState({ queryCaseSensitive })
  }

  private onQueryPatternApply = (query: string) => {
    this.setState({ query })
  }

  private getRuleSampleItems = (): ReadonlyArray<string> =>
    this.state.rules.slice(0, 50).map(rule => rule.name)

  private onNewRule = () => {
    this.setState({
      draft: newDraft(this.props.entry),
      error: null,
      regexBuilderOpen: false,
    })
  }

  private onEditRule = (rule: INotificationAutomationRule) => {
    this.setState({
      draft: draftFromRule(rule),
      error: null,
      regexBuilderOpen: false,
    })
  }

  private onCancelEdit = () => {
    this.setState({ draft: null, error: null, regexBuilderOpen: false })
  }

  private onToggleRuleEnabled = (
    rule: INotificationAutomationRule,
    enabled: boolean
  ) => {
    // Reflect the arm/disarm optimistically; the store persists it for this
    // session but re-clamps to disabled on the next load (untrusted-on-load).
    this.setState(state => ({
      rules: state.rules.map(r => (r.id === rule.id ? { ...r, enabled } : r)),
    }))
    void this.props.dispatcher.setNotificationAutomationRuleEnabled(
      rule.id,
      enabled
    )
  }

  private onRemoveRule = (rule: INotificationAutomationRule) => {
    void this.props.dispatcher
      .removeNotificationAutomationRule(rule.id)
      .then(() => this.reloadRules())
    if (this.state.draft?.id === rule.id) {
      this.setState({ draft: null, error: null })
    }
  }

  private updateDraft(patch: Partial<IRuleDraft>) {
    this.setState(state =>
      state.draft === null
        ? null
        : { draft: { ...state.draft, ...patch }, error: null }
    )
  }

  private onNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.updateDraft({ name: event.currentTarget.value })
  }

  private onKindModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.updateDraft({
      kindMode: event.currentTarget.value as TriggerKindMode,
    })
  }

  private onKindToggle = (kind: NotificationCentreKind, checked: boolean) => {
    this.setState(state => {
      if (state.draft === null) {
        return null
      }
      const kinds = new Set(state.draft.kinds)
      if (checked) {
        kinds.add(kind)
      } else {
        kinds.delete(kind)
      }
      return { draft: { ...state.draft, kinds }, error: null }
    })
  }

  private onRepositoryChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.currentTarget.value
    this.updateDraft({ repositoryId: value === '' ? null : Number(value) })
  }

  private onTitlePatternChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.updateDraft({ titlePattern: event.currentTarget.value })
  }

  private onActionTypeChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.updateDraft({
      actionType: event.currentTarget.value as AutomationActionType,
    })
  }

  private onUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.updateDraft({ url: event.currentTarget.value })
  }

  private onBodyTemplateChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.updateDraft({ bodyTemplate: event.currentTarget.value })
  }

  private onExeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.updateDraft({ exe: event.currentTarget.value })
  }

  private onArgChange = (index: number, value: string) => {
    this.setState(state => {
      if (state.draft === null) {
        return null
      }
      const argTemplates = state.draft.argTemplates.map((arg, i) =>
        i === index ? value : arg
      )
      return { draft: { ...state.draft, argTemplates }, error: null }
    })
  }

  private onAddArg = () => {
    this.setState(state =>
      state.draft === null
        ? null
        : {
            draft: {
              ...state.draft,
              argTemplates: [...state.draft.argTemplates, ''],
            },
          }
    )
  }

  private onRemoveArg = (index: number) => {
    this.setState(state => {
      if (state.draft === null) {
        return null
      }
      const argTemplates = state.draft.argTemplates.filter(
        (_, i) => i !== index
      )
      return {
        draft: {
          ...state.draft,
          argTemplates: argTemplates.length > 0 ? argTemplates : [''],
        },
      }
    })
  }

  private onOpenRegexBuilder = () => this.setState({ regexBuilderOpen: true })
  private onCloseRegexBuilder = () => this.setState({ regexBuilderOpen: false })

  private onApplyTitlePattern = (pattern: string) => {
    this.updateDraft({ titlePattern: pattern })
    this.setState({ regexBuilderOpen: false })
  }

  private onSubmit = () => {
    if (this.state.draft !== null) {
      void this.saveDraft(this.state.draft)
    }
  }

  private async saveDraft(draft: IRuleDraft) {
    const name = draft.name.trim()
    if (name.length === 0) {
      this.setState({ error: 'Enter a name for this automation.' })
      return
    }
    if (draft.kindMode === 'selected' && draft.kinds.size === 0) {
      this.setState({
        error: 'Choose at least one notification kind, or match all kinds.',
      })
      return
    }

    let action: NotificationAutomationAction
    if (draft.actionType === 'webhook') {
      const urlError = validateWebhookUrl(draft.url.trim())
      if (urlError !== null) {
        this.setState({ error: urlError })
        return
      }
      action = {
        type: 'webhook',
        url: draft.url.trim(),
        bodyTemplate: draft.bodyTemplate,
      }
    } else {
      const argTemplates = draft.argTemplates
        .map(arg => arg.trim())
        .filter(arg => arg.length > 0)
      const commandError = validateCommandTemplate(
        draft.exe.trim(),
        argTemplates
      )
      if (commandError !== null) {
        this.setState({ error: commandError })
        return
      }
      action = { type: 'command', exe: draft.exe.trim(), argTemplates }
    }

    const rule: INotificationAutomationRule = {
      id: draft.id,
      name,
      // Saved rules are always disarmed; arming is a deliberate per-session act.
      enabled: false,
      kinds: draft.kindMode === 'all' ? 'all' : [...draft.kinds],
      action,
      ...(draft.repositoryId !== null
        ? { repositoryId: draft.repositoryId }
        : {}),
      ...(draft.titlePattern.trim().length > 0
        ? { titlePattern: draft.titlePattern }
        : {}),
    }

    await this.props.dispatcher.saveNotificationAutomationRule(rule)
    await this.reloadRules()
    if (this.mounted) {
      this.setState({ draft: null, error: null, regexBuilderOpen: false })
    }
  }

  private renderSafetyBanner() {
    return (
      <div className="notification-automations-safety" role="note">
        <Octicon symbol={octicons.shield} />
        <div>
          <strong>Automations never fire until you arm them.</strong>
          <p>
            Arming is per-session: a rule restored, synced, or imported loads
            disabled and must be re-armed here. Commands run without a shell and
            webhooks post server-side with redirects and credentials restricted.
          </p>
        </div>
      </div>
    )
  }

  private renderRuleSummary(rule: INotificationAutomationRule): string {
    const trigger = rule.kinds === 'all' ? 'any kind' : rule.kinds.join(', ')
    const action =
      rule.action.type === 'webhook'
        ? `webhook → ${rule.action.url}`
        : `command → ${rule.action.exe}`
    return `${trigger} · ${action}`
  }

  private renderRulesList() {
    if (this.state.loading) {
      return (
        <div className="notification-automations-empty" role="status">
          <Octicon symbol={octicons.sync} />
          <span>Loading automations…</span>
        </div>
      )
    }

    const rules = this.visibleRules
    return (
      <div className="notification-automations-list-section">
        <div className="notification-automations-filter-bar">
          <label className="notification-automations-search">
            <span>Search</span>
            <input
              type="search"
              value={this.state.query}
              aria-label="Search automations by name"
              placeholder="Automation name"
              onChange={this.onQueryChange}
            />
          </label>
          <FilterModeControl
            mode={this.state.queryMode}
            caseSensitive={this.state.queryCaseSensitive}
            onModeChange={this.onQueryModeChange}
            onCaseSensitiveChange={this.onQueryCaseSensitiveChange}
            regexBuilderTarget="Automations"
            getSampleItems={this.getRuleSampleItems}
            filterText={this.state.query}
            onRegexPatternApply={this.onQueryPatternApply}
          />
        </div>
        {rules.length === 0 ? (
          <div className="notification-automations-empty">
            <Octicon symbol={octicons.workflow} />
            <span>
              {this.state.rules.length === 0
                ? 'No automations yet. Create one to react to notifications.'
                : 'No automations match this search.'}
            </span>
          </div>
        ) : (
          <ul className="notification-automations-list">
            {rules.map(rule => this.renderRuleRow(rule))}
          </ul>
        )}
        <div className="notification-automations-list-actions">
          <Button type="button" onClick={this.onNewRule}>
            New automation…
          </Button>
        </div>
      </div>
    )
  }

  private renderRuleRow(rule: INotificationAutomationRule) {
    return (
      <li
        key={rule.id}
        className={classNames('notification-automation-row', {
          armed: rule.enabled,
        })}
      >
        <label className="notification-automation-arm">
          <input
            type="checkbox"
            role="switch"
            checked={rule.enabled}
            aria-label={
              rule.enabled
                ? `Disarm automation: ${rule.name}`
                : `Arm automation: ${rule.name}`
            }
            // eslint-disable-next-line react/jsx-no-bind
            onChange={event =>
              this.onToggleRuleEnabled(rule, event.currentTarget.checked)
            }
          />
        </label>
        <div className="notification-automation-body">
          <span className="notification-automation-name">{rule.name}</span>
          <span className="notification-automation-summary">
            {this.renderRuleSummary(rule)}
          </span>
          <span
            className={classNames('notification-automation-state', {
              armed: rule.enabled,
            })}
          >
            {rule.enabled ? (
              <>
                <Octicon symbol={octicons.alert} /> Armed — runs automatically
                when a matching notification arrives
              </>
            ) : (
              'Disabled'
            )}
          </span>
        </div>
        <div className="notification-automation-row-actions">
          {/* eslint-disable-next-line react/jsx-no-bind */}
          <Button type="button" onClick={() => this.onEditRule(rule)}>
            Edit
          </Button>
          {/* eslint-disable-next-line react/jsx-no-bind */}
          <Button type="button" onClick={() => this.onRemoveRule(rule)}>
            Remove
          </Button>
        </div>
      </li>
    )
  }

  private renderTrigger(draft: IRuleDraft) {
    return (
      <fieldset className="notification-automations-fieldset">
        <legend>Trigger</legend>
        <label className="notification-automations-field">
          <span>Notification kinds</span>
          <select value={draft.kindMode} onChange={this.onKindModeChange}>
            <option value="all">Any kind</option>
            <option value="selected">Only selected kinds</option>
          </select>
        </label>
        {draft.kindMode === 'selected' ? (
          <div
            className="notification-automations-kind-grid"
            role="group"
            aria-label="Notification kinds"
          >
            {allKinds.map(kind => (
              <label key={kind} className="notification-automations-kind">
                <input
                  type="checkbox"
                  checked={draft.kinds.has(kind)}
                  // eslint-disable-next-line react/jsx-no-bind
                  onChange={event =>
                    this.onKindToggle(kind, event.currentTarget.checked)
                  }
                />
                <span>{kindLabels[kind]}</span>
              </label>
            ))}
          </div>
        ) : null}
        <label className="notification-automations-field">
          <span>Repository</span>
          <select
            value={
              draft.repositoryId === null ? '' : String(draft.repositoryId)
            }
            aria-label="Repository scope"
            onChange={this.onRepositoryChange}
          >
            <option value="">Any repository</option>
            {this.props.repositories.map(repo => (
              <option key={repo.id} value={String(repo.id)}>
                {repo.name}
              </option>
            ))}
          </select>
        </label>
        <label className="notification-automations-field">
          <span>Title pattern (optional)</span>
          <div className="notification-automations-pattern-row">
            <input
              type="text"
              value={draft.titlePattern}
              placeholder="Substring or regular expression"
              aria-label="Title pattern"
              onChange={this.onTitlePatternChange}
            />
            <Button type="button" onClick={this.onOpenRegexBuilder}>
              Regex builder
            </Button>
          </div>
          <small>
            Matched as a regular expression; plain text also works as a
            substring.
          </small>
        </label>
      </fieldset>
    )
  }

  private renderWebhookAction(draft: IRuleDraft) {
    const urlError =
      draft.url.trim().length > 0 ? validateWebhookUrl(draft.url.trim()) : null
    return (
      <>
        <label className="notification-automations-field">
          <span>Webhook URL</span>
          <input
            type="text"
            value={draft.url}
            placeholder="https://example.com/hook"
            aria-label="Webhook URL"
            aria-invalid={urlError !== null}
            onChange={this.onUrlChange}
          />
          {urlError !== null ? (
            <small
              className="notification-automations-inline-error"
              role="alert"
            >
              {urlError}
            </small>
          ) : (
            <small>
              Notification content is sent only in the request body, never in
              the URL.
            </small>
          )}
        </label>
        <label className="notification-automations-field">
          <span>Body template</span>
          <textarea
            value={draft.bodyTemplate}
            rows={5}
            aria-label="Webhook body template"
            onChange={this.onBodyTemplateChange}
          />
          <small className="notification-automations-legend">
            Placeholders:{' '}
            {templatePlaceholders.map((token, index) => (
              <React.Fragment key={token}>
                {index > 0 ? ' ' : ''}
                <code>{token}</code>
              </React.Fragment>
            ))}
          </small>
        </label>
      </>
    )
  }

  private renderCommandAction(draft: IRuleDraft) {
    return (
      <>
        <label className="notification-automations-field">
          <span>Executable</span>
          <input
            type="text"
            value={draft.exe}
            placeholder="notify-send"
            aria-label="Command executable"
            onChange={this.onExeChange}
          />
        </label>
        <div
          className="notification-automations-args"
          role="group"
          aria-label="Command arguments"
        >
          <span className="notification-automations-args-label">Arguments</span>
          {draft.argTemplates.map((arg, index) => (
            <div key={index} className="notification-automations-arg-row">
              <input
                type="text"
                value={arg}
                aria-label={`Argument ${index + 1}`}
                placeholder="--title={title}"
                // eslint-disable-next-line react/jsx-no-bind
                onChange={event =>
                  this.onArgChange(index, event.currentTarget.value)
                }
              />
              {/* eslint-disable-next-line react/jsx-no-bind */}
              <Button type="button" onClick={() => this.onRemoveArg(index)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" onClick={this.onAddArg}>
            Add argument
          </Button>
          <small>
            Arguments allow letters, numbers and{' '}
            <code>{String(SAFE_NOTIFICATION_ARG.source)}</code> plus{' '}
            {templatePlaceholders.map((token, index) => (
              <React.Fragment key={token}>
                {index > 0 ? ' ' : ''}
                <code>{token}</code>
              </React.Fragment>
            ))}
            . A substituted value that contains any other character is refused
            at run time — never escaped or passed to a shell.
          </small>
        </div>
      </>
    )
  }

  private renderEditor(draft: IRuleDraft) {
    return (
      <div className="notification-automations-editor">
        <h2>{draft.isNew ? 'New automation' : 'Edit automation'}</h2>
        <label className="notification-automations-field">
          <span>Name</span>
          <input
            type="text"
            value={draft.name}
            autoFocus={true}
            aria-label="Automation name"
            onChange={this.onNameChange}
          />
        </label>
        {this.renderTrigger(draft)}
        <fieldset className="notification-automations-fieldset">
          <legend>Action</legend>
          <label className="notification-automations-field">
            <span>Type</span>
            <select value={draft.actionType} onChange={this.onActionTypeChange}>
              <option value="webhook">Webhook (HTTP POST)</option>
              <option value="command">Local command</option>
            </select>
          </label>
          {draft.actionType === 'webhook'
            ? this.renderWebhookAction(draft)
            : this.renderCommandAction(draft)}
        </fieldset>
        {this.state.regexBuilderOpen ? (
          <RegexBuilder
            targetLabel="notification titles"
            initialPattern={draft.titlePattern}
            sampleItems={this.props.entry ? [this.props.entry.title] : []}
            onApply={this.onApplyTitlePattern}
            onDismissed={this.onCloseRegexBuilder}
          />
        ) : null}
      </div>
    )
  }

  public render() {
    const { draft } = this.state
    return (
      <Dialog
        id="notification-automations"
        className="notification-automations-dialog"
        title={
          __DARWIN__ ? 'Notification Automations' : 'Notification automations'
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        {this.state.error !== null ? (
          <DialogError>{this.state.error}</DialogError>
        ) : null}
        <DialogContent className="notification-automations-content">
          {this.renderSafetyBanner()}
          {this.renderRulesList()}
          {draft !== null ? this.renderEditor(draft) : null}
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            {draft !== null ? (
              <>
                <Button type="button" onClick={this.onCancelEdit}>
                  Cancel
                </Button>
                <Button type="submit">
                  {draft.isNew ? 'Create automation' : 'Save automation'}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={this.props.onDismissed}>
                Done
              </Button>
            )}
          </div>
        </DialogFooter>
      </Dialog>
    )
  }
}
