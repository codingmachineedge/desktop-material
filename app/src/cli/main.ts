import { join } from 'path'
import { execFile, spawn } from 'child_process'
import { formatCLIHelp, parseCLIArguments } from './arguments'

const run = (...args: Array<string>) => {
  function cb(e: unknown | null, _stdout?: string, stderr?: string) {
    if (e) {
      console.error(`Error running command ${args}`)
      console.error(stderr ?? `${e}`)
      process.exit(
        typeof e === 'object' && 'code' in e && typeof e.code === 'number'
          ? e.code
          : 1
      )
    }
  }

  if (process.platform === 'darwin') {
    execFile('open', ['-n', join(__dirname, '../../..'), '--args', ...args], cb)
  } else if (process.platform === 'win32') {
    const exeName = `GitHubDesktop${__DEV__ ? '-dev' : ''}.exe`
    spawn(join(__dirname, `../../${exeName}`), args, {
      detached: true,
      stdio: 'ignore',
    })
      .on('error', cb)
      .on('exit', code => (process.exitCode = code ?? process.exitCode))
      .unref()
  } else if (process.platform === 'linux') {
    spawn(join(__dirname, '../../desktop'), args, {
      detached: true,
      stdio: 'ignore',
    })
      .on('error', cb)
      .on('exit', code => (process.exitCode = code ?? process.exitCode))
      .unref()
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

delete process.env.ELECTRON_RUN_AS_NODE

const request = parseCLIArguments(process.argv.slice(2), process.cwd())

switch (request.kind) {
  case 'help':
    process.stdout.write(formatCLIHelp())
    break
  case 'version':
    process.stdout.write(`Desktop Material ${__APP_VERSION__}\n`)
    break
  case 'error':
    process.stderr.write(`desktop-material: ${request.message}\n\n`)
    process.stderr.write(formatCLIHelp())
    process.exitCode = 1
    break
  case 'clone':
    run(
      `--cli-clone=${request.url}`,
      ...(request.branch ? [`--cli-branch=${request.branch}`] : [])
    )
    break
  case 'open':
    run(`--cli-open=${request.path}`)
    break
}
