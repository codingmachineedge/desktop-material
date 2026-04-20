import * as React from 'react'
import { Dialog, DialogContent, DialogFooter, DialogError } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  IBYOKProvider,
  IBYOKModel,
  BYOKProviderType,
  BYOKAuthKind,
  BYOKWireApi,
} from '../../lib/copilot/byok'

interface IEditCopilotBYOKProviderDialogProps {
  /** Provider to edit, or `null` when adding a new one. */
  readonly provider: IBYOKProvider | null
  readonly onSave: (
    provider: IBYOKProvider,
    secret: string | null | undefined
  ) => void
  readonly onDismissed: () => void
}

interface IEditCopilotBYOKProviderDialogState {
  readonly name: string
  readonly type: BYOKProviderType
  readonly baseUrl: string
  readonly wireApi: BYOKWireApi
  readonly azureApiVersion: string
  readonly authKind: BYOKAuthKind
  /**
   * The secret as entered by the user. Empty string while editing means "do
   * not change the stored secret"; while adding it means "no secret".
   */
  readonly secret: string
  /**
   * Per-provider request timeout in seconds, as a string so the field can be
   * empty (meaning "use the default").
   */
  readonly requestTimeoutSeconds: string
  readonly models: ReadonlyArray<IBYOKModel>
  readonly errorMessage: string | null
}

const DefaultModel: IBYOKModel = {
  id: '',
  name: '',
}

/**
 * Dialog used to add or edit a single BYOK Copilot provider, including its
 * model list and (separately stored) secret.
 */
interface IModelRowProps {
  readonly index: number
  readonly model: IBYOKModel
  readonly canRemove: boolean
  readonly onIdChanged: (index: number, id: string) => void
  readonly onNameChanged: (index: number, name: string) => void
  readonly onReasoningChanged: (index: number, value: boolean) => void
  readonly onRemove: (index: number) => void
}

class ModelRow extends React.Component<IModelRowProps> {
  public render() {
    const { model, canRemove } = this.props
    return (
      <div className="copilot-byok-model-row">
        <TextBox
          label="Model ID"
          value={model.id}
          onValueChanged={this.onIdChanged}
          placeholder="gpt-4o"
        />
        <TextBox
          label="Display name"
          value={model.name}
          onValueChanged={this.onNameChanged}
          placeholder="GPT-4o"
        />
        <Checkbox
          label="Reasoning"
          value={
            model.supportsReasoningEffort === true
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onReasoningChanged}
        />
        <Button
          onClick={this.onRemove}
          ariaLabel="Remove model"
          disabled={!canRemove}
        >
          <Octicon symbol={octicons.trash} />
        </Button>
      </div>
    )
  }

  private onIdChanged = (id: string) =>
    this.props.onIdChanged(this.props.index, id)

  private onNameChanged = (name: string) =>
    this.props.onNameChanged(this.props.index, name)

  private onReasoningChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.props.onReasoningChanged(this.props.index, event.currentTarget.checked)

  private onRemove = () => this.props.onRemove(this.props.index)
}

/**
 * Returns a hint URL appropriate for the given provider type, used as the
 * placeholder in the Base URL field.
 */
function getBaseUrlPlaceholder(type: BYOKProviderType): string {
  switch (type) {
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'azure':
      return 'https://<resource>.openai.azure.com/'
    case 'anthropic':
      return 'https://api.anthropic.com'
  }
}
export class EditCopilotBYOKProviderDialog extends React.Component<
  IEditCopilotBYOKProviderDialogProps,
  IEditCopilotBYOKProviderDialogState
> {
  public constructor(props: IEditCopilotBYOKProviderDialogProps) {
    super(props)

    const provider = props.provider

    this.state = {
      name: provider?.name ?? '',
      type: provider?.type ?? 'openai',
      baseUrl: provider?.baseUrl ?? '',
      wireApi: provider?.wireApi ?? 'completions',
      azureApiVersion: provider?.azureApiVersion ?? '',
      authKind: provider?.authKind ?? 'apiKey',
      secret: '',
      requestTimeoutSeconds:
        provider?.requestTimeoutSeconds !== undefined
          ? String(provider.requestTimeoutSeconds)
          : '',
      models:
        provider && provider.models.length > 0
          ? [...provider.models]
          : [{ ...DefaultModel }],
      errorMessage: null,
    }
  }

  public render() {
    const isEditing = this.props.provider !== null
    const title = isEditing
      ? __DARWIN__
        ? 'Edit Custom Provider'
        : 'Edit custom provider'
      : __DARWIN__
      ? 'Add Custom Provider'
      : 'Add custom provider'

    return (
      <Dialog
        id="edit-copilot-byok-provider"
        title={title}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        {this.state.errorMessage !== null && (
          <DialogError>{this.state.errorMessage}</DialogError>
        )}
        <DialogContent>
          {this.renderProviderSection()}
          {this.renderAuthenticationSection(isEditing)}
          {this.renderModelsSection()}
          {this.renderAdvancedSection()}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup okButtonText={isEditing ? 'Save' : 'Add'} />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderProviderSection() {
    return (
      <fieldset className="copilot-byok-fieldset">
        <legend>Provider</legend>
        <TextBox
          label="Name"
          value={this.state.name}
          onValueChanged={this.onNameChanged}
          placeholder="My provider"
          required={true}
          autoFocus={true}
        />
        <Select
          label="Type"
          value={this.state.type}
          onChange={this.onTypeChanged}
        >
          <option value="openai">OpenAI / OpenAI-compatible</option>
          <option value="azure">Azure</option>
          <option value="anthropic">Anthropic</option>
        </Select>
        <TextBox
          label={__DARWIN__ ? 'Base URL' : 'Base URL'}
          value={this.state.baseUrl}
          onValueChanged={this.onBaseUrlChanged}
          placeholder={getBaseUrlPlaceholder(this.state.type)}
          required={true}
        />
        {this.state.type === 'openai' && (
          <Select
            label={__DARWIN__ ? 'Wire API' : 'Wire API'}
            value={this.state.wireApi}
            onChange={this.onWireApiChanged}
          >
            <option value="completions">Chat completions (default)</option>
            <option value="responses">Responses (GPT-5 series)</option>
          </Select>
        )}
        {this.state.type === 'azure' && (
          <TextBox
            label={__DARWIN__ ? 'Azure API Version' : 'Azure API version'}
            value={this.state.azureApiVersion}
            onValueChanged={this.onAzureApiVersionChanged}
            placeholder="2024-10-21"
          />
        )}
      </fieldset>
    )
  }

  private renderAuthenticationSection(isEditing: boolean) {
    return (
      <fieldset className="copilot-byok-fieldset">
        <legend>Authentication</legend>
        <Select
          label={__DARWIN__ ? 'Authentication' : 'Authentication'}
          value={this.state.authKind}
          onChange={this.onAuthKindChanged}
        >
          <option value="apiKey">API key</option>
          <option value="bearer">Bearer token</option>
          <option value="none">None (local provider)</option>
        </Select>
        {this.state.authKind !== 'none' && (
          <TextBox
            label={
              this.state.authKind === 'bearer' ? 'Bearer token' : 'API key'
            }
            type="password"
            value={this.state.secret}
            onValueChanged={this.onSecretChanged}
            placeholder={isEditing ? '(unchanged)' : ''}
          />
        )}
        {this.state.authKind === 'none' && (
          <p className="copilot-byok-section-hint">
            No credentials will be sent. Suitable for local providers like
            Ollama or Foundry Local.
          </p>
        )}
      </fieldset>
    )
  }

  private renderModelsSection() {
    return (
      <fieldset className="copilot-byok-fieldset copilot-byok-models">
        <legend>Models</legend>
        <p className="copilot-byok-section-hint">
          Add the models you want to make available. The model ID must match
          what the provider expects.
        </p>
        {this.state.models.map((m, i) => (
          <ModelRow
            key={i}
            index={i}
            model={m}
            canRemove={this.state.models.length > 1}
            onIdChanged={this.onModelIdChanged}
            onNameChanged={this.onModelNameChanged}
            onReasoningChanged={this.onModelReasoningChanged}
            onRemove={this.onRemoveModel}
          />
        ))}
        <Button onClick={this.onAddModel}>
          <Octicon symbol={octicons.plus} />
          {__DARWIN__ ? 'Add Model' : 'Add model'}
        </Button>
      </fieldset>
    )
  }

  private renderAdvancedSection() {
    return (
      <fieldset className="copilot-byok-fieldset">
        <legend>Advanced</legend>
        <TextBox
          label={
            __DARWIN__
              ? 'Request Timeout (seconds)'
              : 'Request timeout (seconds)'
          }
          value={this.state.requestTimeoutSeconds}
          onValueChanged={this.onRequestTimeoutChanged}
          placeholder="60"
        />
        <p className="copilot-byok-section-hint">
          How long to wait for a response before giving up. Leave blank to use
          the default.
        </p>
      </fieldset>
    )
  }

  private onNameChanged = (name: string) => this.setState({ name })

  private onTypeChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ type: event.currentTarget.value as BYOKProviderType })
  }

  private onBaseUrlChanged = (baseUrl: string) => this.setState({ baseUrl })

  private onWireApiChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ wireApi: event.currentTarget.value as BYOKWireApi })
  }

  private onAzureApiVersionChanged = (azureApiVersion: string) =>
    this.setState({ azureApiVersion })

  private onAuthKindChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ authKind: event.currentTarget.value as BYOKAuthKind })
  }

  private onSecretChanged = (secret: string) => this.setState({ secret })

  private onRequestTimeoutChanged = (requestTimeoutSeconds: string) =>
    this.setState({ requestTimeoutSeconds })

  private onModelIdChanged = (index: number, id: string) => {
    this.setState(state => ({
      models: state.models.map((m, i) => (i === index ? { ...m, id } : m)),
    }))
  }

  private onModelNameChanged = (index: number, name: string) => {
    this.setState(state => ({
      models: state.models.map((m, i) => (i === index ? { ...m, name } : m)),
    }))
  }

  private onModelReasoningChanged = (
    index: number,
    supportsReasoningEffort: boolean
  ) => {
    this.setState(state => ({
      models: state.models.map((m, i) =>
        i === index ? { ...m, supportsReasoningEffort } : m
      ),
    }))
  }

  private onAddModel = () => {
    this.setState(state => ({ models: [...state.models, { ...DefaultModel }] }))
  }

  private onRemoveModel = (index: number) => {
    this.setState(state => ({
      models:
        state.models.length > 1
          ? state.models.filter((_, i) => i !== index)
          : state.models,
    }))
  }

  private onSubmit = () => {
    const validationError = this.validate()
    if (validationError !== null) {
      this.setState({ errorMessage: validationError })
      return
    }

    const existing = this.props.provider
    const id = existing?.id ?? crypto.randomUUID()
    const trimmedModels = this.state.models.map(m => ({
      id: m.id.trim(),
      name: m.name.trim() === '' ? m.id.trim() : m.name.trim(),
      ...(m.supportsReasoningEffort === true
        ? { supportsReasoningEffort: true }
        : {}),
    }))

    const provider: IBYOKProvider = {
      id,
      name: this.state.name.trim(),
      type: this.state.type,
      baseUrl: this.state.baseUrl.trim(),
      authKind: this.state.authKind,
      models: trimmedModels,
      ...(this.state.type === 'openai' ? { wireApi: this.state.wireApi } : {}),
      ...(this.state.type === 'azure' &&
      this.state.azureApiVersion.trim() !== ''
        ? { azureApiVersion: this.state.azureApiVersion.trim() }
        : {}),
      ...(this.state.requestTimeoutSeconds.trim() !== ''
        ? {
            requestTimeoutSeconds: Number(
              this.state.requestTimeoutSeconds.trim()
            ),
          }
        : {}),
    }

    // Distinguish "user typed a new secret" from "leave alone" (edit-only).
    const secret =
      this.state.authKind === 'none'
        ? null
        : this.state.secret.length > 0
        ? this.state.secret
        : existing === null
        ? null
        : undefined

    this.props.onSave(provider, secret)
    this.props.onDismissed()
  }

  private validate(): string | null {
    if (this.state.name.trim() === '') {
      return 'Please enter a name.'
    }

    const trimmedUrl = this.state.baseUrl.trim()
    if (trimmedUrl === '') {
      return 'Please enter a base URL.'
    }
    try {
      const parsed = new URL(trimmedUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Base URL must use http or https.'
      }
    } catch {
      return 'Base URL is not a valid URL.'
    }

    const trimmedModels = this.state.models.filter(m => m.id.trim() !== '')
    if (trimmedModels.length === 0) {
      return 'Please add at least one model.'
    }

    const ids = new Set<string>()
    for (const model of trimmedModels) {
      const id = model.id.trim()
      if (ids.has(id)) {
        return `Duplicate model ID '${id}'.`
      }
      ids.add(id)
    }

    if (
      this.state.authKind !== 'none' &&
      this.props.provider === null &&
      this.state.secret.length === 0
    ) {
      return this.state.authKind === 'bearer'
        ? 'Please enter a bearer token.'
        : 'Please enter an API key.'
    }

    const trimmedTimeout = this.state.requestTimeoutSeconds.trim()
    if (trimmedTimeout !== '') {
      const timeout = Number(trimmedTimeout)
      if (!Number.isFinite(timeout) || timeout <= 0) {
        return 'Request timeout must be a positive number of seconds.'
      }
    }

    return null
  }
}
