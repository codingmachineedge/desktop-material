import * as Path from 'path'
import {
  AgentCommandResult,
  AgentCommandVersion,
  IAgentCommandEnvelope,
  agentCommandError,
  assertSafeAgentArgs,
  isAgentCommandName,
  redactAgentValue,
} from './agent-commands'
import { IAppState, IRepositoryState, SelectionType } from './app-state'
import { CloningRepository } from '../models/cloning-repository'
import { Repository } from '../models/repository'
import { FetchType } from '../models/fetch'
import { TipState } from '../models/tip'
import { BatchCloneMode, IBatchCloneItem } from '../models/batch-clone'
import { Dispatcher } from '../ui/dispatcher'
import { RepositoryTabsStore } from './stores/repository-tabs-store'
import * as ipcRenderer from './ipc-renderer'

const CommandTimeoutMs = 60_000
const MaxQueuedPerRepository = 16
const MaxQueuedTotal = 64

interface IAutomationDispatcher {
  oneClickCommitAndPush(repository: Repository): Promise<void>
  mergeAllIntoDefaultBranch(
    repository: Repository,
    mode: 'branches' | 'worktrees'
  ): Promise<void>
}

interface IActionsDispatcher {
  triggerWorkflow(
    repository: Repository,
    workflowId: number,
    ref: string,
    inputs: Readonly<Record<string, string>>
  ): Promise<void>
}

type GetState = () => IAppState

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const rejection = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Agent command timed out after 60 seconds')),
      CommandTimeoutMs
    )
  })
  return Promise.race([promise, rejection]).finally(() => clearTimeout(timeout))
}

/** Serializes mutations per repository while allowing independent repos to run. */
export class AgentCommandQueue {
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly counts = new Map<string, number>()
  private total = 0

  public run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const count = this.counts.get(key) ?? 0
    if (count >= MaxQueuedPerRepository || this.total >= MaxQueuedTotal) {
      return Promise.reject(new Error('Renderer agent command queue is full'))
    }
    this.counts.set(key, count + 1)
    this.total++

    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous
      .catch(() => undefined)
      .then(() => withTimeout(task()))
    const tail = result
      .catch(() => undefined)
      .finally(() => {
        const nextCount = (this.counts.get(key) ?? 1) - 1
        this.total--
        if (nextCount === 0) {
          this.counts.delete(key)
        } else {
          this.counts.set(key, nextCount)
        }
        if (this.tails.get(key) === tail) {
          this.tails.delete(key)
        }
      })
    this.tails.set(key, tail)
    return result
  }
}

function stringArg(
  args: Readonly<Record<string, unknown>>,
  name: string,
  required = true
): string | undefined {
  const value = args[name]
  if (value === undefined && !required) {
    return undefined
  }
  if (typeof value !== 'string' || (required && value.trim().length === 0)) {
    throw new Error(
      `'${name}' must be ${required ? 'a non-empty' : 'a'} string`
    )
  }
  return value
}

function numberArg(
  args: Readonly<Record<string, unknown>>,
  name: string
): number {
  const value = args[name]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`'${name}' must be an integer`)
  }
  return value
}

function repositoryFromArgs(
  args: Readonly<Record<string, unknown>>,
  getState: GetState,
  allowSelected = false
): Repository {
  const state = getState()
  const repositories = state.repositories.filter(
    (repository): repository is Repository =>
      !(repository instanceof CloningRepository)
  )
  const repositoryId = args.repositoryId
  if (typeof repositoryId === 'number') {
    const repository = repositories.find(x => x.id === repositoryId)
    if (repository !== undefined) {
      return repository
    }
    throw new Error(`Repository id ${repositoryId} is not known to the app`)
  }
  const path = args.path
  if (typeof path === 'string') {
    const normalized = Path.resolve(path).toLocaleLowerCase()
    const repository = repositories.find(
      x => Path.resolve(x.path).toLocaleLowerCase() === normalized
    )
    if (repository !== undefined) {
      return repository
    }
    throw new Error(`Repository path '${path}' is not known to the app`)
  }
  if (
    allowSelected &&
    state.selectedState !== null &&
    state.selectedState.type === SelectionType.Repository
  ) {
    return state.selectedState.repository
  }
  throw new Error("Provide either 'repositoryId' or 'path'")
}

async function selectedRepositoryState(
  repository: Repository,
  dispatcher: Dispatcher,
  getState: GetState
): Promise<IRepositoryState> {
  let selected = getState().selectedState
  if (
    selected === null ||
    selected.type !== SelectionType.Repository ||
    selected.repository.id !== repository.id
  ) {
    await dispatcher.selectRepository(repository)
    selected = getState().selectedState
  }
  if (
    selected === null ||
    selected.type !== SelectionType.Repository ||
    selected.repository.id !== repository.id
  ) {
    throw new Error('Repository state is not ready')
  }
  return selected.state
}

function serializeRepository(repository: Repository) {
  return {
    id: repository.id,
    name: repository.name,
    path: repository.path,
    missing: repository.missing,
    accountKey: repository.accountKey,
    github:
      repository.gitHubRepository === null
        ? null
        : {
            name: repository.gitHubRepository.name,
            owner: repository.gitHubRepository.owner.login,
            fullName: repository.gitHubRepository.fullName,
            url: repository.gitHubRepository.htmlURL,
          },
  }
}

function queueKey(command: IAgentCommandEnvelope): string {
  const { repositoryId, path } = command.args
  if (typeof repositoryId === 'number') {
    return `repository:${repositoryId}`
  }
  if (typeof path === 'string') {
    return `path:${Path.resolve(path).toLocaleLowerCase()}`
  }
  return `global:${command.name}`
}

async function execute(
  command: IAgentCommandEnvelope,
  dispatcher: Dispatcher,
  getState: GetState,
  tabs: RepositoryTabsStore
): Promise<unknown> {
  const args = command.args
  switch (command.name) {
    case 'list-accounts':
      return getState().accounts.map(account => ({
        login: account.login,
        endpoint: account.endpoint,
        name: account.name,
      }))
    case 'list-repositories':
      return getState().repositories.map(repository =>
        repository instanceof CloningRepository
          ? {
              id: repository.id,
              name: repository.name,
              path: repository.path,
              cloning: true,
            }
          : serializeRepository(repository)
      )
    case 'list-tabs':
      return tabs.getState()
    case 'get-status': {
      const repository = repositoryFromArgs(args, getState, true)
      const state = await selectedRepositoryState(
        repository,
        dispatcher,
        getState
      )
      const tip = state.branchesState.tip
      return {
        repository: serializeRepository(repository),
        branch:
          tip.kind === TipState.Valid
            ? tip.branch.name
            : tip.kind === TipState.Detached
            ? tip.currentSha
            : tip.kind === TipState.Unborn
            ? tip.ref
            : null,
        tipState: tip.kind,
        changedFiles: state.changesState.workingDirectory.files.length,
        aheadBehind: state.aheadBehind,
        busy: {
          commit: state.isCommitting,
          sync: state.isPushPullFetchInProgress,
        },
      }
    }
    case 'clone': {
      const url = stringArg(args, 'url')!
      const path = stringArg(args, 'path')!
      const branch = stringArg(args, 'branch', false)
      const repository = await dispatcher.clone(url, path, { branch })
      if (repository === null) {
        throw new Error('Clone did not complete')
      }
      return serializeRepository(repository)
    }
    case 'clone-batch': {
      if (
        !Array.isArray(args.items) ||
        args.items.length < 1 ||
        args.items.length > 50
      ) {
        throw new Error("'items' must contain between 1 and 50 repositories")
      }
      const items: IBatchCloneItem[] = args.items.map((value, index) => {
        if (
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value)
        ) {
          throw new Error(`Batch item ${index + 1} must be an object`)
        }
        const item = value as Record<string, unknown>
        const url = stringArg(item, 'url')!
        const path = stringArg(item, 'path')!
        const branch = stringArg(item, 'branch', false)
        return {
          url,
          path,
          name: Path.basename(path),
          ...(branch === undefined ? {} : { defaultBranch: branch }),
        }
      })
      const mode =
        args.mode === BatchCloneMode.Sequential
          ? BatchCloneMode.Sequential
          : BatchCloneMode.Parallel
      await dispatcher.cloneBatch(items, mode)
      return { accepted: items.length, mode }
    }
    case 'commit': {
      const repository = repositoryFromArgs(args, getState)
      const summary = stringArg(args, 'summary')!
      const committed = await dispatcher.commitIncludedChanges(repository, {
        summary,
        description: stringArg(args, 'description', false) ?? null,
      })
      return { committed }
    }
    case 'push': {
      const repository = repositoryFromArgs(args, getState)
      await dispatcher.push(repository)
      return { pushed: true }
    }
    case 'pull': {
      const repository = repositoryFromArgs(args, getState)
      await dispatcher.pull(repository)
      return { pulled: true }
    }
    case 'fetch': {
      const repository = repositoryFromArgs(args, getState)
      await dispatcher.fetch(repository, FetchType.UserInitiatedTask)
      return { fetched: true }
    }
    case 'list-branches': {
      const repository = repositoryFromArgs(args, getState)
      const state = await selectedRepositoryState(
        repository,
        dispatcher,
        getState
      )
      return state.branchesState.allBranches.map(branch => ({
        name: branch.name,
        ref: branch.ref,
        type: branch.type,
        sha: branch.tip.sha,
        upstream: branch.upstream,
      }))
    }
    case 'create-branch': {
      const repository = repositoryFromArgs(args, getState)
      const branch = await dispatcher.createBranch(
        repository,
        stringArg(args, 'name')!,
        stringArg(args, 'startPoint', false) ?? null
      )
      return branch === undefined
        ? { created: false }
        : { created: true, name: branch.name, ref: branch.ref }
    }
    case 'merge-branch': {
      const repository = repositoryFromArgs(args, getState)
      const state = await selectedRepositoryState(
        repository,
        dispatcher,
        getState
      )
      const name = stringArg(args, 'branch')!
      const branch = state.branchesState.allBranches.find(
        x => x.name === name || x.ref === name
      )
      if (branch === undefined) {
        throw new Error(`Branch '${name}' was not found`)
      }
      const squash = args.squash === true
      dispatcher.initializeMergeOperation(repository, squash, branch)
      await dispatcher.mergeBranch(repository, branch, null, squash)
      return { merged: branch.name, squash }
    }
    case 'open-repository': {
      const path = stringArg(args, 'path')!
      const repositories = await dispatcher.addRepositories([path])
      const repository = repositories[0]
      if (repository === undefined) {
        throw new Error(`No repository found at '${path}'`)
      }
      await dispatcher.selectRepository(repository)
      return serializeRepository(repository)
    }
    case 'select-repository': {
      const repository = repositoryFromArgs(args, getState)
      await tabs.ensureTabForRepository(repository)
      await dispatcher.selectRepository(repository)
      return serializeRepository(repository)
    }
    case 'select-tab': {
      const tabId = stringArg(args, 'tabId')!
      const tab = tabs.getState().tabs.find(x => x.id === tabId)
      if (tab === undefined) {
        throw new Error(`Tab '${tabId}' was not found`)
      }
      await tabs.activateTab(tabId)
      let repository: Repository
      try {
        repository = repositoryFromArgs(
          { repositoryId: tab.repositoryId },
          getState
        )
      } catch {
        repository = repositoryFromArgs({ path: tab.repositoryPath }, getState)
      }
      await dispatcher.selectRepository(repository)
      return { selected: tabId, repositoryId: repository.id }
    }
    case 'close-tab': {
      const tabId = stringArg(args, 'tabId')!
      if (!tabs.getState().tabs.some(x => x.id === tabId)) {
        throw new Error(`Tab '${tabId}' was not found`)
      }
      const activeTabId = await tabs.closeTab(tabId)
      if (activeTabId !== null) {
        const activeTab = tabs.getState().tabs.find(x => x.id === activeTabId)
        if (activeTab !== undefined) {
          const repository = repositoryFromArgs(
            { path: activeTab.repositoryPath },
            getState
          )
          await dispatcher.selectRepository(repository)
        }
      }
      return { closed: tabId, activeTabId }
    }
    case 'get-automation-status': {
      const state = getState() as IAppState & {
        readonly automationSettings?: unknown
      }
      let repositoryState: (IRepositoryState & Record<string, unknown>) | null =
        null
      if (
        typeof args.repositoryId === 'number' ||
        typeof args.path === 'string' ||
        (getState().selectedState !== null &&
          getState().selectedState!.type === SelectionType.Repository)
      ) {
        const repository = repositoryFromArgs(args, getState, true)
        repositoryState = (await selectedRepositoryState(
          repository,
          dispatcher,
          getState
        )) as IRepositoryState & Record<string, unknown>
      }
      return {
        available:
          typeof (dispatcher as unknown as Partial<IAutomationDispatcher>)
            .oneClickCommitAndPush === 'function',
        settings: state.automationSettings ?? null,
        phase: repositoryState?.oneClickCommitPushPhase ?? null,
        mergeAll: repositoryState?.mergeAllState ?? null,
      }
    }
    case 'run-automation': {
      const repository = repositoryFromArgs(args, getState)
      const automation = dispatcher as unknown as Partial<IAutomationDispatcher>
      const action = stringArg(args, 'action')
      if (action === 'commit-and-push') {
        if (typeof automation.oneClickCommitAndPush !== 'function') {
          throw new Error(
            'Commit-and-push automation is not available in this build'
          )
        }
        await automation.oneClickCommitAndPush.call(dispatcher, repository)
      } else if (action === 'merge-branches' || action === 'merge-worktrees') {
        if (typeof automation.mergeAllIntoDefaultBranch !== 'function') {
          throw new Error('Merge-all automation is not available in this build')
        }
        await automation.mergeAllIntoDefaultBranch.call(
          dispatcher,
          repository,
          action === 'merge-branches' ? 'branches' : 'worktrees'
        )
      } else {
        throw new Error(`Unsupported automation action '${action}'`)
      }
      return { started: action }
    }
    case 'trigger-workflow': {
      const repository = repositoryFromArgs(args, getState)
      const actions = dispatcher as unknown as Partial<IActionsDispatcher>
      if (typeof actions.triggerWorkflow !== 'function') {
        throw new Error(
          'GitHub Actions workflow dispatch is not available in this build'
        )
      }
      const rawInputs = args.inputs ?? {}
      if (
        rawInputs === null ||
        typeof rawInputs !== 'object' ||
        Array.isArray(rawInputs)
      ) {
        throw new Error("'inputs' must be an object")
      }
      const inputs: Record<string, string> = {}
      for (const [key, value] of Object.entries(rawInputs)) {
        if (typeof value !== 'string') {
          throw new Error(`Workflow input '${key}' must be a string`)
        }
        inputs[key] = value
      }
      await actions.triggerWorkflow.call(
        dispatcher,
        repository,
        numberArg(args, 'workflowId'),
        stringArg(args, 'ref')!,
        inputs
      )
      return { dispatched: true }
    }
  }
}

export async function executeAgentCommand(
  command: IAgentCommandEnvelope,
  dispatcher: Dispatcher,
  getState: GetState,
  tabs: RepositoryTabsStore
): Promise<AgentCommandResult> {
  if (
    command.version !== AgentCommandVersion ||
    !isAgentCommandName(command.name) ||
    command.args === null ||
    typeof command.args !== 'object'
  ) {
    return agentCommandError(
      'invalid_command',
      'Invalid agent command envelope'
    )
  }
  try {
    assertSafeAgentArgs(command.args)
    const data = await execute(command, dispatcher, getState, tabs)
    return { ok: true, data: redactAgentValue(data) }
  } catch (error) {
    return agentCommandError(
      'command_failed',
      error instanceof Error ? error.message : 'Agent command failed'
    )
  }
}

/** Install the sole renderer IPC endpoint used by the main-process bridge. */
export function installAgentCommandExecutor(
  dispatcher: Dispatcher,
  getState: GetState,
  tabs: RepositoryTabsStore
): () => void {
  const queue = new AgentCommandQueue()
  const listener = (_event: unknown, command: IAgentCommandEnvelope) => {
    queue
      .run(queueKey(command), () =>
        executeAgentCommand(command, dispatcher, getState, tabs)
      )
      .then(result =>
        ipcRenderer.send('agent-command-result', command.id, result)
      )
      .catch(error =>
        ipcRenderer.send(
          'agent-command-result',
          command.id,
          agentCommandError(
            'queue_failed',
            error instanceof Error
              ? error.message
              : 'Agent command queue failed',
            true
          )
        )
      )
  }
  ipcRenderer.on('agent-command', listener)
  return () => ipcRenderer.removeListener('agent-command', listener)
}
