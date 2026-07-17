import {
  getAppearanceCustomization,
  getResolvedRepositoryAppearance,
  IResolvedRepositoryAppearance,
} from '../../lib/appearance-customization'
import { Repository } from '../../models/repository'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
} from '../../models/repository-logo'

const DefaultMaximumRepositoryLogoEntries = 128

type ResolveRepositoryAppearance = (
  repository: Repository
) => Promise<IResolvedRepositoryAppearance>

/**
 * The small contract consumed by repository-logo UI surfaces. Keeping this
 * injectable makes stale-request behavior testable without touching Git.
 */
export interface IRepositoryLogoLoader {
  load(repository: Repository): Promise<IRepositoryLogoDesign>
  loadAppearance(repository: Repository): Promise<IResolvedRepositoryAppearance>
  invalidate(repositoryPath: string | null, token?: object): void
  synchronizeProfile(profileSignature: string): void
}

export function getProfileRepositoryLogo(): IRepositoryLogoDesign {
  try {
    return getAppearanceCustomization().repositoryLogo
  } catch {
    return DefaultRepositoryLogoDesign
  }
}

export function getProfileRepositoryLogoSignature(): string {
  return JSON.stringify(getProfileRepositoryLogo())
}

/**
 * A bounded LRU of both in-flight and resolved appearance reads.
 *
 * Repository list rows can be repeated in the Pinned and Recent groups and a
 * repository can also have an open tab. Caching the promise itself guarantees
 * those consumers share one Git-config read, which resolves the logo and the
 * list-name typography together. Failed reads are removed so a later request
 * can recover.
 */
export class RepositoryLogoLoader implements IRepositoryLogoLoader {
  private readonly entries = new Map<
    string,
    Promise<IResolvedRepositoryAppearance>
  >()
  private readonly invalidationTokens = new WeakSet<object>()
  private profileSignature: string | null = null

  public constructor(
    private readonly resolve: ResolveRepositoryAppearance = getResolvedRepositoryAppearance,
    private readonly maximumEntries = DefaultMaximumRepositoryLogoEntries
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new Error('Repository logo cache size must be a positive integer')
    }
  }

  public synchronizeProfile(profileSignature: string): void {
    if (this.profileSignature === profileSignature) {
      return
    }

    this.profileSignature = profileSignature
    this.entries.clear()
  }

  public async load(repository: Repository): Promise<IRepositoryLogoDesign> {
    return (await this.loadAppearance(repository)).logo
  }

  public loadAppearance(
    repository: Repository
  ): Promise<IResolvedRepositoryAppearance> {
    this.synchronizeProfile(getProfileRepositoryLogoSignature())

    const key = repository.path
    const cached = this.entries.get(key)
    if (cached !== undefined) {
      // Map insertion order gives us a compact LRU without a second index.
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached
    }

    const pending = this.resolve(repository).catch(error => {
      if (this.entries.get(key) === pending) {
        this.entries.delete(key)
      }
      throw error
    })
    this.entries.set(key, pending)
    this.trim()
    return pending
  }

  public invalidate(repositoryPath: string | null, token?: object): void {
    if (token !== undefined) {
      if (this.invalidationTokens.has(token)) {
        return
      }
      this.invalidationTokens.add(token)
    }

    if (repositoryPath === null) {
      this.entries.clear()
    } else {
      this.entries.delete(repositoryPath)
    }
  }

  /** Exposed only to make the hard cache bound directly verifiable. */
  public get size(): number {
    return this.entries.size
  }

  private trim(): void {
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) {
        return
      }
      this.entries.delete(oldest)
    }
  }
}

export const repositoryLogoLoader = new RepositoryLogoLoader()
