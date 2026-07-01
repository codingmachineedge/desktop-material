import { createHash } from 'crypto'
import { getFileHash } from './get-file-hash'
import * as path from 'path'

/**
 * The bundle files whose integrity we verify. Any modification to these files
 * could cause crashes or error reports, so we include all of them in the
 * combined hash. In practice, renderer.js and main.js are by far the most
 * likely targets for user modification (e.g., translating UI strings).
 *
 * Not included: native modules (.node files), node_modules dependencies, and
 * static assets (images, fonts) -- these are rarely modified by users and
 * changes to them are unlikely to produce JavaScript error reports.
 */
const bundleFiles = [
  'main.js',
  'renderer.js',
  'crash.js',
  'highlighter.js',
  'cli.js',
  'index.html',
  'crash.html',
]

/**
 * Compute a combined SHA-256 hash representing the integrity of all shipped
 * bundle files in the given directory.
 *
 * The combined hash is a Merkle-style construction: individual file hashes are
 * computed, concatenated in a fixed order, and then hashed again. This produces
 * a single deterministic value that changes if any bundle is modified.
 */
export async function computeBundleHash(bundleDir: string): Promise<string> {
  const hashes = await Promise.all(
    bundleFiles.map(f => getFileHash(path.join(bundleDir, f), 'sha256'))
  )
  return createHash('sha256').update(hashes.join('')).digest('hex')
}

