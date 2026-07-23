import { API, getDotComAPIEndpoint } from '../api'
import { Account, isDotComAccount } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  ICheapLfsStoredPointer,
  ICheapLfsOciRepositoryContext,
  ICheapLfsOciRuntime,
  listCheapLfsStoredPointers,
} from './oci-operations'
import {
  CheapLfsGhcrTransportError,
  IPublishCheapLfsGhcrImageOptions,
  IPullCheapLfsGhcrObjectOptions,
  publishCheapLfsGhcrImage,
  withPulledCheapLfsGhcrObject,
} from './ghcr-oras-transport'
import {
  getCheapLfsOciRegistryProvider,
  getCheapLfsOciRegistryRepository,
} from './ghcr-pointer'
import {
  CheapLfsBundledOrasManifest,
  CheapLfsRegistryProvider,
  CheapLfsRegistryRuntimeError,
  ICheapLfsRegistryCredentials,
  ICheapLfsRegistryTarget,
  clearCheapLfsRegistryCredentials,
  createCheapLfsRegistryPolicyVerifier,
  deriveCheapLfsRegistryTarget,
  resolveCheapLfsDockerHubCredentials,
  resolveCheapLfsGhcrCredentialsFromAccount,
  resolveTrustedCheapLfsOrasExecutable,
} from './oci-registry-runtime'
import {
  DockerHubCheapLfsRegistryRepositoryPolicyApi,
  GhcrCheapLfsRegistryRepositoryPolicyApi,
  GitHubCheapLfsSourceRepositoryPolicyApi,
  ICheapLfsGitHubPolicyApi,
} from './oci-registry-policy-api'

export interface ICheapLfsOciRuntimeSession {
  readonly context: ICheapLfsOciRepositoryContext
  readonly runtime: ICheapLfsOciRuntime
}

export interface IWithCheapLfsOciRuntimeForRepositoryOptions {
  readonly repository: Repository
  readonly account: Account | null
  readonly provider: CheapLfsRegistryProvider
  readonly parallelBlobTransfers: boolean
}

export interface ICheapLfsOciAppRuntimeDependencies {
  readonly apiFor: (account: Account) => ICheapLfsGitHubPolicyApi
  readonly resolveOras: typeof resolveTrustedCheapLfsOrasExecutable
  readonly resolveGhcrCredentials: typeof resolveCheapLfsGhcrCredentialsFromAccount
  readonly resolveDockerHubCredentials: typeof resolveCheapLfsDockerHubCredentials
  readonly listStoredPointers: typeof listCheapLfsStoredPointers
  readonly publish: (
    options: IPublishCheapLfsGhcrImageOptions
  ) => ReturnType<typeof publishCheapLfsGhcrImage>
  readonly pull: typeof withPulledCheapLfsGhcrObject
}

const defaultDependencies: ICheapLfsOciAppRuntimeDependencies = {
  apiFor: account => API.fromAccount(account),
  resolveOras: resolveTrustedCheapLfsOrasExecutable,
  resolveGhcrCredentials: resolveCheapLfsGhcrCredentialsFromAccount,
  resolveDockerHubCredentials: resolveCheapLfsDockerHubCredentials,
  listStoredPointers: listCheapLfsStoredPointers,
  publish: publishCheapLfsGhcrImage,
  pull: withPulledCheapLfsGhcrObject,
}

function fail(message: string): CheapLfsRegistryRuntimeError {
  return new CheapLfsRegistryRuntimeError('policy', message)
}

function requireGitHubDotComRepository(repository: Repository) {
  const github = repository.gitHubRepository
  if (
    github === null ||
    github.owner.endpoint !== getDotComAPIEndpoint() ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(
      github.owner.login
    ) ||
    github.name.length === 0 ||
    github.name.length > 100
  ) {
    throw fail(
      'Cheap LFS OCI storage requires a GitHub.com repository with a canonical owner and name.'
    )
  }
  return github
}

async function resolveSource(
  api: ICheapLfsGitHubPolicyApi,
  repository: Repository
) {
  const github = requireGitHubDotComRepository(repository)
  const metadata = await api.fetchRepository(github.owner.login, github.name)
  if (
    metadata === null ||
    metadata.id === undefined ||
    !Number.isSafeInteger(metadata.id) ||
    metadata.id <= 0
  ) {
    throw fail(
      'Cheap LFS could not resolve the authoritative GitHub repository identity.'
    )
  }
  const source = {
    repositoryId: metadata.id,
    owner: github.owner.login,
    name: github.name,
  }
  const policy = await new GitHubCheapLfsSourceRepositoryPolicyApi(
    api
  ).inspectSourceRepository(source)
  return { source, policy }
}

async function resolveCredentials(
  provider: CheapLfsRegistryProvider,
  account: Account | null,
  visibility: 'public' | 'private',
  dependencies: ICheapLfsOciAppRuntimeDependencies
): Promise<ICheapLfsRegistryCredentials | null> {
  if (provider === 'ghcr') {
    if (account === null) {
      if (visibility === 'private') {
        throw fail(
          'Private GHCR Cheap LFS storage requires a signed-in account.'
        )
      }
      return null
    }
    if (!isDotComAccount(account)) {
      throw fail('GHCR Cheap LFS storage requires a GitHub.com account.')
    }
    return dependencies.resolveGhcrCredentials(account)
  }

  try {
    return await dependencies.resolveDockerHubCredentials()
  } catch (error) {
    if (visibility === 'private') {
      throw error
    }
    // Public Docker Hub pointers remain clone-repairable without Docker
    // Desktop; a later publish still fails closed until credentials exist.
    return null
  }
}

function registryTarget(
  provider: CheapLfsRegistryProvider,
  source: {
    readonly repositoryId: number
    readonly owner: string
    readonly name: string
  },
  credentials: ICheapLfsRegistryCredentials | null,
  storedPointers: ReadonlyArray<ICheapLfsStoredPointer>
): ICheapLfsRegistryTarget {
  const ociPointers = storedPointers.filter(
    pointer => pointer.backend === 'oci'
  )
  const existingRepositories = new Map<CheapLfsRegistryProvider, string>()
  for (const pointer of ociPointers) {
    const registryRepository = getCheapLfsOciRegistryRepository(
      pointer.pointer.image
    )
    if (
      registryRepository === null ||
      getCheapLfsOciRegistryProvider(pointer.pointer.image) !== pointer.provider
    ) {
      throw fail('Cheap LFS found an invalid existing OCI registry pointer.')
    }
    const existingRepository = existingRepositories.get(pointer.provider)
    if (
      existingRepository !== undefined &&
      existingRepository !== registryRepository
    ) {
      throw fail(
        'Cheap LFS existing OCI pointers must share one registry repository per provider.'
      )
    }
    existingRepositories.set(pointer.provider, registryRepository)
  }

  // A partial provider migration can leave one verified repository for the
  // requested provider plus exact materialized entries from the old provider.
  // Only the requested provider determines the next target.
  const existing = existingRepositories.get(provider)
  const reusedDockerHubNamespace =
    provider === 'docker-hub' && existing !== undefined
      ? existing.split('/')[1]
      : undefined
  const target = deriveCheapLfsRegistryTarget({
    ...source,
    provider,
    dockerHubNamespace:
      provider === 'docker-hub'
        ? reusedDockerHubNamespace ?? credentials?.username
        : undefined,
  })
  if (existing !== undefined && existing !== target.registryRepository) {
    throw fail(
      'Cheap LFS existing OCI pointers do not match the verified source repository target.'
    )
  }
  return target
}

function requirePublishCredentials(
  credentials: ICheapLfsRegistryCredentials | null,
  provider: CheapLfsRegistryProvider
): ICheapLfsRegistryCredentials {
  if (credentials === null) {
    throw new CheapLfsRegistryRuntimeError(
      'credential-unavailable',
      provider === 'docker-hub'
        ? 'Sign in to Docker Desktop before publishing Cheap LFS to Docker Hub.'
        : 'Sign in to GitHub.com before publishing Cheap LFS to GHCR.'
    )
  }
  return credentials
}

function actionableRegistryPublishFailure(
  error: unknown,
  provider: CheapLfsRegistryProvider
): unknown {
  if (
    provider !== 'ghcr' ||
    !(error instanceof CheapLfsGhcrTransportError) ||
    error.kind !== 'process-failed'
  ) {
    return error
  }
  const actionable = new CheapLfsRegistryRuntimeError(
    'credential-unavailable',
    'GHCR could not complete the registry command. Reauthorize the selected GitHub.com account for package access and retry. If GHCR still rejects package authentication, choose published Release or Docker Hub storage instead.'
  )
  actionable.cause = error
  return actionable
}

/**
 * Resolve one operation-scoped, fail-closed OCI runtime. Credentials remain in
 * memory only for this callback and are cleared even when preparation, upload,
 * policy verification, pointer mutation, or restore fails.
 */
export async function withCheapLfsOciRuntimeForRepository<T>(
  options: IWithCheapLfsOciRuntimeForRepositoryOptions,
  operation: (session: ICheapLfsOciRuntimeSession) => Promise<T>,
  dependencies: ICheapLfsOciAppRuntimeDependencies = defaultDependencies
): Promise<T> {
  const account = options.account ?? Account.anonymous()
  const api = dependencies.apiFor(account)
  const resolvedSource = await resolveSource(api, options.repository)
  const visibility = resolvedSource.policy.visibility
  const storedPointers = await dependencies.listStoredPointers(
    options.repository.path
  )
  const credentials = await resolveCredentials(
    options.provider,
    options.account,
    visibility,
    dependencies
  )
  try {
    const target = registryTarget(
      options.provider,
      resolvedSource.source,
      credentials,
      storedPointers
    )
    const oras = await dependencies.resolveOras({
      manifest: CheapLfsBundledOrasManifest,
    })
    if (!oras.available) {
      throw new CheapLfsRegistryRuntimeError(
        'untrusted-executable',
        oras.message
      )
    }
    const sourceApi = new GitHubCheapLfsSourceRepositoryPolicyApi(api)
    const registryApi =
      options.provider === 'ghcr'
        ? new GhcrCheapLfsRegistryRepositoryPolicyApi(
            api,
            resolvedSource.source,
            options.account?.login ?? ''
          )
        : credentials === null
        ? null
        : new DockerHubCheapLfsRegistryRepositoryPolicyApi(credentials)
    const verifier =
      registryApi === null
        ? null
        : createCheapLfsRegistryPolicyVerifier({
            source: resolvedSource.source,
            target,
            sourceApi,
            registryApi,
          })
    const context: ICheapLfsOciRepositoryContext = {
      repositoryPath: options.repository.path,
      repositoryIdentity: target.repositoryIdentity,
      sourceRepositoryUrl: target.sourceRepositoryUrl,
      visibility:
        visibility === 'private' ? 'verified-private' : 'verified-public',
      provider: options.provider,
      registryRepository: target.registryRepository,
      parallelBlobTransfers: options.parallelBlobTransfers,
    }
    const runtime: ICheapLfsOciRuntime = {
      publish: async request => {
        if (
          resolvedSource.policy.access !== 'write' &&
          resolvedSource.policy.access !== 'admin'
        ) {
          throw fail(
            'Cheap LFS OCI publishing requires source repository write access.'
          )
        }
        if (
          request.provider !== context.provider ||
          request.registryRepository !== context.registryRepository ||
          request.repositoryIdentity !== context.repositoryIdentity ||
          request.visibility !== visibility ||
          verifier === null
        ) {
          throw fail('Cheap LFS refused an inconsistent OCI publish request.')
        }
        const publishCredentials = requirePublishCredentials(
          credentials,
          options.provider
        )
        if (registryApi instanceof GhcrCheapLfsRegistryRepositoryPolicyApi) {
          await registryApi.preflightRegistryRepository(
            {
              provider: 'ghcr',
              registryRepository: context.registryRepository,
            },
            visibility
          )
        } else if (
          registryApi instanceof DockerHubCheapLfsRegistryRepositoryPolicyApi
        ) {
          await registryApi.ensureRegistryRepository(
            context.registryRepository,
            visibility,
            request.signal
          )
        }
        try {
          return await dependencies.publish({
            image: request.image,
            registryRepository: request.registryRepository,
            orasExecutablePath: oras.path,
            orasExecutableSha256: oras.sha256,
            credentials: publishCredentials,
            packagePolicyVerifier: verifier,
            parallelBlobUploads: request.parallelBlobUploads,
            keyCreated: request.keyCreated,
            keyRelativePath: request.keyRelativePath,
            signal: request.signal,
            onProgress: request.onProgress,
          })
        } catch (error) {
          throw actionableRegistryPublishFailure(error, options.provider)
        }
      },
      withPulledImage: async (request, callback) => {
        if (
          getCheapLfsOciRegistryProvider(request.pointer.image) !==
            context.provider ||
          getCheapLfsOciRegistryRepository(request.pointer.image) !==
            context.registryRepository ||
          request.expectedRepositoryIdentity !== context.repositoryIdentity ||
          request.expectedVisibility !== visibility
        ) {
          throw fail('Cheap LFS refused an inconsistent OCI restore request.')
        }
        const pullCredentials =
          visibility === 'private'
            ? requirePublishCredentials(credentials, options.provider)
            : null
        const pullOptions: IPullCheapLfsGhcrObjectOptions = {
          pointer: request.pointer,
          expectedRepositoryIdentity: request.expectedRepositoryIdentity,
          expectedVisibility: request.expectedVisibility,
          orasExecutablePath: oras.path,
          orasExecutableSha256: oras.sha256,
          credentials: pullCredentials,
          parallelBlobDownloads: options.parallelBlobTransfers,
          signal: request.signal,
          onProgress: request.onProgress,
        }
        return await dependencies.pull(pullOptions, async image => {
          if (image.sourceRepositoryUrl !== context.sourceRepositoryUrl) {
            throw fail(
              'Cheap LFS refused an OCI image linked to a different source repository.'
            )
          }
          return await callback(image)
        })
      },
    }
    return await operation({ context, runtime })
  } finally {
    if (credentials !== null) {
      clearCheapLfsRegistryCredentials(credentials)
    }
  }
}
