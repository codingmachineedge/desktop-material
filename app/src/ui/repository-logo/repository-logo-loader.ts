import {
  getAppearanceCustomization,
  getResolvedRepositoryLogo,
} from '../../lib/appearance-customization'
import { Repository } from '../../models/repository'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
} from '../../models/repository-logo'

const DefaultMaximumRepositoryLogoEntries = 128

type ResolveRepositoryLogo = (
  repository: Repository
) => Promise<IRepositoryLogoDesign>

/**
 * The small contract consumed by repository-logo UI surfaces. Keeping this
 * injectable makes stale-request behavior testable without touching Git.
 */
export interface IRepositoryLogoLoader {
  load(repository: Repository): Promise<IRepositoryLogoDesign>
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
 * A bounded LRU of both in-flight and resolved logo reads.
 *
 * Repository list rows can be repeated in the Pinned and Recent groups and a
 * repository can also have an open tab. Caching the promise itself guarantees
 * those consumers share one Git-config read. Failed reads are removed so a
 * later request can recover.
 */
export class RepositoryLogoLoader implements IRepositoryLogoLoader {
  private readonly entries = new Map<string, Promise<IRepositoryLogoDesign>>()
  private readonly invalidationTokens = new WeakSet<object>()
  private profileSignature: string | null = null

  public constructor(
    private readonly resolve: ResolveRepositoryLogo = getResolvedRepositoryLogo,
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

  public load(repository: Repository): Promise<IRepositoryLogoDesign> {
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
