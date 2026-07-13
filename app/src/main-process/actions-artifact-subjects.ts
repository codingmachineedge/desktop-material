import { createHash, randomBytes } from 'crypto'
import {
  close as closeDescriptor,
  createReadStream,
  fstat,
  lstat,
  open as openDescriptor,
  read,
  Stats,
} from 'fs'
import { mkdtemp, open as openFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough, Readable } from 'stream'
import crc32 from 'buffer-crc32'
import { Entry as YauzlEntry, fromFd, ZipFile as YauzlZipFile } from 'yauzl'
import {
  ActionsArtifactSubjectError,
  ActionsArtifactSubjectFailureReason,
  ActionsArtifactSubjectInventoryResult,
  ActionsArtifactSubjectMaximumAggregateBytes,
  ActionsArtifactSubjectMaximumBytes,
  ActionsArtifactSubjectMaximumCompressionRatio,
  ActionsArtifactSubjectMaximumEntries,
  ActionsArtifactSubjectMaximumPathBytes,
  ActionsArtifactSubjectMaximumSegmentBytes,
  ActionsArtifactSubjectPrepareResult,
  IActionsArtifactSubjectInspectRequest,
  IActionsArtifactSubjectPrepareRequest,
} from '../lib/actions-artifact-subjects'
import { ActionsArtifactMaximumDownloadBytes } from '../lib/actions-artifacts'
import {
  getCompletedActionsArtifactDownload,
  IActionsArtifactDownloadSender,
  ICompletedActionsArtifactDownload,
  onCompletedActionsArtifactDownloadReleased,
} from './actions-artifact-download-registry'

interface ICentralDirectory {
  readonly offset: number
  readonly end: number
  readonly entryCount: number
}

interface IValidatedEntry {
  readonly entry: YauzlEntry
  readonly path: string
  readonly compressedBytes: number
  readonly bytes: number
  readonly fingerprint: string
  readonly rangeStart: number
  readonly rangeEnd: number
}

interface IInventoryEntryRecord {
  readonly entryId: string
  readonly fingerprint: string
  readonly path: string
  readonly compressedBytes: number
  readonly bytes: number
}

interface IInventoryRecord {
  readonly inventoryId: string
  readonly senderId: number
  readonly downloadId: string
  readonly archiveDigest: string
  readonly entries: Map<string, IInventoryEntryRecord>
}

interface IActiveOperation {
  readonly operationId: string
  readonly sender: IActionsArtifactDownloadSender
  readonly controller: AbortController
  readonly cancel: () => void
  readonly done: Promise<void>
  readonly finish: () => void
  downloadId: string | null
}

export interface IRevalidatedActionsArtifactSubjectRequest
  extends IActionsArtifactSubjectPrepareRequest {
  readonly expectedDigest: string
}

/** This lease is main-process-only and is valid only during its callback. */
export interface IRevalidatedActionsArtifactSubject {
  readonly filePath: string
  readonly entryId: string
  readonly entryPath: string
  readonly bytes: number
  readonly digest: string
  readonly archiveDigest: string
}

type AuditedZipFile = Omit<YauzlZipFile, 'readEntryCursor'> & {
  readonly readEntryCursor: number
}

const operationIdPattern = /^[a-f0-9]{32}$/
const opaqueIdPattern = /^[a-f0-9]{32}$/
const controlOrBidi =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
const driveQualified = /^[a-z]:/i
const activeOperations = new Map<string, IActiveOperation>()
const inventories = new Map<string, IInventoryRecord>()

const operationKey = (senderId: number, operationId: string) =>
  `${senderId}:${operationId}`

function opaqueId(existing: ReadonlyMap<string, unknown>): string {
  let value = ''
  do {
    value = randomBytes(16).toString('hex')
  } while (existing.has(value))
  return value
}

function abortError(): Error {
  const error = new Error('Artifact subject operation canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError()
  }
}

function subjectError(
  reason: ActionsArtifactSubjectFailureReason,
  message: string
): never {
  throw new ActionsArtifactSubjectError(reason, message)
}

function beginOperation(
  sender: IActionsArtifactDownloadSender,
  operationId: unknown
): IActiveOperation {
  if (
    typeof operationId !== 'string' ||
    !operationIdPattern.test(operationId)
  ) {
    subjectError(
      'invalid-request',
      'The artifact subject operation is invalid.'
    )
  }
  const key = operationKey(sender.id, operationId)
  if (activeOperations.has(key)) {
    subjectError(
      'invalid-request',
      'The artifact subject operation is duplicate.'
    )
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  let finish!: () => void
  const done = new Promise<void>(resolve => {
    finish = resolve
  })
  const active = {
    operationId,
    sender,
    controller,
    cancel,
    done,
    finish,
    downloadId: null,
  }
  activeOperations.set(key, active)
  sender.on('did-start-navigation', cancel)
  sender.once('destroyed', cancel)
  if (sender.isDestroyed()) {
    controller.abort()
  }
  return active
}

function endOperation(active: IActiveOperation): void {
  activeOperations.delete(operationKey(active.sender.id, active.operationId))
  active.sender.removeListener('did-start-navigation', active.cancel)
  if (!active.sender.isDestroyed()) {
    active.sender.removeListener('destroyed', active.cancel)
  }
  active.finish()
}

function openFd(path: string): Promise<number> {
  return new Promise((resolve, reject) =>
    openDescriptor(path, 'r', (error, fd) =>
      error === null ? resolve(fd) : reject(error)
    )
  )
}

function closeFd(fd: number): Promise<void> {
  return new Promise((resolve, reject) =>
    closeDescriptor(fd, error => (error === null ? resolve() : reject(error)))
  )
}

function statFd(fd: number): Promise<Stats> {
  return new Promise((resolve, reject) =>
    fstat(fd, (error, stats) =>
      error === null ? resolve(stats) : reject(error)
    )
  )
}

function statPath(path: string): Promise<Stats> {
  return new Promise((resolve, reject) =>
    lstat(path, (error, stats) =>
      error === null ? resolve(stats) : reject(error)
    )
  )
}

function readExactly(
  fd: number,
  length: number,
  position: number
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !Number.isSafeInteger(position) ||
    position < 0
  ) {
    subjectError(
      'invalid-archive',
      'The artifact archive contains invalid offsets.'
    )
  }
  const buffer = Buffer.alloc(length)
  return new Promise((resolve, reject) => {
    if (length === 0) {
      resolve(buffer)
      return
    }
    read(fd, buffer, 0, length, position, (error, bytesRead) => {
      if (error !== null) {
        reject(error)
      } else if (bytesRead !== length) {
        reject(
          new ActionsArtifactSubjectError(
            'invalid-archive',
            'The artifact archive ended unexpectedly.'
          )
        )
      } else {
        resolve(buffer)
      }
    })
  })
}

function safeBigInt(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    subjectError('too-large', `The artifact archive ${label} is too large.`)
  }
  return Number(value)
}

async function hashDescriptor(
  fd: number,
  size: number,
  signal: AbortSignal
): Promise<string> {
  const hash = createHash('sha256')
  if (size === 0) {
    return `sha256:${hash.digest('hex')}`
  }
  const source = createReadStream('', {
    fd,
    autoClose: false,
    start: 0,
    end: size - 1,
  })
  const cancel = () => source.destroy(abortError())
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for await (const value of source) {
      throwIfAborted(signal)
      hash.update(value as Buffer)
    }
    throwIfAborted(signal)
    return `sha256:${hash.digest('hex')}`
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

async function readCentralDirectory(
  fd: number,
  fileSize: number
): Promise<ICentralDirectory> {
  const tailSize = Math.min(fileSize, 22 + 0xffff)
  if (tailSize < 22) {
    subjectError('invalid-archive', 'The artifact is not a ZIP archive.')
  }
  const tailOffset = fileSize - tailSize
  const tail = await readExactly(fd, tailSize, tailOffset)
  let relativeOffset = -1
  for (let index = tail.length - 22; index >= 0; index--) {
    if (
      tail.readUInt32LE(index) === 0x06054b50 &&
      tail.readUInt16LE(index + 20) === tail.length - index - 22
    ) {
      relativeOffset = index
      break
    }
  }
  if (relativeOffset < 0) {
    subjectError('invalid-archive', 'The artifact ZIP end record is missing.')
  }
  const eocdOffset = tailOffset + relativeOffset
  const eocd = tail.subarray(relativeOffset, relativeOffset + 22)
  if (eocd.readUInt16LE(4) !== 0 || eocd.readUInt16LE(6) !== 0) {
    subjectError(
      'invalid-archive',
      'Multi-disk ZIP archives are not supported.'
    )
  }
  let entriesOnDisk = eocd.readUInt16LE(8)
  let entryCount = eocd.readUInt16LE(10)
  let directorySize = eocd.readUInt32LE(12)
  let directoryOffset = eocd.readUInt32LE(16)
  const classicEntriesOnDisk = entriesOnDisk
  const classicEntryCount = entryCount
  const classicDirectorySize = directorySize
  const classicDirectoryOffset = directoryOffset
  let boundary = eocdOffset
  const usesZip64 =
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  if (usesZip64) {
    if (eocdOffset < 20) {
      subjectError('invalid-archive', 'The ZIP64 locator is missing.')
    }
    const locator = await readExactly(fd, 20, eocdOffset - 20)
    if (
      locator.readUInt32LE(0) !== 0x07064b50 ||
      locator.readUInt32LE(4) !== 0 ||
      locator.readUInt32LE(16) !== 1
    ) {
      subjectError('invalid-archive', 'The ZIP64 disk metadata is invalid.')
    }
    const zip64Offset = safeBigInt(
      locator.readBigUInt64LE(8),
      'ZIP64 end offset'
    )
    const zip64 = await readExactly(fd, 56, zip64Offset)
    const zip64RecordSize = safeBigInt(
      zip64.readBigUInt64LE(4),
      'end record size'
    )
    if (
      zip64.readUInt32LE(0) !== 0x06064b50 ||
      zip64RecordSize < 44 ||
      zip64Offset + 12 + zip64RecordSize !== eocdOffset - 20 ||
      zip64.readUInt32LE(16) !== 0 ||
      zip64.readUInt32LE(20) !== 0
    ) {
      subjectError('invalid-archive', 'The ZIP64 end record is invalid.')
    }
    const zip64EntriesOnDisk = safeBigInt(
      zip64.readBigUInt64LE(24),
      'entry count'
    )
    const zip64EntryCount = safeBigInt(zip64.readBigUInt64LE(32), 'entry count')
    if (zip64EntriesOnDisk !== zip64EntryCount) {
      subjectError('invalid-archive', 'The ZIP64 archive spans multiple disks.')
    }
    entriesOnDisk = zip64EntriesOnDisk
    entryCount = zip64EntryCount
    directorySize = safeBigInt(zip64.readBigUInt64LE(40), 'central directory')
    directoryOffset = safeBigInt(
      zip64.readBigUInt64LE(48),
      'central directory offset'
    )
    if (
      (classicEntriesOnDisk !== 0xffff &&
        classicEntriesOnDisk !== entriesOnDisk) ||
      (classicEntryCount !== 0xffff && classicEntryCount !== entryCount) ||
      (classicDirectorySize !== 0xffffffff &&
        classicDirectorySize !== directorySize) ||
      (classicDirectoryOffset !== 0xffffffff &&
        classicDirectoryOffset !== directoryOffset)
    ) {
      subjectError('invalid-archive', 'The ZIP64 end records are inconsistent.')
    }
    boundary = zip64Offset
  }
  if (entriesOnDisk !== entryCount) {
    subjectError('invalid-archive', 'The ZIP archive spans multiple disks.')
  }
  if (entryCount > ActionsArtifactSubjectMaximumEntries) {
    subjectError('too-large', 'The artifact archive has too many entries.')
  }
  const end = directoryOffset + directorySize
  if (!Number.isSafeInteger(end) || end !== boundary) {
    subjectError(
      'invalid-archive',
      'The ZIP central directory bounds are invalid.'
    )
  }
  return { offset: directoryOffset, end, entryCount }
}

function parseExtraFields(bytes: Buffer): Map<number, Buffer> {
  const fields = new Map<number, Buffer>()
  for (let offset = 0; offset < bytes.length; ) {
    if (bytes.length - offset < 4) {
      subjectError('invalid-archive', 'A ZIP extra field is truncated.')
    }
    const id = bytes.readUInt16LE(offset)
    const size = bytes.readUInt16LE(offset + 2)
    offset += 4
    if (offset + size > bytes.length) {
      subjectError('invalid-archive', 'A ZIP extra field exceeds its record.')
    }
    if ((id === 0x0001 || id === 0x7075 || id === 0x9901) && fields.has(id)) {
      subjectError(
        'invalid-archive',
        'A security-sensitive ZIP extra field is duplicate.'
      )
    }
    fields.set(id, bytes.subarray(offset, offset + size))
    offset += size
  }
  if (fields.has(0x9901)) {
    subjectError(
      'unsafe-entry',
      'Encrypted artifact entries are not supported.'
    )
  }
  if (fields.has(0x7075)) {
    subjectError(
      'unsafe-entry',
      'Unicode-path ZIP overrides are not accepted in this strict profile.'
    )
  }
  return fields
}

function normalizeEntryPath(value: string, directory: boolean): string {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    driveQualified.test(value) ||
    controlOrBidi.test(value)
  ) {
    subjectError('unsafe-entry', 'The artifact contains an unsafe entry path.')
  }
  const input = directory && value.endsWith('/') ? value.slice(0, -1) : value
  const segments = input.split('/')
  if (
    segments.length === 0 ||
    segments.some(
      segment =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        Buffer.byteLength(segment.normalize('NFC'), 'utf8') >
          ActionsArtifactSubjectMaximumSegmentBytes
    )
  ) {
    subjectError('unsafe-entry', 'The artifact contains an unsafe entry path.')
  }
  const normalized = segments.map(segment => segment.normalize('NFC')).join('/')
  if (
    Buffer.byteLength(normalized, 'utf8') >
    ActionsArtifactSubjectMaximumPathBytes
  ) {
    subjectError('too-large', 'An artifact entry path is too long.')
  }
  return normalized
}

function entryKind(entry: YauzlEntry): 'file' | 'directory' {
  const host = entry.versionMadeBy >>> 8
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixType = mode & 0xf000
  const hasTrailingSlash = entry.fileName.endsWith('/')
  const dosDirectory = (entry.externalFileAttributes & 0x10) !== 0
  const dosVolume = (entry.externalFileAttributes & 0x08) !== 0
  if (host === 3 || host === 19) {
    if (unixType === 0x4000) {
      if (!hasTrailingSlash || entry.uncompressedSize !== 0) {
        subjectError('unsafe-entry', 'A ZIP directory entry is inconsistent.')
      }
      return 'directory'
    }
    if (unixType !== 0x8000 || hasTrailingSlash || dosDirectory) {
      subjectError(
        'unsafe-entry',
        'Links and special ZIP entries are not supported.'
      )
    }
    return 'file'
  }
  if (host !== 0 && host !== 10 && host !== 14) {
    subjectError(
      'unsafe-entry',
      'The ZIP entry type cannot be verified safely.'
    )
  }
  if (dosVolume) {
    subjectError('unsafe-entry', 'ZIP volume entries are not supported.')
  }
  if (hasTrailingSlash || dosDirectory) {
    if (!hasTrailingSlash || entry.uncompressedSize !== 0) {
      subjectError('unsafe-entry', 'A ZIP directory entry is inconsistent.')
    }
    return 'directory'
  }
  return 'file'
}

function resolvedLocalSizes(
  fixed: Buffer,
  extras: ReadonlyMap<number, Buffer>
): { readonly compressed: number; readonly uncompressed: number } {
  const compressed32 = fixed.readUInt32LE(18)
  const uncompressed32 = fixed.readUInt32LE(22)
  let compressed = compressed32
  let uncompressed = uncompressed32
  if (compressed32 === 0xffffffff || uncompressed32 === 0xffffffff) {
    const zip64 = extras.get(0x0001)
    if (zip64 === undefined) {
      subjectError('invalid-archive', 'A local ZIP64 size field is missing.')
    }
    let offset = 0
    if (uncompressed32 === 0xffffffff) {
      if (offset + 8 > zip64.length) {
        subjectError('invalid-archive', 'A local ZIP64 size is truncated.')
      }
      uncompressed = safeBigInt(zip64.readBigUInt64LE(offset), 'entry size')
      offset += 8
    }
    if (compressed32 === 0xffffffff) {
      if (offset + 8 > zip64.length) {
        subjectError('invalid-archive', 'A local ZIP64 size is truncated.')
      }
      compressed = safeBigInt(
        zip64.readBigUInt64LE(offset),
        'compressed entry size'
      )
    }
  }
  return { compressed, uncompressed }
}

async function descriptorEnd(
  fd: number,
  start: number,
  entry: YauzlEntry,
  zip64Sizes: boolean,
  centralDirectoryOffset: number
): Promise<number> {
  const unsignedLength = zip64Sizes ? 20 : 12
  const signedLength = unsignedLength + 4
  const matches = new Array<number>()
  for (const signed of [false, true]) {
    const length = signed ? signedLength : unsignedLength
    if (start + length > centralDirectoryOffset) {
      continue
    }
    const value = await readExactly(fd, length, start)
    let offset = 0
    if (signed) {
      if (value.readUInt32LE(0) !== 0x08074b50) {
        continue
      }
      offset = 4
    }
    const crc = value.readUInt32LE(offset)
    const compressed = zip64Sizes
      ? safeBigInt(value.readBigUInt64LE(offset + 4), 'descriptor size')
      : value.readUInt32LE(offset + 4)
    const uncompressed = zip64Sizes
      ? safeBigInt(value.readBigUInt64LE(offset + 12), 'descriptor size')
      : value.readUInt32LE(offset + 8)
    if (
      crc === entry.crc32 &&
      compressed === entry.compressedSize &&
      uncompressed === entry.uncompressedSize
    ) {
      matches.push(start + length)
    }
  }
  if (matches.length !== 1) {
    subjectError(
      'invalid-archive',
      'A ZIP data descriptor is invalid or ambiguous.'
    )
  }
  return matches[0]
}

async function validateRawHeaders(
  fd: number,
  zip: AuditedZipFile,
  entry: YauzlEntry,
  directory: ICentralDirectory
): Promise<{ readonly start: number; readonly end: number }> {
  const centralLength =
    46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength
  const centralStart = zip.readEntryCursor - centralLength
  if (
    centralStart < directory.offset ||
    centralStart + centralLength > directory.end
  ) {
    subjectError('invalid-archive', 'A ZIP central entry is out of bounds.')
  }
  const central = await readExactly(fd, centralLength, centralStart)
  if (
    central.readUInt32LE(0) !== 0x02014b50 ||
    central.readUInt16LE(34) !== 0
  ) {
    subjectError('invalid-archive', 'A ZIP central entry is invalid.')
  }
  if (
    central.readUInt16LE(6) !== entry.versionNeededToExtract ||
    central.readUInt16LE(8) !== entry.generalPurposeBitFlag ||
    central.readUInt16LE(10) !== entry.compressionMethod ||
    central.readUInt16LE(12) !== entry.lastModFileTime ||
    central.readUInt16LE(14) !== entry.lastModFileDate ||
    central.readUInt32LE(16) !== entry.crc32
  ) {
    subjectError(
      'invalid-archive',
      'A ZIP central entry changed while reading.'
    )
  }
  const centralName = central.subarray(46, 46 + entry.fileNameLength)
  const centralExtra = central.subarray(
    46 + entry.fileNameLength,
    46 + entry.fileNameLength + entry.extraFieldLength
  )
  parseExtraFields(centralExtra)
  if ((entry.generalPurposeBitFlag & 0x0800) !== 0) {
    let decoded: string
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(centralName)
    } catch {
      subjectError('unsafe-entry', 'A ZIP entry filename is not valid UTF-8.')
    }
    if (decoded !== entry.fileName) {
      subjectError(
        'invalid-archive',
        'A ZIP entry filename changed while decoding.'
      )
    }
  }
  const zip64Sizes =
    central.readUInt32LE(20) === 0xffffffff ||
    central.readUInt32LE(24) === 0xffffffff

  const localStart = entry.relativeOffsetOfLocalHeader
  if (
    !Number.isSafeInteger(localStart) ||
    localStart < 0 ||
    localStart + 30 > directory.offset
  ) {
    subjectError('invalid-archive', 'A ZIP local header is out of bounds.')
  }
  const localFixed = await readExactly(fd, 30, localStart)
  if (localFixed.readUInt32LE(0) !== 0x04034b50) {
    subjectError('invalid-archive', 'A ZIP local header signature is invalid.')
  }
  const localNameLength = localFixed.readUInt16LE(26)
  const localExtraLength = localFixed.readUInt16LE(28)
  const localVariable = await readExactly(
    fd,
    localNameLength + localExtraLength,
    localStart + 30
  )
  const localName = localVariable.subarray(0, localNameLength)
  const localExtras = parseExtraFields(localVariable.subarray(localNameLength))
  if (!localName.equals(centralName)) {
    subjectError('invalid-archive', 'A ZIP local filename is inconsistent.')
  }
  if (
    localFixed.readUInt16LE(4) !== entry.versionNeededToExtract ||
    localFixed.readUInt16LE(6) !== entry.generalPurposeBitFlag ||
    localFixed.readUInt16LE(8) !== entry.compressionMethod ||
    localFixed.readUInt16LE(10) !== entry.lastModFileTime ||
    localFixed.readUInt16LE(12) !== entry.lastModFileDate
  ) {
    subjectError('invalid-archive', 'A ZIP local header is inconsistent.')
  }
  const usesDescriptor = (entry.generalPurposeBitFlag & 0x08) !== 0
  if (usesDescriptor) {
    if (
      localFixed.readUInt32LE(14) !== 0 ||
      localFixed.readUInt32LE(18) !== 0 ||
      localFixed.readUInt32LE(22) !== 0
    ) {
      subjectError(
        'invalid-archive',
        'A streamed ZIP local header is inconsistent.'
      )
    }
  } else {
    const sizes = resolvedLocalSizes(localFixed, localExtras)
    if (
      localFixed.readUInt32LE(14) !== entry.crc32 ||
      sizes.compressed !== entry.compressedSize ||
      sizes.uncompressed !== entry.uncompressedSize
    ) {
      subjectError(
        'invalid-archive',
        'ZIP local sizes or CRC are inconsistent.'
      )
    }
  }
  const dataStart = localStart + 30 + localNameLength + localExtraLength
  const dataEnd = dataStart + entry.compressedSize
  if (!Number.isSafeInteger(dataEnd) || dataEnd > directory.offset) {
    subjectError(
      'invalid-archive',
      'ZIP entry data exceeds the archive bounds.'
    )
  }
  return {
    start: localStart,
    end: usesDescriptor
      ? await descriptorEnd(fd, dataEnd, entry, zip64Sizes, directory.offset)
      : dataEnd,
  }
}

function validateEntryMetadata(entry: YauzlEntry): 'file' | 'directory' {
  if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x2041) !== 0) {
    subjectError(
      'unsafe-entry',
      'Encrypted artifact entries are not supported.'
    )
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    subjectError(
      'unsafe-entry',
      'The artifact uses an unsupported compression method.'
    )
  }
  const allowedFlags = entry.compressionMethod === 0 ? 0x0808 : 0x080e
  if ((entry.generalPurposeBitFlag & ~allowedFlags) !== 0) {
    subjectError(
      'unsafe-entry',
      'The artifact uses unsupported ZIP entry flags.'
    )
  }
  if (
    entry.versionNeededToExtract < (entry.compressionMethod === 8 ? 20 : 10) ||
    entry.versionNeededToExtract > 45
  ) {
    subjectError(
      'unsafe-entry',
      'The artifact needs an unsupported ZIP version.'
    )
  }
  if (
    entry.compressionMethod === 0 &&
    entry.compressedSize !== entry.uncompressedSize
  ) {
    subjectError(
      'invalid-archive',
      'A stored ZIP entry has inconsistent sizes.'
    )
  }
  return entryKind(entry)
}

function entryFingerprint(entry: YauzlEntry, path: string): string {
  return createHash('sha256')
    .update(path)
    .update('\u0000')
    .update(
      [
        entry.relativeOffsetOfLocalHeader,
        entry.crc32,
        entry.compressionMethod,
        entry.compressedSize,
        entry.uncompressedSize,
      ].join(':')
    )
    .digest('hex')
}

function openZip(fd: number): Promise<AuditedZipFile> {
  return new Promise((resolve, reject) =>
    fromFd(
      fd,
      {
        autoClose: false,
        lazyEntries: true,
        decodeStrings: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) =>
        error === undefined || error === null
          ? resolve(zip as unknown as AuditedZipFile)
          : reject(
              new ActionsArtifactSubjectError(
                'invalid-archive',
                'The artifact ZIP structure is invalid.'
              )
            )
    )
  )
}

function closeZip(zip: AuditedZipFile): Promise<void> {
  if (!zip.isOpen) {
    return Promise.reject(
      new ActionsArtifactSubjectError(
        'io',
        'The artifact archive close state is uncertain.'
      )
    )
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let closeError: Error | undefined
    const finish = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      zip.removeListener('close', onClose)
      zip.removeListener('error', onError)
      if (error === undefined) {
        resolve()
      } else {
        reject(error)
      }
    }
    const onClose = () => finish(closeError)
    const onError = () => {
      closeError = new ActionsArtifactSubjectError(
        'io',
        'The artifact archive could not be closed safely.'
      )
    }
    zip.once('close', onClose)
    zip.once('error', onError)
    const timeout = setTimeout(() => {
      finish(
        closeError ??
          new ActionsArtifactSubjectError(
            'io',
            'The artifact archive did not close safely.'
          )
      )
    }, 5_000)
    try {
      zip.close()
    } catch {
      onError()
    }
  })
}

async function readValidatedEntries(
  fd: number,
  zip: AuditedZipFile,
  directory: ICentralDirectory,
  signal: AbortSignal
): Promise<ReadonlyArray<IValidatedEntry>> {
  if (zip.entryCount !== directory.entryCount) {
    subjectError('invalid-archive', 'The ZIP entry count is inconsistent.')
  }
  const paths = new Set<string>()
  const values = new Array<IValidatedEntry>()
  const allRanges = new Array<{
    readonly start: number
    readonly end: number
  }>()
  let aggregate = 0
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) {
        return
      }
      settled = true
      zip.removeListener('entry', onEntry)
      zip.removeListener('end', onEnd)
      zip.removeListener('error', onError)
      if (error === undefined) {
        resolve()
      } else {
        reject(error)
      }
    }
    const onError = (error: Error) =>
      finish(
        error instanceof ActionsArtifactSubjectError
          ? error
          : new ActionsArtifactSubjectError(
              'invalid-archive',
              'The artifact ZIP entry is invalid.'
            )
      )
    const onEnd = () => {
      if (zip.readEntryCursor !== directory.end) {
        finish(
          new ActionsArtifactSubjectError(
            'invalid-archive',
            'The ZIP central directory size is inconsistent.'
          )
        )
      } else {
        finish()
      }
    }
    const onEntry = (entry: YauzlEntry) => {
      void (async () => {
        throwIfAborted(signal)
        const kind = validateEntryMetadata(entry)
        const path = normalizeEntryPath(entry.fileName, kind === 'directory')
        if (paths.has(path)) {
          subjectError(
            'unsafe-entry',
            'The artifact contains duplicate entry paths.'
          )
        }
        paths.add(path)
        aggregate += entry.uncompressedSize
        if (
          !Number.isSafeInteger(aggregate) ||
          aggregate > ActionsArtifactSubjectMaximumAggregateBytes
        ) {
          subjectError(
            'too-large',
            'The artifact expands beyond the 8 GiB limit.'
          )
        }
        const range = await validateRawHeaders(fd, zip, entry, directory)
        allRanges.push(range)
        if (kind === 'file') {
          if (entry.uncompressedSize > ActionsArtifactSubjectMaximumBytes) {
            subjectError(
              'too-large',
              'An artifact subject exceeds the 1 GiB limit.'
            )
          }
          if (
            entry.uncompressedSize > 0 &&
            (entry.compressedSize === 0 ||
              entry.uncompressedSize >
                entry.compressedSize *
                  ActionsArtifactSubjectMaximumCompressionRatio)
          ) {
            subjectError(
              'too-large',
              'An artifact subject exceeds the 200:1 ratio limit.'
            )
          }
          values.push({
            entry,
            path,
            compressedBytes: entry.compressedSize,
            bytes: entry.uncompressedSize,
            fingerprint: entryFingerprint(entry, path),
            rangeStart: range.start,
            rangeEnd: range.end,
          })
        }
        if (!settled) {
          zip.readEntry()
        }
      })().catch(finish)
    }
    zip.on('error', onError)
    zip.on('end', onEnd)
    zip.on('entry', onEntry)
    try {
      zip.readEntry()
    } catch (error) {
      finish(error)
    }
  })
  const ranges = [...allRanges].sort((left, right) => left.start - right.start)
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index].start < ranges[index - 1].end) {
      subjectError('invalid-archive', 'ZIP entry data ranges overlap.')
    }
  }
  return values
}

async function withValidatedArchive<T>(
  download: ICompletedActionsArtifactDownload,
  signal: AbortSignal,
  use: (
    zip: AuditedZipFile,
    entries: ReadonlyArray<IValidatedEntry>
  ) => Promise<T>
): Promise<T> {
  throwIfAborted(signal)
  const pathStats = await statPath(download.path)
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    subjectError('changed', 'The downloaded artifact archive has changed.')
  }
  let fd: number | null = await openFd(download.path)
  let zip: AuditedZipFile | null = null
  try {
    const stats = await statFd(fd)
    if (
      !stats.isFile() ||
      stats.size !== download.bytes ||
      stats.size > ActionsArtifactMaximumDownloadBytes
    ) {
      subjectError('changed', 'The downloaded artifact archive has changed.')
    }
    const archiveDigest = await hashDescriptor(fd, stats.size, signal)
    if (archiveDigest !== download.archiveDigest) {
      subjectError('changed', 'The downloaded artifact bytes have changed.')
    }
    const directory = await readCentralDirectory(fd, stats.size)
    throwIfAborted(signal)
    const archiveFd = fd
    zip = await openZip(archiveFd)
    fd = null
    const entries = await readValidatedEntries(
      archiveFd,
      zip,
      directory,
      signal
    )
    zip.on('error', () => undefined)
    throwIfAborted(signal)
    return await use(zip, entries)
  } catch (error) {
    if (signal.aborted && (error as Error)?.name !== 'AbortError') {
      throw abortError()
    }
    throw error
  } finally {
    if (zip !== null) {
      try {
        await closeZip(zip)
      } catch (error) {
        if (signal.aborted) {
          throw abortError()
        }
        if (error instanceof ActionsArtifactSubjectError) {
          throw error
        }
        subjectError('io', 'The artifact archive could not be closed safely.')
      }
    } else if (fd !== null) {
      try {
        await closeFd(fd)
      } catch {
        if (signal.aborted) {
          throw abortError()
        }
        subjectError('io', 'The artifact archive could not be closed safely.')
      }
    }
  }
}

function openEntryStream(
  zip: AuditedZipFile,
  entry: YauzlEntry
): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error === undefined || error === null
        ? resolve(stream as Readable)
        : reject(error)
    )
  )
}

async function writeAll(
  handle: Awaited<ReturnType<typeof openFile>>,
  bytes: Buffer
): Promise<void> {
  let offset = 0
  while (offset < bytes.length) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      null
    )
    if (result.bytesWritten <= 0) {
      subjectError('io', 'The artifact subject could not be written.')
    }
    offset += result.bytesWritten
  }
}

async function extractEntry(
  zip: AuditedZipFile,
  value: IValidatedEntry,
  path: string,
  signal: AbortSignal
): Promise<string> {
  let handle: Awaited<ReturnType<typeof openFile>> | null = null
  let source: Readable | null = null
  let wrapper: PassThrough | null = null
  try {
    handle = await openFile(path, 'wx', 0o600)
    source = await openEntryStream(zip, value.entry)
    wrapper = new PassThrough()
    const target = wrapper
    const onSourceError = (_error: Error) =>
      target.destroy(
        new ActionsArtifactSubjectError(
          'invalid-archive',
          'The artifact subject stream is invalid.'
        )
      )
    source.on('error', onSourceError)
    source.pipe(wrapper)
    const cancel = () => {
      target.destroy(abortError())
      source?.destroy()
    }
    signal.addEventListener('abort', cancel, { once: true })
    const hash = createHash('sha256')
    let crc: Buffer | undefined
    let bytes = 0
    try {
      for await (const chunk of wrapper) {
        throwIfAborted(signal)
        const buffer = chunk as Buffer
        if (
          bytes + buffer.length > value.bytes ||
          bytes + buffer.length > ActionsArtifactSubjectMaximumBytes
        ) {
          subjectError(
            'invalid-archive',
            'The artifact subject exceeds its declared size.'
          )
        }
        bytes += buffer.length
        hash.update(buffer)
        crc = crc32(buffer, crc)
        await writeAll(handle, buffer)
      }
      throwIfAborted(signal)
      if (
        bytes !== value.bytes ||
        (crc?.readUInt32BE(0) ?? crc32.unsigned(Buffer.alloc(0))) !==
          value.entry.crc32
      ) {
        subjectError(
          'invalid-archive',
          'The artifact subject CRC or size is invalid.'
        )
      }
      await handle.sync()
      return `sha256:${hash.digest('hex')}`
    } finally {
      signal.removeEventListener('abort', cancel)
      source.removeListener('error', onSourceError)
    }
  } finally {
    wrapper?.destroy()
    source?.destroy()
    if (handle !== null) {
      try {
        await handle.close()
      } catch {
        subjectError(
          'io',
          'The temporary artifact subject could not be closed.'
        )
      }
    }
  }
}

async function withSubjectLease<T>(
  download: ICompletedActionsArtifactDownload,
  selected: IInventoryEntryRecord,
  signal: AbortSignal,
  expectedDigest: string | null,
  use: (subject: IRevalidatedActionsArtifactSubject) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(
    join(tmpdir(), 'desktop-material-actions-subject-')
  )
  const filePath = join(directory, 'subject.bin')
  try {
    const subject = await withValidatedArchive(
      download,
      signal,
      async (zip, validated) => {
        const matches = validated.filter(
          value => value.fingerprint === selected.fingerprint
        )
        if (matches.length !== 1) {
          subjectError('changed', 'The selected artifact subject has changed.')
        }
        const value = matches[0]
        const digest = await extractEntry(zip, value, filePath, signal)
        if (expectedDigest !== null && digest !== expectedDigest) {
          subjectError('changed', 'The selected artifact subject has changed.')
        }
        return {
          filePath,
          entryId: selected.entryId,
          entryPath: selected.path,
          bytes: selected.bytes,
          digest,
          archiveDigest: download.archiveDigest,
        }
      }
    )
    // The archive and output file are closed before the leased path is used.
    throwIfAborted(signal)
    const result = await use(subject)
    throwIfAborted(signal)
    return result
  } finally {
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    } catch {
      subjectError('io', 'The temporary artifact subject could not be removed.')
    }
  }
}

function mapFailure(error: unknown): {
  readonly ok: false
  readonly reason: ActionsArtifactSubjectFailureReason
} {
  if ((error as Error)?.name === 'AbortError') {
    return { ok: false, reason: 'canceled' }
  }
  if (error instanceof ActionsArtifactSubjectError) {
    return { ok: false, reason: error.reason }
  }
  return { ok: false, reason: 'io' }
}

function requestDownload(
  senderId: number,
  downloadId: unknown
): ICompletedActionsArtifactDownload {
  const value = getCompletedActionsArtifactDownload(senderId, downloadId)
  if (value === null) {
    subjectError('not-found', 'The retained artifact download is unavailable.')
  }
  return value
}

function requestSelectedEntry(
  senderId: number,
  download: ICompletedActionsArtifactDownload,
  inventoryId: unknown,
  entryId: unknown
): IInventoryEntryRecord {
  if (
    typeof inventoryId !== 'string' ||
    !opaqueIdPattern.test(inventoryId) ||
    typeof entryId !== 'string' ||
    !opaqueIdPattern.test(entryId)
  ) {
    subjectError(
      'invalid-request',
      'The artifact subject selection is invalid.'
    )
  }
  const inventory = inventories.get(inventoryId)
  const selected = inventory?.entries.get(entryId)
  if (
    inventory === undefined ||
    selected === undefined ||
    inventory.senderId !== senderId ||
    inventory.downloadId !== download.downloadId ||
    inventory.archiveDigest !== download.archiveDigest
  ) {
    subjectError('not-found', 'The artifact subject selection is stale.')
  }
  return selected
}

export async function inspectActionsArtifactSubjects(
  sender: IActionsArtifactDownloadSender,
  request: IActionsArtifactSubjectInspectRequest
): Promise<ActionsArtifactSubjectInventoryResult> {
  let active: IActiveOperation | null = null
  try {
    active = beginOperation(sender, request?.operationId)
    const download = requestDownload(sender.id, request?.downloadId)
    active.downloadId = download.downloadId
    return await withValidatedArchive(
      download,
      active.controller.signal,
      async (_zip, validated) => {
        const inventoryId = opaqueId(inventories)
        const entries = new Map<string, IInventoryEntryRecord>()
        const resultEntries = validated.map(value => {
          const entryId = opaqueId(entries)
          entries.set(entryId, {
            entryId,
            fingerprint: value.fingerprint,
            path: value.path,
            compressedBytes: value.compressedBytes,
            bytes: value.bytes,
          })
          return {
            entryId,
            path: value.path,
            compressedBytes: value.compressedBytes,
            bytes: value.bytes,
          }
        })
        inventories.set(inventoryId, {
          inventoryId,
          senderId: sender.id,
          downloadId: download.downloadId,
          archiveDigest: download.archiveDigest,
          entries,
        })
        return {
          ok: true,
          inventoryId,
          archiveDigest: download.archiveDigest,
          archiveBytes: download.bytes,
          entries: resultEntries,
        }
      }
    )
  } catch (error) {
    return mapFailure(error)
  } finally {
    if (active !== null) {
      endOperation(active)
    }
  }
}

export async function prepareActionsArtifactSubject(
  sender: IActionsArtifactDownloadSender,
  request: IActionsArtifactSubjectPrepareRequest
): Promise<ActionsArtifactSubjectPrepareResult> {
  let active: IActiveOperation | null = null
  try {
    active = beginOperation(sender, request?.operationId)
    const download = requestDownload(sender.id, request?.downloadId)
    active.downloadId = download.downloadId
    const selected = requestSelectedEntry(
      sender.id,
      download,
      request?.inventoryId,
      request?.entryId
    )
    return await withSubjectLease(
      download,
      selected,
      active.controller.signal,
      null,
      async subject => ({
        ok: true,
        entryId: subject.entryId,
        path: subject.entryPath,
        bytes: subject.bytes,
        digest: subject.digest,
        archiveDigest: subject.archiveDigest,
      })
    )
  } catch (error) {
    return mapFailure(error)
  } finally {
    if (active !== null) {
      endOperation(active)
    }
  }
}

/**
 * Reopen and revalidate a sender-owned subject, then lend its private path to
 * one awaited main-process callback. The path is never returned over IPC.
 */
export async function withRevalidatedActionsArtifactSubject<T>(
  sender: IActionsArtifactDownloadSender,
  request: IRevalidatedActionsArtifactSubjectRequest,
  use: (
    subject: IRevalidatedActionsArtifactSubject,
    signal: AbortSignal
  ) => Promise<T>
): Promise<T> {
  let active: IActiveOperation | null = null
  try {
    active = beginOperation(sender, request?.operationId)
    const download = requestDownload(sender.id, request?.downloadId)
    active.downloadId = download.downloadId
    const selected = requestSelectedEntry(
      sender.id,
      download,
      request?.inventoryId,
      request?.entryId
    )
    if (
      typeof request?.expectedDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(request.expectedDigest)
    ) {
      subjectError(
        'invalid-request',
        'The expected artifact subject digest is invalid.'
      )
    }
    return await withSubjectLease(
      download,
      selected,
      active.controller.signal,
      request.expectedDigest,
      subject => use(subject, active!.controller.signal)
    )
  } finally {
    if (active !== null) {
      endOperation(active)
    }
  }
}

export function cancelActionsArtifactSubjectOperation(
  senderId: number,
  operationId: unknown
): boolean {
  if (
    typeof operationId !== 'string' ||
    !operationIdPattern.test(operationId)
  ) {
    return false
  }
  const active = activeOperations.get(operationKey(senderId, operationId))
  if (active === undefined) {
    return false
  }
  active.controller.abort()
  return true
}

export function cancelAllActionsArtifactSubjectOperations(): void {
  for (const active of activeOperations.values()) {
    active.controller.abort()
  }
}

export async function cancelAllActionsArtifactSubjectOperationsAndWait(): Promise<void> {
  const active = [...activeOperations.values()]
  for (const operation of active) {
    operation.controller.abort()
  }
  await Promise.all(active.map(operation => operation.done))
}

export function releaseActionsArtifactSubjectInventoriesForSender(
  senderId: number
): void {
  for (const [inventoryId, inventory] of inventories) {
    if (inventory.senderId === senderId) {
      inventories.delete(inventoryId)
    }
  }
}

onCompletedActionsArtifactDownloadReleased((downloadId, senderId) => {
  for (const active of activeOperations.values()) {
    if (active.sender.id === senderId && active.downloadId === downloadId) {
      active.controller.abort()
    }
  }
  for (const [inventoryId, inventory] of inventories) {
    if (
      inventory.senderId === senderId &&
      inventory.downloadId === downloadId
    ) {
      inventories.delete(inventoryId)
    }
  }
})
