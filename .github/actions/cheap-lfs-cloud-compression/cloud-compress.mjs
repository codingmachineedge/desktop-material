import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDeflateRaw } from 'node:zlib'

const POINTER_VERSION = 'desktop-material/cheap-lfs/v1'
const MAX_POINTER_BYTES = 512 * 1024
const MAX_ASSET_NAME_BYTES = 255
const MAX_PART_BYTES = 2 * 1024 * 1024 * 1024
const API_VERSION = '2022-11-28'
const workspace = process.env.GITHUB_WORKSPACE
const repository = process.env.GITHUB_REPOSITORY
const token = process.env.CHEAP_LFS_GITHUB_TOKEN
const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'
const refName = process.env.GITHUB_REF_NAME

if (!workspace || !repository || !token || !refName) {
  throw new Error(
    'Cheap LFS cloud compression is missing its GitHub Actions context.'
  )
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error(
    'Cheap LFS cloud compression received an invalid repository name.'
  )
}

function git(args, options = {}) {
  const output = execFileSync('git', ['-C', workspace, ...args], {
    encoding: 'utf8',
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : undefined,
  })
  return options.raw ? output : output.trim()
}

function parsePointer(text) {
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text, 'utf8') > MAX_POINTER_BYTES ||
    text.includes('\0')
  ) {
    return null
  }
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
  const heads = new Map()
  const parts = []
  for (const line of lines) {
    if (line.startsWith('part-deflate ')) {
      const match =
        /^part-deflate ([a-f0-9]{64}) (0|[1-9][0-9]*) (0|[1-9][0-9]*) (.+)$/.exec(
          line
        )
      if (!match) return null
      parts.push({
        sha256: match[1],
        size: Number(match[2]),
        storedSize: Number(match[3]),
        name: match[4],
      })
      continue
    }
    if (line.startsWith('part ')) {
      const match = /^part ([a-f0-9]{64}) (0|[1-9][0-9]*) (.+)$/.exec(line)
      if (!match) return null
      parts.push({ sha256: match[1], size: Number(match[2]), name: match[3] })
      continue
    }
    const separator = line.indexOf(' ')
    if (separator <= 0) return null
    const key = line.slice(0, separator)
    if (heads.has(key)) return null
    heads.set(key, line.slice(separator + 1))
  }
  if (heads.size !== 5 || heads.get('version') !== POINTER_VERSION) return null
  const releaseTag = heads.get('release-tag')
  const assetName = heads.get('asset-name')
  const size = Number(heads.get('size'))
  const sha256 = heads.get('sha256')
  if (
    !releaseTag ||
    /\s/.test(releaseTag) ||
    !assetName ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !/^[a-f0-9]{64}$/.test(sha256 || '')
  ) {
    return null
  }
  if (parts.length === 0) {
    return { releaseTag, assetName, size, sha256, parts: null }
  }
  let total = 0
  for (const part of parts) {
    if (
      !Number.isSafeInteger(part.size) ||
      part.size < 0 ||
      part.size > MAX_PART_BYTES ||
      !part.name ||
      Buffer.byteLength(part.name, 'utf8') > MAX_ASSET_NAME_BYTES ||
      (part.storedSize !== undefined &&
        (!Number.isSafeInteger(part.storedSize) ||
          part.storedSize < 1 ||
          part.storedSize >= part.size ||
          part.storedSize > MAX_PART_BYTES))
    ) {
      return null
    }
    total += part.size
  }
  return total === size ? { releaseTag, assetName, size, sha256, parts } : null
}

function serializePointer(pointer) {
  const lines = [
    'version ' + POINTER_VERSION,
    'release-tag ' + pointer.releaseTag,
    'asset-name ' + pointer.assetName,
    'size ' + pointer.size,
    'sha256 ' + pointer.sha256,
  ]
  if (pointer.parts) {
    for (const part of pointer.parts) {
      lines.push(
        part.storedSize === undefined
          ? 'part ' + part.sha256 + ' ' + part.size + ' ' + part.name
          : 'part-deflate ' +
              part.sha256 +
              ' ' +
              part.size +
              ' ' +
              part.storedSize +
              ' ' +
              part.name
      )
    }
  }
  return lines.join('\n') + '\n'
}

function trackedFiles() {
  return git(['ls-files', '-z'], { quiet: true, raw: true })
    .split('\0')
    .filter(Boolean)
}

async function readPointer(path) {
  const absolutePath = join(workspace, path)
  const file = await stat(absolutePath).catch(() => null)
  if (!file?.isFile() || file.size > MAX_POINTER_BYTES) return null
  const text = await readFile(absolutePath, 'utf8').catch(() => null)
  if (
    text === null ||
    !text.replace(/^\uFEFF/, '').startsWith('version ' + POINTER_VERSION)
  ) {
    return null
  }
  const pointer = parsePointer(text)
  return pointer === null ? null : { path, absolutePath, text, pointer }
}

function rawObjects(entry) {
  if (entry.pointer.parts === null) {
    return [
      {
        key:
          entry.path +
          '\0' +
          entry.pointer.releaseTag +
          '\0' +
          entry.pointer.assetName,
        partIndex: null,
        name: entry.pointer.assetName,
        size: entry.pointer.size,
        sha256: entry.pointer.sha256,
      },
    ]
  }
  return entry.pointer.parts.flatMap((part, partIndex) =>
    part.storedSize === undefined
      ? [
          {
            key:
              entry.path + '\0' + entry.pointer.releaseTag + '\0' + part.name,
            partIndex,
            name: part.name,
            size: part.size,
            sha256: part.sha256,
          },
        ]
      : []
  )
}

async function api(path, options = {}) {
  const { allowNotFound = false, ...fetchOptions } = options
  const response = await fetch(apiUrl + path, {
    ...fetchOptions,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'desktop-material-cheap-lfs-cloud-compression',
      ...fetchOptions.headers,
    },
  })
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    const message = (await response.text()).slice(0, 500)
    throw new Error('GitHub API ' + response.status + ': ' + message)
  }
  return response
}

async function releaseForTag(tag) {
  const response = await api(
    '/repos/' + repository + '/releases/tags/' + encodeURIComponent(tag),
    { allowNotFound: true }
  )
  if (response.ok) return await response.json()

  // GitHub's exact tag endpoint intentionally hides draft releases. Cheap LFS
  // can point at drafts, so use the same bounded authenticated inventory
  // fallback as the desktop app before declaring the object unavailable.
  for (let page = 1; page <= 100; page++) {
    const inventoryResponse = await api(
      '/repos/' + repository + '/releases?per_page=100&page=' + page
    )
    const releases = await inventoryResponse.json()
    const release = releases.find(candidate => candidate.tag_name === tag)
    if (release !== undefined) return release
    if (releases.length < 100) {
      throw new Error('GitHub release tag was not found: ' + tag)
    }
  }
  throw new Error('Repository has too many releases to inspect safely.')
}

async function allAssets(releaseId) {
  const assets = []
  for (let page = 1; page <= 100; page++) {
    const response = await api(
      '/repos/' +
        repository +
        '/releases/' +
        releaseId +
        '/assets?per_page=100&page=' +
        page
    )
    const next = await response.json()
    assets.push(...next)
    if (next.length < 100) return assets
  }
  throw new Error('Release has too many assets to inspect safely.')
}

async function downloadAsset(assetId, destination) {
  const response = await api(
    '/repos/' + repository + '/releases/assets/' + assetId,
    { headers: { Accept: 'application/octet-stream' } }
  )
  if (!response.body)
    throw new Error('GitHub returned an empty release asset response.')
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination, { flags: 'wx' })
  )
}

async function hashFile(path) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
    bytes += chunk.length
  }
  return { sha256: hash.digest('hex'), bytes }
}

async function compressFile(source, destination) {
  await pipeline(
    createReadStream(source),
    createDeflateRaw({ level: 9 }),
    createWriteStream(destination, { flags: 'wx' })
  )
  return await hashFile(destination)
}

function truncateUtf8(value, maximumBytes) {
  let result = value
  while (Buffer.byteLength(result, 'utf8') > maximumBytes) {
    result = result.slice(0, -1)
  }
  return result
}

function candidateBaseName(rawName, logicalSha) {
  const suffix = '.cheap-lfs-' + logicalSha.slice(0, 12) + '.deflate'
  const available = MAX_ASSET_NAME_BYTES - Buffer.byteLength(suffix, 'utf8')
  return truncateUtf8(basename(rawName), available) + suffix
}

async function assetMatches(asset, size, sha256, tempRoot) {
  if (asset.state !== 'uploaded' || asset.size !== size) return false
  if (typeof asset.digest === 'string')
    return asset.digest === 'sha256:' + sha256
  const verificationPath = join(tempRoot, 'verify-' + asset.id)
  await downloadAsset(asset.id, verificationPath)
  const verified = await hashFile(verificationPath)
  await rm(verificationPath, { force: true })
  return verified.bytes === size && verified.sha256 === sha256
}

async function chooseCandidateName(
  assets,
  rawName,
  logicalSha,
  stored,
  tempRoot
) {
  const base = candidateBaseName(rawName, logicalSha)
  for (let attempt = 0; attempt < 1000; attempt++) {
    const suffix = attempt === 0 ? '' : '-' + (attempt + 1)
    const maximumBase = MAX_ASSET_NAME_BYTES - Buffer.byteLength(suffix, 'utf8')
    const name = truncateUtf8(base, maximumBase) + suffix
    const existing = assets.find(asset => asset.name === name)
    if (!existing) return { name, existing: null }
    if (await assetMatches(existing, stored.bytes, stored.sha256, tempRoot)) {
      return { name, existing }
    }
  }
  throw new Error('Could not allocate a unique compressed release asset name.')
}

async function uploadAsset(release, path, name, stored) {
  const uploadBase = release.upload_url.replace(/\{.*$/, '')
  const body = createReadStream(path)
  const response = await fetch(
    uploadBase + '?name=' + encodeURIComponent(name),
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stored.bytes),
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'desktop-material-cheap-lfs-cloud-compression',
      },
      body,
      duplex: 'half',
    }
  )
  if (!response.ok) {
    throw new Error(
      'Compressed release upload failed with HTTP ' + response.status + '.'
    )
  }
  return await response.json()
}

async function deleteAttemptAsset(assetId) {
  await api('/repos/' + repository + '/releases/assets/' + assetId, {
    method: 'DELETE',
  }).catch(error => {
    console.warn(
      'Could not remove unadopted compressed attempt asset ' +
        assetId +
        ': ' +
        error.message
    )
  })
}

async function adoptPointer(
  entry,
  object,
  candidateName,
  storedSize,
  onPushAttempt
) {
  const currentText = await readFile(entry.absolutePath, 'utf8')
  if (currentText !== entry.text) {
    throw new Error(
      'Pointer changed while its release object was being compressed.'
    )
  }
  const compressedPart = {
    name: candidateName,
    size: object.size,
    sha256: object.sha256,
    storedSize,
  }
  const next = {
    ...entry.pointer,
    assetName:
      object.partIndex === null ? candidateName : entry.pointer.assetName,
    parts:
      object.partIndex === null
        ? [compressedPart]
        : entry.pointer.parts.map((part, index) =>
            index === object.partIndex ? compressedPart : part
          ),
  }
  const nextText = serializePointer(next)
  const temporary = entry.absolutePath + '.cheap-lfs-cloud-' + process.pid
  await writeFile(temporary, nextText, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, entry.absolutePath)

  try {
    git(['add', '--', entry.path])
    const staged = git(['diff', '--cached', '--name-only', '-z'], {
      quiet: true,
      raw: true,
    })
      .split('\0')
      .filter(Boolean)
    if (staged.length !== 1 || staged[0] !== entry.path) {
      throw new Error('Pointer adoption staged an unexpected path.')
    }
    git([
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit',
      '-m',
      'Compress Cheap LFS release object [skip ci]',
      '--',
      entry.path,
    ])
    try {
      // A push can update the remote and still fail locally when the response is
      // lost. From this point onward the side asset must be retained so a
      // remotely adopted pointer can always be materialized.
      onPushAttempt()
      git(['push', 'origin', 'HEAD:' + refName])
    } catch (error) {
      git(['reset', '--hard', 'HEAD^'])
      throw error
    }
  } catch (error) {
    if (git(['status', '--porcelain'], { quiet: true }).length > 0) {
      git(['reset', '--hard', 'HEAD'])
    }
    throw error
  }
}

async function compressObject(entry, object) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-'))
  let uploadedAttemptId = null
  try {
    const release = await releaseForTag(entry.pointer.releaseTag)
    const assets = await allAssets(release.id)
    const rawAsset = assets.find(asset => asset.name === object.name)
    if (!rawAsset || rawAsset.state !== 'uploaded') {
      throw new Error(
        'Raw release asset is missing or not uploaded: ' + object.name
      )
    }
    if (rawAsset.size !== object.size) {
      throw new Error(
        'Raw release asset size does not match its pointer: ' + object.name
      )
    }
    if (
      typeof rawAsset.digest === 'string' &&
      rawAsset.digest !== 'sha256:' + object.sha256
    ) {
      throw new Error(
        'Raw release asset digest does not match its pointer: ' + object.name
      )
    }

    const rawPath = join(tempRoot, 'raw-object')
    const compressedPath = join(tempRoot, 'compressed-object')
    await downloadAsset(rawAsset.id, rawPath)
    const raw = await hashFile(rawPath)
    if (raw.bytes !== object.size || raw.sha256 !== object.sha256) {
      throw new Error(
        'Downloaded raw object does not match its pointer: ' + object.name
      )
    }

    const stored = await compressFile(rawPath, compressedPath)
    await rm(rawPath, { force: true })
    if (stored.bytes >= object.size) {
      return { kind: 'not-beneficial', storedBytes: stored.bytes }
    }

    const candidate = await chooseCandidateName(
      assets,
      object.name,
      object.sha256,
      stored,
      tempRoot
    )
    let uploaded = candidate.existing
    if (!uploaded) {
      uploaded = await uploadAsset(
        release,
        compressedPath,
        candidate.name,
        stored
      )
      uploadedAttemptId = uploaded.id
      if (
        !(await assetMatches(uploaded, stored.bytes, stored.sha256, tempRoot))
      ) {
        await deleteAttemptAsset(uploaded.id)
        uploadedAttemptId = null
        throw new Error(
          'GitHub did not preserve the compressed release asset exactly.'
        )
      }
    }

    await adoptPointer(entry, object, candidate.name, stored.bytes, () => {
      uploadedAttemptId = null
    })
    uploadedAttemptId = null
    return {
      kind: 'compressed',
      storedBytes: stored.bytes,
      name: candidate.name,
    }
  } catch (error) {
    if (uploadedAttemptId !== null) await deleteAttemptAsset(uploadedAttemptId)
    throw error
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function nextRawObject(attempted) {
  for (const path of trackedFiles()) {
    const entry = await readPointer(path)
    if (!entry) continue
    for (const object of rawObjects(entry)) {
      if (!attempted.has(object.key)) return { entry, object }
    }
  }
  return null
}

async function summaryLine(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, text + '\n', 'utf8')
  }
}

async function main() {
  git(['diff', '--quiet'])
  git(['diff', '--cached', '--quiet'])
  const attempted = new Set()
  let compressed = 0
  let skipped = 0
  let failed = 0
  await summaryLine('## Cheap LFS cloud compression')

  while (true) {
    const candidate = await nextRawObject(attempted)
    if (!candidate) break
    const { entry, object } = candidate
    attempted.add(object.key)
    console.log(
      'Compressing ' + entry.path + ' object ' + object.name + ' one at a time…'
    )
    try {
      const result = await compressObject(entry, object)
      if (result.kind === 'compressed') {
        compressed++
        const percent = ((1 - result.storedBytes / object.size) * 100).toFixed(
          1
        )
        await summaryLine(
          '- Compressed `' +
            entry.path +
            '` / `' +
            object.name +
            '` by ' +
            percent +
            '%.'
        )
      } else {
        skipped++
        await summaryLine(
          '- Kept `' +
            entry.path +
            '` / `' +
            object.name +
            '` raw because compression was not smaller.'
        )
      }
    } catch (error) {
      failed++
      console.error(
        '::error title=Cheap LFS object stayed raw::' + error.message
      )
      await summaryLine(
        '- Failed safely for `' +
          entry.path +
          '` / `' +
          object.name +
          '`: ' +
          String(error.message).replace(/[\r\n]+/g, ' ')
      )
    }
  }

  await summaryLine('')
  await summaryLine(
    '**Result:** ' +
      compressed +
      ' compressed, ' +
      skipped +
      ' kept raw, ' +
      failed +
      ' failed safely.'
  )
  console.log(
    'Cheap LFS cloud compression: ' +
      compressed +
      ' compressed, ' +
      skipped +
      ' kept raw, ' +
      failed +
      ' failed safely.'
  )
  if (failed > 0) process.exitCode = 1
}

await main()
