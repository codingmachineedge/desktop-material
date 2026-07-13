import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { parseEnv } from 'util'

function reporter(r) {
  return ['--test-reporter', r, '--test-reporter-destination', 'stdout']
}

async function findTestFilesIn(paths) {
  const files = []
  for (const path of paths) {
    const entry = await stat(path)
    if (entry.isFile()) {
      files.push(path)
      continue
    }

    for (const file of await readdir(path, { recursive: true }).then(x =>
      x
        .filter(f => /-test\.(ts|tsx|js|jsx|mts|mjs)$/.test(f))
        .map(f => join(path, f))
    )) {
      files.push(file)
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

// Leave room for Windows' CreateProcess command-line limit as well as quoting
// added by Node. A full Desktop Material unit run contains hundreds of paths,
// so passing every file to one child process can fail with ENAMETOOLONG before
// the test runner starts.
const maximumCommandLength = process.platform === 'win32' ? 24_000 : 96_000

function estimateCommandLength(args) {
  return (
    'node'.length + args.reduce((length, arg) => length + arg.length + 3, 0)
  )
}

function partitionFiles(baseArgs, files) {
  const batches = []
  let batch = []

  for (const file of files) {
    if (
      batch.length > 0 &&
      estimateCommandLength([...baseArgs, ...batch, file]) >
        maximumCommandLength
    ) {
      batches.push(batch)
      batch = []
    }

    batch.push(file)
  }

  if (batch.length > 0 || files.length === 0) {
    batches.push(batch)
  }

  return batches
}

function runNode(args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn('node', args, {
      stdio: 'inherit',
      cwd: resolve(import.meta.dirname, '..'),
    })

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      resolveExit(code ?? (signal === null ? 1 : 128))
    })
  })
}

const fileArgs = process.argv.slice(2).filter(a => !a.startsWith('--'))
const switchArgs = process.argv.slice(2).filter(a => a.startsWith('--'))

const projectRoot = join(import.meta.dirname, '..')
const files =
  fileArgs.length > 0
    ? await findTestFilesIn(fileArgs)
    : await findTestFilesIn([join(projectRoot, 'app', 'test', 'unit')])

// I would _looooove_ to use the `--env-file` option, but it doesn't override
// existing environment variables and we need to override some of them.
const testEnv = parseEnv(await readFile(join(projectRoot, '.test.env'), 'utf8'))
Object.entries(testEnv).forEach(([k, v]) => (process.env[k] = v))

const baseArgs = [
  '--disable-warning=ExperimentalWarning',
  '--experimental-test-module-mocks',
  // Allow CJS resolution to find ESM-only packages (e.g. @github/copilot-sdk)
  // whose "exports" only declare an "import" condition with no "require" fallback.
  '--conditions=import',
  ...['--import', 'tsx'],
  ...['--import', './app/test/globals.mts'],
  ...switchArgs,
  '--test',
  ...reporter('spec'),
  ...(process.env.GITHUB_ACTIONS ? reporter('node-test-github-reporter') : []),
]

const batches = partitionFiles(baseArgs, files)
if (batches.length > 1) {
  console.log(`Running ${files.length} test files in ${batches.length} batches`)
}

for (const batch of batches) {
  const exitCode = await runNode([...baseArgs, ...batch])
  if (exitCode !== 0) {
    process.exitCode = exitCode
    break
  }
}
