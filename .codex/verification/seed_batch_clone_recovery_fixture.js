#!/usr/bin/env node
/* eslint-disable no-sync -- this helper only touches validated, isolated fixture paths */

/**
 * Seed the renderer-owned v2 batch-clone journal before launching Electron.
 * The caller creates one unique run root, empty userData directory, and empty
 * destination directory beneath the system Temp root. This helper refuses to
 * overwrite any existing queue or destination and never writes credentials.
 */

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const JournalName = 'clone-queue-v1.json'
const FixtureItemCount = 12
const RecoveryIdBytes = 24
const realpathSync = fs.realpathSync.native ?? fs.realpathSync

function fail(message) {
  throw new Error(message)
}

function isWithin(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate)
  return (
    (allowRoot || relative.length > 0) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function pathsEqual(first, second) {
  const normalize = value => {
    const normalized = path.normalize(value)
    return process.platform === 'win32'
      ? normalized.toLocaleLowerCase('en-US')
      : normalized
  }
  return normalize(first) === normalize(second)
}

function requireCanonicalDirectory(value, label) {
  const requested = path.resolve(value ?? '')
  if (!fs.existsSync(requested)) {
    fail(`${label} must be an existing directory.`)
  }
  const metadata = fs.lstatSync(requested)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} must be an ordinary directory.`)
  }
  const parsed = path.parse(requested)
  let current = parsed.root
  for (const segment of requested
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(part => part.length > 0)) {
    current = path.join(current, segment)
    if (fs.lstatSync(current).isSymbolicLink()) {
      fail(`${label} must not traverse a link or junction.`)
    }
  }
  const canonical = realpathSync(requested)
  return canonical
}

function parseArguments(argv) {
  const values = new Map()
  const allowed = new Set(['run-root', 'user-data-path', 'destination-root'])
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${name ?? '<end>'}.`)
    }
    const key = name.slice(2)
    if (!allowed.has(key)) {
      fail(`Unknown argument ${name}.`)
    }
    if (values.has(key)) {
      fail(`Duplicate argument ${name}.`)
    }
    values.set(key, value)
  }
  for (const key of allowed) {
    if (!values.has(key)) {
      fail(`${key} is required.`)
    }
  }

  const runRoot = requireCanonicalDirectory(values.get('run-root'), 'run-root')
  const tempRoot = requireCanonicalDirectory(os.tmpdir(), 'system Temp root')
  if (
    !path.basename(runRoot).startsWith('desktop-material-p0-ui-') ||
    !isWithin(tempRoot, runRoot)
  ) {
    fail('run-root must be a named child of the system Temp root.')
  }

  const userDataPath = requireCanonicalDirectory(
    values.get('user-data-path'),
    'user-data-path'
  )
  const destinationRoot = requireCanonicalDirectory(
    values.get('destination-root'),
    'destination-root'
  )
  for (const [label, candidate] of [
    ['user-data-path', userDataPath],
    ['destination-root', destinationRoot],
  ]) {
    if (!isWithin(runRoot, candidate)) {
      fail(`${label} must remain inside run-root.`)
    }
  }
  if (pathsEqual(userDataPath, destinationRoot)) {
    fail('user-data-path and destination-root must be distinct.')
  }
  return { runRoot, userDataPath, destinationRoot }
}

function buildFixture(destinationRoot) {
  const items = Array.from({ length: FixtureItemCount }, (_, offset) => {
    const sequence = String(offset + 1).padStart(2, '0')
    const name = `responsive-recovery-${sequence}-long-repository-name`
    return {
      url: `https://example.invalid/desktop-material/${name}.git`,
      name,
      path: path.join(destinationRoot, name),
      defaultBranch: 'main',
      recoveryId: crypto.randomBytes(RecoveryIdBytes).toString('hex'),
    }
  })
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    items,
    statuses: items.map(item => [
      item.path,
      {
        kind: 'interrupted',
        description: 'Paused for isolated responsive recovery verification.',
      },
    ]),
    mode: 'sequential',
    source: 'manual',
    paused: true,
    generation: 1,
    notifiedGeneration: 0,
  }
}

function assertValidFixture(fixture, destinationRoot) {
  if (
    fixture.version !== 2 ||
    fixture.mode !== 'sequential' ||
    fixture.source !== 'manual' ||
    fixture.paused !== true ||
    fixture.generation !== 1 ||
    fixture.notifiedGeneration !== 0 ||
    !Array.isArray(fixture.items) ||
    fixture.items.length !== FixtureItemCount ||
    !Array.isArray(fixture.statuses) ||
    fixture.statuses.length !== fixture.items.length
  ) {
    fail('The generated clone recovery fixture has an invalid journal shape.')
  }

  const paths = new Set()
  const recoveryIds = new Set()
  for (const item of fixture.items) {
    const url = new URL(item.url)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'example.invalid' ||
      url.username !== '' ||
      url.password !== '' ||
      path.dirname(item.path) !== destinationRoot ||
      path.basename(item.path) !== item.name ||
      !isWithin(destinationRoot, item.path) ||
      !/^[a-f\d]{48}$/.test(item.recoveryId) ||
      fs.existsSync(item.path)
    ) {
      fail('The generated clone recovery fixture contains an unsafe item.')
    }
    paths.add(item.path)
    recoveryIds.add(item.recoveryId)
  }
  if (
    paths.size !== fixture.items.length ||
    recoveryIds.size !== fixture.items.length
  ) {
    fail('The generated clone recovery fixture contains duplicate ownership.')
  }
  for (const entry of fixture.statuses) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !paths.has(entry[0]) ||
      entry[1]?.kind !== 'interrupted'
    ) {
      fail('Every clone recovery fixture item must be interrupted.')
    }
  }

  const serialized = JSON.stringify(fixture)
  if (
    /"(?:accountKey|token|password|authorization|credential)"\s*:/i.test(
      serialized
    ) ||
    /https?:\/\/[^/\s@]+@/i.test(serialized)
  ) {
    fail('The clone recovery fixture must not contain credentials or secrets.')
  }
}

function seedBatchCloneRecoveryFixture(requestedOptions) {
  const options = parseArguments([
    '--run-root',
    requestedOptions.runRoot,
    '--user-data-path',
    requestedOptions.userDataPath,
    '--destination-root',
    requestedOptions.destinationRoot,
  ])
  if (fs.readdirSync(options.userDataPath).length !== 0) {
    fail('user-data-path must be empty before the isolated app launch.')
  }
  if (fs.readdirSync(options.destinationRoot).length !== 0) {
    fail('destination-root must be empty before fixture seeding.')
  }

  const journalPath = path.join(options.userDataPath, JournalName)
  for (const candidate of [journalPath, `${journalPath}.backup`]) {
    if (fs.existsSync(candidate)) {
      fail('The clone recovery fixture refuses to overwrite queue state.')
    }
  }

  const fixture = buildFixture(options.destinationRoot)
  assertValidFixture(fixture, options.destinationRoot)
  const serialized = `${JSON.stringify(fixture, null, 2)}\n`
  let descriptor = null
  let created = false
  try {
    descriptor = fs.openSync(journalPath, 'wx', 0o600)
    created = true
    fs.writeFileSync(descriptor, serialized, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    const persisted = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    assertValidFixture(persisted, options.destinationRoot)
  } catch (error) {
    const cleanupErrors = []
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (created && fs.existsSync(journalPath)) {
      try {
        fs.unlinkSync(journalPath)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Clone recovery fixture creation and cleanup both failed.'
      )
    }
    throw error
  }

  return {
    journalPath,
    itemCount: fixture.items.length,
    paused: fixture.paused,
    statuses: ['interrupted'],
    sha256: crypto.createHash('sha256').update(serialized).digest('hex'),
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const receipt = seedBatchCloneRecoveryFixture(options)
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  }
}

module.exports = {
  FixtureItemCount,
  assertValidFixture,
  buildFixture,
  parseArguments,
  seedBatchCloneRecoveryFixture,
}
