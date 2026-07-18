import { execFile } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { isIP } from 'net'
import * as Path from 'path'
import { promisify } from 'util'
import { setupEnvironment } from 'dugite'

import { withTrampolineEnv } from '../trampoline/trampoline-environment'
import { getSSHExecutable } from './ssh'

const execFileAsync = promisify(execFile)

const SSHWorkingCopyStorageVersion = 1
const SSHWorkingCopyStoragePrefix = 'ssh-working-copies-v1-'
const MaxStoredDefinitions = 16
const MaxStoredDocumentLength = 32 * 1024
const MaxCommandOutputBytes = 256 * 1024

export type SSHWorkingCopyAction =
  | 'test'
  | 'clone'
  | 'status'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'deploy'

/**
 * Non-secret metadata for one working copy hosted over SSH. Passwords and key
 * passphrases are deliberately absent: Desktop's askpass trampoline stores
 * those in the OS credential vault only when the user chooses Remember.
 */
export interface ISSHWorkingCopyDefinition {
  readonly id: string
  readonly label: string
  readonly host: string
  readonly port: number | null
  readonly user: string | null
  /** Optional local identity-file path. The file contents are never read here. */
  readonly authenticationReference: string | null
  readonly destinationPath: string
  /** The local named remote. Its URL is resolved transiently at clone time. */
  readonly sourceRemoteName: string | null
  /** Fast-forward this checkout and deploy Docker Compose after a matching push. */
  readonly deployOnPush?: boolean
}

export interface ISSHWorkingCopyResult {
  readonly stdout: string
  readonly stderr: string
}

export interface ISSHWorkingCopyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface ISSHWorkingCopyDocument {
  readonly version: 1
  readonly definitions: ReadonlyArray<ISSHWorkingCopyDefinition>
}

const definitionKeys = new Set([
  'id',
  'label',
  'host',
  'port',
  'user',
  'authenticationReference',
  'destinationPath',
  'sourceRemoteName',
  'deployOnPush',
])

const hasControlCharacters = (value: string): boolean =>
  /[\u0000-\u001f\u007f]/.test(value)

const normalizeOptional = (value: string | null): string | null => {
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

const validateIdentifier = (id: string): string => {
  if (!/^[a-f0-9]{32}$/.test(id)) {
    throw new Error('The SSH host definition has an invalid identifier.')
  }
  return id
}

const validateLabel = (label: string): string => {
  const normalized = label.trim()
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    hasControlCharacters(normalized)
  ) {
    throw new Error('Host label must be between 1 and 80 printable characters.')
  }
  return normalized
}

const validateHost = (host: string): string => {
  const normalized = host.trim()
  const address =
    normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    (isIP(address) === 0 &&
      !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(normalized))
  ) {
    throw new Error('Host must be a valid hostname or OpenSSH config alias.')
  }
  return address
}

const validatePort = (port: number | null): number | null => {
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('SSH port must be an integer from 1 through 65535.')
  }
  return port
}

const validateUser = (user: string | null): string | null => {
  const normalized = normalizeOptional(user)
  if (
    normalized !== null &&
    (normalized.length > 64 || !/^[A-Za-z0-9._-]+$/.test(normalized))
  ) {
    throw new Error(
      'SSH user may contain letters, numbers, dot, dash, and underscore.'
    )
  }
  return normalized
}

const validateAuthenticationReference = (
  authenticationReference: string | null
): string | null => {
  const normalized = normalizeOptional(authenticationReference)
  if (normalized === null) {
    return null
  }
  if (
    normalized.length > 1024 ||
    hasControlCharacters(normalized) ||
    !Path.isAbsolute(normalized)
  ) {
    throw new Error(
      'Authentication reference must be an absolute identity-file path.'
    )
  }
  return normalized
}

/** Validate an absolute POSIX checkout path without normalizing away traversal. */
export function validateSSHRemoteDestinationPath(value: string): string {
  const normalized = value.trim()
  if (
    normalized.length < 2 ||
    normalized.length > 512 ||
    hasControlCharacters(normalized) ||
    !normalized.startsWith('/') ||
    normalized.endsWith('/')
  ) {
    throw new Error(
      'Remote destination must be an absolute POSIX path below the filesystem root.'
    )
  }
  const segments = normalized.slice(1).split('/')
  if (
    segments.some(
      segment =>
        segment.length === 0 ||
        segment.length > 128 ||
        segment === '.' ||
        segment === '..'
    )
  ) {
    throw new Error(
      'Remote destination cannot contain empty, dot, or parent segments.'
    )
  }
  return normalized
}

const validateSourceRemoteName = (value: string | null): string | null => {
  const normalized = normalizeOptional(value)
  if (
    normalized !== null &&
    (normalized.length > 255 ||
      hasControlCharacters(normalized) ||
      normalized.startsWith('-'))
  ) {
    throw new Error('Source remote name is invalid.')
  }
  return normalized
}

export function validateSSHWorkingCopyDefinition(
  definition: ISSHWorkingCopyDefinition
): ISSHWorkingCopyDefinition {
  if (
    definition.deployOnPush !== undefined &&
    typeof definition.deployOnPush !== 'boolean'
  ) {
    throw new Error('Deploy-after-push must be enabled or disabled.')
  }
  const sourceRemoteName = validateSourceRemoteName(
    definition.sourceRemoteName
  )
  if (definition.deployOnPush === true && sourceRemoteName === null) {
    throw new Error(
      'Choose a source remote before enabling Docker deployment after push.'
    )
  }

  return {
    id: validateIdentifier(definition.id),
    label: validateLabel(definition.label),
    host: validateHost(definition.host),
    port: validatePort(definition.port),
    user: validateUser(definition.user),
    authenticationReference: validateAuthenticationReference(
      definition.authenticationReference
    ),
    destinationPath: validateSSHRemoteDestinationPath(
      definition.destinationPath
    ),
    sourceRemoteName,
    ...(definition.deployOnPush === true ? { deployOnPush: true } : {}),
  }
}

/** Create a non-guessable identifier without encoding connection metadata. */
export const createSSHWorkingCopyId = (): string =>
  randomBytes(16).toString('hex')

export const getSSHWorkingCopyStorageKey = (repositoryPath: string): string =>
  `${SSHWorkingCopyStoragePrefix}${createHash('sha256')
    .update(repositoryPath)
    .digest('hex')}`

/**
 * Scope a remembered SSH password to the actual network endpoint. This avoids
 * the legacy OpenSSH prompt collision where a non-default port is absent from
 * the visible `user@host's password` text.
 */
export function getSSHWorkingCopyCredentialScope(
  definition: ISSHWorkingCopyDefinition
): string {
  const validated = validateSSHWorkingCopyDefinition(definition)
  const endpoint = `${
    validated.user ?? ''
  }\u0000${validated.host.toLowerCase()}\u0000${validated.port ?? 22}`
  return `ssh-working-copy:${createHash('sha256')
    .update(endpoint)
    .digest('hex')}`
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseStoredDefinition = (
  value: unknown
): ISSHWorkingCopyDefinition | null => {
  if (
    !isPlainObject(value) ||
    Object.keys(value).some(key => !definitionKeys.has(key))
  ) {
    return null
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.host !== 'string' ||
    (value.port !== null && typeof value.port !== 'number') ||
    (value.user !== null && typeof value.user !== 'string') ||
    (value.authenticationReference !== null &&
      typeof value.authenticationReference !== 'string') ||
    typeof value.destinationPath !== 'string' ||
    (value.sourceRemoteName !== null &&
      typeof value.sourceRemoteName !== 'string') ||
    (value.deployOnPush !== undefined &&
      typeof value.deployOnPush !== 'boolean')
  ) {
    return null
  }
  try {
    return validateSSHWorkingCopyDefinition(
      value as unknown as ISSHWorkingCopyDefinition
    )
  } catch {
    return null
  }
}

/** Load only the exact non-secret document schema; fail closed on corruption. */
export function loadSSHWorkingCopies(
  repositoryPath: string,
  storage: ISSHWorkingCopyStorage = localStorage
): ReadonlyArray<ISSHWorkingCopyDefinition> {
  try {
    const raw = storage.getItem(getSSHWorkingCopyStorageKey(repositoryPath))
    if (raw === null || raw.length > MaxStoredDocumentLength) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (
      !isPlainObject(parsed) ||
      Object.keys(parsed).some(
        key => key !== 'version' && key !== 'definitions'
      ) ||
      parsed.version !== SSHWorkingCopyStorageVersion ||
      !Array.isArray(parsed.definitions) ||
      parsed.definitions.length > MaxStoredDefinitions
    ) {
      return []
    }
    const definitions = parsed.definitions.map(parseStoredDefinition)
    return definitions.every(
      (definition): definition is ISSHWorkingCopyDefinition =>
        definition !== null
    )
      ? definitions
      : []
  } catch {
    return []
  }
}

export function saveSSHWorkingCopies(
  repositoryPath: string,
  definitions: ReadonlyArray<ISSHWorkingCopyDefinition>,
  storage: ISSHWorkingCopyStorage = localStorage
): void {
  if (definitions.length > MaxStoredDefinitions) {
    throw new Error(`At most ${MaxStoredDefinitions} SSH hosts may be saved.`)
  }
  const ids = new Set<string>()
  const validated = definitions.map(definition => {
    const result = validateSSHWorkingCopyDefinition(definition)
    if (ids.has(result.id)) {
      throw new Error('SSH host identifiers must be unique.')
    }
    ids.add(result.id)
    return result
  })
  const document: ISSHWorkingCopyDocument = {
    version: SSHWorkingCopyStorageVersion,
    definitions: validated,
  }
  const serialized = JSON.stringify(document)
  if (serialized.length > MaxStoredDocumentLength) {
    throw new Error('SSH host metadata is too large to save.')
  }
  storage.setItem(getSSHWorkingCopyStorageKey(repositoryPath), serialized)
}

/** Enabled SSH Docker targets whose configured source is the pushed remote. */
export function loadSSHDockerDeploymentsForPush(
  repositoryPath: string,
  remoteName: string,
  storage: ISSHWorkingCopyStorage = localStorage
): ReadonlyArray<ISSHWorkingCopyDefinition> {
  if (remoteName.length === 0) {
    return []
  }
  return loadSSHWorkingCopies(repositoryPath, storage).filter(
    definition =>
      definition.deployOnPush === true &&
      definition.sourceRemoteName === remoteName
  )
}

/** Quote one value as a literal POSIX shell word for the remote shell. */
export const quotePOSIXShellWord = (value: string): string =>
  `'${value.replace(/'/g, `'"'"'`)}'`

/** Reject local paths, command-line options, and credential-bearing URLs. */
export function validateSSHCloneSourceUrl(value: string): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > 2048 ||
    hasControlCharacters(normalized) ||
    normalized.startsWith('-')
  ) {
    throw new Error('The source remote URL is invalid.')
  }

  if (normalized.includes('://')) {
    let parsed: URL
    try {
      parsed = new URL(normalized)
    } catch {
      throw new Error('The source remote URL is invalid.')
    }
    if (
      !['https:', 'ssh:', 'git:'].includes(parsed.protocol) ||
      parsed.password.length > 0 ||
      parsed.hostname.length === 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      (parsed.protocol !== 'ssh:' && parsed.username.length > 0)
    ) {
      throw new Error(
        'The source remote must use HTTPS, SSH, or Git without embedded credentials.'
      )
    }
    return normalized
  }

  if (
    !/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?:[^\s:]+$/.test(
      normalized
    )
  ) {
    throw new Error(
      'The source remote must use HTTPS, SSH, Git, or SCP-style SSH syntax.'
    )
  }
  return normalized
}

export function buildSSHWorkingCopyCommand(
  definition: ISSHWorkingCopyDefinition,
  action: SSHWorkingCopyAction,
  sourceUrl?: string,
  expectedBranch?: string
): string {
  const validated = validateSSHWorkingCopyDefinition(definition)
  const destination = quotePOSIXShellWord(validated.destinationPath)

  switch (action) {
    case 'test':
      return "set -eu; printf 'Desktop Material SSH connection ready\\n'; git --version"
    case 'clone': {
      if (sourceUrl === undefined) {
        throw new Error(
          'Choose a credential-free source remote before cloning.'
        )
      }
      const source = quotePOSIXShellWord(validateSSHCloneSourceUrl(sourceUrl))
      const remote = quotePOSIXShellWord(
        validated.sourceRemoteName ?? 'origin'
      )
      return `set -eu; destination=${destination}; remote=${remote}; parent=$(dirname "$destination"); mkdir -p "$parent"; if [ -e "$destination" ]; then printf 'Remote destination already exists.\\n' >&2; exit 17; fi; git clone -- ${source} "$destination"; if [ "$remote" != origin ]; then git -C "$destination" remote rename origin "$remote"; fi`
    }
    case 'status':
      return `set -eu; git -C ${destination} status --short --branch`
    case 'fetch':
      return `set -eu; git -C ${destination} fetch --prune --all`
    case 'pull':
      return `set -eu; git -C ${destination} pull --ff-only`
    case 'push':
      return `set -eu; git -C ${destination} push`
    case 'deploy': {
      if (validated.sourceRemoteName === null) {
        throw new Error(
          'Choose the source remote that the SSH deployment should follow.'
        )
      }
      if (
        expectedBranch !== undefined &&
        (expectedBranch.length === 0 ||
          expectedBranch.length > 1024 ||
          /[\u0000-\u001f\u007f]/.test(expectedBranch))
      ) {
        throw new Error('The pushed branch is not safe to deploy over SSH.')
      }
      const remote = quotePOSIXShellWord(validated.sourceRemoteName)
      const expected = quotePOSIXShellWord(expectedBranch ?? '')
      return `set -eu; destination=${destination}; remote=${remote}; expected=${expected}; branch=$(git -C "$destination" symbolic-ref --quiet --short HEAD); if [ -n "$expected" ]; then git check-ref-format --branch "$expected" >/dev/null; if [ "$branch" != "$expected" ]; then printf 'Remote checkout branch does not match the pushed branch.\n' >&2; exit 18; fi; fi; git -C "$destination" fetch --prune -- "$remote" "$branch"; git -C "$destination" merge --ff-only -- "refs/remotes/$remote/$branch"; cd "$destination"; docker compose up --detach --build`
    }
  }
}

export function buildSSHWorkingCopyArguments(
  definition: ISSHWorkingCopyDefinition,
  action: SSHWorkingCopyAction,
  sourceUrl?: string,
  expectedBranch?: string
): ReadonlyArray<string> {
  const validated = validateSSHWorkingCopyDefinition(definition)
  const args = [
    '-T',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'ServerAliveInterval=10',
    '-o',
    'ServerAliveCountMax=2',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-o',
    'ControlPersist=no',
  ]
  if (validated.port !== null) {
    args.push('-p', validated.port.toString())
  }
  if (validated.user !== null) {
    args.push('-l', validated.user)
  }
  if (validated.authenticationReference !== null) {
    args.push(
      '-o',
      'IdentitiesOnly=yes',
      '-i',
      validated.authenticationReference
    )
  }
  args.push(
    '--',
    validated.host,
    buildSSHWorkingCopyCommand(validated, action, sourceUrl, expectedBranch)
  )
  return args
}

/** Redact common secret shapes before any command output reaches the UI. */
export function sanitizeSSHWorkingCopyOutput(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      '[redacted private key]'
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(
      /\b(password|passphrase|private[_-]?key|access[_-]?token|auth[_-]?token)(\s*[=:]\s*)[^\s]+/gi,
      '$1$2[redacted]'
    )
    .replace(
      /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      '[redacted token]'
    )
}

const isRawSSHAuthenticationFailure = (error: unknown): boolean =>
  error instanceof Error &&
  /(?:Permission denied|Authentication failed|Too many authentication failures)/i.test(
    error.message
  )

const getActionTimeout = (action: SSHWorkingCopyAction): number =>
  action === 'test' || action === 'status'
    ? 30_000
    : action === 'deploy'
    ? 600_000
    : 180_000

/**
 * Execute one bounded SSH operation. Dynamic connection values are argv items,
 * the remote command quotes every dynamic shell word, and host-key policy is
 * intentionally left to the user's OpenSSH configuration/known_hosts file.
 */
export async function runSSHWorkingCopyAction(
  repositoryPath: string,
  definition: ISSHWorkingCopyDefinition,
  action: SSHWorkingCopyAction,
  sourceUrl?: string,
  signal?: AbortSignal,
  expectedBranch?: string
): Promise<ISSHWorkingCopyResult> {
  const args = buildSSHWorkingCopyArguments(
    definition,
    action,
    sourceUrl,
    expectedBranch
  )
  const executable = await getSSHExecutable()

  return withTrampolineEnv(
    async trampolineEnvironment => {
      const { env } = setupEnvironment({
        ...(trampolineEnvironment as Record<string, string | undefined>),
        // Force askpass even though stdin is detached from a terminal.
        SSH_ASKPASS_REQUIRE: 'force',
      })
      try {
        const result = await execFileAsync(executable, args, {
          cwd: repositoryPath,
          env,
          encoding: 'utf8',
          timeout: getActionTimeout(action),
          maxBuffer: MaxCommandOutputBytes,
          windowsHide: true,
          shell: false,
          signal,
        })
        return {
          stdout: sanitizeSSHWorkingCopyOutput(result.stdout),
          stderr: sanitizeSSHWorkingCopyOutput(result.stderr),
        }
      } catch (error) {
        const candidate = error as Error & {
          readonly stdout?: string | Buffer
          readonly stderr?: string | Buffer
          readonly killed?: boolean
          readonly code?: string | number
        }
        const rawOutput = [candidate.stderr, candidate.stdout]
          .filter(output => output !== undefined)
          .map(output => output?.toString() ?? '')
          .join('\n')
          .trim()
        const output = sanitizeSSHWorkingCopyOutput(rawOutput)
        const timedOut = candidate.killed === true
        const aborted = signal?.aborted === true
        const reason = aborted
          ? 'SSH operation was cancelled.'
          : timedOut
          ? 'SSH operation exceeded its time limit.'
          : output || 'SSH operation failed.'
        const safeError = new Error(reason)
        safeError.cause = error
        throw safeError
      }
    },
    repositoryPath,
    false,
    undefined,
    undefined,
    isRawSSHAuthenticationFailure,
    getSSHWorkingCopyCredentialScope(definition)
  )
}
