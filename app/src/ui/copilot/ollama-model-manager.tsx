import * as React from 'react'
import { Button } from '../lib/button'

export interface IOllamaManagerProviderModel {
  readonly id: string
  readonly name: string
}

/**
 * The provider fields used by the manager. Existing BYOK providers satisfy
 * this contract without making this UI depend on the persistence model.
 */
export interface IOllamaManagerProvider {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly models: ReadonlyArray<IOllamaManagerProviderModel>
}

export interface IOllamaRequestOptions {
  readonly signal?: AbortSignal
}

export interface IOllamaPullProgress {
  readonly status: string
  readonly digest?: string
  readonly total?: number
  readonly completed?: number
}

export interface IOllamaPullOptions extends IOllamaRequestOptions {
  readonly onProgress?: (progress: IOllamaPullProgress) => void
}

export interface IOllamaVersion {
  readonly version: string
}

export interface IOllamaModelDetails {
  readonly parentModel?: string
  readonly format?: string
  readonly family?: string
  readonly families?: ReadonlyArray<string>
  readonly parameterSize?: string
  readonly quantizationLevel?: string
}

/** Minimal structural shape shared by installed and running model records. */
export interface IOllamaModelRecord {
  readonly name?: string
  readonly model?: string
  readonly modifiedAt?: string
  readonly size?: number
  readonly digest?: string
  readonly details?: IOllamaModelDetails
  readonly capabilities?: ReadonlyArray<string>
}

export interface IOllamaRunningModelRecord extends IOllamaModelRecord {
  readonly expiresAt?: string
  readonly sizeVram?: number
  readonly contextLength?: number
}

export interface IOllamaModelInformation {
  readonly license?: string
  readonly parameters?: string
  readonly details?: IOllamaModelDetails
  readonly capabilities?: ReadonlyArray<string>
}

/**
 * Structural client contract intentionally mirroring app/src/lib/ollama.
 * Keeping it structural lets the root integration inject the concrete client
 * without introducing a dependency cycle or coupling the preference UI to IO.
 */
export interface IOllamaModelManagerClient {
  readonly health: (options?: IOllamaRequestOptions) => Promise<IOllamaVersion>
  readonly list: (
    options?: IOllamaRequestOptions
  ) => Promise<ReadonlyArray<IOllamaModelRecord>>
  readonly listRunning: (
    options?: IOllamaRequestOptions
  ) => Promise<ReadonlyArray<IOllamaRunningModelRecord>>
  readonly show: (
    model: string,
    options?: IOllamaRequestOptions
  ) => Promise<IOllamaModelInformation>
  readonly pull: (
    model: string,
    options?: IOllamaPullOptions
  ) => Promise<unknown>
  readonly copy: (
    source: string,
    destination: string,
    options?: IOllamaRequestOptions
  ) => Promise<void>
  readonly delete: (
    model: string,
    options?: IOllamaRequestOptions
  ) => Promise<void>
  readonly load: (
    model: string,
    options?: IOllamaRequestOptions
  ) => Promise<void>
  readonly unload: (
    model: string,
    options?: IOllamaRequestOptions
  ) => Promise<void>
}

export interface IOllamaModelManagerStrings {
  readonly title: string
  readonly subtitle: string
  readonly endpoint: string
  readonly configuredEndpoint: string
  readonly connected: string
  readonly unavailable: string
  readonly checking: string
  readonly partial: string
  readonly version: string
  readonly installed: string
  readonly running: string
  readonly refresh: string
  readonly refreshing: string
  readonly searchLabel: string
  readonly searchPlaceholder: string
  readonly scopeLabel: string
  readonly allModels: string
  readonly runningModels: string
  readonly inventoryLabel: string
  readonly loadingInventory: string
  readonly unavailableInventory: string
  readonly emptyInventory: string
  readonly emptyFilter: string
  readonly modelDetails: string
  readonly selectModel: string
  readonly loadingDetails: string
  readonly runningBadge: string
  readonly size: string
  readonly modified: string
  readonly digest: string
  readonly family: string
  readonly format: string
  readonly parameters: string
  readonly quantization: string
  readonly capabilities: string
  readonly license: string
  readonly noneReported: string
  readonly runtime: string
  readonly vram: string
  readonly context: string
  readonly expires: string
  readonly notRunning: string
  readonly pullTitle: string
  readonly pullHint: string
  readonly modelName: string
  readonly pullPlaceholder: string
  readonly pull: string
  readonly pulling: string
  readonly cancel: string
  readonly receiving: string
  readonly copyTitle: string
  readonly copyHint: string
  readonly copyDestination: string
  readonly copy: string
  readonly renameTitle: string
  readonly renameHint: string
  readonly renameDestination: string
  readonly rename: string
  readonly load: string
  readonly unload: string
  readonly delete: string
  readonly deleteTitle: string
  readonly deleteConfirm: string
  readonly invalidName: string
  readonly duplicateName: string
  readonly operationError: string
  readonly refreshError: string
  readonly detailsError: string
  readonly configurationPartial: string
  readonly renamePartial: string
  readonly pullCancelled: string
  readonly unknown: string
  readonly never: string
  readonly showing: (visible: number, total: number) => string
  readonly selectedModel: (name: string) => string
  readonly moreCapabilities: (count: number) => string
  readonly pullProgress: (percent: number) => string
  readonly pullSucceeded: (name: string) => string
  readonly copySucceeded: (source: string, destination: string) => string
  readonly renameSucceeded: (source: string, destination: string) => string
  readonly loadSucceeded: (name: string) => string
  readonly unloadSucceeded: (name: string) => string
  readonly deleteSucceeded: (name: string) => string
  readonly confirmDelete: (name: string) => string
}

/** Default English catalog; callers may inject any subset through `strings`. */
export const DefaultOllamaModelManagerStrings: IOllamaModelManagerStrings = {
  title: 'Ollama model manager',
  subtitle: 'Install, inspect, and control models on this Ollama provider.',
  endpoint: 'Endpoint',
  configuredEndpoint: 'Configured endpoint',
  connected: 'Connected',
  unavailable: 'Unavailable',
  checking: 'Checking…',
  partial: 'Some model information could not be loaded.',
  version: 'Version',
  installed: 'Installed',
  running: 'Running',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  searchLabel: 'Search installed models',
  searchPlaceholder: 'Search by name, family, or capability…',
  scopeLabel: 'Model inventory filter',
  allModels: 'All models',
  runningModels: 'Running only',
  inventoryLabel: 'Installed Ollama models',
  loadingInventory: 'Loading models…',
  unavailableInventory: 'The model inventory is unavailable.',
  emptyInventory: 'No models are installed on this endpoint.',
  emptyFilter: 'No models match the current filters.',
  modelDetails: 'Model details',
  selectModel: 'Select an installed model to inspect and manage it.',
  loadingDetails: 'Loading model details…',
  runningBadge: 'Running',
  size: 'Size',
  modified: 'Modified',
  digest: 'Digest',
  family: 'Family',
  format: 'Format',
  parameters: 'Parameters',
  quantization: 'Quantization',
  capabilities: 'Capabilities',
  license: 'License summary',
  noneReported: 'Not reported',
  runtime: 'Runtime',
  vram: 'VRAM',
  context: 'Context length',
  expires: 'Expires',
  notRunning: 'This model is not currently loaded.',
  pullTitle: 'Install a model',
  pullHint:
    'Enter an Ollama model name. The configured endpoint is used as-is.',
  modelName: 'Model name',
  pullPlaceholder: 'llama3.2:latest',
  pull: 'Pull and install',
  pulling: 'Installing…',
  cancel: 'Cancel',
  receiving: 'Receiving model data…',
  copyTitle: 'Copy model',
  copyHint: 'Create another local model name from the selected model.',
  copyDestination: 'Copy destination',
  copy: 'Copy',
  renameTitle: 'Rename model',
  renameHint: 'Copy to the new name, then remove the original.',
  renameDestination: 'New model name',
  rename: 'Rename',
  load: 'Load / start',
  unload: 'Unload / stop',
  delete: 'Delete',
  deleteTitle: 'Delete model?',
  deleteConfirm: 'Delete model',
  invalidName: 'Enter a model name.',
  duplicateName: 'Choose a different model name.',
  operationError: 'The model operation could not be completed.',
  refreshError: 'Ollama could not be reached at this provider endpoint.',
  detailsError: 'Extended details could not be loaded for this model.',
  configurationPartial:
    'The Ollama operation succeeded, but the configured model list could not be updated.',
  renamePartial:
    'The copy succeeded, but the original model could not be removed.',
  pullCancelled: 'Model installation canceled.',
  unknown: 'Unknown',
  never: 'Never',
  showing: (visible, total) => `Showing ${visible} of ${total} models`,
  selectedModel: name => `Select ${name}`,
  moreCapabilities: count => `+${count} more`,
  pullProgress: percent => `${percent}% complete`,
  pullSucceeded: name => `Installed ${name}.`,
  copySucceeded: (source, destination) => `Copied ${source} to ${destination}.`,
  renameSucceeded: (source, destination) =>
    `Renamed ${source} to ${destination}.`,
  loadSucceeded: name => `Loaded ${name}.`,
  unloadSucceeded: name => `Unloaded ${name}.`,
  deleteSucceeded: name => `Deleted ${name}.`,
  confirmDelete: name =>
    `Delete ${name} from this Ollama endpoint? This cannot be undone.`,
}

export interface IOllamaModelManagerProps {
  readonly provider: IOllamaManagerProvider
  /** A ready client takes precedence over `clientFactory`. */
  readonly client?: IOllamaModelManagerClient
  readonly clientFactory?: (
    provider: IOllamaManagerProvider
  ) => IOllamaModelManagerClient
  /** Persist the provider's selectable models after pull/copy/rename/delete. */
  readonly onProviderModelsChanged: (
    provider: IOllamaManagerProvider,
    models: ReadonlyArray<IOllamaManagerProviderModel>
  ) => Promise<void> | void
  readonly strings?: Partial<IOllamaModelManagerStrings>
}

type InventoryPhase = 'loading' | 'available' | 'partial' | 'unavailable'
type InventoryScope = 'all' | 'running'
type OperationKind = 'pull' | 'copy' | 'rename' | 'load' | 'unload' | 'delete'
type NoticeKind = 'success' | 'cancelled' | 'error' | 'partial'

interface INormalizedModel extends IOllamaModelRecord {
  readonly name: string
}

interface INormalizedRunningModel extends IOllamaRunningModelRecord {
  readonly name: string
}

interface IOperationState {
  readonly id: number
  readonly kind: OperationKind
  readonly model: string
}

interface IPullState {
  readonly completed: number | null
  readonly total: number | null
}

interface INotice {
  readonly kind: NoticeKind
  readonly message: string
}

interface IOllamaModelManagerState {
  readonly endpointVersion: string | null
  readonly endpointAvailable: boolean | null
  readonly inventoryPhase: InventoryPhase
  readonly models: ReadonlyArray<INormalizedModel> | null
  readonly runningModels: ReadonlyArray<INormalizedRunningModel>
  readonly selectedModel: string | null
  readonly modelInformation: IOllamaModelInformation | null
  readonly detailsLoading: boolean
  readonly detailsUnavailable: boolean
  readonly query: string
  readonly scope: InventoryScope
  readonly pullName: string
  readonly copyName: string
  readonly renameName: string
  readonly operation: IOperationState | null
  readonly pullProgress: IPullState | null
  readonly deleteConfirmation: string | null
  readonly notice: INotice | null
}

interface ISettledResult<T> {
  readonly succeeded: boolean
  readonly value: T | null
}

interface IInventoryRefreshResult {
  readonly inventorySucceeded: boolean
  readonly providerModelsSynchronized: boolean
}

const MaximumLicenseCharacters = 1200
const MaximumMetadataCharacters = 180
const MaximumCapabilities = 10
let managerInstance = 0

function settle<T>(promise: Promise<T>): Promise<ISettledResult<T>> {
  return promise.then(
    value => ({ succeeded: true, value }),
    () => ({ succeeded: false, value: null })
  )
}

function normalizedName(model: IOllamaModelRecord): string {
  return (model.name ?? model.model ?? '').trim()
}

function normalizeModels(
  models: ReadonlyArray<IOllamaModelRecord>
): ReadonlyArray<INormalizedModel> {
  return models
    .map(model => ({ ...model, name: normalizedName(model) }))
    .filter(model => model.name !== '')
}

function normalizeRunningModels(
  models: ReadonlyArray<IOllamaRunningModelRecord>
): ReadonlyArray<INormalizedRunningModel> {
  return models
    .map(model => ({ ...model, name: normalizedName(model) }))
    .filter(model => model.name !== '')
}

function boundedText(value: string, maximum: number): string {
  const trimmed = value.trim()
  return trimmed.length <= maximum
    ? trimmed
    : `${trimmed.slice(0, maximum).trimEnd()}…`
}

/** Strip credentials and request-specific data before an endpoint is shown. */
export function formatSafeOllamaEndpoint(
  value: string,
  fallback: string
): string {
  try {
    const endpoint = new URL(value)
    if (
      (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
      endpoint.origin === 'null'
    ) {
      return fallback
    }
    const path = endpoint.pathname === '/' ? '' : endpoint.pathname
    return boundedText(`${endpoint.origin}${path}`, MaximumMetadataCharacters)
  } catch {
    return fallback
  }
}

function finiteNonNegative(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null
}

export class OllamaModelManager extends React.Component<
  IOllamaModelManagerProps,
  IOllamaModelManagerState
> {
  private readonly headingId = `ollama-manager-heading-${++managerInstance}`
  private readonly detailsHeadingId = `${this.headingId}-details`
  private readonly pullHintId = `${this.headingId}-pull-hint`
  private readonly copyHintId = `${this.headingId}-copy-hint`
  private readonly renameHintId = `${this.headingId}-rename-hint`
  private refreshRequestId = 0
  private detailRequestId = 0
  private operationRequestId = 0
  private refreshController: AbortController | null = null
  private detailController: AbortController | null = null
  private operationController: AbortController | null = null
  private deleteButton: HTMLButtonElement | null = null
  private confirmDeleteButton: HTMLButtonElement | null = null

  public constructor(props: IOllamaModelManagerProps) {
    super(props)
    this.state = this.getInitialState()
  }

  public componentDidMount() {
    void this.refreshInventory(false)
  }

  public componentDidUpdate(prevProps: IOllamaModelManagerProps) {
    if (
      prevProps.provider.id !== this.props.provider.id ||
      prevProps.provider.baseUrl !== this.props.provider.baseUrl ||
      prevProps.client !== this.props.client
    ) {
      this.invalidateRequests()
      this.setState(this.getInitialState(), () => {
        void this.refreshInventory(false)
      })
    }
  }

  public componentWillUnmount() {
    this.invalidateRequests()
  }

  public render() {
    const strings = this.getStrings()
    const visibleModels = this.getVisibleModels()
    const initialLoading =
      this.state.inventoryPhase === 'loading' && this.state.models === null
    const busy = this.state.operation !== null

    return (
      <section
        className="ollama-model-manager"
        data-verification="ollama-manager"
        aria-labelledby={this.headingId}
        aria-busy={initialLoading || busy}
      >
        <header className="ollama-model-manager-header">
          <div className="ollama-model-manager-title">
            <h3 id={this.headingId}>{strings.title}</h3>
            <p>{strings.subtitle}</p>
          </div>
          <Button
            size="small"
            dataVerification="ollama-refresh"
            onClick={this.onRefresh}
            disabled={initialLoading || busy}
          >
            {this.state.inventoryPhase === 'loading'
              ? strings.refreshing
              : strings.refresh}
          </Button>
        </header>

        {this.renderEndpointSummary(strings)}
        {this.renderNotice()}
        {this.renderPullForm(strings)}

        <div className="ollama-model-manager-workspace">
          <div className="ollama-model-inventory">
            {this.renderInventoryControls(strings)}
            {this.renderInventory(strings, visibleModels)}
          </div>
          {this.renderDetails(strings)}
        </div>
      </section>
    )
  }

  private getInitialState(): IOllamaModelManagerState {
    return {
      endpointVersion: null,
      endpointAvailable: null,
      inventoryPhase: 'loading',
      models: null,
      runningModels: [],
      selectedModel: null,
      modelInformation: null,
      detailsLoading: false,
      detailsUnavailable: false,
      query: '',
      scope: 'all',
      pullName: '',
      copyName: '',
      renameName: '',
      operation: null,
      pullProgress: null,
      deleteConfirmation: null,
      notice: null,
    }
  }

  private getStrings(): IOllamaModelManagerStrings {
    return { ...DefaultOllamaModelManagerStrings, ...this.props.strings }
  }

  private resolveClient(
    provider: IOllamaManagerProvider
  ): IOllamaModelManagerClient | null {
    try {
      return this.props.client ?? this.props.clientFactory?.(provider) ?? null
    } catch {
      return null
    }
  }

  private isCurrentProvider(provider: IOllamaManagerProvider): boolean {
    return (
      this.props.provider.id === provider.id &&
      this.props.provider.baseUrl === provider.baseUrl
    )
  }

  private invalidateRequests() {
    ++this.refreshRequestId
    ++this.detailRequestId
    ++this.operationRequestId
    this.refreshController?.abort()
    this.detailController?.abort()
    this.operationController?.abort()
    this.refreshController = null
    this.detailController = null
    this.operationController = null
  }

  private refreshInventory = async (
    preserveNotice: boolean,
    operationGuard?: () => boolean
  ): Promise<IInventoryRefreshResult> => {
    const provider = this.props.provider
    const requestId = ++this.refreshRequestId
    this.refreshController?.abort()
    this.detailController?.abort()
    ++this.detailRequestId
    const controller = new AbortController()
    this.refreshController = controller
    this.setState(state => ({
      inventoryPhase: 'loading',
      detailsLoading: state.selectedModel !== null,
      detailsUnavailable: false,
      notice: preserveNotice ? state.notice : null,
    }))

    const isCurrent = () =>
      requestId === this.refreshRequestId &&
      !controller.signal.aborted &&
      this.isCurrentProvider(provider) &&
      (operationGuard?.() ?? true)

    const client = this.resolveClient(provider)
    if (client === null) {
      if (!isCurrent()) {
        return {
          inventorySucceeded: false,
          providerModelsSynchronized: false,
        }
      }
      this.refreshController = null
      this.setState({
        endpointAvailable: false,
        endpointVersion: null,
        inventoryPhase: 'unavailable',
        models: null,
        runningModels: [],
        selectedModel: null,
        modelInformation: null,
        detailsLoading: false,
        detailsUnavailable: false,
        notice: {
          kind: 'error',
          message: this.getStrings().refreshError,
        },
      })
      return {
        inventorySucceeded: false,
        providerModelsSynchronized: false,
      }
    }

    const options = { signal: controller.signal }
    const [health, inventory, running] = await Promise.all([
      settle(client.health(options)),
      settle(client.list(options)),
      settle(client.listRunning(options)),
    ])

    if (!isCurrent()) {
      return {
        inventorySucceeded: false,
        providerModelsSynchronized: false,
      }
    }

    const models = inventory.succeeded
      ? normalizeModels(inventory.value ?? [])
      : null
    const runningModels = running.succeeded
      ? normalizeRunningModels(running.value ?? [])
      : []
    const failures = [health, inventory, running].filter(
      result => !result.succeeded
    ).length
    const phase: InventoryPhase =
      failures === 0 ? 'available' : failures === 3 ? 'unavailable' : 'partial'
    const selectedModel = this.resolveSelectedModel(models)
    const providerModelsSynchronized =
      inventory.succeeded && models !== null
        ? await this.synchronizeProviderModels(provider, models, isCurrent)
        : false

    if (!isCurrent()) {
      return {
        inventorySucceeded: inventory.succeeded,
        providerModelsSynchronized: false,
      }
    }
    this.refreshController = null

    this.setState(
      {
        endpointAvailable: health.succeeded,
        endpointVersion: health.value?.version ?? null,
        inventoryPhase: phase,
        models,
        runningModels,
        selectedModel,
        modelInformation:
          selectedModel === this.state.selectedModel
            ? this.state.modelInformation
            : null,
        detailsLoading: selectedModel !== null,
        detailsUnavailable: false,
        copyName:
          selectedModel === this.state.selectedModel ? this.state.copyName : '',
        renameName:
          selectedModel === this.state.selectedModel
            ? this.state.renameName
            : '',
        notice:
          inventory.succeeded && !providerModelsSynchronized
            ? {
                kind: 'partial',
                message: this.getStrings().configurationPartial,
              }
            : preserveNotice
            ? this.state.notice
            : phase === 'unavailable'
            ? {
                kind: 'error',
                message: this.getStrings().refreshError,
              }
            : null,
      },
      () => {
        if (selectedModel !== null && isCurrent()) {
          void this.loadModelInformation(selectedModel, provider)
        }
      }
    )
    return {
      inventorySucceeded: inventory.succeeded,
      providerModelsSynchronized,
    }
  }

  private async synchronizeProviderModels(
    provider: IOllamaManagerProvider,
    models: ReadonlyArray<INormalizedModel>,
    isCurrent: () => boolean
  ): Promise<boolean> {
    const seen = new Set<string>()
    const next = models.reduce<IOllamaManagerProviderModel[]>(
      (result, model) => {
        if (!seen.has(model.name)) {
          seen.add(model.name)
          result.push({ id: model.name, name: model.name })
        }
        return result
      },
      []
    )
    const unchanged =
      provider.models.length === next.length &&
      provider.models.every(
        (model, index) =>
          model.id === next[index].id && model.name === next[index].name
      )

    if (unchanged) {
      return true
    }
    if (!isCurrent()) {
      return false
    }
    try {
      await this.props.onProviderModelsChanged(provider, next)
    } catch {
      return false
    }
    return isCurrent()
  }

  private resolveSelectedModel(
    models: ReadonlyArray<INormalizedModel> | null
  ): string | null {
    if (models === null || models.length === 0) {
      return null
    }
    const current = this.state.selectedModel
    return current !== null && models.some(model => model.name === current)
      ? current
      : models[0].name
  }

  private loadModelInformation = async (
    model: string,
    provider: IOllamaManagerProvider
  ) => {
    const client = this.resolveClient(provider)
    if (client === null) {
      if (this.isCurrentProvider(provider)) {
        this.setState({
          detailsLoading: false,
          detailsUnavailable: true,
        })
      }
      return
    }

    const requestId = ++this.detailRequestId
    this.detailController?.abort()
    const controller = new AbortController()
    this.detailController = controller
    this.setState({ detailsLoading: true, detailsUnavailable: false })
    const result = await settle(
      client.show(model, { signal: controller.signal })
    )

    if (
      requestId !== this.detailRequestId ||
      controller.signal.aborted ||
      !this.isCurrentProvider(provider) ||
      this.state.selectedModel !== model
    ) {
      return
    }
    this.detailController = null
    this.setState({
      modelInformation: result.value,
      detailsLoading: false,
      detailsUnavailable: !result.succeeded,
    })
  }

  private renderEndpointSummary(strings: IOllamaModelManagerStrings) {
    const endpointStatus =
      this.state.endpointAvailable === null
        ? strings.checking
        : this.state.endpointAvailable
        ? strings.connected
        : strings.unavailable

    return (
      <div className="ollama-endpoint-summary" aria-live="polite">
        <div className="ollama-endpoint-identity">
          <span
            className={`ollama-health-indicator is-${
              this.state.endpointAvailable === null
                ? 'checking'
                : this.state.endpointAvailable
                ? 'connected'
                : 'unavailable'
            }`}
            aria-hidden="true"
          />
          <div>
            <span className="ollama-summary-label">{strings.endpoint}</span>
            <strong data-verification="ollama-endpoint-status">
              {endpointStatus}
            </strong>
            <span className="ollama-endpoint-name">
              {boundedText(this.props.provider.name, MaximumMetadataCharacters)}
              {' · '}
              {formatSafeOllamaEndpoint(
                this.props.provider.baseUrl,
                strings.configuredEndpoint
              )}
            </span>
          </div>
        </div>
        <dl className="ollama-endpoint-metrics">
          <div>
            <dt>{strings.version}</dt>
            <dd>{this.state.endpointVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>{strings.installed}</dt>
            <dd>{this.state.models?.length ?? '—'}</dd>
          </div>
          <div>
            <dt>{strings.running}</dt>
            <dd>
              {this.state.models === null
                ? '—'
                : this.state.runningModels.length}
            </dd>
          </div>
        </dl>
        {this.state.inventoryPhase === 'partial' && (
          <p className="ollama-partial-state" role="status">
            {strings.partial}
          </p>
        )}
      </div>
    )
  }

  private renderNotice() {
    const notice = this.state.notice
    if (notice === null) {
      return null
    }
    return (
      <div
        className={`ollama-manager-notice is-${notice.kind}`}
        data-verification="ollama-notice"
        role={notice.kind === 'error' ? 'alert' : 'status'}
        aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
      >
        {notice.message}
      </div>
    )
  }

  private renderPullForm(strings: IOllamaModelManagerStrings) {
    const pulling = this.state.operation?.kind === 'pull'
    const busy = this.state.operation !== null
    const progress = this.state.pullProgress
    const hasTotal = progress?.total !== null && progress?.total !== undefined
    const percentage =
      hasTotal && progress !== null && progress.total! > 0
        ? Math.min(
            100,
            Math.round(((progress.completed ?? 0) / progress.total!) * 100)
          )
        : null

    return (
      <form className="ollama-pull-card" onSubmit={this.onPullSubmit}>
        <div className="ollama-pull-copy">
          <h4>{strings.pullTitle}</h4>
          <p id={this.pullHintId}>{strings.pullHint}</p>
        </div>
        <div className="ollama-pull-controls">
          <label htmlFor={`${this.headingId}-pull-name`}>
            {strings.modelName}
          </label>
          <input
            id={`${this.headingId}-pull-name`}
            data-verification="ollama-pull-name"
            value={this.state.pullName}
            onChange={this.onPullNameChanged}
            placeholder={strings.pullPlaceholder}
            aria-describedby={this.pullHintId}
            spellCheck={false}
            disabled={busy}
          />
          <Button type="submit" dataVerification="ollama-pull" disabled={busy}>
            {pulling ? strings.pulling : strings.pull}
          </Button>
        </div>
        {pulling && (
          <div
            className="ollama-pull-progress"
            data-verification="ollama-pull-progress"
            role="status"
            aria-live="polite"
          >
            <div>
              <span>{strings.receiving}</span>
              {percentage !== null && (
                <strong>{strings.pullProgress(percentage)}</strong>
              )}
            </div>
            {hasTotal && progress !== null ? (
              <progress
                max={progress.total!}
                value={progress.completed ?? 0}
                aria-label={strings.receiving}
              />
            ) : (
              <progress aria-label={strings.receiving} />
            )}
            <Button
              size="small"
              dataVerification="ollama-pull-cancel"
              onClick={this.onCancelPull}
            >
              {strings.cancel}
            </Button>
          </div>
        )}
      </form>
    )
  }

  private renderInventoryControls(strings: IOllamaModelManagerStrings) {
    const total = this.state.models?.length ?? 0
    const visible = this.getVisibleModels().length
    return (
      <div className="ollama-inventory-controls">
        <div className="ollama-model-search" role="search">
          <label htmlFor={`${this.headingId}-search`}>
            {strings.searchLabel}
          </label>
          <input
            id={`${this.headingId}-search`}
            data-verification="ollama-filter"
            type="search"
            value={this.state.query}
            onChange={this.onQueryChanged}
            placeholder={strings.searchPlaceholder}
            disabled={this.state.models === null}
          />
        </div>
        <label className="ollama-scope-control">
          <span>{strings.scopeLabel}</span>
          <select
            data-verification="ollama-scope"
            value={this.state.scope}
            onChange={this.onScopeChanged}
          >
            <option value="all">{strings.allModels}</option>
            <option value="running">{strings.runningModels}</option>
          </select>
        </label>
        <span className="ollama-inventory-count" role="status">
          {strings.showing(visible, total)}
        </span>
      </div>
    )
  }

  private renderInventory(
    strings: IOllamaModelManagerStrings,
    models: ReadonlyArray<INormalizedModel>
  ) {
    if (this.state.models === null) {
      return (
        <div
          className="ollama-inventory-state"
          data-verification="ollama-inventory"
          role="status"
        >
          {this.state.inventoryPhase === 'loading'
            ? strings.loadingInventory
            : strings.unavailableInventory}
        </div>
      )
    }
    if (this.state.models.length === 0) {
      return (
        <div
          className="ollama-inventory-state"
          data-verification="ollama-inventory"
          role="status"
        >
          {strings.emptyInventory}
        </div>
      )
    }
    if (models.length === 0) {
      return (
        <div
          className="ollama-inventory-state"
          data-verification="ollama-inventory"
          role="status"
        >
          {strings.emptyFilter}
        </div>
      )
    }

    return (
      <ul
        className="ollama-model-list"
        data-verification="ollama-inventory"
        aria-label={strings.inventoryLabel}
      >
        {models.map(this.renderModelRow)}
      </ul>
    )
  }

  private renderModelRow = (model: INormalizedModel) => {
    const strings = this.getStrings()
    const running = this.getRunningModel(model.name) !== null
    const selected = this.state.selectedModel === model.name
    return (
      <li key={model.name}>
        <button
          type="button"
          className="ollama-model-row"
          data-verification="ollama-model-row"
          data-model={model.name}
          onClick={this.onSelectModel}
          aria-pressed={selected}
          aria-label={strings.selectedModel(model.name)}
        >
          <span className="ollama-model-row-main">
            <strong>{model.name}</strong>
            <span>{this.getModelSubtitle(model)}</span>
          </span>
          <span className="ollama-model-row-meta">
            {running && (
              <span className="ollama-running-badge">
                {strings.runningBadge}
              </span>
            )}
            <span>{this.formatBytes(model.size)}</span>
          </span>
        </button>
      </li>
    )
  }

  private getVisibleModels(): ReadonlyArray<INormalizedModel> {
    const models = this.state.models ?? []
    const query = this.state.query.trim().toLocaleLowerCase()
    return models.filter(model => {
      if (
        this.state.scope === 'running' &&
        this.getRunningModel(model.name) === null
      ) {
        return false
      }
      if (query === '') {
        return true
      }
      const details = model.details
      return [
        model.name,
        details?.family,
        details?.format,
        details?.parameterSize,
        details?.quantizationLevel,
        ...(details?.families ?? []),
        ...(model.capabilities ?? []),
      ]
        .filter((value): value is string => value !== undefined)
        .some(value => value.toLocaleLowerCase().includes(query))
    })
  }

  private getModelSubtitle(model: INormalizedModel): string {
    const parts = [
      model.details?.family,
      model.details?.parameterSize,
      model.details?.quantizationLevel,
    ].filter((value): value is string => value !== undefined && value !== '')
    return parts.length > 0 ? parts.join(' · ') : this.getStrings().unknown
  }

  private getSelectedModel(): INormalizedModel | null {
    const name = this.state.selectedModel
    return this.state.models?.find(model => model.name === name) ?? null
  }

  private getRunningModel(name: string): INormalizedRunningModel | null {
    return this.state.runningModels.find(model => model.name === name) ?? null
  }

  private renderDetails(strings: IOllamaModelManagerStrings) {
    const model = this.getSelectedModel()
    if (model === null) {
      return (
        <section
          className="ollama-model-details is-empty"
          data-verification="ollama-details"
          aria-labelledby={this.detailsHeadingId}
        >
          <h4 id={this.detailsHeadingId}>{strings.modelDetails}</h4>
          <p>{strings.selectModel}</p>
        </section>
      )
    }

    const information = this.state.modelInformation
    const details = information?.details ?? model.details
    const running = this.getRunningModel(model.name)
    const capabilities = Array.from(
      new Set([
        ...(model.capabilities ?? []),
        ...(information?.capabilities ?? []),
      ])
    )
    const visibleCapabilities = capabilities.slice(0, MaximumCapabilities)
    const remainingCapabilities =
      capabilities.length - visibleCapabilities.length
    const busy = this.state.operation !== null

    return (
      <section
        className="ollama-model-details"
        data-verification="ollama-details"
        aria-labelledby={this.detailsHeadingId}
      >
        <header>
          <div>
            <span className="ollama-summary-label">{strings.modelDetails}</span>
            <h4 id={this.detailsHeadingId}>{model.name}</h4>
          </div>
          <div className="ollama-model-primary-actions">
            <Button
              size="small"
              dataVerification="ollama-load"
              onClick={this.onLoadModel}
              disabled={busy || running !== null}
            >
              {strings.load}
            </Button>
            <Button
              size="small"
              dataVerification="ollama-unload"
              onClick={this.onUnloadModel}
              disabled={busy || running === null}
            >
              {strings.unload}
            </Button>
            <Button
              size="small"
              className="destructive"
              dataVerification="ollama-delete"
              onClick={this.onRequestDelete}
              onButtonRef={this.onDeleteButtonRef}
              disabled={busy}
            >
              {strings.delete}
            </Button>
          </div>
        </header>

        {this.state.detailsLoading && (
          <p className="ollama-details-state" role="status">
            {strings.loadingDetails}
          </p>
        )}
        {this.state.detailsUnavailable && (
          <p className="ollama-details-state is-warning" role="status">
            {strings.detailsError}
          </p>
        )}

        <dl className="ollama-model-metadata">
          {this.renderMetadata(strings.size, this.formatBytes(model.size))}
          {this.renderMetadata(
            strings.modified,
            this.formatDate(model.modifiedAt)
          )}
          {this.renderMetadata(
            strings.digest,
            this.formatMetadata(model.digest)
          )}
          {this.renderMetadata(
            strings.family,
            this.formatMetadata(
              details?.family ?? details?.families?.join(', ')
            )
          )}
          {this.renderMetadata(
            strings.format,
            this.formatMetadata(details?.format)
          )}
          {this.renderMetadata(
            strings.parameters,
            this.formatMetadata(details?.parameterSize)
          )}
          {this.renderMetadata(
            strings.quantization,
            this.formatMetadata(details?.quantizationLevel)
          )}
        </dl>

        <div className="ollama-capability-section">
          <h5>{strings.capabilities}</h5>
          {visibleCapabilities.length === 0 ? (
            <p>{strings.noneReported}</p>
          ) : (
            <ul aria-label={strings.capabilities}>
              {visibleCapabilities.map(capability => (
                <li key={capability}>{boundedText(capability, 80)}</li>
              ))}
              {remainingCapabilities > 0 && (
                <li>{strings.moreCapabilities(remainingCapabilities)}</li>
              )}
            </ul>
          )}
        </div>

        <div className="ollama-license-section">
          <h5>{strings.license}</h5>
          <p>
            {information?.license
              ? boundedText(information.license, MaximumLicenseCharacters)
              : strings.noneReported}
          </p>
        </div>

        {this.renderRuntime(strings, running)}
        {this.renderCopyRenameForms(strings, model, busy)}
        {this.renderDeleteConfirmation(strings, model)}
      </section>
    )
  }

  private renderMetadata(label: string, value: string) {
    return (
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    )
  }

  private renderRuntime(
    strings: IOllamaModelManagerStrings,
    running: INormalizedRunningModel | null
  ) {
    return (
      <div className="ollama-runtime-section">
        <h5>{strings.runtime}</h5>
        {running === null ? (
          <p>{strings.notRunning}</p>
        ) : (
          <dl>
            {this.renderMetadata(
              strings.vram,
              this.formatBytes(running.sizeVram)
            )}
            {this.renderMetadata(
              strings.context,
              running.contextLength?.toLocaleString() ?? strings.unknown
            )}
            {this.renderMetadata(
              strings.expires,
              running.expiresAt === undefined
                ? strings.never
                : this.formatDate(running.expiresAt)
            )}
          </dl>
        )}
      </div>
    )
  }

  private renderCopyRenameForms(
    strings: IOllamaModelManagerStrings,
    model: INormalizedModel,
    busy: boolean
  ) {
    return (
      <div className="ollama-model-editors">
        <form onSubmit={this.onCopySubmit}>
          <div>
            <h5>{strings.copyTitle}</h5>
            <p id={this.copyHintId}>{strings.copyHint}</p>
          </div>
          <label htmlFor={`${this.headingId}-copy-name`}>
            {strings.copyDestination}
          </label>
          <div className="ollama-inline-field">
            <input
              id={`${this.headingId}-copy-name`}
              data-verification="ollama-copy-name"
              value={this.state.copyName}
              onChange={this.onCopyNameChanged}
              aria-describedby={this.copyHintId}
              spellCheck={false}
              disabled={busy}
            />
            <Button
              type="submit"
              dataVerification="ollama-copy"
              disabled={busy}
            >
              {strings.copy}
            </Button>
          </div>
        </form>
        <form onSubmit={this.onRenameSubmit}>
          <div>
            <h5>{strings.renameTitle}</h5>
            <p id={this.renameHintId}>{strings.renameHint}</p>
          </div>
          <label htmlFor={`${this.headingId}-rename-name`}>
            {strings.renameDestination}
          </label>
          <div className="ollama-inline-field">
            <input
              id={`${this.headingId}-rename-name`}
              data-verification="ollama-rename-name"
              value={this.state.renameName}
              onChange={this.onRenameNameChanged}
              aria-describedby={this.renameHintId}
              spellCheck={false}
              disabled={busy}
            />
            <Button
              type="submit"
              dataVerification="ollama-rename"
              disabled={busy}
            >
              {strings.rename}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  private renderDeleteConfirmation(
    strings: IOllamaModelManagerStrings,
    model: INormalizedModel
  ) {
    if (this.state.deleteConfirmation !== model.name) {
      return null
    }
    return (
      <div
        className="ollama-delete-confirmation"
        data-verification="ollama-delete-dialog"
        role="alertdialog"
        tabIndex={-1}
        aria-labelledby={`${this.detailsHeadingId}-delete-title`}
        aria-describedby={`${this.detailsHeadingId}-delete-description`}
      >
        <div>
          <h5 id={`${this.detailsHeadingId}-delete-title`}>
            {strings.deleteTitle}
          </h5>
          <p id={`${this.detailsHeadingId}-delete-description`}>
            {strings.confirmDelete(model.name)}
          </p>
        </div>
        <div>
          <Button
            size="small"
            dataVerification="ollama-delete-cancel"
            onClick={this.onCancelDelete}
            onKeyDown={this.onDeleteConfirmationKeyDown}
          >
            {strings.cancel}
          </Button>
          <Button
            size="small"
            className="destructive"
            dataVerification="ollama-delete-confirm"
            onClick={this.onConfirmDelete}
            onKeyDown={this.onDeleteConfirmationKeyDown}
            onButtonRef={this.onConfirmDeleteButtonRef}
          >
            {strings.deleteConfirm}
          </Button>
        </div>
      </div>
    )
  }

  private formatBytes(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      return this.getStrings().unknown
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let amount = value
    let unit = 0
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024
      unit++
    }
    const digits = unit === 0 || amount >= 10 ? 0 : 1
    return `${amount.toFixed(digits)} ${units[unit]}`
  }

  private formatDate(value: string | undefined): string {
    if (value === undefined || value.trim() === '') {
      return this.getStrings().unknown
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? boundedText(value, MaximumMetadataCharacters)
      : date.toLocaleString()
  }

  private formatMetadata(value: string | undefined): string {
    return value === undefined || value.trim() === ''
      ? this.getStrings().unknown
      : boundedText(value, MaximumMetadataCharacters)
  }

  private onRefresh = () => {
    void this.refreshInventory(false)
  }

  private onQueryChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ query: event.currentTarget.value })
  }

  private onScopeChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({ scope: event.currentTarget.value as InventoryScope })
  }

  private onPullNameChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ pullName: event.currentTarget.value })
  }

  private onCopyNameChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ copyName: event.currentTarget.value })
  }

  private onRenameNameChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ renameName: event.currentTarget.value })
  }

  private onSelectModel = (event: React.MouseEvent<HTMLButtonElement>) => {
    const model = event.currentTarget.getAttribute('data-model')
    if (model === null || model === this.state.selectedModel) {
      return
    }
    this.detailController?.abort()
    ++this.detailRequestId
    this.setState(
      {
        selectedModel: model,
        modelInformation: null,
        detailsLoading: true,
        detailsUnavailable: false,
        copyName: '',
        renameName: '',
        deleteConfirmation: null,
      },
      () => void this.loadModelInformation(model, this.props.provider)
    )
  }

  private onPullSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const name = this.state.pullName.trim()
    if (name === '') {
      this.setState({
        notice: { kind: 'error', message: this.getStrings().invalidName },
      })
      return
    }
    void this.performOperation('pull', name)
  }

  private onCopySubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const source = this.state.selectedModel
    const destination = this.state.copyName.trim()
    if (source === null || !this.validateDestination(destination, source)) {
      return
    }
    void this.performOperation('copy', source, destination)
  }

  private onRenameSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const source = this.state.selectedModel
    const destination = this.state.renameName.trim()
    if (source === null || !this.validateDestination(destination, source)) {
      return
    }
    void this.performOperation('rename', source, destination)
  }

  private validateDestination(destination: string, source: string | null) {
    const strings = this.getStrings()
    if (destination === '') {
      this.setState({ notice: { kind: 'error', message: strings.invalidName } })
      return false
    }
    if (
      destination === source ||
      this.state.models?.some(model => model.name === destination)
    ) {
      this.setState({
        notice: { kind: 'error', message: strings.duplicateName },
      })
      return false
    }
    return true
  }

  private onLoadModel = () => {
    const model = this.state.selectedModel
    if (model !== null) {
      void this.performOperation('load', model)
    }
  }

  private onUnloadModel = () => {
    const model = this.state.selectedModel
    if (model !== null) {
      void this.performOperation('unload', model)
    }
  }

  private onRequestDelete = () => {
    const model = this.state.selectedModel
    if (model === null || this.state.operation !== null) {
      return
    }
    this.setState({ deleteConfirmation: model, notice: null }, () =>
      this.confirmDeleteButton?.focus()
    )
  }

  private onCancelDelete = () => {
    this.setState({ deleteConfirmation: null }, () =>
      this.deleteButton?.focus()
    )
  }

  private onDeleteConfirmationKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.onCancelDelete()
    }
  }

  private onConfirmDelete = () => {
    const model = this.state.selectedModel
    if (model !== null && model === this.state.deleteConfirmation) {
      void this.performOperation('delete', model)
    }
  }

  private onDeleteButtonRef = (button: HTMLButtonElement | null) => {
    this.deleteButton = button
  }

  private onConfirmDeleteButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmDeleteButton = button
  }

  private onCancelPull = () => {
    if (this.state.operation?.kind !== 'pull') {
      return
    }
    ++this.operationRequestId
    this.operationController?.abort()
    this.operationController = null
    this.setState(
      {
        operation: null,
        pullProgress: null,
        notice: {
          kind: 'cancelled',
          message: this.getStrings().pullCancelled,
        },
      },
      () => void this.refreshInventory(true)
    )
  }

  private beginOperation(
    kind: OperationKind,
    model: string
  ): { readonly id: number; readonly controller: AbortController } | null {
    if (this.operationController !== null || this.state.operation !== null) {
      return null
    }
    const id = ++this.operationRequestId
    const controller = new AbortController()
    this.operationController = controller
    this.setState({
      operation: { id, kind, model },
      pullProgress: kind === 'pull' ? { completed: null, total: null } : null,
      deleteConfirmation: null,
      notice: null,
    })
    return { id, controller }
  }

  private performOperation = async (
    kind: OperationKind,
    source: string,
    destination?: string
  ) => {
    const provider = this.props.provider
    const client = this.resolveClient(provider)
    if (client === null) {
      this.setState({
        notice: { kind: 'error', message: this.getStrings().operationError },
      })
      return
    }
    const started = this.beginOperation(kind, source)
    if (started === null) {
      return
    }
    const { id, controller } = started
    const options = { signal: controller.signal }
    const isCurrent = () =>
      id === this.operationRequestId &&
      !controller.signal.aborted &&
      this.isCurrentProvider(provider)
    let renamePartial = false

    try {
      switch (kind) {
        case 'pull':
          await client.pull(source, {
            ...options,
            onProgress: this.onPullProgress(id),
          })
          if (!isCurrent()) {
            return
          }
          break
        case 'copy':
          await client.copy(source, destination!, options)
          if (!isCurrent()) {
            return
          }
          break
        case 'rename':
          await client.copy(source, destination!, options)
          if (!isCurrent()) {
            return
          }
          try {
            await client.delete(source, options)
            if (!isCurrent()) {
              return
            }
          } catch {
            if (!isCurrent()) {
              return
            }
            renamePartial = true
          }
          break
        case 'load':
          await client.load(source, options)
          if (!isCurrent()) {
            return
          }
          break
        case 'unload':
          await client.unload(source, options)
          if (!isCurrent()) {
            return
          }
          break
        case 'delete':
          await client.delete(source, options)
          if (!isCurrent()) {
            return
          }
          break
      }

      if (!isCurrent()) {
        return
      }
      const refresh = await this.refreshInventory(true, isCurrent)
      if (!isCurrent()) {
        return
      }
      const changesInstalledModels =
        kind === 'pull' ||
        kind === 'copy' ||
        kind === 'rename' ||
        kind === 'delete'
      const configurationUpdated =
        !changesInstalledModels ||
        (refresh.inventorySucceeded && refresh.providerModelsSynchronized)
      this.operationController = null
      this.setState({
        operation: null,
        pullProgress: null,
        pullName: kind === 'pull' ? '' : this.state.pullName,
        copyName: kind === 'copy' ? '' : this.state.copyName,
        renameName: kind === 'rename' ? '' : this.state.renameName,
        notice: renamePartial
          ? { kind: 'partial', message: this.getStrings().renamePartial }
          : !configurationUpdated
          ? {
              kind: 'partial',
              message: this.getStrings().configurationPartial,
            }
          : {
              kind: 'success',
              message: this.successMessage(kind, source, destination),
            },
      })
    } catch {
      if (!isCurrent()) {
        return
      }
      this.operationController = null
      this.setState({
        operation: null,
        pullProgress: null,
        notice: {
          kind: 'error',
          message: this.getStrings().operationError,
        },
      })
    }
  }

  private onPullProgress =
    (operationId: number) => (progress: IOllamaPullProgress) => {
      if (
        operationId !== this.operationRequestId ||
        this.operationController?.signal.aborted
      ) {
        return
      }
      const total = finiteNonNegative(progress.total)
      const completed = finiteNonNegative(progress.completed)
      this.setState({
        pullProgress: {
          total: total !== null && total > 0 ? total : null,
          completed,
        },
      })
    }

  private successMessage(
    kind: OperationKind,
    source: string,
    destination?: string
  ): string {
    const strings = this.getStrings()
    switch (kind) {
      case 'pull':
        return strings.pullSucceeded(source)
      case 'copy':
        return strings.copySucceeded(source, destination!)
      case 'rename':
        return strings.renameSucceeded(source, destination!)
      case 'load':
        return strings.loadSucceeded(source)
      case 'unload':
        return strings.unloadSucceeded(source)
      case 'delete':
        return strings.deleteSucceeded(source)
    }
  }
}
