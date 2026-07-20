import * as React from 'react'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
} from '../../lib/i18n'
import {
  isOllamaBYOKProvider,
  type IBYOKProvider,
} from '../../lib/copilot/byok'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import {
  buildOllamaModelManagerStrings,
  OllamaModelManager,
  type IOllamaManagerProvider,
  type IOllamaManagerProviderModel,
  type IOllamaModelManagerClient,
} from './ollama-model-manager'

export interface IOllamaModelManagerDialogProps {
  readonly provider: IBYOKProvider
  readonly client?: IOllamaModelManagerClient
  readonly clientFactory?: (
    provider: IOllamaManagerProvider
  ) => IOllamaModelManagerClient
  readonly onProviderModelsChanged: (
    provider: IOllamaManagerProvider,
    models: ReadonlyArray<IOllamaManagerProviderModel>
  ) => Promise<void> | void
  readonly onDismissed: () => void
}

interface IOllamaModelManagerDialogState {
  readonly languageMode: LanguageMode
}

/**
 * Resolve an authoritative inventory update against the provider that still
 * exists in current app state. The popup's captured provider is never allowed
 * to overwrite another provider or a provider whose endpoint was edited while
 * an inventory request was in flight.
 */
export function getOllamaProviderModelsUpdate(
  providers: ReadonlyArray<IBYOKProvider>,
  source: IOllamaManagerProvider,
  models: ReadonlyArray<IOllamaManagerProviderModel>
): IBYOKProvider | null {
  const current = providers.find(provider => provider.id === source.id)
  if (
    current === undefined ||
    !isOllamaBYOKProvider(current) ||
    current.baseUrl !== source.baseUrl
  ) {
    return null
  }

  return {
    ...current,
    models: models.map(model => ({ id: model.id, name: model.name })),
  }
}

/** Provider-bound popup shell for the native Ollama lifecycle manager. */
export class OllamaModelManagerDialog extends React.Component<
  IOllamaModelManagerDialogProps,
  IOllamaModelManagerDialogState
> {
  public constructor(props: IOllamaModelManagerDialogProps) {
    super(props)
    this.state = { languageMode: getPersistedLanguageMode() }
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

  public render() {
    const strings = buildOllamaModelManagerStrings((key, variables) =>
      translate(key, this.state.languageMode, variables)
    )

    return (
      <Dialog
        id="ollama-model-manager"
        title={strings.title}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent className="ollama-model-manager-dialog-content">
          <div data-verification="ollama-manager-dialog">
            <OllamaModelManager
              provider={this.props.provider}
              client={this.props.client}
              clientFactory={this.props.clientFactory}
              onProviderModelsChanged={this.props.onProviderModelsChanged}
              strings={strings}
            />
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            type="button"
            dataVerification="ollama-manager-back"
            onClick={this.props.onDismissed}
          >
            {translate(
              'ollama.manager.backAction',
              this.state.languageMode
            )}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }
}
