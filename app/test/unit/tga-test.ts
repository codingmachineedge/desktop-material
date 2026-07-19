import assert from 'node:assert'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { describe, it } from 'node:test'
import { inflateSync } from 'zlib'
import { exec } from 'dugite'

import { getWorkingDirectoryDiff } from '../../src/lib/git'
import {
  convertTGAToPNG,
  MaxTGAFileBytes,
  MaxTGADimension,
  TGAConversionError,
} from '../../src/lib/tga'
import {
  DiffSelection,
  DiffSelectionType,
  DiffType,
  IImageDiff,
} from '../../src/models/diff'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../src/models/status'
import { setupEmptyRepository } from '../helpers/repositories'

function tgaHeader(
  imageType: number,
  width: number,
  height: number,
  pixelDepth: number,
  descriptor: number
): Buffer {
  const header = Buffer.alloc(18)
  header[2] = imageType
  header.writeUInt16LE(width, 12)
  header.writeUInt16LE(height, 14)
  header[16] = pixelDepth
  header[17] = descriptor
  return header
}

function pngPixels(png: Buffer): {
  readonly width: number
  readonly height: number
  readonly pixels: ReadonlyArray<number>
} {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const compressed = new Array<Buffer>()
  let offset = 8
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') {
      compressed.push(png.subarray(offset + 8, offset + 8 + length))
    }
    offset += length + 12
  }

  const scanlines = inflateSync(Buffer.concat(compressed))
  const pixels = new Array<number>()
  const stride = width * 4 + 1
  for (let row = 0; row < height; row++) {
    assert.equal(scanlines[row * stride], 0)
    pixels.push(...scanlines.subarray(row * stride + 1, (row + 1) * stride))
  }
  return { width, height, pixels }
}

function expectFailure(input: Buffer, reason: TGAConversionError['reason']) {
  assert.throws(
    () => convertTGAToPNG(input),
    error => error instanceof TGAConversionError && error.reason === reason
  )
}

describe('TGA preview conversion', () => {
  it('decodes uncompressed true-color pixels with bottom-right orientation', () => {
    const input = Buffer.concat([
      tgaHeader(2, 2, 2, 24, 0x10),
      Buffer.from([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
    ])
    const result = pngPixels(convertTGAToPNG(input))

    assert.equal(result.width, 2)
    assert.equal(result.height, 2)
    assert.deepEqual(
      result.pixels,
      [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]
    )
  })

  it('decodes RLE true-color packets', () => {
    const input = Buffer.concat([
      tgaHeader(10, 3, 1, 24, 0x20),
      Buffer.from([0x81, 0, 0, 255, 0, 0, 255, 0]),
    ])

    assert.deepEqual(
      pngPixels(convertTGAToPNG(input)).pixels,
      [255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]
    )
  })

  it('decodes uncompressed grayscale pixels', () => {
    const input = Buffer.concat([
      tgaHeader(3, 2, 1, 8, 0x20),
      Buffer.from([17, 200]),
    ])

    assert.deepEqual(
      pngPixels(convertTGAToPNG(input)).pixels,
      [17, 17, 17, 255, 200, 200, 200, 255]
    )
  })

  it('rejects truncated, unsupported, and oversized inputs', () => {
    expectFailure(tgaHeader(2, 1, 1, 24, 0x20), 'invalid')
    expectFailure(tgaHeader(1, 1, 1, 8, 0x20), 'unsupported')
    expectFailure(Buffer.alloc(MaxTGAFileBytes + 1), 'oversized')
    expectFailure(tgaHeader(2, MaxTGADimension + 1, 1, 24, 0x20), 'oversized')
  })

  it('converts valid TGA git diffs to browser-renderable PNG data', async t => {
    const repository = await setupEmptyRepository(t)
    const input = Buffer.concat([
      tgaHeader(2, 1, 1, 24, 0x20),
      Buffer.from([0, 0, 255]),
    ])
    await writeFile(join(repository.path, 'pixel.tga'), input)
    const file = new WorkingDirectoryFileChange(
      'pixel.tga',
      { kind: AppFileStatusKind.Untracked },
      DiffSelection.fromInitialSelection(DiffSelectionType.All)
    )

    const diff = await getWorkingDirectoryDiff(repository, file)
    assert.equal(diff.kind, DiffType.Image)
    const image = (diff as IImageDiff).current
    assert.equal(image?.mediaType, 'image/png')
    assert.ok(image?.contents.startsWith('iVBORw0KGgo'))
    assert.equal(image?.bytes, input.length)

    await exec(['add', 'pixel.tga'], repository.path)
    await exec(['commit', '-m', 'Add TGA pixel'], repository.path)
    const modifiedInput = Buffer.concat([
      tgaHeader(2, 1, 1, 24, 0x20),
      Buffer.from([255, 0, 0]),
    ])
    await writeFile(join(repository.path, 'pixel.tga'), modifiedInput)
    const modifiedFile = new WorkingDirectoryFileChange(
      'pixel.tga',
      { kind: AppFileStatusKind.Modified },
      DiffSelection.fromInitialSelection(DiffSelectionType.All)
    )
    const modifiedDiff = await getWorkingDirectoryDiff(repository, modifiedFile)
    assert.equal(modifiedDiff.kind, DiffType.Image)
    assert.ok((modifiedDiff as IImageDiff).previous)
    assert.ok((modifiedDiff as IImageDiff).current)
  })

  it('falls invalid and oversized TGA git diffs back to binary', async t => {
    const repository = await setupEmptyRepository(t)
    const cases = [
      ['invalid.tga', Buffer.alloc(18)],
      ['oversized.tga', tgaHeader(2, MaxTGADimension + 1, 1, 24, 0x20)],
    ] as const

    for (const [path, contents] of cases) {
      await writeFile(join(repository.path, path), contents)
      const file = new WorkingDirectoryFileChange(
        path,
        { kind: AppFileStatusKind.Untracked },
        DiffSelection.fromInitialSelection(DiffSelectionType.All)
      )
      const diff = await getWorkingDirectoryDiff(repository, file)
      assert.equal(diff.kind, DiffType.Binary)
    }
  })
})
