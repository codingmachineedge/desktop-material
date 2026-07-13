import { createHash } from 'crypto'
import type {
  RepositorySigningFormat,
  RepositorySigningScope,
} from './cli-workbench'

const MaximumSigningConfigBytes = 64 * 1024
const MaximumSigningKeyBytes = 16 * 1024
const MaximumTags = 100
const SigningConfigKeys = new Set([
  'user.signingkey',
  'gpg.format',
  'commit.gpgsign',
  'tag.gpgsign',
])
const HexSigningKey = /^(?:0x)?[a-f0-9]{16,64}$/i
const SSHPublicKey =
  /^key::(ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]+={0,2})$/
const ObjectID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const SafeFingerprint = /^[A-Za-z0-9:+/=._-]{1,256}$/

export interface IRepositorySigningConfig {
  readonly scope: RepositorySigningScope
  readonly format: RepositorySigningFormat | null
  readonly hasSigningKey: boolean
  readonly signingKeyDescription: string | null
  readonly commitSigning: boolean | null
  readonly tagSigning: boolean | null
}

export interface IRepositorySigningEffectiveConfig {
  readonly format: RepositorySigningFormat
  readonly hasSigningKey: boolean
  readonly signingKeyDescription: string | null
  readonly signingKeyScope: RepositorySigningScope | null
  readonly commitSigning: boolean
  readonly commitSigningScope: RepositorySigningScope | null
  readonly tagSigning: boolean
  readonly tagSigningScope: RepositorySigningScope | null
}

export interface IRepositorySigningTag {
  readonly name: string
  readonly object: string
}

export type RepositorySignatureGrade =
  | 'good'
  | 'bad'
  | 'good-unknown-validity'
  | 'expired-signature'
  | 'expired-key'
  | 'revoked-key'
  | 'cannot-verify'
  | 'unsigned'
  | 'unknown'

export interface IRepositorySignatureVerification {
  readonly object: string
  readonly grade: RepositorySignatureGrade
  readonly fingerprint: string | null
  readonly key: string | null
}

function isSigningFormat(value: string): value is RepositorySigningFormat {
  return value === 'openpgp' || value === 'ssh' || value === 'x509'
}

function parseBoolean(value: string, label: string): boolean {
  switch (value.trim().toLowerCase()) {
    case 'true':
    case 'yes':
    case 'on':
    case '1':
      return true
    case 'false':
    case 'no':
    case 'off':
    case '0':
      return false
    default:
      throw new Error(`Git returned an invalid ${label} value.`)
  }
}

function describeSigningKey(
  value: string,
  format: RepositorySigningFormat | null
): string {
  if (format === 'ssh') {
    const match = SSHPublicKey.exec(value)
    if (match !== null) {
      const decoded = Buffer.from(match[2], 'base64')
      const fingerprint = createHash('sha256')
        .update(decoded)
        .digest('base64')
        .replace(/=+$/, '')
      return `${match[1]} public key SHA256:${fingerprint}`
    }
    return 'Configured SSH public-key reference (value hidden)'
  }

  const match = /([a-f0-9]{8,64})$/i.exec(value)
  if (match !== null) {
    return `Key ending ${match[1].slice(-8).toUpperCase()}`
  }
  return 'Configured key identifier (value hidden)'
}

/**
 * Parse only the four allowlisted signing keys. Arbitrary config values,
 * origins, include paths, signing programs, and allowed-signers paths never
 * reach renderer state.
 */
export function parseRepositorySigningConfig(
  output: string,
  scope: RepositorySigningScope
): IRepositorySigningConfig {
  if (Buffer.byteLength(output, 'utf8') > MaximumSigningConfigBytes) {
    throw new Error('Git returned too much signing configuration to review.')
  }

  const values = new Map<string, string>()
  for (const rawRecord of output.split('\0')) {
    const record = rawRecord.replace(/\r?\n$/, '')
    if (record.length === 0) {
      continue
    }
    const match = /^([^\r\n]+)\r?\n([\s\S]*)$/.exec(record)
    if (match === null || !SigningConfigKeys.has(match[1])) {
      throw new Error('Git returned an unexpected signing configuration key.')
    }
    if (
      match[2].includes('\0') ||
      Buffer.byteLength(match[2], 'utf8') > MaximumSigningKeyBytes
    ) {
      throw new Error('Git returned an invalid signing configuration value.')
    }
    values.set(match[1], match[2])
  }

  const formatValue = values.get('gpg.format')
  if (formatValue !== undefined && !isSigningFormat(formatValue)) {
    throw new Error('Git returned an unsupported signing format.')
  }
  const format = formatValue ?? null
  const signingKey = values.get('user.signingkey')
  return {
    scope,
    format,
    hasSigningKey: signingKey !== undefined && signingKey.length > 0,
    signingKeyDescription:
      signingKey === undefined || signingKey.length === 0
        ? null
        : describeSigningKey(signingKey, format),
    commitSigning: values.has('commit.gpgsign')
      ? parseBoolean(values.get('commit.gpgsign') ?? '', 'commit signing')
      : null,
    tagSigning: values.has('tag.gpgsign')
      ? parseBoolean(values.get('tag.gpgsign') ?? '', 'tag signing')
      : null,
  }
}

export function getEffectiveRepositorySigningConfig(
  local: IRepositorySigningConfig,
  global: IRepositorySigningConfig
): IRepositorySigningEffectiveConfig {
  const signingKeySource = local.hasSigningKey
    ? local
    : global.hasSigningKey
    ? global
    : null
  return {
    format: local.format ?? global.format ?? 'openpgp',
    hasSigningKey: signingKeySource !== null,
    signingKeyDescription: signingKeySource?.signingKeyDescription ?? null,
    signingKeyScope: signingKeySource?.scope ?? null,
    commitSigning: local.commitSigning ?? global.commitSigning ?? false,
    commitSigningScope:
      local.commitSigning !== null
        ? 'local'
        : global.commitSigning !== null
        ? 'global'
        : null,
    tagSigning: local.tagSigning ?? global.tagSigning ?? false,
    tagSigningScope:
      local.tagSigning !== null
        ? 'local'
        : global.tagSigning !== null
        ? 'global'
        : null,
  }
}

export function getRepositorySigningConfigToken(
  config: IRepositorySigningConfig
): string {
  return JSON.stringify([
    config.scope,
    config.format,
    config.hasSigningKey,
    config.signingKeyDescription,
    config.commitSigning,
    config.tagSigning,
  ])
}

/** Validate a replacement identifier without ever accepting a private key. */
export function normalizeRepositorySigningKey(
  format: RepositorySigningFormat,
  value: string
): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.includes('\0') ||
    /[\r\n\u0000-\u001f\u007f]/.test(normalized) ||
    Buffer.byteLength(normalized, 'utf8') > MaximumSigningKeyBytes
  ) {
    throw new Error('Enter a valid public signing-key identifier.')
  }

  if (format === 'ssh') {
    const match = SSHPublicKey.exec(normalized)
    if (match === null) {
      throw new Error(
        'Enter an inline SSH public key beginning with key::. Private-key paths and comments are not accepted.'
      )
    }
    const decoded = Buffer.from(match[2], 'base64')
    if (decoded.length < 32 || decoded.length > MaximumSigningKeyBytes) {
      throw new Error('Enter a valid inline SSH public key.')
    }
    return normalized
  }

  if (!HexSigningKey.test(normalized)) {
    throw new Error(
      `${
        format === 'x509' ? 'X.509' : 'OpenPGP'
      } signing keys must use a 16–64 digit hexadecimal fingerprint.`
    )
  }
  return normalized.replace(/^0x/i, '').toUpperCase()
}

export function parseRepositorySigningTags(
  output: string
): ReadonlyArray<IRepositorySigningTag> {
  if (Buffer.byteLength(output, 'utf8') > MaximumSigningConfigBytes) {
    throw new Error('Git returned too many tags to review safely.')
  }
  const tags = new Array<IRepositorySigningTag>()
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      continue
    }
    const fields = line.split('\0')
    if (
      fields.length !== 3 ||
      fields[0].length === 0 ||
      fields[0].length > 1024 ||
      fields[0].startsWith('-') ||
      fields[1] !== 'tag' ||
      !ObjectID.test(fields[2]) ||
      /[\x00-\x20\x7f~^:?*\[\\]/.test(fields[0]) ||
      names.has(fields[0])
    ) {
      throw new Error('Git returned an invalid annotated tag list.')
    }
    names.add(fields[0])
    tags.push({ name: fields[0], object: fields[2] })
    if (tags.length > MaximumTags) {
      throw new Error('Git returned too many tags to review safely.')
    }
  }
  return tags
}

function signatureGrade(value: string): RepositorySignatureGrade {
  switch (value || 'N') {
    case 'G':
      return 'good'
    case 'B':
      return 'bad'
    case 'U':
      return 'good-unknown-validity'
    case 'X':
      return 'expired-signature'
    case 'Y':
      return 'expired-key'
    case 'R':
      return 'revoked-key'
    case 'E':
      return 'cannot-verify'
    case 'N':
      return 'unsigned'
    default:
      return 'unknown'
  }
}

export function parseRepositorySignatureVerification(
  output: string
): IRepositorySignatureVerification {
  if (Buffer.byteLength(output, 'utf8') > MaximumSigningConfigBytes) {
    throw new Error('Git returned too much signature information to review.')
  }
  const fields = output.replace(/\r?\n$/, '').split('\0')
  if (fields.length !== 4 || !ObjectID.test(fields[0])) {
    throw new Error('Git returned an invalid signature-verification result.')
  }
  for (const value of fields.slice(2)) {
    if (value.length > 0 && !SafeFingerprint.test(value)) {
      throw new Error('Git returned an unsafe signature identifier.')
    }
  }
  return {
    object: fields[0],
    grade: signatureGrade(fields[1]),
    fingerprint: fields[2] || null,
    key: fields[3] || null,
  }
}

export function describeRepositorySignatureGrade(
  grade: RepositorySignatureGrade
): string {
  switch (grade) {
    case 'good':
      return 'Good signature'
    case 'bad':
      return 'Bad signature'
    case 'good-unknown-validity':
      return 'Cryptographically good; trust is unknown'
    case 'expired-signature':
      return 'Good signature made after its expiry'
    case 'expired-key':
      return 'Good signature made by an expired key'
    case 'revoked-key':
      return 'Good signature made by a revoked key'
    case 'cannot-verify':
      return 'Signature could not be checked'
    case 'unsigned':
      return 'Unsigned'
    default:
      return 'Unknown signature state'
  }
}
