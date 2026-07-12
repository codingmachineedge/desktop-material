import { CloningRepository } from '../../models/cloning-repository'
import { ICloneProgress } from '../../models/progress'
import { CloneOptions } from '../../models/clone-options'
import { RetryAction, RetryActionType } from '../../models/retry-actions'

import { clone as cloneRepo } from '../git'
import { ErrorWithMetadata } from '../error-with-metadata'
import { BaseStore } from './base-store'

/** The store in charge of repository currently being cloned. */
export class CloningRepositoriesStore extends BaseStore {
  private readonly _repositories = new Array<CloningRepository>()
  private readonly stateByID = new Map<number, ICloneProgress>()

  /**
   * Clone the repository at the URL to the path.
   *
   * Returns a {Promise} which resolves to whether the clone was successful.
   */
  public async clone(
    url: string,
    path: string,
    options: CloneOptions,
    opts?: {
      /**
       * When provided the error is passed here instead of being emitted as a
       * global error. Used by batch clone so a failing repo yields a batch
       * summary rather than a per-repo error dialog.
       */
      readonly onError?: (error: Error) => void
      /**
       * Called with each raw progress event, on top of the store's own
       * bookkeeping, so composing stores can mirror progress per item.
       */
      readonly onProgress?: (progress: ICloneProgress) => void
    }
  ): Promise<boolean> {
    const repository = new CloningRepository(path, url)
    this._repositories.push(repository)

    const title = `Cloning into ${path}`

    this.stateByID.set(repository.id, { kind: 'clone', title, value: 0 })
    this.emitUpdate()

    let success = true
    try {
      await cloneRepo(url, path, options, progress => {
        this.stateByID.set(repository.id, progress)
        opts?.onProgress?.(progress)
        this.emitUpdate()
      })
    } catch (e) {
      success = false

      const retryAction: RetryAction = {
        type: RetryActionType.Clone,
        name: repository.name,
        url,
        path,
        options,
      }
      e = new ErrorWithMetadata(e, { retryAction, repository })

      if (opts?.onError !== undefined) {
        opts.onError(e)
      } else {
        this.emitError(e)
      }
    }

    this.remove(repository)

    return success
  }

  /** Get the repositories currently being cloned. */
  public get repositories(): ReadonlyArray<CloningRepository> {
    return Array.from(this._repositories)
  }

  /** Get the state of the repository. */
  public getRepositoryState(
    repository: CloningRepository
  ): ICloneProgress | null {
    return this.stateByID.get(repository.id) || null
  }

  /** Remove the repository. */
  public remove(repository: CloningRepository) {
    this.stateByID.delete(repository.id)

    const repoIndex = this._repositories.findIndex(r => r.id === repository.id)
    if (repoIndex > -1) {
      this._repositories.splice(repoIndex, 1)
    }

    this.emitUpdate()
  }
}
