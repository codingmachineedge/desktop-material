/* eslint-disable react/jsx-no-bind -- inventory rows bind exact reviewed tag objects */
import * as React from 'react'
import {
  ICreateTagLifecycleOptions,
  ILocalTagLifecycleEntry,
  IRemoteTagDeletionReview,
  IRemoteTagLifecycleEntry,
  ITagLifecycleInventory,
  ITagRefReview,
  ITagPushReview,
  TagKind,
} from '../../lib/git'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translatedVariable,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { LocalizedText } from '../lib/localized-text'
import { FilterMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
  matchGroup,
} from '../lib/filter-list-mode'

const TagLifecycleFilterListId = 'tag-lifecycle-inventory'

export interface ITagLifecycleDispatcher {
  readonly getTagLifecycleInventory: (
    repository: Repository,
    includeRemote: boolean
  ) => Promise<ITagLifecycleInventory>
  readonly createLifecycleTag: (
    repository: Repository,
    options: ICreateTagLifecycleOptions
  ) => Promise<boolean>
  readonly moveLifecycleTag: (
    repository: Repository,
    options: ICreateTagLifecycleOptions & {
      readonly expectedRefObject: string
    }
  ) => Promise<boolean>
  readonly deleteReviewedLifecycleTag: (
    repository: Repository,
    review: ITagRefReview
  ) => Promise<boolean>
  readonly pushLifecycleTags: (
    repository: Repository,
    reviews: ReadonlyArray<ITagPushReview>
  ) => Promise<boolean>
  readonly fetchLifecycleTags: (
    repository: Repository,
    prune: boolean,
    reviewedLocalTags: ReadonlyArray<ITagRefReview>
  ) => Promise<boolean>
  readonly deleteRemoteLifecycleTag: (
    repository: Repository,
    review: IRemoteTagDeletionReview
  ) => Promise<boolean>
}

interface ITagLifecycleManagerProps {
  readonly repository: Repository
  readonly dispatcher: ITagLifecycleDispatcher
  readonly readOnly: boolean
  readonly onRefreshRepository: () => Promise<void>
}

type PendingAction =
  | {
      readonly kind: 'move'
      readonly options: ICreateTagLifecycleOptions & {
        readonly expectedRefObject: string
      }
    }
  | { readonly kind: 'delete-local'; readonly tag: ILocalTagLifecycleEntry }
  | {
      readonly kind: 'push-one'
      readonly tag: ILocalTagLifecycleEntry
      readonly review: ITagPushReview
    }
  | {
      readonly kind: 'push-all'
      readonly reviews: ReadonlyArray<ITagPushReview>
    }
  | {
      readonly kind: 'fetch-prune'
      readonly remoteName: string
      readonly tags: ReadonlyArray<ILocalTagLifecycleEntry>
    }
  | { readonly kind: 'delete-remote'; readonly tag: IRemoteTagLifecycleEntry }

interface ITagLifecycleManagerState {
  readonly inventory: ITagLifecycleInventory | null
  readonly loading: boolean
  readonly busy: boolean
  readonly error: ILocalizedMessage | string | null
  readonly status: ILocalizedMessage | null
  readonly filter: string
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
  readonly createName: string
  readonly createTarget: string
  readonly createKind: TagKind
  readonly createMessage: string
  readonly createSigned: boolean
  readonly movingTag: ILocalTagLifecycleEntry | null
  readonly moveTarget: string
  readonly moveKind: TagKind
  readonly moveMessage: string
  readonly moveSigned: boolean
  readonly pending: PendingAction | null
  readonly confirmationText: string
  readonly languageMode: LanguageMode
}

interface ILocalizedMessage {
  readonly key: TranslationKey
  readonly variables?: TranslationVariables
}

class TagOperationRejectedError extends Error {}

const emptyState: Omit<
  ITagLifecycleManagerState,
  'languageMode' | 'loading' | 'filterMode' | 'filterCaseSensitive'
> = {
  inventory: null,
  busy: false,
  error: null,
  status: null,
  filter: '',
  createName: '',
  createTarget: 'HEAD',
  createKind: 'annotated',
  createMessage: '',
  createSigned: false,
  movingTag: null,
  moveTarget: 'HEAD',
  moveKind: 'annotated',
  moveMessage: '',
  moveSigned: false,
  pending: null,
  confirmationText: '',
}

function shortObject(oid: string): string {
  return oid.slice(0, 10)
}

function errorMessage(error: unknown): ILocalizedMessage | string {
  return error instanceof TagOperationRejectedError
    ? { key: 'tagLifecycle.rejectedError' }
    : error instanceof Error
    ? error.message
    : { key: 'tagLifecycle.operationFailedError' }
}

/**
 * One task-focused surface for local and remote tag lifecycle operations.
 * Every mutation is a typed dispatcher call; no command or refspec is editable.
 */
export class TagLifecycleManager extends React.Component<
  ITagLifecycleManagerProps,
  ITagLifecycleManagerState
> {
  private mounted = false

  public constructor(props: ITagLifecycleManagerProps) {
    super(props)
    this.state = {
      ...emptyState,
      loading: true,
      filterMode: readPersistedFilterMode(TagLifecycleFilterListId),
      filterCaseSensitive: false,
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    this.mounted = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    void this.loadInventory(false)
  }

  public componentDidUpdate(prevProps: ITagLifecycleManagerProps) {
    if (prevProps.repository !== this.props.repository) {
      this.setState({ ...emptyState, loading: true }, () => {
        void this.loadInventory(false)
      })
    }
  }

  public componentWillUnmount() {
    this.mounted = false
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

  private text(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private localized(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): JSX.Element {
    return (
      <LocalizedText
        translationKey={key}
        variables={variables}
        languageMode={this.state.languageMode}
      />
    )
  }

  private renderMessage(message: ILocalizedMessage): JSX.Element {
    return this.localized(message.key, message.variables)
  }

  private loadInventory = async (includeRemote: boolean) => {
    if (this.state.busy) {
      return
    }
    this.setState({ loading: true, error: null })
    try {
      const inventory = await this.props.dispatcher.getTagLifecycleInventory(
        this.props.repository,
        includeRemote
      )
      if (this.mounted) {
        this.setState({ inventory, loading: false })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({ loading: false, error: errorMessage(error) })
      }
    }
  }

  private refreshAfterMutation = async (status: ILocalizedMessage) => {
    await this.props.onRefreshRepository()
    const includeRemote = this.state.inventory?.remote !== null
    const inventory = await this.props.dispatcher.getTagLifecycleInventory(
      this.props.repository,
      includeRemote
    )
    if (this.mounted) {
      this.setState({ inventory, status, error: null })
    }
  }

  private runMutation = async (
    operation: () => Promise<boolean | void>,
    successStatus: ILocalizedMessage
  ) => {
    if (this.state.busy || this.props.readOnly) {
      return
    }
    this.setState({ busy: true, error: null, status: null })
    try {
      const result = await operation()
      if (result === false) {
        throw new TagOperationRejectedError()
      }
      await this.refreshAfterMutation(successStatus)
    } catch (error) {
      if (this.mounted) {
        this.setState({ error: errorMessage(error) })
      }
    } finally {
      if (this.mounted) {
        this.setState({ busy: false, pending: null, confirmationText: '' })
      }
    }
  }

  private createTag = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const options: ICreateTagLifecycleOptions = {
      name: this.state.createName,
      target: this.state.createTarget,
      kind: this.state.createKind,
      message:
        this.state.createKind === 'annotated'
          ? this.state.createMessage
          : undefined,
      sign:
        this.state.createKind === 'annotated' ? this.state.createSigned : false,
    }
    void this.runMutation(
      () =>
        this.props.dispatcher.createLifecycleTag(
          this.props.repository,
          options
        ),
      {
        key: 'tagLifecycle.createdStatus',
        variables: { name: options.name },
      }
    ).then(() => {
      if (this.mounted && this.state.error === null) {
        this.setState({
          createName: '',
          createMessage: '',
          createSigned: false,
        })
      }
    })
  }

  private beginMove = (tag: ILocalTagLifecycleEntry) => {
    this.setState({
      movingTag: tag,
      moveTarget: tag.target,
      moveKind: tag.kind,
      moveMessage: tag.message,
      moveSigned: tag.signed,
      pending: null,
      confirmationText: '',
      error: null,
    })
  }

  private reviewMove = () => {
    const tag = this.state.movingTag
    if (tag === null) {
      return
    }
    this.setState({
      pending: {
        kind: 'move',
        options: {
          name: tag.name,
          target: this.state.moveTarget,
          kind: this.state.moveKind,
          message:
            this.state.moveKind === 'annotated'
              ? this.state.moveMessage
              : undefined,
          sign:
            this.state.moveKind === 'annotated' ? this.state.moveSigned : false,
          expectedRefObject: tag.refObject,
        },
      },
      confirmationText: '',
    })
  }

  private confirmationPhrase(pending: PendingAction): string {
    switch (pending.kind) {
      case 'move':
        return pending.options.name
      case 'delete-local':
      case 'delete-remote':
        return pending.tag.name
      case 'push-one':
        return 'PUSH'
      case 'push-all':
        return 'PUSH ALL'
      case 'fetch-prune':
        return 'PRUNE'
    }
  }

  private confirmationSummary(pending: PendingAction): ILocalizedMessage {
    switch (pending.kind) {
      case 'move':
        return {
          key: 'tagLifecycle.confirmMove',
          variables: {
            name: pending.options.name,
            target: pending.options.target,
            kind: translatedVariable(
              pending.options.kind === 'annotated'
                ? 'tagLifecycle.annotated'
                : 'tagLifecycle.lightweight'
            ),
          },
        }
      case 'delete-local':
        return {
          key: 'tagLifecycle.confirmDeleteLocal',
          variables: { name: pending.tag.name },
        }
      case 'push-one':
        return pending.review.expectedRemoteRefObject === null
          ? {
              key: 'tagLifecycle.confirmPushNew',
              variables: { name: pending.tag.name },
            }
          : {
              key: 'tagLifecycle.confirmPushReplace',
              variables: { name: pending.tag.name },
            }
      case 'push-all':
        return {
          key: 'tagLifecycle.confirmPushAll',
          variables: { count: String(pending.reviews.length) },
        }
      case 'fetch-prune':
        return {
          key: 'tagLifecycle.confirmFetchPrune',
          variables: { remote: pending.remoteName },
        }
      case 'delete-remote':
        return {
          key: 'tagLifecycle.confirmDeleteRemote',
          variables: {
            name: pending.tag.name,
            object: shortObject(pending.tag.refObject),
          },
        }
    }
  }

  private confirmPending = () => {
    const pending = this.state.pending
    if (
      pending === null ||
      this.state.confirmationText !== this.confirmationPhrase(pending)
    ) {
      return
    }

    switch (pending.kind) {
      case 'move':
        void this.runMutation(
          () =>
            this.props.dispatcher.moveLifecycleTag(
              this.props.repository,
              pending.options
            ),
          {
            key: 'tagLifecycle.movedStatus',
            variables: { name: pending.options.name },
          }
        ).then(() => {
          if (this.mounted && this.state.error === null) {
            this.setState({ movingTag: null })
          }
        })
        return
      case 'delete-local':
        void this.runMutation(
          () =>
            this.props.dispatcher.deleteReviewedLifecycleTag(
              this.props.repository,
              {
                name: pending.tag.name,
                expectedRefObject: pending.tag.refObject,
              }
            ),
          {
            key: 'tagLifecycle.deletedLocalStatus',
            variables: { name: pending.tag.name },
          }
        )
        return
      case 'push-one':
        void this.runMutation(
          () =>
            this.props.dispatcher.pushLifecycleTags(this.props.repository, [
              pending.review,
            ]),
          {
            key: 'tagLifecycle.pushedStatus',
            variables: { name: pending.tag.name },
          }
        )
        return
      case 'push-all':
        void this.runMutation(
          () =>
            this.props.dispatcher.pushLifecycleTags(
              this.props.repository,
              pending.reviews
            ),
          {
            key: 'tagLifecycle.pushedAllStatus',
            variables: { count: String(pending.reviews.length) },
          }
        )
        return
      case 'fetch-prune':
        void this.runMutation(
          () =>
            this.props.dispatcher.fetchLifecycleTags(
              this.props.repository,
              true,
              pending.tags.map(tag => ({
                name: tag.name,
                expectedRefObject: tag.refObject,
              }))
            ),
          {
            key: 'tagLifecycle.fetchedPrunedStatus',
            variables: { remote: pending.remoteName },
          }
        )
        return
      case 'delete-remote':
        void this.runMutation(
          () =>
            this.props.dispatcher.deleteRemoteLifecycleTag(
              this.props.repository,
              {
                name: pending.tag.name,
                expectedRefObject: pending.tag.refObject,
              }
            ),
          {
            key: 'tagLifecycle.deletedRemoteStatus',
            variables: { name: pending.tag.name },
          }
        )
        return
    }
  }

  private renderCreate() {
    const disabled = this.state.busy || this.props.readOnly
    return (
      <form className="tag-lifecycle-editor" onSubmit={this.createTag}>
        <h3>{this.localized('tagLifecycle.createHeading')}</h3>
        <div className="tag-lifecycle-form-grid">
          <label>
            {this.localized('tagLifecycle.nameLabel')}
            <input
              value={this.state.createName}
              maxLength={245}
              disabled={disabled}
              onChange={event =>
                this.setState({ createName: event.currentTarget.value })
              }
            />
          </label>
          <label>
            {this.localized('tagLifecycle.targetLabel')}
            <input
              value={this.state.createTarget}
              maxLength={512}
              disabled={disabled}
              placeholder={this.accessibleText(
                'tagLifecycle.targetPlaceholder'
              )}
              onChange={event =>
                this.setState({ createTarget: event.currentTarget.value })
              }
            />
          </label>
          <label>
            {this.localized('tagLifecycle.typeLabel')}
            <select
              value={this.state.createKind}
              disabled={disabled}
              onChange={event =>
                this.setState({
                  createKind: event.currentTarget.value as TagKind,
                })
              }
            >
              <option value="annotated">
                {this.text('tagLifecycle.annotated')}
              </option>
              <option value="lightweight">
                {this.text('tagLifecycle.lightweight')}
              </option>
            </select>
          </label>
        </div>
        {this.state.createKind === 'annotated' && (
          <>
            <label>
              {this.localized('tagLifecycle.messageLabel')}
              <textarea
                value={this.state.createMessage}
                maxLength={64 * 1024}
                rows={3}
                disabled={disabled}
                onChange={event =>
                  this.setState({ createMessage: event.currentTarget.value })
                }
              />
            </label>
            <label className="tag-lifecycle-check">
              <input
                type="checkbox"
                checked={this.state.createSigned}
                disabled={disabled}
                onChange={event =>
                  this.setState({ createSigned: event.currentTarget.checked })
                }
              />
              {this.localized('tagLifecycle.signConfigured', {
                format: this.state.inventory?.signingFormat ?? 'OpenPGP',
              })}
            </label>
            <p className="tag-lifecycle-signing-status">
              {this.state.inventory?.signingConfigured === true
                ? this.localized('tagLifecycle.signingConfigured')
                : this.localized('tagLifecycle.signingNotConfigured')}
            </p>
          </>
        )}
        <Button
          type="submit"
          disabled={
            disabled ||
            this.state.createName.trim().length === 0 ||
            this.state.createTarget.trim().length === 0
          }
        >
          {this.localized('tagLifecycle.createAction')}
        </Button>
      </form>
    )
  }

  private renderMove() {
    const tag = this.state.movingTag
    if (tag === null) {
      return null
    }
    const disabled = this.state.busy || this.props.readOnly
    return (
      <section
        className="tag-lifecycle-editor"
        aria-label={this.accessibleText('tagLifecycle.moveAria', {
          name: tag.name,
        })}
      >
        <h3>
          {this.localized('tagLifecycle.moveHeading', { name: tag.name })}
        </h3>
        <p>
          {this.localized('tagLifecycle.reviewedObject', {
            object: shortObject(tag.refObject),
          })}
        </p>
        <div className="tag-lifecycle-form-grid">
          <label>
            {this.localized('tagLifecycle.newTargetLabel')}
            <input
              value={this.state.moveTarget}
              maxLength={512}
              disabled={disabled}
              onChange={event =>
                this.setState({ moveTarget: event.currentTarget.value })
              }
            />
          </label>
          <label>
            {this.localized('tagLifecycle.recreatedTypeLabel')}
            <select
              value={this.state.moveKind}
              disabled={disabled}
              onChange={event =>
                this.setState({
                  moveKind: event.currentTarget.value as TagKind,
                })
              }
            >
              <option value="annotated">
                {this.text('tagLifecycle.annotated')}
              </option>
              <option value="lightweight">
                {this.text('tagLifecycle.lightweight')}
              </option>
            </select>
          </label>
        </div>
        {this.state.moveKind === 'annotated' && (
          <>
            <label>
              {this.localized('tagLifecycle.messageLabel')}
              <textarea
                value={this.state.moveMessage}
                maxLength={64 * 1024}
                rows={3}
                disabled={disabled}
                onChange={event =>
                  this.setState({ moveMessage: event.currentTarget.value })
                }
              />
            </label>
            <label className="tag-lifecycle-check">
              <input
                type="checkbox"
                checked={this.state.moveSigned}
                disabled={disabled}
                onChange={event =>
                  this.setState({ moveSigned: event.currentTarget.checked })
                }
              />
              {this.localized('tagLifecycle.signRecreated')}
            </label>
          </>
        )}
        <div className="tag-lifecycle-actions">
          <Button
            disabled={disabled || this.state.moveTarget.trim().length === 0}
            onClick={this.reviewMove}
          >
            {this.localized('tagLifecycle.reviewMoveAction')}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => this.setState({ movingTag: null, pending: null })}
          >
            {this.localized('tagLifecycle.cancelAction')}
          </Button>
        </div>
      </section>
    )
  }

  private renderLocalTag(
    tag: ILocalTagLifecycleEntry,
    remoteByName: ReadonlyMap<string, IRemoteTagLifecycleEntry>
  ) {
    const remote = remoteByName.get(tag.name)
    const remoteStatusKey: TranslationKey =
      remote === undefined
        ? this.state.inventory?.remote === null
          ? 'tagLifecycle.remoteNotLoaded'
          : 'tagLifecycle.localOnly'
        : remote.refObject === tag.refObject
        ? 'tagLifecycle.pushed'
        : 'tagLifecycle.differentRemotely'
    const kindKey: TranslationKey =
      tag.kind === 'annotated'
        ? 'tagLifecycle.annotatedLower'
        : 'tagLifecycle.lightweightLower'
    const disabled = this.state.busy || this.props.readOnly
    return (
      <li className="tag-lifecycle-row" key={tag.name}>
        <div>
          <strong>{tag.name}</strong>
          <span>
            {this.localized('tagLifecycle.localTagMeta', {
              kind: translatedVariable(kindKey),
              target: shortObject(tag.target),
              remoteStatus: translatedVariable(remoteStatusKey),
              signed: tag.signed
                ? translatedVariable('tagLifecycle.signedSuffix')
                : '',
            })}
          </span>
          {tag.message.length > 0 && <p>{tag.message}</p>}
        </div>
        <div className="tag-lifecycle-row-actions">
          <Button disabled={disabled} onClick={() => this.beginMove(tag)}>
            {this.localized('tagLifecycle.moveAction')}
          </Button>
          <Button
            disabled={disabled || this.state.inventory?.remoteName === null}
            onClick={() =>
              this.setState({
                pending: {
                  kind: 'push-one',
                  tag,
                  review: {
                    name: tag.name,
                    expectedRefObject: tag.refObject,
                    expectedRemoteRefObject: remote?.refObject ?? null,
                  },
                },
                confirmationText: '',
              })
            }
          >
            {this.localized('tagLifecycle.pushAction')}
          </Button>
          {remote !== undefined && (
            <Button
              disabled={disabled}
              onClick={() =>
                this.setState({
                  pending: { kind: 'delete-remote', tag: remote },
                  confirmationText: '',
                })
              }
            >
              {this.localized('tagLifecycle.deleteRemoteAction')}
            </Button>
          )}
          <Button
            disabled={disabled}
            onClick={() =>
              this.setState({
                pending: { kind: 'delete-local', tag },
                confirmationText: '',
              })
            }
          >
            {this.localized('tagLifecycle.deleteLocalAction')}
          </Button>
        </div>
      </li>
    )
  }

  private renderRemoteOnlyTag(tag: IRemoteTagLifecycleEntry) {
    const disabled = this.state.busy || this.props.readOnly
    return (
      <li className="tag-lifecycle-row remote" key={tag.name}>
        <div>
          <strong>{tag.name}</strong>
          <span>
            {this.localized('tagLifecycle.remoteOnlyMeta', {
              target: shortObject(tag.target),
            })}
          </span>
        </div>
        <Button
          disabled={disabled}
          onClick={() =>
            this.setState({
              pending: { kind: 'delete-remote', tag },
              confirmationText: '',
            })
          }
        >
          {this.localized('tagLifecycle.deleteRemoteAction')}
        </Button>
      </li>
    )
  }

  private renderConfirmation() {
    const pending = this.state.pending
    if (pending === null) {
      return null
    }
    const phrase = this.confirmationPhrase(pending)
    return (
      <section className="tag-lifecycle-confirmation" role="alertdialog">
        <h3>{this.localized('tagLifecycle.confirmHeading')}</h3>
        <p>{this.renderMessage(this.confirmationSummary(pending))}</p>
        <label>
          {this.localized('tagLifecycle.typeToConfirm', { phrase })}
          <input
            autoFocus={true}
            value={this.state.confirmationText}
            maxLength={245}
            disabled={this.state.busy}
            onChange={event =>
              this.setState({ confirmationText: event.currentTarget.value })
            }
          />
        </label>
        <div className="tag-lifecycle-actions">
          <Button
            disabled={this.state.busy || this.state.confirmationText !== phrase}
            onClick={this.confirmPending}
          >
            {this.localized('tagLifecycle.confirmAction')}
          </Button>
          <Button
            disabled={this.state.busy}
            onClick={() =>
              this.setState({ pending: null, confirmationText: '' })
            }
          >
            {this.localized('tagLifecycle.cancelAction')}
          </Button>
        </div>
      </section>
    )
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(TagLifecycleFilterListId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) =>
    this.setState({ filterCaseSensitive })

  private onFilterPatternApply = (filter: string) => this.setState({ filter })

  private getFilterSamples = () => [
    ...(this.state.inventory?.local.map(tag => tag.name) ?? []),
    ...(this.state.inventory?.remote?.map(tag => tag.name) ?? []),
  ]

  public render() {
    const inventory = this.state.inventory
    const remoteByName = new Map(
      (inventory?.remote ?? []).map(tag => [tag.name, tag])
    )
    const localMatches = matchGroup(
      this.state.filter.trim(),
      inventory?.local ?? [],
      tag => [tag.name, tag.target, tag.refObject],
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )
    const local = localMatches.results.map(match => match.item)
    const localNames = new Set((inventory?.local ?? []).map(tag => tag.name))
    const remoteMatches = matchGroup(
      this.state.filter.trim(),
      (inventory?.remote ?? []).filter(tag => !localNames.has(tag.name)),
      tag => [tag.name, tag.target, tag.refObject],
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )
    const remoteOnly = remoteMatches.results.map(match => match.item)
    const regexError = localMatches.regexError ?? remoteMatches.regexError
    const disabled = this.state.busy || this.props.readOnly

    return (
      <section
        className="tag-lifecycle-manager"
        aria-label={this.accessibleText('tagLifecycle.managerAria')}
      >
        <header>
          <div>
            <h2>{this.localized('tagLifecycle.title')}</h2>
            <p>{this.localized('tagLifecycle.description')}</p>
          </div>
          <div className="tag-lifecycle-actions">
            <Button
              disabled={this.state.loading || this.state.busy}
              onClick={() =>
                void this.loadInventory(inventory?.remote !== null)
              }
            >
              {this.localized('tagLifecycle.refreshLocalAction')}
            </Button>
            <Button
              disabled={this.state.loading || this.state.busy}
              onClick={() => void this.loadInventory(true)}
            >
              {this.localized('tagLifecycle.loadRemoteAction')}
            </Button>
          </div>
        </header>

        {this.props.readOnly && (
          <p className="tag-lifecycle-notice">
            {this.localized('tagLifecycle.readOnlyNotice')}
          </p>
        )}
        {this.state.error !== null && (
          <p className="tag-lifecycle-error" role="alert">
            {typeof this.state.error === 'string'
              ? this.state.error
              : this.renderMessage(this.state.error)}
          </p>
        )}
        {this.state.status !== null && (
          <p className="tag-lifecycle-notice" role="status">
            {this.renderMessage(this.state.status)}
          </p>
        )}
        {this.state.loading && (
          <p role="status">{this.localized('tagLifecycle.loading')}</p>
        )}

        {this.renderCreate()}
        {this.renderMove()}
        {this.renderConfirmation()}

        <section className="tag-lifecycle-inventory">
          <div className="tag-lifecycle-inventory-toolbar">
            <label>
              {this.localized('tagLifecycle.filterLabel')}
              <div className="tag-lifecycle-filter-field">
                <input
                  data-search-surface-id="tag-lifecycle-inventory"
                  type="search"
                  value={this.state.filter}
                  onChange={event =>
                    this.setState({ filter: event.currentTarget.value })
                  }
                />
                <FilterModeControl
                  searchSurfaceId="tag-lifecycle-inventory"
                  mode={this.state.filterMode}
                  caseSensitive={this.state.filterCaseSensitive}
                  onModeChange={this.onFilterModeChanged}
                  onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
                  regexBuilderTarget="Tags"
                  getSampleItems={this.getFilterSamples}
                  filterText={this.state.filter}
                  onRegexPatternApply={this.onFilterPatternApply}
                />
              </div>
            </label>
            <div className="tag-lifecycle-actions">
              <Button
                disabled={disabled || inventory?.remoteName === null}
                onClick={() =>
                  void this.runMutation(
                    () =>
                      this.props.dispatcher.fetchLifecycleTags(
                        this.props.repository,
                        false,
                        []
                      ),
                    {
                      key: 'tagLifecycle.fetchedStatus',
                      variables: {
                        remote: inventory?.remoteName ?? 'remote',
                      },
                    }
                  )
                }
              >
                {this.localized('tagLifecycle.fetchAction')}
              </Button>
              <Button
                disabled={
                  disabled ||
                  inventory?.remoteName === null ||
                  inventory?.localTruncated === true ||
                  inventory?.remoteTruncated === true
                }
                onClick={() =>
                  this.setState({
                    pending: {
                      kind: 'fetch-prune',
                      remoteName: inventory?.remoteName ?? 'remote',
                      tags: inventory?.local ?? [],
                    },
                    confirmationText: '',
                  })
                }
              >
                {this.localized('tagLifecycle.fetchPruneAction')}
              </Button>
              <Button
                disabled={
                  disabled ||
                  inventory === null ||
                  inventory.local.length === 0 ||
                  inventory.remoteName === null ||
                  inventory.localTruncated ||
                  inventory.remoteTruncated
                }
                onClick={() =>
                  this.setState({
                    pending: {
                      kind: 'push-all',
                      reviews: (inventory?.local ?? []).map(tag => ({
                        name: tag.name,
                        expectedRefObject: tag.refObject,
                        expectedRemoteRefObject:
                          remoteByName.get(tag.name)?.refObject ?? null,
                      })),
                    },
                    confirmationText: '',
                  })
                }
              >
                {this.localized('tagLifecycle.pushAllAction')}
              </Button>
            </div>
          </div>

          {regexError !== null && (
            <p className="tag-lifecycle-error" role="alert">
              Invalid tag search pattern: {regexError}
            </p>
          )}

          <h3>
            {this.localized('tagLifecycle.localTagsHeading', {
              count: String(inventory?.local.length ?? 0),
            })}
          </h3>
          {local.length === 0 ? (
            <p>{this.localized('tagLifecycle.noLocalMatches')}</p>
          ) : (
            <ul>{local.map(tag => this.renderLocalTag(tag, remoteByName))}</ul>
          )}
          {inventory?.localTruncated === true && (
            <p className="tag-lifecycle-notice">
              {this.localized('tagLifecycle.localTruncated')}
            </p>
          )}

          {inventory?.remote !== null && (
            <>
              <h3>
                {this.localized('tagLifecycle.remoteOnlyHeading', {
                  count: String(remoteOnly.length),
                  remote: inventory?.remoteName ?? 'remote',
                })}
              </h3>
              {remoteOnly.length === 0 ? (
                <p>{this.localized('tagLifecycle.noRemoteMatches')}</p>
              ) : (
                <ul>{remoteOnly.map(tag => this.renderRemoteOnlyTag(tag))}</ul>
              )}
              {inventory?.remoteTruncated === true && (
                <p className="tag-lifecycle-notice">
                  {this.localized('tagLifecycle.remoteTruncated')}
                </p>
              )}
            </>
          )}
        </section>
      </section>
    )
  }
}
