import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDeflateRaw } from 'node:zlib'

const POINTER_VERSION = 'desktop-material/cheap-lfs/v1'
const MAX_POINTER_BYTES = 512 * 1024
const POINTER_BLOB_FILTER_BYTES = MAX_POINTER_BYTES + 1
const MAX_ASSET_NAME_BYTES = 255
const MAX_PART_BYTES = 2 * 1024 * 1024 * 1024
const MAX_GIT_METADATA_BYTES = 64 * 1024 * 1024
const API_VERSION = '2022-11-28'
const workspace = process.env.GITHUB_WORKSPACE
const repository = process.env.GITHUB_REPOSITORY
const token = process.env.CHEAP_LFS_GITHUB_TOKEN
const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'
const refName = process.env.GITHUB_REF_NAME
const eventCommit = process.env.GITHUB_SHA

if (!workspace || !repository || !token || !refName || !eventCommit) {
  throw new Error(
    'Cheap LFS cloud compression is missing its GitHub Actions context.'
  )
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error(
    'Cheap LFS cloud compression received an invalid repository name.'
  )
}
if (!/^[a-f0-9]{40,64}$/.test(eventCommit)) {
  throw new Error('Cheap LFS cloud compression received an invalid commit.')
}

function git(args, options = {}) {
  const output = execFileSync('git', ['-C', workspace, ...args], {
    encoding: options.buffer ? null : 'utf8',
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: '1',
      ...options.env,
    },
    input: options.input,
    maxBuffer: options.maxBuffer || MAX_GIT_METADATA_BYTES,
    stdio: options.quiet ? ['pipe', 'pipe', 'pipe'] : undefined,
  })
  return options.raw || options.buffer ? output : output.trim()
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
      part.size >= MAX_PART_BYTES ||
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

function parseTreeEntries(output, commit) {
  const entries = []
  const seenPaths = new Set()
  let offset = 0
  while (offset < output.length) {
    const end = output.indexOf(0, offset)
    if (end < 0) throw new Error('Git returned an unterminated tree entry.')
    const record = output.subarray(offset, end)
    offset = end + 1
    const separator = record.indexOf(9)
    if (separator < 0) throw new Error('Git returned an invalid tree entry.')
    const header = record.subarray(0, separator).toString('ascii')
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})$/.exec(header)
    if (!match) continue
    const pathBytes = record.subarray(separator + 1)
    const path = pathBytes.toString('utf8')
    if (
      path.length === 0 ||
      path.includes('\0') ||
      !Buffer.from(path, 'utf8').equals(pathBytes) ||
      seenPaths.has(path)
    ) {
      throw new Error('Git returned an unsafe or duplicate tree path.')
    }
    seenPaths.add(path)
    entries.push({ commit, mode: match[1], oid: match[2], path })
  }
  return entries
}

function treeEntriesAt(commit) {
  const output = git(['ls-tree', '-r', '-z', '--full-tree', commit], {
    buffer: true,
    quiet: true,
  })
  return parseTreeEntries(output, commit)
}

function localPointerBlobCandidates(entries) {
  const objectIds = [...new Set(entries.map(entry => entry.oid))]
  if (objectIds.length === 0) return []
  const output = git(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    {
      input: objectIds.join('\n') + '\n',
      quiet: true,
      raw: true,
    }
  )
  const lines = output.trimEnd().split('\n')
  if (lines.length !== objectIds.length) {
    throw new Error('Git returned an incomplete object inventory.')
  }
  const local = []
  for (let index = 0; index < objectIds.length; index++) {
    const objectId = objectIds[index]
    const line = lines[index]
    if (line === objectId + ' missing') continue
    const match = /^([a-f0-9]{40,64}) blob (0|[1-9][0-9]*)$/.exec(line)
    if (!match || match[1] !== objectId) {
      throw new Error('Git returned an invalid object inventory entry.')
    }
    const size = Number(match[2])
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Git returned an invalid blob size.')
    }
    if (size <= MAX_POINTER_BYTES) local.push({ oid: objectId, size })
  }
  return local
}

async function readPointerBlobs(candidates, onBlob) {
  if (candidates.length === 0) return
  const child = spawn('git', ['-C', workspace, 'cat-file', '--batch'], {
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    if (stderr.length < MAX_GIT_METADATA_BYTES) stderr += chunk
  })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  child.stdin.end(candidates.map(candidate => candidate.oid).join('\n') + '\n')

  let pending = Buffer.alloc(0)
  let current = null
  let index = 0
  try {
    for await (const chunk of child.stdout) {
      pending = Buffer.concat([pending, chunk])
      while (true) {
        if (current === null) {
          const newline = pending.indexOf(10)
          if (newline < 0) break
          const header = pending.subarray(0, newline).toString('ascii')
          pending = pending.subarray(newline + 1)
          const match = /^([a-f0-9]{40,64}) blob (0|[1-9][0-9]*)$/.exec(header)
          const expected = candidates[index]
          if (
            !match ||
            expected === undefined ||
            match[1] !== expected.oid ||
            Number(match[2]) !== expected.size
          ) {
            throw new Error('Git returned an invalid pointer-blob header.')
          }
          current = expected
        }
        if (pending.length < current.size + 1) break
        if (pending[current.size] !== 10) {
          throw new Error('Git returned an invalid pointer-blob delimiter.')
        }
        const contents = pending.subarray(0, current.size)
        pending = pending.subarray(current.size + 1)
        await onBlob(current.oid, contents)
        index++
        current = null
      }
    }
  } catch (error) {
    child.kill()
    await completion.catch(() => {})
    throw error
  }
  const exitCode = await completion
  if (
    exitCode !== 0 ||
    current !== null ||
    pending.length !== 0 ||
    index !== candidates.length
  ) {
    throw new Error(
      'Git could not read the bounded pointer blobs without lazy fetching: ' +
        stderr.trim().slice(0, 500)
    )
  }
}

async function trackedPointersAt(commit) {
  const entries = treeEntriesAt(commit)
  const entriesByObject = new Map()
  for (const entry of entries) {
    const paths = entriesByObject.get(entry.oid) || []
    paths.push(entry)
    entriesByObject.set(entry.oid, paths)
  }
  const pointers = []
  const candidates = localPointerBlobCandidates(entries)
  await readPointerBlobs(candidates, async (oid, contents) => {
    if (
      contents.includes(0) ||
      !contents
        .subarray(0, Math.min(contents.length, 64))
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .startsWith('version ' + POINTER_VERSION)
    ) {
      return
    }
    const text = contents.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(contents)) return
    const pointer = parsePointer(text)
    if (pointer === null) return
    for (const entry of entriesByObject.get(oid) || []) {
      pointers.push({ ...entry, text, pointer })
    }
  })
  return pointers
}

function fetchPointerSizedBlobs() {
  const head = git(['rev-parse', '--verify', 'HEAD'])
  if (head !== eventCommit) {
    throw new Error(
      'Checked-out HEAD does not match the workflow event commit.'
    )
  }
  git([
    'fetch',
    '--no-tags',
    '--refetch',
    '--depth=1',
    '--filter=blob:limit=' + POINTER_BLOB_FILTER_BYTES,
    'origin',
    eventCommit,
  ])
  if (git(['rev-parse', '--verify', 'HEAD']) !== head) {
    throw new Error('Checked-out HEAD changed while fetching pointer blobs.')
  }
  return head
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

function remoteBranchCommit() {
  const remoteRef = 'refs/heads/' + refName
  const advertised = git(['ls-remote', '--refs', 'origin', remoteRef], {
    quiet: true,
    raw: true,
  })
  const match = /^([a-f0-9]{40,64})\t([^\r\n]+)\r?\n?$/.exec(advertised)
  return match && match[2] === remoteRef ? match[1] : null
}

async function remoteContainsCommit(commit) {
  const remoteCommit = remoteBranchCommit()
  if (remoteCommit === null) return false
  if (remoteCommit === commit) return true
  try {
    const response = await api(
      '/repos/' + repository + '/compare/' + commit + '...' + remoteCommit
    )
    const comparison = await response.json()
    return (
      comparison.status === 'ahead' &&
      comparison.merge_base_commit?.sha === commit
    )
  } catch (error) {
    console.warn(
      'Could not prove an ambiguously acknowledged pointer push: ' +
        error.message
    )
    return false
  }
}

async function adoptPointer(
  entry,
  object,
  candidateName,
  storedSize,
  tempRoot
) {
  const currentCommit = git(['rev-parse', '--verify', 'HEAD'])
  git(['diff', '--quiet'])
  git(['diff', '--cached', '--quiet'])
  if (currentCommit !== entry.commit) {
    throw new Error(
      'Pointer changed while its release object was being compressed.'
    )
  }
  const currentText = git(['cat-file', 'blob', entry.oid], {
    maxBuffer: MAX_POINTER_BYTES + 1024,
    quiet: true,
    raw: true,
  })
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
  if (Buffer.byteLength(nextText, 'utf8') > MAX_POINTER_BYTES) {
    throw new Error('Compressed pointer exceeds the Cheap LFS pointer limit.')
  }

  const temporaryIndex = join(tempRoot, 'pointer-index')
  const indexEnvironment = { GIT_INDEX_FILE: temporaryIndex }
  git(['read-tree', currentCommit], { env: indexEnvironment })
  const nextOid = git(['hash-object', '-w', '--stdin'], { input: nextText })
  git(['update-index', '-z', '--index-info'], {
    env: indexEnvironment,
    input: Buffer.from(entry.mode + ' ' + nextOid + '\t' + entry.path + '\0'),
  })
  // The temporary full-tree index intentionally references omitted promisor
  // blobs. --missing-ok writes their existing object IDs without hydrating
  // multi-gigabyte ordinary files.
  const nextTree = git(['write-tree', '--missing-ok'], {
    env: indexEnvironment,
  })
  const changedPaths = git(
    [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      currentCommit,
      nextTree,
    ],
    { quiet: true, raw: true }
  )
    .split('\0')
    .filter(Boolean)
  if (changedPaths.length !== 1 || changedPaths[0] !== entry.path) {
    throw new Error('Pointer adoption prepared an unexpected tree change.')
  }
  if (
    git(['rev-parse', '--verify', 'HEAD']) !== currentCommit ||
    git(['cat-file', 'blob', entry.oid], {
      maxBuffer: MAX_POINTER_BYTES + 1024,
      quiet: true,
      raw: true,
    }) !== entry.text
  ) {
    throw new Error(
      'Pointer changed while its release object was being compressed.'
    )
  }
  if (remoteBranchCommit() !== currentCommit) {
    throw new Error(
      'The remote branch advanced while its release object was being compressed.'
    )
  }

  const nextCommit = git(
    [
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit-tree',
      nextTree,
      '-p',
      currentCommit,
      '-m',
      'Compress Cheap LFS release object [skip ci]',
    ],
    { quiet: true }
  )
  // The verified side asset is already durable and no longer owned by this
  // attempt. A push can update the remote and still fail locally when the
  // response is lost, so it must remain available for reconciliation/reuse.
  try {
    git(['push', 'origin', nextCommit + ':refs/heads/' + refName])
  } catch (error) {
    if (!(await remoteContainsCommit(nextCommit))) throw error
    console.warn(
      'The pointer push acknowledgement was lost, but the remote contains the exact adopted commit.'
    )
  }
  git(['diff', '--quiet'])
  git(['diff', '--cached', '--quiet'])
  git(['reset', '--hard', nextCommit])
  if (
    git(['rev-parse', '--verify', 'HEAD']) !== nextCommit ||
    git(['diff', '--quiet'], { quiet: true }) !== '' ||
    git(['diff', '--cached', '--quiet'], { quiet: true }) !== ''
  ) {
    throw new Error(
      'Pointer adoption could not synchronize the local checkout.'
    )
  }
  return {
    ...entry,
    commit: nextCommit,
    oid: nextOid,
    pointer: next,
    text: nextText,
  }
}

async function compressObject(entry, object) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-'))
  let uploadedAttemptId = null
  try {
    if (object.size >= MAX_PART_BYTES) {
      throw new Error('Raw release object must be smaller than 2 GiB.')
    }
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
      if (uploaded.name !== candidate.name) {
        await deleteAttemptAsset(uploaded.id)
        uploadedAttemptId = null
        throw new Error(
          'GitHub returned a different compressed release asset name.'
        )
      }
      if (
        !(await assetMatches(uploaded, stored.bytes, stored.sha256, tempRoot))
      ) {
        await deleteAttemptAsset(uploaded.id)
        uploadedAttemptId = null
        throw new Error(
          'GitHub did not preserve the compressed release asset exactly.'
        )
      }
      // A verified compressed asset is durable shared state. Relinquish
      // deletion ownership before any pointer CAS/adoption so an older run can
      // never delete an orphan already reused by a newer run.
      uploadedAttemptId = null
    }

    const adoptedEntry = await adoptPointer(
      entry,
      object,
      candidate.name,
      stored.bytes,
      tempRoot
    )
    return {
      kind: 'compressed',
      storedBytes: stored.bytes,
      name: candidate.name,
      entry: adoptedEntry,
    }
  } catch (error) {
    if (uploadedAttemptId !== null) await deleteAttemptAsset(uploadedAttemptId)
    throw error
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function advanceQueuedPointerEntries(entries, adoptedEntry) {
  const currentCommit = git(['rev-parse', '--verify', 'HEAD'])
  if (currentCommit !== adoptedEntry.commit) {
    throw new Error('HEAD changed after a release object was adopted.')
  }
  const parentCommit = git(['rev-parse', '--verify', adoptedEntry.commit + '^'])
  const currentTree = new Map(
    treeEntriesAt(currentCommit).map(entry => [entry.path, entry])
  )
  const advanced = []
  for (const [path, entry] of entries) {
    if (entry.commit !== parentCommit) {
      throw new Error(
        'A queued pointer was not based on the adopted commit parent.'
      )
    }
    const current = currentTree.get(path)
    if (path === adoptedEntry.path) {
      if (
        current === undefined ||
        current.mode !== adoptedEntry.mode ||
        current.oid !== adoptedEntry.oid
      ) {
        throw new Error('The adopted pointer is not exact in the current tree.')
      }
      advanced.push([path, adoptedEntry])
      continue
    }
    if (
      current === undefined ||
      current.mode !== entry.mode ||
      current.oid !== entry.oid
    ) {
      throw new Error(
        'A queued pointer changed while another release object was adopted.'
      )
    }
    advanced.push([path, { ...entry, commit: adoptedEntry.commit }])
  }
  for (const [path, entry] of advanced) entries.set(path, entry)
}

async function summaryLine(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, text + '\n', 'utf8')
  }
}

async function main() {
  git(['diff', '--quiet'])
  git(['diff', '--cached', '--quiet'])
  if (
    git(['check-ref-format', '--branch', refName], { quiet: true }) !== refName
  ) {
    throw new Error('Cheap LFS cloud compression received an invalid branch.')
  }
  const head = fetchPointerSizedBlobs()
  const entries = new Map()
  const queue = []
  for (const entry of await trackedPointersAt(head)) {
    entries.set(entry.path, entry)
    for (const object of rawObjects(entry))
      queue.push({ path: entry.path, object })
  }
  let compressed = 0
  let skipped = 0
  let failed = 0
  await summaryLine('## Cheap LFS cloud compression')

  for (const candidate of queue) {
    const entry = entries.get(candidate.path)
    if (entry === undefined) {
      throw new Error('Cheap LFS lost a tracked pointer during compression.')
    }
    const object = rawObjects(entry).find(
      value => value.key === candidate.object.key
    )
    if (object === undefined) continue
    console.log(
      'Compressing ' + entry.path + ' object ' + object.name + ' one at a time…'
    )
    try {
      const result = await compressObject(entry, object)
      if (result.kind === 'compressed') {
        advanceQueuedPointerEntries(entries, result.entry)
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
