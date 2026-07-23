'use strict'

const { readFileSync } = require('node:fs')

const maxRunIdDigits = 12
const maxNuGetSpecialVersionLength = 20

const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z-]+))?$/

function parseReleaseVersion(version) {
  if (typeof version !== 'string') {
    throw new Error('Release version must be a string.')
  }

  const match = versionPattern.exec(version)
  if (match === null) {
    throw new Error(`Invalid release version '${version}'.`)
  }

  const prerelease = match[5]
  if (
    prerelease !== undefined &&
    prerelease.length > maxNuGetSpecialVersionLength
  ) {
    throw new Error(
      `NuGet special version '${prerelease}' exceeds ${maxNuGetSpecialVersionLength} characters.`
    )
  }

  return {
    core: [match[1], match[2], match[3], match[4] ?? '0'].map(value =>
      BigInt(value)
    ),
    prerelease,
  }
}

function createReleaseVersion(baseVersion, runId) {
  const base = parseReleaseVersion(baseVersion)
  if (base.prerelease === undefined) {
    throw new Error(
      `Base version '${baseVersion}' must already contain a prerelease channel.`
    )
  }

  if (
    typeof runId !== 'string' ||
    !new RegExp(`^[1-9]\\d{0,${maxRunIdDigits - 1}}$`).test(runId)
  ) {
    throw new Error(
      `GitHub run ID must be a positive decimal with at most ${maxRunIdDigits} digits.`
    )
  }

  const sequence = runId.padStart(maxRunIdDigits, '0')
  const version = `${baseVersion}-z${sequence}`
  parseReleaseVersion(version)
  return version
}

function compareReleaseVersions(leftVersion, rightVersion) {
  const left = parseReleaseVersion(leftVersion)
  const right = parseReleaseVersion(rightVersion)

  for (let index = 0; index < left.core.length; index++) {
    if (left.core[index] < right.core[index]) {
      return -1
    }
    if (left.core[index] > right.core[index]) {
      return 1
    }
  }

  if (left.prerelease === undefined && right.prerelease === undefined) {
    return 0
  }
  if (left.prerelease === undefined) {
    return 1
  }
  if (right.prerelease === undefined) {
    return -1
  }

  const leftPrerelease = left.prerelease.toLowerCase()
  const rightPrerelease = right.prerelease.toLowerCase()
  if (leftPrerelease < rightPrerelease) {
    return -1
  }
  if (leftPrerelease > rightPrerelease) {
    return 1
  }
  return 0
}

function selectHighestReleaseTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('At least one release tag is required.')
  }

  let highestTag
  let highestVersion
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.startsWith('v')) {
      throw new Error(`Invalid release tag '${String(tag)}'.`)
    }

    const version = tag.slice(1)
    parseReleaseVersion(version)
    if (
      highestVersion === undefined ||
      compareReleaseVersions(version, highestVersion) > 0
    ) {
      highestTag = tag
      highestVersion = version
    }
  }

  return highestTag
}

function runCli(argv) {
  const [command, ...args] = argv
  if (command === 'create' && args.length === 2) {
    process.stdout.write(`${createReleaseVersion(args[0], args[1])}\n`)
    return
  }
  if (command === 'compare' && args.length === 2) {
    process.stdout.write(`${compareReleaseVersions(args[0], args[1])}\n`)
    return
  }
  if (command === 'max' && args.length === 0) {
    const tags = readFileSync(0, 'utf8')
      .split(/\r?\n/)
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
    process.stdout.write(`${selectHighestReleaseTag(tags)}\n`)
    return
  }

  throw new Error(
    'Usage: release-version.js create <base> <run-id> | compare <left> <right> | max'
  )
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  compareReleaseVersions,
  createReleaseVersion,
  selectHighestReleaseTag,
}
