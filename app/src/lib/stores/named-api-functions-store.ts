import { TypedBaseStore } from './base-store'
import {
  createNamedAPIFunctionDefinition,
  functionBelongsToBinding,
  INamedAPIFunctionBinding,
  INamedAPIFunctionDefinition,
  INamedAPIFunctionDraft,
  NamedAPIFunctionLimit,
  NamedAPIFunctionsStorageKey,
  parseNamedAPIFunctionsDocument,
  serializeNamedAPIFunctionsDocument,
} from '../named-api-functions'

type NamedFunctionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Transactional active-profile registry for named API functions. The backing
 * key is part of the profile settings allowlist, while account credentials stay
 * in AccountsStore/the OS credential store and never enter this document.
 */
export class NamedAPIFunctionsStore extends TypedBaseStore<
  ReadonlyArray<INamedAPIFunctionDefinition>
> {
  public constructor(private readonly storage: NamedFunctionStorage) {
    super()
  }

  public getAll(): ReadonlyArray<INamedAPIFunctionDefinition> {
    return parseNamedAPIFunctionsDocument(
      this.storage.getItem(NamedAPIFunctionsStorageKey)
    ).functions
  }

  public getByName(name: string): INamedAPIFunctionDefinition | null {
    return this.getAll().find(value => value.name === name) ?? null
  }

  public upsert(draft: INamedAPIFunctionDraft): INamedAPIFunctionDefinition {
    const current = [...this.getAll()]
    const existingIndex =
      draft.id === undefined
        ? -1
        : current.findIndex(value => value.id === draft.id)
    const existing = existingIndex < 0 ? undefined : current[existingIndex]
    const definition = createNamedAPIFunctionDefinition(draft, existing)
    const nameCollision = current.find(
      value => value.name === definition.name && value.id !== definition.id
    )
    if (nameCollision !== undefined) {
      throw new Error(`A function named '${definition.name}' already exists.`)
    }
    if (existingIndex < 0) {
      if (current.length >= NamedAPIFunctionLimit) {
        throw new Error(
          `Only ${NamedAPIFunctionLimit} named API functions are allowed.`
        )
      }
      current.push(definition)
    } else {
      current[existingIndex] = definition
    }
    this.commit(current)
    return definition
  }

  public remove(id: string): boolean {
    const current = this.getAll()
    const next = current.filter(value => value.id !== id)
    if (next.length === current.length) {
      return false
    }
    this.commit(next)
    return true
  }

  /** Cascade all functions owned by an account/repository binding. */
  public removeByBinding(binding: INamedAPIFunctionBinding): number {
    const current = this.getAll()
    const next = current.filter(
      value => !functionBelongsToBinding(value, binding)
    )
    const removed = current.length - next.length
    if (removed > 0) {
      this.commit(next)
    }
    return removed
  }

  /** Reload storage and canonicalize valid legacy state. Invalid state fails closed. */
  public migrate(): ReadonlyArray<INamedAPIFunctionDefinition> {
    try {
      const raw = this.storage.getItem(NamedAPIFunctionsStorageKey)
      const functions = parseNamedAPIFunctionsDocument(raw).functions
      if (raw !== null) {
        const canonical = serializeNamedAPIFunctionsDocument(functions)
        if (raw !== canonical) {
          this.storage.setItem(NamedAPIFunctionsStorageKey, canonical)
        }
      }
      this.emitUpdate(functions)
      return functions
    } catch (error) {
      // A restored or externally edited profile must never leave an older,
      // still-runnable catalog visible in the UI.
      this.emitUpdate([])
      const failure = error instanceof Error ? error : new Error(String(error))
      this.emitError(failure)
      throw failure
    }
  }

  private commit(functions: ReadonlyArray<INamedAPIFunctionDefinition>): void {
    // Serialize and re-parse before mutating Storage. If validation or the
    // storage write fails, the previous document remains untouched.
    const serialized = serializeNamedAPIFunctionsDocument(functions)
    parseNamedAPIFunctionsDocument(serialized)
    this.storage.setItem(NamedAPIFunctionsStorageKey, serialized)
    this.emitUpdate(functions)
  }
}
