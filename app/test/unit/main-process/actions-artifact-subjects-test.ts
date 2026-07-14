import assert from 'node:assert'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync } from 'zlib'
import crc32 from 'buffer-crc32'
import { describe, it } from 'node:test'
import {
  cancelActionsArtifactSubjectOperation,
  inspectActionsArtifactSubjects,
  prepareActionsArtifactSubject,
  withRevalidatedActionsArtifactSubject,
} from '../../../src/main-process/actions-artifact-subjects'
import {
  IActionsArtifactDownloadSender,
  releaseAllCompletedActionsArtifactDownloads,
  releaseCompletedActionsArtifactDownload,
  retainCompletedActionsArtifactDownload,
} from '../../../src/main-process/actions-artifact-download-registry'

interface IZipOptions {
  readonly name?: string | Buffer
  readonly localName?: string | Buffer
  readonly data?: Buffer
  readonly method?: 0 | 8
  readonly descriptor?: boolean
  readonly descriptorSignature?: boolean
  readonly crc?: number
  readonly externalAttributes?: number
}

class TestSender
  extends EventEmitter
  implements IActionsArtifactDownloadSender
{
  private destroyed = false

  public constructor(public readonly id: number) {
    super()
  }

  public isDestroyed(): boolean {
    return this.destroyed
  }

  public destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }

  public navigate(): void {
    this.emit('did-start-navigation')
  }
}

const asBytes = (value: string | Buffer): Buffer =>
  Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')

function rawZip(options: IZipOptions = {}): Buffer {
  const name = asBytes(options.name ?? 'subject.txt')
  const localName = asBytes(options.localName ?? name)
  const data = options.data ?? Buffer.from('trusted artifact subject')
  const method = options.method ?? 0
  const compressed = method === 8 ? deflateRawSync(data) : data
  const checksum = options.crc ?? crc32.unsigned(data)
  const descriptor = options.descriptor ?? false
  const flags = 0x0800 | (descriptor ? 0x0008 : 0)
  const versionNeeded = method === 8 ? 20 : 10

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(versionNeeded, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(descriptor ? 0 : checksum, 14)
  local.writeUInt32LE(descriptor ? 0 : compressed.length, 18)
  local.writeUInt32LE(descriptor ? 0 : data.length, 22)
  local.writeUInt16LE(localName.length, 26)

  const dataDescriptor = descriptor
    ? Buffer.alloc(options.descriptorSignature === false ? 12 : 16)
    : Buffer.alloc(0)
  if (descriptor) {
    const offset = options.descriptorSignature === false ? 0 : 4
    if (offset === 4) {
      dataDescriptor.writeUInt32LE(0x08074b50, 0)
    }
    dataDescriptor.writeUInt32LE(checksum, offset)
    dataDescriptor.writeUInt32LE(compressed.length, offset + 4)
    dataDescriptor.writeUInt32LE(data.length, offset + 8)
  }

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE((3 << 8) | 20, 4)
  central.writeUInt16LE(versionNeeded, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(
    options.externalAttributes ?? (0o100644 << 16) >>> 0,
    38
  )

  const localRecord = Buffer.concat([
    local,
    localName,
    compressed,
    dataDescriptor,
  ])
  const centralRecord = Buffer.concat([central, name])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralRecord.length, 12)
  end.writeUInt32LE(localRecord.length, 16)
  return Buffer.concat([localRecord, centralRecord, end])
}

const operationId = (value: string): string => value.repeat(32)

async function withArchive(
  bytes: Buffer,
  run: (context: {
    readonly sender: TestSender
    readonly other: TestSender
    readonly downloadId: string
    readonly path: string
  }) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'actions-subject-test-'))
  const path = join(directory, 'artifact.zip')
  const sender = new TestSender(401)
  const other = new TestSender(402)
  await writeFile(path, bytes)
  const downloadId = retainCompletedActionsArtifactDownload(sender, {
    endpoint: 'https://api.github.com/',
    path,
    bytes: bytes.length,
    archiveDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    owner: 'owner',
    repository: 'repository',
    artifactId: 29,
    workflowRun: null,
  })
  try {
    await run({ sender, other, downloadId, path })
  } finally {
    releaseAllCompletedActionsArtifactDownloads()
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Actions artifact subject service', () => {
  it('inventories and prepares a valid stored subject without leaking its bytes', async () => {
    const bytes = Buffer.from('trusted stored subject')
    await withArchive(
      rawZip({ data: bytes }),
      async ({ sender, downloadId }) => {
        const inventory = await inspectActionsArtifactSubjects(sender, {
          operationId: operationId('a'),
          downloadId,
        })
        assert.equal(inventory.ok, true)
        if (!inventory.ok) {
          return
        }
        assert.deepEqual(inventory.entries, [
          {
            entryId: inventory.entries[0].entryId,
            path: 'subject.txt',
            compressedBytes: bytes.length,
            bytes: bytes.length,
          },
        ])
        const before = new Set(
          (await readdir(tmpdir())).filter(value =>
            value.startsWith('desktop-material-actions-subject-')
          )
        )
        const prepared = await prepareActionsArtifactSubject(sender, {
          operationId: operationId('b'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
        })
        assert.deepEqual(prepared, {
          ok: true,
          entryId: inventory.entries[0].entryId,
          path: 'subject.txt',
          bytes: bytes.length,
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
          archiveDigest: inventory.archiveDigest,
        })
        const after = new Set(
          (await readdir(tmpdir())).filter(value =>
            value.startsWith('desktop-material-actions-subject-')
          )
        )
        assert.deepEqual(after, before)
      }
    )
  })

  it('supports deflate plus signed and unsigned data descriptors', async () => {
    for (const descriptorSignature of [true, false]) {
      const data = Buffer.from('deflated subject '.repeat(24))
      await withArchive(
        rawZip({
          data,
          method: 8,
          descriptor: true,
          descriptorSignature,
        }),
        async ({ sender, downloadId }) => {
          const inventory = await inspectActionsArtifactSubjects(sender, {
            operationId: operationId('c'),
            downloadId,
          })
          assert.equal(inventory.ok, true)
          if (!inventory.ok) {
            return
          }
          assert.ok(inventory.entries[0].compressedBytes < data.length)
          const prepared = await prepareActionsArtifactSubject(sender, {
            operationId: operationId('d'),
            downloadId,
            inventoryId: inventory.inventoryId,
            entryId: inventory.entries[0].entryId,
          })
          assert.equal(prepared.ok, true)
          if (prepared.ok) {
            assert.equal(
              prepared.digest,
              `sha256:${createHash('sha256').update(data).digest('hex')}`
            )
          }
        }
      )
    }
  })

  it('rejects traversal, malformed UTF-8, links, ratio bombs, and header mismatches', async () => {
    const cases: ReadonlyArray<{
      readonly label: string
      readonly archive: Buffer
      readonly reason: 'invalid-archive' | 'too-large' | 'unsafe-entry'
    }> = [
      {
        label: 'traversal',
        archive: rawZip({ name: '../escape.txt' }),
        reason: 'invalid-archive',
      },
      {
        label: 'malformed UTF-8',
        archive: rawZip({ name: Buffer.from([0xc3, 0x28]) }),
        reason: 'unsafe-entry',
      },
      {
        label: 'symbolic link',
        archive: rawZip({
          externalAttributes: (0o120777 << 16) >>> 0,
        }),
        reason: 'unsafe-entry',
      },
      {
        label: 'compression ratio',
        archive: rawZip({
          data: Buffer.alloc(64 * 1024),
          method: 8,
        }),
        reason: 'too-large',
      },
      {
        label: 'local filename mismatch',
        archive: rawZip({ name: 'safe.txt', localName: 'evil.txt' }),
        reason: 'invalid-archive',
      },
    ]
    for (const value of cases) {
      await withArchive(value.archive, async ({ sender, downloadId }) => {
        const result = await inspectActionsArtifactSubjects(sender, {
          operationId: operationId('e'),
          downloadId,
        })
        assert.deepEqual(
          result,
          { ok: false, reason: value.reason },
          value.label
        )
      })
    }
  })

  it('checks CRC while preparing the selected subject', async () => {
    const data = Buffer.from('subject with a forged CRC')
    await withArchive(
      rawZip({ data, crc: (crc32.unsigned(data) ^ 0xffffffff) >>> 0 }),
      async ({ sender, downloadId }) => {
        const inventory = await inspectActionsArtifactSubjects(sender, {
          operationId: operationId('f'),
          downloadId,
        })
        assert.equal(inventory.ok, true)
        if (!inventory.ok) {
          return
        }
        const prepared = await prepareActionsArtifactSubject(sender, {
          operationId: operationId('1'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
        })
        assert.deepEqual(prepared, { ok: false, reason: 'invalid-archive' })
      }
    )
  })

  it('binds selections to sender and exact retained archive bytes', async () => {
    const archive = rawZip()
    await withArchive(archive, async ({ sender, other, downloadId, path }) => {
      assert.deepEqual(
        await inspectActionsArtifactSubjects(other, {
          operationId: operationId('2'),
          downloadId,
        }),
        { ok: false, reason: 'not-found' }
      )
      const inventory = await inspectActionsArtifactSubjects(sender, {
        operationId: operationId('3'),
        downloadId,
      })
      assert.equal(inventory.ok, true)
      if (!inventory.ok) {
        return
      }
      assert.deepEqual(
        await prepareActionsArtifactSubject(other, {
          operationId: operationId('4'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
        }),
        { ok: false, reason: 'not-found' }
      )
      await writeFile(path, Buffer.concat([archive, Buffer.from([0])]))
      assert.deepEqual(
        await prepareActionsArtifactSubject(sender, {
          operationId: operationId('5'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
        }),
        { ok: false, reason: 'changed' }
      )
    })
  })

  it('cancels an active operation and invalidates inventory on release', async () => {
    await withArchive(rawZip(), async ({ sender, downloadId }) => {
      const pending = inspectActionsArtifactSubjects(sender, {
        operationId: operationId('6'),
        downloadId,
      })
      assert.equal(
        cancelActionsArtifactSubjectOperation(sender.id, operationId('6')),
        true
      )
      assert.deepEqual(await pending, { ok: false, reason: 'canceled' })

      const inventory = await inspectActionsArtifactSubjects(sender, {
        operationId: operationId('7'),
        downloadId,
      })
      assert.equal(inventory.ok, true)
      if (!inventory.ok) {
        return
      }
      assert.equal(
        releaseCompletedActionsArtifactDownload(sender.id, downloadId),
        true
      )
      assert.deepEqual(
        await prepareActionsArtifactSubject(sender, {
          operationId: operationId('8'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
        }),
        { ok: false, reason: 'not-found' }
      )
    })
  })

  it('leases a closed revalidated subject path only during the awaited callback', async () => {
    const data = Buffer.from('callback-scoped trusted subject')
    await withArchive(rawZip({ data }), async ({ sender, downloadId }) => {
      const inventory = await inspectActionsArtifactSubjects(sender, {
        operationId: operationId('9'),
        downloadId,
      })
      assert.equal(inventory.ok, true)
      if (!inventory.ok) {
        return
      }
      const digest = `sha256:${createHash('sha256').update(data).digest('hex')}`
      let leasedPath = ''
      const value = await withRevalidatedActionsArtifactSubject(
        sender,
        {
          operationId: operationId('a'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
          expectedDigest: digest,
        },
        async (subject, signal) => {
          leasedPath = subject.filePath
          assert.equal(signal.aborted, false)
          assert.deepEqual(await readFile(subject.filePath), data)
          assert.equal(subject.digest, digest)
          return 'used'
        }
      )
      assert.equal(value, 'used')
      await assert.rejects(readFile(leasedPath), { code: 'ENOENT' })

      let called = false
      await assert.rejects(
        withRevalidatedActionsArtifactSubject(
          sender,
          {
            operationId: operationId('b'),
            downloadId,
            inventoryId: inventory.inventoryId,
            entryId: inventory.entries[0].entryId,
            expectedDigest: `sha256:${'0'.repeat(64)}`,
          },
          async () => {
            called = true
          }
        ),
        (error: unknown) =>
          error instanceof Error &&
          (error as { reason?: string }).reason === 'changed'
      )
      assert.equal(called, false)
    })
  })

  it('binds duplicate and cross-sender cancellation and aborts on download release', async () => {
    await withArchive(rawZip(), async ({ sender, other, downloadId }) => {
      const inventory = await inspectActionsArtifactSubjects(sender, {
        operationId: operationId('c'),
        downloadId,
      })
      assert.equal(inventory.ok, true)
      if (!inventory.ok) {
        return
      }
      const digest = `sha256:${createHash('sha256')
        .update('trusted artifact subject')
        .digest('hex')}`
      let entered!: () => void
      const callbackEntered = new Promise<void>(resolve => {
        entered = resolve
      })
      let leasedPath = ''
      const pending = withRevalidatedActionsArtifactSubject(
        sender,
        {
          operationId: operationId('d'),
          downloadId,
          inventoryId: inventory.inventoryId,
          entryId: inventory.entries[0].entryId,
          expectedDigest: digest,
        },
        async (subject, signal) => {
          leasedPath = subject.filePath
          entered()
          await new Promise<void>(resolveAbort =>
            signal.addEventListener('abort', () => resolveAbort(), {
              once: true,
            })
          )
        }
      )
      await callbackEntered
      assert.equal(
        cancelActionsArtifactSubjectOperation(other.id, operationId('d')),
        false
      )
      await assert.rejects(
        withRevalidatedActionsArtifactSubject(
          sender,
          {
            operationId: operationId('d'),
            downloadId,
            inventoryId: inventory.inventoryId,
            entryId: inventory.entries[0].entryId,
            expectedDigest: digest,
          },
          async () => undefined
        ),
        (error: unknown) =>
          error instanceof Error &&
          (error as { reason?: string }).reason === 'invalid-request'
      )
      assert.equal(
        releaseCompletedActionsArtifactDownload(sender.id, downloadId),
        true
      )
      await assert.rejects(pending, { name: 'AbortError' })
      await assert.rejects(readFile(leasedPath), { code: 'ENOENT' })
    })
  })
})
