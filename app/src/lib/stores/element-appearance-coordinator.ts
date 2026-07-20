import { createHash, randomUUID } from 'crypto'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'

import { Disposable } from 'event-kit'

import {
  DefaultAppearanceCustomization,
  IAppearanceCustomization,
  IRepositoryAppearanceOverrides,
  normalizeAppearanceCustomization,
} from '../../models/appearance-customization'
import {
  IElementAppearanceDocument,
  IFeatureHighlightAppearance,
  IProfileAppearanceElementSettings,
  IRepositoryAppearanceElementSettings,
  ITabTitleAppearance,
  ProfileAppearanceElementId,
  RepositoryAppearanceElementId,
  elementAppearanceDocument,
  isElementAppearanceDocument,
  mergeProfileAppearance,
  normalizeFeatureHighlightAppearance,
  normalizeProfileAppearanceElement,
  normalizeTabTitleAppearance,
  splitProfileAppearance,
} from '../../models/element-appearance'
import { ProfileKey } from '../../models/profile'
import { Repository } from '../../models/repository'
import { ITabTitleStyle } from '../../models/repository-tab'
import {
  AppearanceCustomizationStorageKey,
  getAppearanceCustomization,
  getRepositoryAppearanceOverrides,
  setAppearanceCustomization,
} from '../appearance-customization'
import { readCrashSafeText } from '../crash-safe-file'
import { getConfigValue, setConfigValue } from '../git/config'
import { withProfileRepositoryLock } from '../profiles/profile-git'
import { getPath } from '../../ui/main-process-proxy'
import { IVersionedStoreHistorySource } from '../../ui/version-history/versioned-store-history'
import { TypedBaseStore } from './base-store'
import { DedicatedSettingStore } from './dedicated-setting-store'
import { ProfileStore } from './profile-store'

export const RepositoryAppearanceIdConfigKey = 'desktop-material.appearance-id'

const SettingCommitDelayMs = 250
const RepositoryAppearanceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const repositoryAppearanceIdInitializations = new Map<string, Promise<string>>()

type ProfileDocument<K extends ProfileAppearanceElementId> =
  IElementAppearanceDocument<IProfileAppearanceElementSettings[K]>

type AnyProfileDocument = IElementAppearanceDocument<
  IProfileAppearanceElementSettings[ProfileAppearanceElementId]
>

type RepositoryDocument<K extends RepositoryAppearanceElementId> =
  IElementAppearanceDocument<IRepositoryAppearanceElementSettings[K]>

type AnyRepositoryDocument = IElementAppearanceDocument<
  IRepositoryAppearanceElementSettings[RepositoryAppearanceElementId]
>

export interface IElementAppearanceCoordinatorState {
  readonly appearance: IAppearanceCustomization
  readonly featureHighlights: Readonly<Record<string, boolean>>
  readonly initialized: boolean
  readonly activeProfileKey: ProfileKey
}

/**
 * Coordinates independent element repositories while exposing the legacy
 * aggregate solely as a renderer projection. No edit spans two Git histories.
 */
export class ElementAppearanceCoordinator extends TypedBaseStore<IElementAppearanceCoordinatorState> {
  private rootPath: string | null = null
  private initialized = false
  private activeProfileKey: ProfileKey
  private appearance = getAppearanceCustomization()
  private featureHighlights: Readonly<Record<string, boolean>> = {}
  private readonly profileStores = new Map<
    ProfileAppearanceElementId,
    DedicatedSettingStore<AnyProfileDocument>
  >()
  private readonly featureStores = new Map<
    string,
    DedicatedSettingStore<
      IElementAppearanceDocument<IFeatureHighlightAppearance>
    >
  >()
  private readonly tabStores = new Map<
    string,
    DedicatedSettingStore<IElementAppearanceDocument<ITabTitleAppearance>>
  >()
  private readonly repositoryStores = new Map<
    string,
    DedicatedSettingStore<AnyRepositoryDocument>
  >()
  private readonly featureInitializations = new Map<string, Promise<void>>()
  private readonly tabInitializations = new Map<string, Promise<void>>()
  private readonly repositoryInitializations = new Map<string, Promise<void>>()
  private readonly elementSubscriptions = new Array<Disposable>()
  private profileSwitchTail: Promise<void> = Promise.resolve()

  public constructor(private readonly profileStore: ProfileStore) {
    super()
    this.activeProfileKey = profileStore.getActiveProfileKey()
  }

  public getState(): IElementAppearanceCoordinatorState {
    return {
      appearance: this.appearance,
      featureHighlights: this.featureHighlights,
      initialized: this.initialized,
      activeProfileKey: this.activeProfileKey,
    }
  }

  public async initialize(rootPath?: string): Promise<void> {
    this.rootPath = resolve(
      rootPath ?? join(await getPath('userData'), 'appearance-elements')
    )
    await this.switchToActiveProfile()
    this.profileStore.onDidUpdate(() => {
      this.profileSwitchTail = this.profileSwitchTail
        .catch(() => undefined)
        .then(() => this.switchToActiveProfile())
      void this.profileSwitchTail.catch(error => this.emitError(asError(error)))
    })
  }

  public async flush(): Promise<void> {
    await this.profileSwitchTail
    await Promise.all([
      ...[...this.profileStores.values()].map(store => store.flush()),
      ...[...this.featureStores.values()].map(store => store.flush()),
      ...[...this.tabStores.values()].map(store => store.flush()),
      ...[...this.repositoryStores.values()].map(store => store.flush()),
    ])
  }

  public getProfileElement<K extends ProfileAppearanceElementId>(
    id: K
  ): IProfileAppearanceElementSettings[K] {
    const store = this.requireProfileStore(id)
    return store.getState().setting
      .value as IProfileAppearanceElementSettings[K]
  }

  public async setProfileElement<K extends ProfileAppearanceElementId>(
    id: K,
    value: IProfileAppearanceElementSettings[K],
    description: string = `Update ${id} appearance`
  ): Promise<void> {
    const store = this.requireProfileStore(id)
    const normalized = normalizeProfileAppearanceElement(id, value)
    await store.set(
      elementAppearanceDocument(normalized) as ProfileDocument<K>,
      description
    )
  }

  /** Split a compatibility projection into independent element commits. */
  public async setAppearanceProjection(
    value: IAppearanceCustomization
  ): Promise<IAppearanceCustomization> {
    const normalized = normalizeAppearanceCustomization(value)
    const split = splitProfileAppearance(normalized)
    const operations = new Array<Promise<void>>()

    for (const id of profileElementIds()) {
      const current = this.getProfileElement(id)
      const next = split[id]
      if (!jsonEqual(current, next)) {
        operations.push(
          this.setProfileElement(
            id,
            next,
            `Update ${humanizeElementId(id)} appearance`
          )
        )
      }
    }

    // Language is deliberately an ordinary profile setting, not an element
    // history. Writing the projection updates only its independent preference.
    setAppearanceCustomization(normalized)
    await Promise.all(operations)
    this.rebuildAppearanceProjection(normalized.languageMode)
    return this.appearance
  }

  public getProfileHistorySource<K extends ProfileAppearanceElementId>(
    id: K
  ): IVersionedStoreHistorySource {
    return historySource(this.requireProfileStore(id))
  }

  public getProfileRepositoryPath<K extends ProfileAppearanceElementId>(
    id: K
  ): string {
    return this.requireProfileStore(id).getRepositoryPath()
  }

  public async ensureFeatureElement(
    featureId: string,
    seed: boolean = this.appearance.highlightDesktopMaterialFeatures
  ): Promise<IFeatureHighlightAppearance> {
    const canonicalId = normalizeFeatureId(featureId)
    const key = stableElementKey(canonicalId)
    let store = this.featureStores.get(key)
    let initialization = this.featureInitializations.get(key)
    if (store === undefined) {
      store = new DedicatedSettingStore({
        repositoryPath: this.elementPath(
          'features',
          stableElementKey(canonicalId)
        ),
        ownershipRootPath: this.storageOwnershipRoot(),
        seed: elementAppearanceDocument({ highlighted: seed }),
        validate: isFeatureDocument,
        normalize: document =>
          elementAppearanceDocument(
            normalizeFeatureHighlightAppearance(document.value, seed)
          ),
        commitDelayMs: SettingCommitDelayMs,
        initializationMessage: `Initialize ${canonicalId} appearance`,
      })
      this.featureStores.set(key, store)
      this.observe(store, () => this.rebuildFeatureProjection())
      initialization = store.initialize()
      this.featureInitializations.set(key, initialization)
    }
    await (initialization ?? store.initialize())
    this.rebuildFeatureProjection()
    return store.getState().setting.value
  }

  public async setFeatureElement(
    featureId: string,
    highlighted: boolean
  ): Promise<void> {
    await this.ensureFeatureElement(featureId)
    const store = this.requireFeatureStore(featureId)
    await store.set(
      elementAppearanceDocument({ highlighted }),
      `${highlighted ? 'Highlight' : 'Unhighlight'} ${normalizeFeatureId(
        featureId
      )}`
    )
  }

  public getFeatureHistorySource(
    featureId: string
  ): IVersionedStoreHistorySource {
    return historySource(this.requireFeatureStore(featureId))
  }

  public getFeatureRepositoryPath(featureId: string): string {
    return this.requireFeatureStore(featureId).getRepositoryPath()
  }

  public async ensureTabTitleElement(
    tabId: string,
    seed: ITabTitleStyle | null
  ): Promise<ITabTitleAppearance> {
    const key = stableElementKey(tabId)
    let store = this.tabStores.get(key)
    let initialization = this.tabInitializations.get(key)
    if (store === undefined) {
      store = new DedicatedSettingStore({
        repositoryPath: this.elementPath('tabs', key, 'title-style'),
        ownershipRootPath: this.storageOwnershipRoot(),
        seed: elementAppearanceDocument({ style: seed }),
        validate: isTabTitleDocument,
        normalize: document =>
          elementAppearanceDocument(
            normalizeTabTitleAppearance(document.value)
          ),
        commitDelayMs: SettingCommitDelayMs,
        initializationMessage: 'Initialize tab title appearance',
      })
      this.tabStores.set(key, store)
      this.observe(store, () => this.emitUpdate(this.getState()))
      initialization = store.initialize()
      this.tabInitializations.set(key, initialization)
    }
    await (initialization ?? store.initialize())
    return store.getState().setting.value
  }

  public async setTabTitleElement(
    tabId: string,
    style: ITabTitleStyle | null
  ): Promise<void> {
    await this.ensureTabTitleElement(tabId, style)
    await this.requireTabStore(tabId).set(
      elementAppearanceDocument(normalizeTabTitleAppearance({ style })),
      'Update tab title appearance'
    )
  }

  public getTabTitleHistorySource(tabId: string): IVersionedStoreHistorySource {
    return historySource(this.requireTabStore(tabId))
  }

  public getTabTitleRepositoryPath(tabId: string): string {
    return this.requireTabStore(tabId).getRepositoryPath()
  }

  public async ensureRepositoryElements(
    repository: Repository,
    legacyOverrides?: IRepositoryAppearanceOverrides
  ): Promise<IRepositoryAppearanceElementSettings> {
    const appearanceId = await ensureRepositoryAppearanceId(repository)
    const overrides =
      legacyOverrides ?? (await getRepositoryAppearanceOverrides(repository))
    const seeds = repositorySeeds(overrides)

    await Promise.all(
      repositoryElementIds().map(async id => {
        const key = repositoryStoreKey(appearanceId, id)
        const existing = this.repositoryStores.get(key)
        const existingInitialization = this.repositoryInitializations.get(key)
        if (existing !== undefined) {
          await (existingInitialization ?? existing.initialize())
          return
        }
        const store = new DedicatedSettingStore<AnyRepositoryDocument>({
          repositoryPath: this.elementPath('repositories', appearanceId, id),
          ownershipRootPath: this.storageOwnershipRoot(),
          seed: elementAppearanceDocument(seeds[id]) as AnyRepositoryDocument,
          validate: (value): value is AnyRepositoryDocument =>
            isRepositoryDocument(id, value),
          normalize: document =>
            elementAppearanceDocument(
              normalizeRepositoryElement(id, document.value)
            ) as AnyRepositoryDocument,
          commitDelayMs: SettingCommitDelayMs,
          initializationMessage: `Initialize repository ${id} appearance`,
        })
        this.repositoryStores.set(key, store)
        this.observe(store, () => this.emitUpdate(this.getState()))
        const initialization = store.initialize()
        this.repositoryInitializations.set(key, initialization)
        await initialization
      })
    )

    return this.getRepositoryElementsById(appearanceId)
  }

  public async setRepositoryElement<K extends RepositoryAppearanceElementId>(
    repository: Repository,
    id: K,
    value: IRepositoryAppearanceElementSettings[K]
  ): Promise<void> {
    const appearanceId = await ensureRepositoryAppearanceId(repository)
    await this.ensureRepositoryElements(repository)
    const store = this.requireRepositoryStore(appearanceId, id)
    await store.set(
      elementAppearanceDocument(
        normalizeRepositoryElement(id, value)
      ) as RepositoryDocument<K>,
      `Update repository ${id} appearance`
    )
  }

  public async getRepositoryHistorySource(
    repository: Repository,
    id: RepositoryAppearanceElementId
  ): Promise<IVersionedStoreHistorySource> {
    const appearanceId = await ensureRepositoryAppearanceId(repository)
    await this.ensureRepositoryElements(repository)
    return historySource(this.requireRepositoryStore(appearanceId, id))
  }

  public async getRepositoryElementPath(
    repository: Repository,
    id: RepositoryAppearanceElementId
  ): Promise<string> {
    const appearanceId = await ensureRepositoryAppearanceId(repository)
    await this.ensureRepositoryElements(repository)
    return this.requireRepositoryStore(appearanceId, id).getRepositoryPath()
  }

  private async switchToActiveProfile(): Promise<void> {
    if (this.rootPath === null) {
      throw new Error('Element appearance coordinator has no root path')
    }

    this.disposeElementSubscriptions()
    this.profileStores.clear()
    this.featureStores.clear()
    this.tabStores.clear()
    this.repositoryStores.clear()
    this.featureInitializations.clear()
    this.tabInitializations.clear()
    this.repositoryInitializations.clear()
    this.featureHighlights = {}
    this.initialized = false
    this.activeProfileKey = this.profileStore.getActiveProfileKey()

    const legacy = await this.readLegacyProfileProjection()
    const seeds = splitProfileAppearance(legacy)

    await forEachWithConcurrency(profileElementIds(), 3, async id => {
      const store = new DedicatedSettingStore<AnyProfileDocument>({
        repositoryPath: this.elementPath('profile', id),
        ownershipRootPath: this.storageOwnershipRoot(),
        seed: elementAppearanceDocument(seeds[id]) as AnyProfileDocument,
        validate: (value): value is AnyProfileDocument =>
          isProfileDocument(id, value),
        normalize: document =>
          elementAppearanceDocument(
            normalizeProfileAppearanceElement(id, document.value)
          ) as AnyProfileDocument,
        commitDelayMs: SettingCommitDelayMs,
        initializationMessage: `Initialize ${humanizeElementId(id)} appearance`,
      })
      this.profileStores.set(id, store)
      this.observe(store, () => this.rebuildAppearanceProjection())
      await store.initialize()
    })

    this.initialized = true
    this.rebuildAppearanceProjection(legacy.languageMode)
  }

  private async readLegacyProfileProjection(): Promise<IAppearanceCustomization> {
    const profilePath = this.profileStore.getActiveProfileRepositoryPath()
    if (profilePath !== null) {
      try {
        const saved = await readCrashSafeText(
          join(profilePath, 'settings.json'),
          {
            validate: isProfileSettingsText,
          }
        )
        if (saved !== null) {
          const parsed = JSON.parse(saved.contents) as {
            readonly settings: Record<string, string>
          }
          const serialized = parsed.settings[AppearanceCustomizationStorageKey]
          if (serialized !== undefined) {
            const candidate: unknown = JSON.parse(serialized)
            return normalizeAppearanceCustomization(candidate)
          }
        }
      } catch {
        // The local projection remains a safe migration fallback.
      }
    }
    return getAppearanceCustomization()
  }

  private rebuildAppearanceProjection(
    languageMode = this.appearance.languageMode
  ) {
    if (
      this.profileStores.size !== profileElementIds().length ||
      [...this.profileStores.values()].some(
        store => !store.getState().initialized
      )
    ) {
      return
    }
    const values: IProfileAppearanceElementSettings = {
      [ProfileAppearanceElementId.AppWorkspace]: this.getProfileElement(
        ProfileAppearanceElementId.AppWorkspace
      ),
      [ProfileAppearanceElementId.UpdateProgress]: this.getProfileElement(
        ProfileAppearanceElementId.UpdateProgress
      ),
      [ProfileAppearanceElementId.Toolbar]: this.getProfileElement(
        ProfileAppearanceElementId.Toolbar
      ),
      [ProfileAppearanceElementId.RepositoryList]: this.getProfileElement(
        ProfileAppearanceElementId.RepositoryList
      ),
      [ProfileAppearanceElementId.RepositoryTabs]: this.getProfileElement(
        ProfileAppearanceElementId.RepositoryTabs
      ),
      [ProfileAppearanceElementId.CodeDiff]: this.getProfileElement(
        ProfileAppearanceElementId.CodeDiff
      ),
      [ProfileAppearanceElementId.SubmoduleBackButton]: this.getProfileElement(
        ProfileAppearanceElementId.SubmoduleBackButton
      ),
      [ProfileAppearanceElementId.AppIdentity]: this.getProfileElement(
        ProfileAppearanceElementId.AppIdentity
      ),
      [ProfileAppearanceElementId.DefaultRepositoryLogo]:
        this.getProfileElement(
          ProfileAppearanceElementId.DefaultRepositoryLogo
        ),
    }
    this.appearance = mergeProfileAppearance(
      { languageMode },
      values,
      this.appearance.highlightDesktopMaterialFeatures
    )
    // Retain a bounded startup cache only. Element stores remain authoritative.
    setAppearanceCustomization(this.appearance)
    this.emitUpdate(this.getState())
  }

  private rebuildFeatureProjection() {
    const next: Record<string, boolean> = {}
    for (const [key, store] of this.featureStores) {
      if (store.getState().initialized) {
        next[key] = store.getState().setting.value.highlighted
      }
    }
    this.featureHighlights = next
    this.emitUpdate(this.getState())
  }

  private elementPath(...parts: ReadonlyArray<string>): string {
    const ownedRoot = this.elementOwnershipRoot()
    const path = resolve(ownedRoot, ...parts)
    if (!isPathWithinOrEqual(ownedRoot, path) || path === ownedRoot) {
      throw new Error('Element appearance path escaped its profile root')
    }
    return path
  }

  private elementOwnershipRoot(): string {
    if (this.rootPath === null) {
      throw new Error('Element appearance coordinator has no root path')
    }
    const profileRepositoryPath =
      this.profileStore.getActiveProfileRepositoryPath()
    const profileDirectory =
      profileRepositoryPath === null
        ? stableElementKey(String(this.activeProfileKey))
        : basename(profileRepositoryPath)
    return resolve(this.rootPath, profileDirectory)
  }

  private storageOwnershipRoot(): string {
    if (this.rootPath === null) {
      throw new Error('Element appearance coordinator has no root path')
    }
    return this.rootPath
  }

  private observe<T>(store: DedicatedSettingStore<T>, onUpdate: () => void) {
    this.elementSubscriptions.push(store.onDidUpdate(onUpdate))
    this.elementSubscriptions.push(
      store.onDidError(error => this.emitError(error))
    )
  }

  private disposeElementSubscriptions() {
    for (const subscription of this.elementSubscriptions.splice(0)) {
      subscription.dispose()
    }
  }

  private requireProfileStore<K extends ProfileAppearanceElementId>(
    id: K
  ): DedicatedSettingStore<ProfileDocument<K>> {
    const store = this.profileStores.get(id)
    if (store === undefined || !store.getState().initialized) {
      throw new Error(`${id} appearance is not initialized`)
    }
    return store as unknown as DedicatedSettingStore<ProfileDocument<K>>
  }

  private requireFeatureStore(
    featureId: string
  ): DedicatedSettingStore<
    IElementAppearanceDocument<IFeatureHighlightAppearance>
  > {
    const canonicalId = normalizeFeatureId(featureId)
    const store = this.featureStores.get(stableElementKey(canonicalId))
    if (store === undefined || !store.getState().initialized) {
      throw new Error(`${featureId} appearance is not initialized`)
    }
    return store
  }

  private requireTabStore(
    tabId: string
  ): DedicatedSettingStore<IElementAppearanceDocument<ITabTitleAppearance>> {
    const store = this.tabStores.get(stableElementKey(tabId))
    if (store === undefined || !store.getState().initialized) {
      throw new Error('Tab title appearance is not initialized')
    }
    return store
  }

  private requireRepositoryStore<K extends RepositoryAppearanceElementId>(
    appearanceId: string,
    id: K
  ): DedicatedSettingStore<RepositoryDocument<K>> {
    const store = this.repositoryStores.get(
      repositoryStoreKey(appearanceId, id)
    )
    if (store === undefined || !store.getState().initialized) {
      throw new Error(`Repository ${id} appearance is not initialized`)
    }
    return store as unknown as DedicatedSettingStore<RepositoryDocument<K>>
  }

  private getRepositoryElementsById(
    appearanceId: string
  ): IRepositoryAppearanceElementSettings {
    return {
      [RepositoryAppearanceElementId.Workspace]: this.requireRepositoryStore(
        appearanceId,
        RepositoryAppearanceElementId.Workspace
      ).getState().setting.value,
      [RepositoryAppearanceElementId.Toolbar]: this.requireRepositoryStore(
        appearanceId,
        RepositoryAppearanceElementId.Toolbar
      ).getState().setting.value,
      [RepositoryAppearanceElementId.Tabs]: this.requireRepositoryStore(
        appearanceId,
        RepositoryAppearanceElementId.Tabs
      ).getState().setting.value,
      [RepositoryAppearanceElementId.ListName]: this.requireRepositoryStore(
        appearanceId,
        RepositoryAppearanceElementId.ListName
      ).getState().setting.value,
      [RepositoryAppearanceElementId.Logo]: this.requireRepositoryStore(
        appearanceId,
        RepositoryAppearanceElementId.Logo
      ).getState().setting.value,
    }
  }
}

export function historySource<T>(
  store: DedicatedSettingStore<T>
): IVersionedStoreHistorySource {
  return {
    getHistory: (skip, limit) => store.getHistory(skip, limit),
    getFiles: sha => store.getFiles(sha),
    getDiff: (sha, file) => store.getDiff(sha, file),
    undoLastChange: () => store.undoLastChange(),
    redoLastChange: () => store.redoLastChange(),
    restoreTo: sha => store.restoreTo(sha),
  }
}

export async function ensureRepositoryAppearanceId(
  repository: Repository
): Promise<string> {
  const key = normalizedRepositoryPathKey(repository.path)
  const existing = repositoryAppearanceIdInitializations.get(key)
  if (existing !== undefined) {
    return existing
  }

  const initialization = ensureRepositoryAppearanceIdOnce(repository)
  repositoryAppearanceIdInitializations.set(key, initialization)
  const clear = () => {
    if (repositoryAppearanceIdInitializations.get(key) === initialization) {
      repositoryAppearanceIdInitializations.delete(key)
    }
  }
  void initialization.then(clear, clear)
  return initialization
}

async function ensureRepositoryAppearanceIdOnce(
  repository: Repository
): Promise<string> {
  return withProfileRepositoryLock(repository, async () => {
    const stored = await readRepositoryAppearanceId(repository)
    if (stored !== null) {
      return stored
    }

    await setConfigValue(
      repository,
      RepositoryAppearanceIdConfigKey,
      randomUUID().toLowerCase()
    )

    // Git config is the authority. Re-read after the write so even another
    // process which raced before obtaining the cross-renderer lock cannot make
    // this caller continue with an ID different from the durable local value.
    const persisted = await readRepositoryAppearanceId(repository)
    if (persisted === null) {
      throw new Error('Repository appearance id was not persisted')
    }
    return persisted
  })
}

async function readRepositoryAppearanceId(
  repository: Repository
): Promise<string | null> {
  const stored = await getConfigValue(
    repository,
    RepositoryAppearanceIdConfigKey,
    true
  )
  return stored !== null && RepositoryAppearanceIdPattern.test(stored)
    ? stored.toLowerCase()
    : null
}

function profileElementIds(): ReadonlyArray<ProfileAppearanceElementId> {
  return Object.values(ProfileAppearanceElementId)
}

function repositoryElementIds(): ReadonlyArray<RepositoryAppearanceElementId> {
  return Object.values(RepositoryAppearanceElementId)
}

function humanizeElementId(id: string): string {
  return id.replace(/-/g, ' ')
}

function stableElementKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

function normalizeFeatureId(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 256) {
    throw new Error('Feature appearance requires a stable bounded id')
  }
  return trimmed
}

function repositoryStoreKey(
  appearanceId: string,
  id: RepositoryAppearanceElementId
): string {
  return `${appearanceId}:${id}`
}

function isProfileDocument(
  id: ProfileAppearanceElementId,
  value: unknown
): value is AnyProfileDocument {
  return (
    isStrictElementAppearanceDocument(value) &&
    structurallyEqual(
      value.value,
      normalizeProfileAppearanceElement(id, value.value)
    )
  )
}

function isRepositoryDocument(
  id: RepositoryAppearanceElementId,
  value: unknown
): value is AnyRepositoryDocument {
  return (
    isStrictElementAppearanceDocument(value) &&
    structurallyEqual(value.value, normalizeRepositoryElement(id, value.value))
  )
}

function isFeatureDocument(
  value: unknown
): value is IElementAppearanceDocument<IFeatureHighlightAppearance> {
  return (
    isStrictElementAppearanceDocument(value) &&
    structurallyEqual(
      value.value,
      normalizeFeatureHighlightAppearance(value.value)
    )
  )
}

function isTabTitleDocument(
  value: unknown
): value is IElementAppearanceDocument<ITabTitleAppearance> {
  return (
    isStrictElementAppearanceDocument(value) &&
    structurallyEqual(value.value, normalizeTabTitleAppearance(value.value))
  )
}

function isStrictElementAppearanceDocument(
  value: unknown
): value is IElementAppearanceDocument<unknown> {
  return (
    isElementAppearanceDocument(value) &&
    Object.keys(value).length === 2 &&
    Object.prototype.hasOwnProperty.call(value, 'version') &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  )
}

function repositorySeeds(
  overrides: IRepositoryAppearanceOverrides
): IRepositoryAppearanceElementSettings {
  return {
    [RepositoryAppearanceElementId.Workspace]: {
      accentPalette: overrides.accentPalette ?? null,
      surfacePalette: overrides.surfacePalette ?? null,
    },
    [RepositoryAppearanceElementId.Toolbar]: {
      toolbarLabels: overrides.toolbarLabels ?? null,
      toolbarDensity: overrides.toolbarDensity ?? null,
    },
    [RepositoryAppearanceElementId.Tabs]: {
      tabDensity: overrides.tabDensity ?? null,
      tabWidth: overrides.tabWidth ?? null,
    },
    [RepositoryAppearanceElementId.ListName]: {
      style: overrides.listNameStyle ?? null,
    },
    [RepositoryAppearanceElementId.Logo]: {
      logo: overrides.repositoryLogo ?? null,
    },
  }
}

function normalizeRepositoryElement<K extends RepositoryAppearanceElementId>(
  id: K,
  value: unknown
): IRepositoryAppearanceElementSettings[K] {
  const combined =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const normalizedLegacy = normalizeAppearanceCustomization({
    ...DefaultAppearanceCustomization,
    ...combined,
  })
  switch (id) {
    case RepositoryAppearanceElementId.Workspace:
      return {
        accentPalette:
          combined.accentPalette === null
            ? null
            : normalizedLegacy.accentPalette,
        surfacePalette:
          combined.surfacePalette === null
            ? null
            : normalizedLegacy.surfacePalette,
      } as IRepositoryAppearanceElementSettings[K]
    case RepositoryAppearanceElementId.Toolbar:
      return {
        toolbarLabels:
          combined.toolbarLabels === null
            ? null
            : normalizedLegacy.toolbarLabels,
        toolbarDensity:
          combined.toolbarDensity === null
            ? null
            : normalizedLegacy.toolbarDensity,
      } as IRepositoryAppearanceElementSettings[K]
    case RepositoryAppearanceElementId.Tabs:
      return {
        tabDensity:
          combined.tabDensity === null ? null : normalizedLegacy.tabDensity,
        tabWidth: combined.tabWidth === null ? null : normalizedLegacy.tabWidth,
      } as IRepositoryAppearanceElementSettings[K]
    case RepositoryAppearanceElementId.ListName:
      return normalizeTabTitleAppearance({
        style: combined.style,
      }) as IRepositoryAppearanceElementSettings[K]
    case RepositoryAppearanceElementId.Logo:
      return {
        logo:
          combined.logo === null || combined.logo === undefined
            ? null
            : normalizeAppearanceCustomization({
                ...DefaultAppearanceCustomization,
                repositoryLogo: combined.logo,
              }).repositoryLogo,
      } as IRepositoryAppearanceElementSettings[K]
  }
}

function isProfileSettingsText(contents: string): boolean {
  try {
    const parsed: unknown = JSON.parse(contents)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).settings === 'object' &&
      (parsed as Record<string, unknown>).settings !== null
    )
  } catch {
    return false
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    )
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false
  }
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && structurallyEqual(left[key], right[key])
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPathWithinOrEqual(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return (
    child === '' ||
    (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  )
}

function normalizedRepositoryPathKey(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function forEachWithConcurrency<T>(
  values: ReadonlyArray<T>,
  concurrency: number,
  action: (value: T) => Promise<void>
): Promise<void> {
  let next = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next++
        await action(values[index])
      }
    }
  )
  await Promise.all(workers)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
