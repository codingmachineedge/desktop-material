import { IGitModulesEntry, parseGitModules } from '../git/gitmodules'

/**
 * Fetches the raw `.gitmodules` file for a hosted repository, resolving to
 * null when the repository has no `.gitmodules` (or it cannot be read — a
 * repository we cannot probe simply shows no badge).
 */
export type GitModulesFileFetcher = (
  owner: string,
  name: string
) => Promise<string | null>

/** The hosted-repository identity a probe needs to fetch `.gitmodules`. */
export interface IProbeableRepository {
  readonly cloneUrl: string
  readonly ownerLogin: string
  readonly name: string
}

/** How many `.gitmodules` probes may be in flight at once. */
const DefaultProbeConcurrency = 4

/** How many probed repositories to remember before evicting the oldest. */
const DefaultProbeCapacity = 500

/**
 * A lazy, bounded cache of `.gitmodules` contents for hosted repositories.
 *
 * The clone surfaces render hundreds of repository rows; probing each visible
 * row on demand (deduplicating in-flight requests and bounding concurrency)
 * lets submodule badges appear progressively without hammering the API.
 * Results — including "no submodules" — are cached for the probe's lifetime.
 */
export class GitModulesProbe {
  private readonly cache = new Map<string, ReadonlyArray<IGitModulesEntry>>()
  private readonly inFlight = new Set<string>()
  private readonly queue = new Array<IProbeableRepository>()
  private activeCount = 0

  public constructor(
    private readonly fetchFile: GitModulesFileFetcher,
    private readonly onDidUpdate?: () => void,
    private readonly concurrency: number = DefaultProbeConcurrency,
    private readonly capacity: number = DefaultProbeCapacity
  ) {}

  /**
   * The cached submodule entries for a clone URL, or undefined when the
   * repository hasn't been probed yet. An empty array means "probed, none".
   */
  public getCachedEntries(
    cloneUrl: string
  ): ReadonlyArray<IGitModulesEntry> | undefined {
    return this.cache.get(cloneUrl)
  }

  /** The cached submodule count, or undefined when not yet probed. */
  public getCachedCount(cloneUrl: string): number | undefined {
    return this.cache.get(cloneUrl)?.length
  }

  /**
   * Request a probe of the given repository. A no-op when the repository has
   * already been probed or a probe is already queued or in flight.
   */
  public probe(repository: IProbeableRepository): void {
    const key = repository.cloneUrl
    if (this.cache.has(key) || this.inFlight.has(key)) {
      return
    }

    this.inFlight.add(key)
    this.queue.push(repository)
    this.pump()
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const repository = this.queue.shift()
      if (repository === undefined) {
        return
      }

      this.activeCount++
      this.runProbe(repository).finally(() => {
        this.activeCount--
        this.pump()
      })
    }
  }

  private async runProbe(repository: IProbeableRepository): Promise<void> {
    const key = repository.cloneUrl
    let entries: ReadonlyArray<IGitModulesEntry> = []

    try {
      const contents = await this.fetchFile(
        repository.ownerLogin,
        repository.name
      )
      if (contents !== null) {
        entries = parseGitModules(contents)
      }
    } catch {
      // An unprobeable repository renders no badge; treat it as empty.
      entries = []
    }

    this.inFlight.delete(key)
    this.evictIfNeeded()
    this.cache.set(key, entries)

    if (entries.length > 0) {
      this.onDidUpdate?.()
    }
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.capacity) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) {
        return
      }
      this.cache.delete(oldest.value)
    }
  }
}
