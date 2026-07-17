import { spawn } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { mkdir, open, rm, stat, writeFile, readFile } from 'fs/promises'
import { pathExists } from '../../lib/path-exists'
import {
  BuildRunLogStream,
  BuildStageKind,
  IBuildRunPlan,
  ICommand,
} from '../../lib/build-run/types'

/**
 * Elevated (single-UAC) execution path.
 *
 * Because a medium-integrity process cannot stream from, or kill, a
 * high-integrity child, we bridge the integrity boundary with the filesystem:
 *
 *   os.tmpdir()/desktop-material/build-run/<runId>/
 *     manifest.json   argv-encoded commands (never string-concatenated)
 *     run.ps1         chain that appends to output.log, polls cancel.flag
 *     output.log      combined stream, tailed by this (medium) process
 *     exit.code       written last; its appearance is the terminal signal
 *     cancel.flag     written by us to request cancellation
 *     ready.flag      proves the elevated supervisor established the bridge
 *     heartbeat.flag  distinguishes a silent command from a lost supervisor
 *
 * A single `Start-Process -Verb RunAs` triggers exactly one UAC prompt. The
 * elevated supervisor owns each command process tree so it can observe a
 * cancellation while the command is still running and terminate descendants
 * from the high-integrity side. It ships pre-expanded fallbacks (e.g. `npm ci` →
 * `npm install --legacy-peer-deps`) because adaptive, output-driven auto-fix is
 * only available in the non-elevated runner.
 */

/** The origin of a streamed elevated log line, forwarded to the runner. */
export interface IElevatedEmit {
  (
    stage: BuildStageKind | 'toolchain',
    stream: BuildRunLogStream,
    text: string
  ): void
}

/** Terminal outcome of an elevated chain. */
export interface IElevatedResult {
  readonly code: number
  readonly cancelled: boolean
}

/** A live elevated run the caller can await and cancel. */
export interface IElevatedRun {
  readonly whenDone: Promise<IElevatedResult>
  /**
   * Request cancellation and observe the same terminal result exposed by
   * `whenDone`. The promise never rejects, including when the filesystem
   * control channel is unavailable.
   */
  cancel(): Promise<IElevatedResult>
}

/**
 * Bounded protocol timings. The overrides are primarily useful to exercise
 * failure paths without making tests wait for production watchdogs.
 */
export interface IElevatedRunOptions {
  readonly platform?: NodeJS.Platform
  readonly pollIntervalMs?: number
  readonly launchTimeoutMs?: number
  readonly protocolIdleTimeoutMs?: number
  readonly runTimeoutMs?: number
  readonly terminationGracePeriodMs?: number
}

/** The Windows exit code we use to mark a cancelled (Ctrl-C-equivalent) run. */
const CANCELLED_EXIT_CODE = 1223

/** How often (ms) we tail output.log and check for the exit sentinel. */
const POLL_INTERVAL_MS = 150

/** Maximum time to wait for the elevated script to establish its bridge. */
const LAUNCH_TIMEOUT_MS = 2 * 60 * 1000

/** Maximum silence after the elevated bridge has announced it is ready. */
const PROTOCOL_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** Absolute safety bound for an elevated run, including preparation. */
const RUN_TIMEOUT_MS = 12 * 60 * 60 * 1000

/** Time allowed for the elevated side to acknowledge a termination request. */
const TERMINATION_GRACE_PERIOD_MS = 30 * 1000

/** Avoid allocating an unbounded buffer if a log grows very quickly. */
const MAX_LOG_READ_BYTES = 1024 * 1024

/** Bound output from tools that never terminate a log line. */
const MAX_BUFFERED_LINE_CHARS = 256 * 1024

/** Markers the run.ps1 emits into output.log so we can type each line. */
const CMD_MARKER = '##DM-CMD##'
const META_MARKER = '##DM-META##'

/** One flattened, argv-encoded command in the elevated manifest. */
interface IManifestCommand {
  readonly kind: BuildStageKind
  readonly exe: string
  readonly args: ReadonlyArray<string>
  readonly label: string
  readonly encodedCommand: string
  readonly fallback?: {
    readonly exe: string
    readonly args: ReadonlyArray<string>
    readonly label: string
    readonly encodedCommand: string
  }
  readonly fallbackNote?: string
}

interface IManifest {
  readonly cwd: string
  readonly env: Record<string, string>
  readonly commands: ReadonlyArray<IManifestCommand>
}

function cmd(exe: string, args: ReadonlyArray<string>): ICommand {
  return { exe, args, label: `${exe} ${args.join(' ')}`.trim() }
}

/**
 * A pre-expanded fallback for the elevated chain, mirroring the intent of the
 * non-elevated auto-fix but decided up front (no live output to inspect).
 */
function elevatedFallback(
  ecosystem: string,
  stage: BuildStageKind,
  command: ICommand,
  flags: { hasYarnLock: boolean; hasPnpmLock: boolean }
): ICommand | null {
  if (ecosystem !== 'node' || stage !== 'install') {
    return null
  }
  const exe = command.exe.toLowerCase()
  const first = command.args[0]
  if (exe.startsWith('npm') && first === 'ci') {
    if (flags.hasYarnLock) {
      return cmd('yarn', ['install'])
    }
    if (flags.hasPnpmLock) {
      return cmd('pnpm', ['install'])
    }
    return cmd('npm', ['install', '--legacy-peer-deps'])
  }
  if (exe.startsWith('npm') && first === 'install') {
    return cmd('npm', ['install', '--legacy-peer-deps'])
  }
  return null
}

/**
 * Encode the per-command wrapper rather than interpolating repository argv in
 * the supervisor. The only argument Start-Process receives is PowerShell's
 * restricted base64 alphabet; the wrapper reloads the manifest and invokes
 * the original argv array with PowerShell's splatting semantics.
 */
function encodeInvocation(
  baseDir: string,
  commandIndex: number,
  useFallback: boolean
): string {
  const b = baseDir.replace(/'/g, "''")
  const script = [
    `$ErrorActionPreference = 'Continue'`,
    `$base = '${b}'`,
    `$log = Join-Path $base 'output.log'`,
    `$manifest = Get-Content -LiteralPath (Join-Path $base 'manifest.json') -Raw -ErrorAction Stop | ConvertFrom-Json`,
    `$c = $manifest.commands[${commandIndex}]`,
    ...(useFallback ? [`$c = $c.fallback`] : []),
    `foreach ($property in $manifest.env.PSObject.Properties) {`,
    `  [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')`,
    `}`,
    `Set-Location -LiteralPath $manifest.cwd -ErrorAction Stop`,
    `$cmdArgs = @(); if ($c.args) { $cmdArgs = @($c.args) }`,
    `$global:LASTEXITCODE = $null`,
    `& $c.exe @cmdArgs *>> $log 2>&1`,
    `$code = $LASTEXITCODE`,
    `if ($null -eq $code) { $code = 0 }`,
    `exit ([int]$code)`,
  ].join('\r\n')
  return Buffer.from(script, 'utf16le').toString('base64')
}

function buildManifest(plan: IBuildRunPlan, baseDir: string): IManifest {
  const commands: IManifestCommand[] = []
  for (const stage of plan.stages) {
    for (const command of stage.commands) {
      const commandIndex = commands.length
      const fb = elevatedFallback(plan.ecosystem, stage.kind, command, {
        hasYarnLock: plan.probeFlags.hasYarnLock,
        hasPnpmLock: plan.probeFlags.hasPnpmLock,
      })
      commands.push({
        kind: stage.kind,
        exe: command.exe,
        args: command.args,
        label: command.label,
        encodedCommand: encodeInvocation(baseDir, commandIndex, false),
        fallback: fb
          ? {
              exe: fb.exe,
              args: fb.args,
              label: fb.label,
              encodedCommand: encodeInvocation(baseDir, commandIndex, true),
            }
          : undefined,
        fallbackNote: fb
          ? `First attempt failed — retrying with ${fb.label}.`
          : undefined,
      })
    }
  }
  return { cwd: plan.cwd, env: plan.env, commands }
}

/**
 * The PowerShell chain, parameterised only by our own temp-dir path. Repo
 * paths and commands are read from manifest.json at runtime — never
 * interpolated into this script text.
 */
function runScript(baseDir: string): string {
  // Escape single quotes for a PowerShell single-quoted string literal.
  const b = baseDir.replace(/'/g, "''")
  return [
    `$ErrorActionPreference = 'Continue'`,
    `$base = '${b}'`,
    `$log = Join-Path $base 'output.log'`,
    `$exitFile = Join-Path $base 'exit.code'`,
    `$cancel = Join-Path $base 'cancel.flag'`,
    `$ready = Join-Path $base 'ready.flag'`,
    `$heartbeat = Join-Path $base 'heartbeat.flag'`,
    `$final = 1`,
    `function Stop-CommandTree {`,
    `  param([System.Diagnostics.Process]$Process)`,
    `  if ($Process.HasExited) { return $true }`,
    `  $rootId = [int]$Process.Id`,
    `  $knownIds = @($rootId)`,
    `  $snapshotComplete = $false`,
    `  try {`,
    `    $allProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)`,
    `    $pendingIds = @($rootId)`,
    `    while ($pendingIds.Count -gt 0) {`,
    `      $parentId = [int]$pendingIds[0]`,
    `      if ($pendingIds.Count -eq 1) { $pendingIds = @() } else { $pendingIds = @($pendingIds[1..($pendingIds.Count - 1)]) }`,
    `      foreach ($child in @($allProcesses | Where-Object { [int]$_.ParentProcessId -eq $parentId })) {`,
    `        $childId = [int]$child.ProcessId`,
    `        if ($knownIds -notcontains $childId) {`,
    `          $knownIds += $childId`,
    `          $pendingIds += $childId`,
    `        }`,
    `      }`,
    `    }`,
    `    $snapshotComplete = $true`,
    `  } catch { }`,
    `  $taskkill = Join-Path $env:SystemRoot 'System32\\taskkill.exe'`,
    `  $taskkillCode = 1`,
    `  try {`,
    `    & $taskkill /PID ([string]$rootId) /T /F *> $null`,
    `    $taskkillCode = $LASTEXITCODE`,
    `  } catch { }`,
    `  $deadline = [DateTime]::UtcNow.AddSeconds(10)`,
    `  $remainingIds = @($knownIds)`,
    `  while ($remainingIds.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {`,
    `    Start-Sleep -Milliseconds 100`,
    `    $remainingIds = @($knownIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })`,
    `  }`,
    `  if ($remainingIds.Count -gt 0) {`,
    `    for ($i = $knownIds.Count - 1; $i -ge 0; $i--) {`,
    `      try { Stop-Process -Id $knownIds[$i] -Force -ErrorAction Stop } catch { }`,
    `    }`,
    `    try { $Process.WaitForExit(2000) | Out-Null } catch { }`,
    `  }`,
    `  $remainingIds = @($knownIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })`,
    `  return ($remainingIds.Count -eq 0 -and ($taskkillCode -eq 0 -or $snapshotComplete))`,
    `}`,
    `function Append-DiagnosticFile {`,
    `  param([string]$Path)`,
    `  try {`,
    `    if (Test-Path -LiteralPath $Path) {`,
    `      $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop`,
    `      if ($text) { Add-Content -LiteralPath $log -Value $text -ErrorAction Stop }`,
    `      Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue`,
    `    }`,
    `  } catch { }`,
    `}`,
    `function Invoke-ManifestCommand {`,
    `  param([int]$Index, [bool]$Fallback)`,
    `  $command = $script:manifest.commands[$Index]`,
    `  if ($Fallback) { $command = $command.fallback }`,
    `  $attempt = if ($Fallback) { 'fallback' } else { 'primary' }`,
    `  $stdout = Join-Path $base ('supervisor-' + $Index + '-' + $attempt + '.stdout')`,
    `  $stderr = Join-Path $base ('supervisor-' + $Index + '-' + $attempt + '.stderr')`,
    `  Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue`,
    `  $process = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$command.encodedCommand) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -ErrorAction Stop`,
    `  $wasCancelled = $false`,
    `  $treeStopped = $true`,
    `  $nextHeartbeat = [DateTime]::MinValue`,
    `  while (-not $process.HasExited) {`,
    `    if ([DateTime]::UtcNow -ge $nextHeartbeat) {`,
    `      try { Set-Content -LiteralPath $heartbeat -Value ([string][DateTime]::UtcNow.Ticks) -ErrorAction Stop } catch { }`,
    `      $nextHeartbeat = [DateTime]::UtcNow.AddSeconds(2)`,
    `    }`,
    `    if (Test-Path -LiteralPath $cancel) {`,
    `      $wasCancelled = $true`,
    `      $treeStopped = Stop-CommandTree -Process $process`,
    `      break`,
    `    }`,
    `    Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}`,
    `    try { $process.Refresh() } catch { }`,
    `  }`,
    `  if (-not $process.HasExited) { $treeStopped = Stop-CommandTree -Process $process }`,
    `  try { $process.WaitForExit() } catch { }`,
    `  Append-DiagnosticFile -Path $stdout`,
    `  Append-DiagnosticFile -Path $stderr`,
    `  if ($wasCancelled) {`,
    `    if (-not $treeStopped) { return 1 }`,
    `    return ${CANCELLED_EXIT_CODE}`,
    `  }`,
    `  if (-not $process.HasExited) { return 1 }`,
    `  return ([int]$process.ExitCode)`,
    `}`,
    `try {`,
    `  $script:manifest = Get-Content -LiteralPath (Join-Path $base 'manifest.json') -Raw -ErrorAction Stop | ConvertFrom-Json`,
    `  Set-Content -LiteralPath $heartbeat -Value ([string][DateTime]::UtcNow.Ticks) -ErrorAction Stop`,
    `  Set-Content -LiteralPath $ready -Value ([string]$PID) -ErrorAction Stop`,
    `  $final = 0`,
    `  for ($index = 0; $index -lt $script:manifest.commands.Count; $index++) {`,
    `    $c = $script:manifest.commands[$index]`,
    `    if (Test-Path -LiteralPath $cancel) { $final = ${CANCELLED_EXIT_CODE}; break }`,
    `    Add-Content -LiteralPath $log -Value ('${CMD_MARKER}' + $c.kind + '|' + $c.label) -ErrorAction Stop`,
    `    $code = Invoke-ManifestCommand -Index $index -Fallback $false`,
    `    if (Test-Path -LiteralPath $cancel) {`,
    `      if ($code -eq ${CANCELLED_EXIT_CODE}) { $final = ${CANCELLED_EXIT_CODE} } else { $final = 1 }`,
    `      break`,
    `    }`,
    `    if ($code -ne 0 -and $c.fallback) {`,
    `      if (Test-Path -LiteralPath $cancel) { $final = ${CANCELLED_EXIT_CODE}; break }`,
    `      Add-Content -LiteralPath $log -Value ('${META_MARKER}' + $c.kind + '|' + $c.fallbackNote) -ErrorAction Stop`,
    `      Add-Content -LiteralPath $log -Value ('${CMD_MARKER}' + $c.kind + '|' + $c.fallback.label) -ErrorAction Stop`,
    `      $code = Invoke-ManifestCommand -Index $index -Fallback $true`,
    `    }`,
    `    if ($null -eq $code) { $code = 0 }`,
    `    if ($code -ne 0) { $final = $code; break }`,
    `  }`,
    `} catch {`,
    `  $final = 1`,
    `  try { Add-Content -LiteralPath $log -Value ('${META_MARKER}toolchain|The elevated execution protocol failed.') } catch { }`,
    `} finally {`,
    `  try { Set-Content -LiteralPath $exitFile -Value ([string]$final) -ErrorAction Stop } catch { }`,
    `}`,
    ``,
  ].join('\r\n')
}

/** Parse one output.log line into a typed emit, given the current stage. */
function parseLine(
  line: string,
  current: BuildStageKind | 'toolchain'
): {
  stage: BuildStageKind | 'toolchain'
  stream: BuildRunLogStream
  text: string
} {
  if (line.startsWith(CMD_MARKER)) {
    const [kind, ...rest] = line.slice(CMD_MARKER.length).split('|')
    return {
      stage: kind as BuildStageKind,
      stream: 'command',
      text: rest.join('|'),
    }
  }
  if (line.startsWith(META_MARKER)) {
    const [kind, ...rest] = line.slice(META_MARKER.length).split('|')
    return {
      stage: kind as BuildStageKind,
      stream: 'meta',
      text: rest.join('|'),
    }
  }
  return { stage: current, stream: 'stdout', text: line }
}

/** Read bytes appended to `file` since `offset`; returns text + new offset. */
async function readFrom(
  file: string,
  offset: number
): Promise<{ text: string; offset: number }> {
  let size = 0
  try {
    size = (await stat(file)).size
  } catch {
    return { text: '', offset }
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    return { text: '', offset }
  }
  const start = size < offset ? 0 : offset
  if (size === start) {
    return { text: '', offset: start }
  }
  const length = Math.min(size - start, MAX_LOG_READ_BYTES)
  const buffer = Buffer.alloc(length)
  let handle
  let bytesRead = 0
  try {
    handle = await open(file, 'r')
    bytesRead = (await handle.read(buffer, 0, length, start)).bytesRead
  } catch {
    return { text: '', offset }
  } finally {
    await handle?.close().catch(() => {})
  }
  return {
    text: buffer.subarray(0, bytesRead).toString('utf8'),
    offset: start + bytesRead,
  }
}

function boundedDuration(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.floor(value))
}

/**
 * Launch a plan under UAC and stream its progress. Windows-only; on other
 * platforms it resolves immediately as a failure with an explanatory line.
 */
export function startElevatedRun(
  plan: IBuildRunPlan,
  emit: IElevatedEmit,
  options: IElevatedRunOptions = {}
): IElevatedRun {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    emit(
      'toolchain',
      'meta',
      'Pre-elevated Build & Run is only supported on Windows.'
    )
    const whenDone = Promise.resolve({ code: 1, cancelled: false })
    return {
      whenDone,
      cancel: () => whenDone,
    }
  }

  const pollIntervalMs = boundedDuration(
    options.pollIntervalMs,
    POLL_INTERVAL_MS
  )
  const launchTimeoutMs = boundedDuration(
    options.launchTimeoutMs,
    LAUNCH_TIMEOUT_MS
  )
  const protocolIdleTimeoutMs = boundedDuration(
    options.protocolIdleTimeoutMs,
    PROTOCOL_IDLE_TIMEOUT_MS
  )
  const runTimeoutMs = boundedDuration(options.runTimeoutMs, RUN_TIMEOUT_MS)
  const terminationGracePeriodMs = boundedDuration(
    options.terminationGracePeriodMs,
    TERMINATION_GRACE_PERIOD_MS
  )

  const baseDir = path.join(
    os.tmpdir(),
    'desktop-material',
    'build-run',
    plan.runId
  )
  const logFile = path.join(baseDir, 'output.log')
  const exitFile = path.join(baseDir, 'exit.code')
  const cancelFile = path.join(baseDir, 'cancel.flag')
  const readyFile = path.join(baseDir, 'ready.flag')
  const heartbeatFile = path.join(baseDir, 'heartbeat.flag')

  let settled = false
  let cancelRequested = false
  let currentStage: BuildStageKind | 'toolchain' = 'toolchain'
  let readOffset = 0
  let lineBuffer = ''
  let ticking = false
  let outerExited = false
  let outerExitCode: number | null = null
  let outerStarted = false
  let bridgePrepared = false
  let elevatedReady = false
  let lastHeartbeat = ''
  let lastProtocolActivityAt = Date.now()
  let launchDeadlineAt = Number.POSITIVE_INFINITY
  let terminationPending = false
  let terminationSignalFailed = false
  let forcedResult: IElevatedResult = { code: 1, cancelled: false }
  let pollTimer: NodeJS.Timeout | null = null
  let launchTimer: NodeJS.Timeout | null = null
  let runTimer: NodeJS.Timeout | null = null
  let terminationTimer: NodeJS.Timeout | null = null
  let requestCancel: (() => void) | null = null

  const whenDone = new Promise<IElevatedResult>(resolve => {
    const safeEmit = (
      stage: BuildStageKind | 'toolchain',
      stream: BuildRunLogStream,
      text: string
    ) => {
      try {
        emit(stage, stream, text)
      } catch (err) {
        log.warn('[build-run] elevated log receiver failed', err)
      }
    }

    const emitLine = (line: string) => {
      const parsed = parseLine(line, currentStage)
      if (parsed.stream === 'command') {
        currentStage = parsed.stage
      }
      safeEmit(parsed.stage, parsed.stream, parsed.text)
    }

    const pump = async (): Promise<boolean> => {
      const { text, offset } = await readFrom(logFile, readOffset)
      readOffset = offset
      if (text.length === 0) {
        return false
      }
      lastProtocolActivityAt = Date.now()
      lineBuffer += text.replace(/\r\n/g, '\n')
      let idx = lineBuffer.indexOf('\n')
      while (idx !== -1) {
        emitLine(lineBuffer.slice(0, idx))
        lineBuffer = lineBuffer.slice(idx + 1)
        idx = lineBuffer.indexOf('\n')
      }
      while (lineBuffer.length > MAX_BUFFERED_LINE_CHARS) {
        emitLine(lineBuffer.slice(0, MAX_BUFFERED_LINE_CHARS))
        lineBuffer = lineBuffer.slice(MAX_BUFFERED_LINE_CHARS)
      }
      return true
    }

    const clearTimers = () => {
      for (const timer of [
        pollTimer,
        launchTimer,
        runTimer,
        terminationTimer,
      ]) {
        if (timer !== null) {
          clearTimeout(timer)
        }
      }
      pollTimer = null
      launchTimer = null
      runTimer = null
      terminationTimer = null
    }

    const finish = (result: IElevatedResult, cleanupBridge: boolean) => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()

      // Promise settlement must precede every fallible final read and cleanup.
      // A deleted/locked log or broken consumer can never strand the caller.
      resolve(result)

      void (async () => {
        try {
          await pump()
          if (lineBuffer.length > 0) {
            emitLine(lineBuffer)
            lineBuffer = ''
          }
        } catch (err) {
          log.warn('[build-run] failed to drain elevated output', err)
        }
        if (cleanupBridge) {
          await rm(baseDir, { recursive: true, force: true }).catch(err =>
            log.warn(`[build-run] failed to clean elevated temp dir`, err)
          )
        }
      })().catch(err =>
        log.warn('[build-run] elevated finalization failed', err)
      )
    }

    const readExitCode = async (): Promise<number | null> => {
      if (!(await pathExists(exitFile))) {
        return null
      }
      try {
        const raw = (await readFile(exitFile, 'utf8')).trim()
        if (!/^-?\d+$/.test(raw)) {
          return 1
        }
        const code = Number(raw)
        return Number.isSafeInteger(code) ? code : 1
      } catch {
        return 1
      }
    }

    const signalTermination = () => {
      if (!bridgePrepared) {
        return
      }
      void writeFile(cancelFile, '1', 'utf8').catch(err => {
        terminationSignalFailed = true
        forcedResult = { code: 1, cancelled: false }
        log.warn(`[build-run] failed to write elevated cancel flag`, err)
      })
    }

    const beginTermination = (
      message: string,
      result: IElevatedResult
    ): void => {
      if (settled) {
        return
      }
      if (result.cancelled) {
        forcedResult = result
      }
      if (terminationPending) {
        return
      }
      terminationPending = true
      forcedResult = result
      safeEmit('toolchain', 'meta', message)
      signalTermination()

      // This can stop the medium-integrity launcher while a UAC prompt is
      // pending. Once the elevated process exists Windows may deny the kill;
      // the filesystem flag remains the authoritative stop request.
      try {
        outerProcess?.kill()
      } catch (err) {
        log.warn('[build-run] failed to stop elevation launcher', err)
      }

      terminationTimer = setTimeout(
        () =>
          finish(
            terminationSignalFailed
              ? { code: 1, cancelled: false }
              : forcedResult,
            !outerStarted
          ),
        terminationGracePeriodMs
      )
    }

    const handleAsyncFailure = (boundary: string, err: unknown) => {
      log.warn(
        `[build-run] elevated ${boundary} failed`,
        err instanceof Error ? err : undefined
      )
      beginTermination(
        'The elevated execution protocol stopped responding and was terminated.',
        { code: 1, cancelled: cancelRequested }
      )
    }

    const tick = async () => {
      if (ticking || settled) {
        return
      }
      ticking = true
      try {
        await pump()

        const code = await readExitCode()
        if (code !== null) {
          finish(
            {
              code,
              cancelled:
                code === CANCELLED_EXIT_CODE &&
                (cancelRequested || !terminationPending),
            },
            true
          )
          return
        }

        if (!elevatedReady && (await pathExists(readyFile))) {
          elevatedReady = true
          lastProtocolActivityAt = Date.now()
          if (launchTimer !== null) {
            clearTimeout(launchTimer)
            launchTimer = null
          }
        }

        if (elevatedReady && (await pathExists(heartbeatFile))) {
          try {
            const heartbeat = (await readFile(heartbeatFile, 'utf8')).trim()
            if (heartbeat.length <= 64 && heartbeat !== lastHeartbeat) {
              lastHeartbeat = heartbeat
              lastProtocolActivityAt = Date.now()
            }
          } catch {
            // The idle watchdog remains authoritative when heartbeat reads fail.
          }
        }

        const now = Date.now()
        if (
          outerExited &&
          outerExitCode !== null &&
          outerExitCode !== 0 &&
          !elevatedReady
        ) {
          safeEmit(
            'toolchain',
            'meta',
            'Elevation was declined or the elevated process failed to start.'
          )
          finish({ code: 1, cancelled: false }, true)
          return
        }

        if (!elevatedReady && now >= launchDeadlineAt) {
          beginTermination(
            'The elevated process did not establish its control protocol in time.',
            { code: 1, cancelled: cancelRequested }
          )
          return
        }

        if (
          elevatedReady &&
          now - lastProtocolActivityAt >= protocolIdleTimeoutMs
        ) {
          beginTermination(
            'The elevated execution protocol became unresponsive and was terminated.',
            { code: 1, cancelled: cancelRequested }
          )
        }
      } finally {
        ticking = false
      }
    }

    const tickSafely = (boundary: string) => {
      void tick().catch(err => handleAsyncFailure(boundary, err))
    }

    let outerProcess: ReturnType<typeof spawn> | null = null

    const abandonPreparationIfSettled = async (): Promise<boolean> => {
      if (!settled) {
        return false
      }
      await rm(baseDir, { recursive: true, force: true }).catch(err =>
        log.warn('[build-run] failed to abandon elevated preparation', err)
      )
      return true
    }

    const prepare = async () => {
      await mkdir(baseDir, { recursive: true })
      if (await abandonPreparationIfSettled()) {
        return
      }
      await writeFile(
        path.join(baseDir, 'manifest.json'),
        JSON.stringify(buildManifest(plan, baseDir)),
        'utf8'
      )
      if (await abandonPreparationIfSettled()) {
        return
      }
      const scriptPath = path.join(baseDir, 'run.ps1')
      await writeFile(scriptPath, runScript(baseDir), 'utf8')
      if (await abandonPreparationIfSettled()) {
        return
      }
      // Seed the log so the tail has a file to read immediately.
      await writeFile(logFile, '', 'utf8')
      if (await abandonPreparationIfSettled()) {
        return
      }
      bridgePrepared = true

      if (cancelRequested || terminationPending || settled) {
        finish({ code: CANCELLED_EXIT_CODE, cancelled: cancelRequested }, true)
        return
      }

      const inner =
        `Start-Process -FilePath 'powershell' -Verb RunAs -WindowStyle Hidden ` +
        `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','` +
        scriptPath.replace(/'/g, "''") +
        `')`
      const outer = spawn(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', inner],
        { windowsHide: true, shell: false }
      )
      outerProcess = outer
      outerStarted = true
      launchDeadlineAt = Date.now() + launchTimeoutMs
      outer.on('error', err => {
        safeEmit(
          'toolchain',
          'meta',
          `Failed to launch elevated process: ${err.message}`
        )
        finish({ code: 1, cancelled: false }, true)
      })
      outer.on('exit', code => {
        outerExited = true
        outerExitCode = code
        tickSafely('launcher-exit check')
      })

      pollTimer = setInterval(() => tickSafely('poll timer'), pollIntervalMs)
      launchTimer = setTimeout(
        () => tickSafely('launch watchdog'),
        launchTimeoutMs
      )
      tickSafely('initial poll')
    }

    runTimer = setTimeout(
      () =>
        beginTermination(
          'The elevated run exceeded its safety timeout and was terminated.',
          { code: 1, cancelled: cancelRequested }
        ),
      runTimeoutMs
    )

    void prepare().catch(err => {
      if (settled) {
        return
      }
      safeEmit(
        'toolchain',
        'meta',
        `Failed to prepare elevated run: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      if (outerStarted) {
        beginTermination('The elevated run could not be prepared safely.', {
          code: 1,
          cancelled: cancelRequested,
        })
      } else {
        finish({ code: 1, cancelled: cancelRequested }, true)
      }
    })

    requestCancel = () => {
      if (settled || cancelRequested) {
        return
      }
      cancelRequested = true
      beginTermination('Cancellation requested. Stopping the elevated run…', {
        code: CANCELLED_EXIT_CODE,
        cancelled: true,
      })
    }
  })

  const cancel = (): Promise<IElevatedResult> => {
    requestCancel?.()
    return whenDone
  }

  return { whenDone, cancel }
}
