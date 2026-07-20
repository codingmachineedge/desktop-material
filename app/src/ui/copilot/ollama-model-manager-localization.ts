import { translate } from '../../lib/i18n'
import type { LanguageMode } from '../../models/language-mode'
import type { IOllamaModelManagerStrings } from './ollama-model-manager'

/** Resolve the complete manager string contract for an explicit language mode. */
export function getOllamaModelManagerStrings(
  languageMode: LanguageMode
): IOllamaModelManagerStrings {
  const text = (
    key: Parameters<typeof translate>[0],
    variables: Parameters<typeof translate>[2] = {}
  ) => translate(key, languageMode, variables)

  return {
    title: text('ollama.manager.title'),
    subtitle: text('ollama.manager.subtitle'),
    endpoint: text('ollama.manager.endpoint'),
    configuredEndpoint: text('ollama.manager.configuredEndpoint'),
    connected: text('ollama.manager.connected'),
    unavailable: text('ollama.manager.unavailable'),
    checking: text('ollama.manager.checking'),
    partial: text('ollama.manager.partial'),
    version: text('ollama.manager.version'),
    installed: text('ollama.manager.installed'),
    running: text('ollama.manager.running'),
    refresh: text('ollama.manager.refresh'),
    refreshing: text('ollama.manager.refreshing'),
    searchLabel: text('ollama.manager.searchLabel'),
    searchPlaceholder: text('ollama.manager.searchPlaceholder'),
    scopeLabel: text('ollama.manager.scopeLabel'),
    allModels: text('ollama.manager.allModels'),
    runningModels: text('ollama.manager.runningModels'),
    inventoryLabel: text('ollama.manager.inventoryLabel'),
    loadingInventory: text('ollama.manager.loadingInventory'),
    unavailableInventory: text('ollama.manager.unavailableInventory'),
    emptyInventory: text('ollama.manager.emptyInventory'),
    emptyFilter: text('ollama.manager.emptyFilter'),
    modelDetails: text('ollama.manager.modelDetails'),
    selectModel: text('ollama.manager.selectModel'),
    loadingDetails: text('ollama.manager.loadingDetails'),
    runningBadge: text('ollama.manager.runningBadge'),
    size: text('ollama.manager.size'),
    modified: text('ollama.manager.modified'),
    digest: text('ollama.manager.digest'),
    family: text('ollama.manager.family'),
    format: text('ollama.manager.format'),
    parameters: text('ollama.manager.parameters'),
    quantization: text('ollama.manager.quantization'),
    capabilities: text('ollama.manager.capabilities'),
    license: text('ollama.manager.license'),
    noneReported: text('ollama.manager.noneReported'),
    runtime: text('ollama.manager.runtime'),
    vram: text('ollama.manager.vram'),
    context: text('ollama.manager.context'),
    expires: text('ollama.manager.expires'),
    notRunning: text('ollama.manager.notRunning'),
    pullTitle: text('ollama.manager.pullTitle'),
    pullHint: text('ollama.manager.pullHint'),
    modelName: text('ollama.manager.modelName'),
    pullPlaceholder: text('ollama.manager.pullPlaceholder'),
    pull: text('ollama.manager.pull'),
    pulling: text('ollama.manager.pulling'),
    cancel: text('ollama.manager.cancel'),
    receiving: text('ollama.manager.receiving'),
    copyTitle: text('ollama.manager.copyTitle'),
    copyHint: text('ollama.manager.copyHint'),
    copyDestination: text('ollama.manager.copyDestination'),
    copy: text('ollama.manager.copy'),
    renameTitle: text('ollama.manager.renameTitle'),
    renameHint: text('ollama.manager.renameHint'),
    renameDestination: text('ollama.manager.renameDestination'),
    rename: text('ollama.manager.rename'),
    load: text('ollama.manager.load'),
    unload: text('ollama.manager.unload'),
    delete: text('ollama.manager.delete'),
    deleteTitle: text('ollama.manager.deleteTitle'),
    deleteConfirm: text('ollama.manager.deleteConfirm'),
    invalidName: text('ollama.manager.invalidName'),
    duplicateName: text('ollama.manager.duplicateName'),
    operationError: text('ollama.manager.operationError'),
    refreshError: text('ollama.manager.refreshError'),
    detailsError: text('ollama.manager.detailsError'),
    configurationPartial: text('ollama.manager.configurationPartial'),
    renamePartial: text('ollama.manager.renamePartial'),
    pullCancelled: text('ollama.manager.pullCancelled'),
    unknown: text('ollama.manager.unknown'),
    never: text('ollama.manager.never'),
    showing: (visible, total) =>
      text('ollama.manager.showing', {
        visible: String(visible),
        total: String(total),
      }),
    selectedModel: name => text('ollama.manager.selectedModel', { name }),
    moreCapabilities: count =>
      text('ollama.manager.moreCapabilities', { count: String(count) }),
    pullProgress: percent =>
      text('ollama.manager.pullProgress', { percent: String(percent) }),
    pullSucceeded: name => text('ollama.manager.pullSucceeded', { name }),
    copySucceeded: (source, destination) =>
      text('ollama.manager.copySucceeded', { source, destination }),
    renameSucceeded: (source, destination) =>
      text('ollama.manager.renameSucceeded', { source, destination }),
    loadSucceeded: name => text('ollama.manager.loadSucceeded', { name }),
    unloadSucceeded: name => text('ollama.manager.unloadSucceeded', { name }),
    deleteSucceeded: name => text('ollama.manager.deleteSucceeded', { name }),
    confirmDelete: name => text('ollama.manager.confirmDelete', { name }),
  }
}
