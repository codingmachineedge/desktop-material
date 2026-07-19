import crc32 from 'buffer-crc32'
import { deflateSync } from 'zlib'

/** Maximum source bytes accepted by the in-app TGA previewer. */
export const MaxTGAFileBytes = 24 * 1024 * 1024

/** Maximum width or height accepted by the in-app TGA previewer. */
export const MaxTGADimension = 4096

/** Maximum decoded pixels accepted by the in-app TGA previewer. */
export const MaxTGAPixels = 4 * 1024 * 1024

export type TGAConversionFailure = 'invalid' | 'oversized' | 'unsupported'

/** A safe, user-content parsing failure which should fall back to binary UI. */
export class TGAConversionError extends Error {
  public constructor(public readonly reason: TGAConversionFailure) {
    super(`TGA preview is ${reason}`)
    this.name = 'TGAConversionError'
  }
}

function fail(reason: TGAConversionFailure): never {
  throw new TGAConversionError(reason)
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.allocUnsafe(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(
    crc32.unsigned(Buffer.concat([typeBuffer, data])),
    8 + data.length
  )
  return chunk
}

function encodePNG(width: number, height: number, scanlines: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Decode the bounded subset of TGA used by the previewer and return a PNG.
 *
 * Supported inputs are uncompressed true-color (type 2), uncompressed
 * grayscale (type 3), and RLE true-color (type 10), including all four origin
 * orientations. Color-mapped and interleaved images deliberately fall back to
 * the binary-file experience.
 */
export function convertTGAToPNG(input: Uint8Array): Buffer {
  if (input.byteLength > MaxTGAFileBytes) {
    fail('oversized')
  }

  const contents = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (contents.length < 18) {
    fail('invalid')
  }

  const idLength = contents[0]
  const colorMapType = contents[1]
  const imageType = contents[2]
  const width = contents.readUInt16LE(12)
  const height = contents.readUInt16LE(14)
  const pixelDepth = contents[16]
  const descriptor = contents[17]

  if (colorMapType !== 0 || (descriptor & 0xc0) !== 0) {
    fail('unsupported')
  }
  if (width === 0 || height === 0) {
    fail('invalid')
  }
  if (
    width > MaxTGADimension ||
    height > MaxTGADimension ||
    width * height > MaxTGAPixels
  ) {
    fail('oversized')
  }

  const trueColor = imageType === 2 || imageType === 10
  const grayscale = imageType === 3
  if (!trueColor && !grayscale) {
    fail('unsupported')
  }
  if (
    (trueColor && pixelDepth !== 24 && pixelDepth !== 32) ||
    (grayscale && pixelDepth !== 8)
  ) {
    fail('unsupported')
  }

  let sourceOffset = 18 + idLength
  if (sourceOffset > contents.length) {
    fail('invalid')
  }

  const pixelCount = width * height
  const scanlineStride = width * 4 + 1
  const scanlines = Buffer.alloc(scanlineStride * height)
  const topToBottom = (descriptor & 0x20) !== 0
  const rightToLeft = (descriptor & 0x10) !== 0

  const writePixel = (
    fileIndex: number,
    red: number,
    green: number,
    blue: number,
    alpha: number
  ) => {
    const fileX = fileIndex % width
    const fileY = Math.floor(fileIndex / width)
    const x = rightToLeft ? width - fileX - 1 : fileX
    const y = topToBottom ? fileY : height - fileY - 1
    const target = y * scanlineStride + 1 + x * 4
    scanlines[target] = red
    scanlines[target + 1] = green
    scanlines[target + 2] = blue
    scanlines[target + 3] = alpha
  }

  if (grayscale) {
    if (sourceOffset + pixelCount > contents.length) {
      fail('invalid')
    }
    for (let fileIndex = 0; fileIndex < pixelCount; fileIndex++) {
      const value = contents[sourceOffset++]
      writePixel(fileIndex, value, value, value, 255)
    }
    return encodePNG(width, height, scanlines)
  }

  const bytesPerPixel = pixelDepth / 8
  const readColor = (): readonly [number, number, number, number] => {
    if (sourceOffset + bytesPerPixel > contents.length) {
      fail('invalid')
    }
    const blue = contents[sourceOffset]
    const green = contents[sourceOffset + 1]
    const red = contents[sourceOffset + 2]
    const alpha = bytesPerPixel === 4 ? contents[sourceOffset + 3] : 255
    sourceOffset += bytesPerPixel
    return [red, green, blue, alpha]
  }

  if (imageType === 2) {
    for (let fileIndex = 0; fileIndex < pixelCount; fileIndex++) {
      writePixel(fileIndex, ...readColor())
    }
    return encodePNG(width, height, scanlines)
  }

  let fileIndex = 0
  while (fileIndex < pixelCount) {
    if (sourceOffset >= contents.length) {
      fail('invalid')
    }
    const packet = contents[sourceOffset++]
    const packetLength = (packet & 0x7f) + 1
    if (fileIndex + packetLength > pixelCount) {
      fail('invalid')
    }

    if ((packet & 0x80) !== 0) {
      const color = readColor()
      for (let index = 0; index < packetLength; index++) {
        writePixel(fileIndex++, ...color)
      }
    } else {
      for (let index = 0; index < packetLength; index++) {
        writePixel(fileIndex++, ...readColor())
      }
    }
  }

  return encodePNG(width, height, scanlines)
}
