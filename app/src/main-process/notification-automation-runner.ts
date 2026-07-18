import { net, session } from 'electron'
import { spawn, SpawnOptions } from 'child_process'
import * as ipcMain from './ipc-main'
import { resolveExecutable, batchSpawnSpec } from './build-run/runner'
import {
  fillNotificationTemplate,
  validateWebhookUrl,
  SAFE_NOTIFICATION_ARG,
  INotificationAutomationRule,
  INotificationCommandResult,
  INotificationWebhookResult,
  NotificationAutomationEntry,
} from '../lib/notifications/automation/notification-automation'

/**
 * Main-process runners for notification automations. Everything that actually
 * touches the network or spawns a process lives here, behind the same guard set
 * the app uses for its other outbound/spawn boundaries:
 *
 *  - webhooks go through `net.request` on an isolated session partition with
 *    credentials omitted, manual (https-only) redirect handling, and a bounded
 *    response — never the renderer's `fetch`, and never with notification
 *    content in the URL (only in the request body);
 *  - commands are spawned with `shell: false`, and every templated argv value is
 *    re-validated against the batch-spawn allow-list after substitution and the
 *    run is refused (never escaped) if any value contains a shell metacharacter.
 *
 * Both runners take injectable dependencies so the guards can be exercised
 * deterministically in unit tests.
 */

const WebhookUserAgent = 'DesktopMaterial-NotificationAutomation'
const WebhookPartition = 'notification-automation'
const WebhookMaxRedirects = 5

/** Hard cap on the response bytes read from a webhook target (2 MiB). */
const WebhookResponseByteCap = 2 * 1024 * 1024

/** Bound on the response snippet carried back to the receipt notification. */
const WebhookResultBodyCap = 4 * 1024

/** Bound on the command output snippet carried back to the receipt. */
const CommandOutputCap = 8 * 1024

// --- Webhook ----------------------------------------------------------------

/** A minimal, transport-agnostic response the webhook runner consumes. */
export interface INotificationWebhookResponse {
  readonly status: number
  /** The redirect target for a 3xx response, else null. */
  readonly location: string | null
  /** The (already bounded) response body. */
  text(): Promise<string>
}

export type NotificationWebhookRequestFn = (
  url: string,
  init: {
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly body: string | null
  },
  signal: AbortSignal
) => Promise<INotificationWebhookResponse>

export interface INotificationWebhookDependencies {
  readonly request: NotificationWebhookRequestFn
}

/**
 * POST a rule's templated body to its webhook URL. Refuses the URL up front if
 * it is not http/https or carries credentials, a query string or a fragment;
 * follows only https redirects (bounded and loop-guarded); returns `{ ok,
 * status }` on completion or `{ ok: false, reason }` on a guard failure.
 */
export async function runWebhook(
  rule: INotificationAutomationRule,
  entry: NotificationAutomationEntry,
  deps: INotificationWebhookDependencies = defaultWebhookDependencies()
): Promise<INotificationWebhookResult> {
  if (rule.action.type !== 'webhook') {
    return { ok: false, reason: 'The rule does not define a webhook action.' }
  }

  const action = rule.action
  const urlError = validateWebhookUrl(action.url)
  if (urlError !== null) {
    return { ok: false, reason: urlError }
  }

  const body = fillNotificationTemplate(action.bodyTemplate, entry)
  const headers = {
    'Content-Type': looksLikeJson(body)
      ? 'application/json'
      : 'text/plain; charset=utf-8',
    'User-Agent': WebhookUserAgent,
  }

  const controller = new AbortController()
  let current = new URL(action.url)
  const seen = new Set<string>([current.toString()])

  try {
    for (let redirects = 0; ; redirects++) {
      const response = await deps.request(
        current.toString(),
        { method: 'POST', headers, body },
        controller.signal
      )

      if (response.status >= 300 && response.status < 400) {
        if (redirects >= WebhookMaxRedirects) {
          return {
            ok: false,
            status: response.status,
            reason: 'The webhook redirected too many times.',
          }
        }
        if (response.location === null) {
          return {
            ok: false,
            status: response.status,
            reason: 'The webhook redirect did not include a location.',
          }
        }
        const next = safeRedirect(response.location, current)
        if (next === null) {
          return {
            ok: false,
            status: response.status,
            reason: 'The webhook redirected to an unsafe (non-https) location.',
          }
        }
        if (seen.has(next.toString())) {
          return {
            ok: false,
            status: response.status,
            reason: 'The webhook redirect looped.',
          }
        }
        seen.add(next.toString())
        current = next
        continue
      }

      const text = (await response.text()).slice(0, WebhookResultBodyCap)
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        body: text,
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

function safeRedirect(location: string, current: URL): URL | null {
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    return null
  }
  if (
    next.protocol !== 'https:' ||
    next.username !== '' ||
    next.password !== ''
  ) {
    return null
  }
  return next
}

function looksLikeJson(body: string): boolean {
  const trimmed = body.trim()
  const first = trimmed[0]
  if (first !== '{' && first !== '[') {
    return false
  }
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

// --- Command ----------------------------------------------------------------

/** A minimal child-process shape the command runner consumes. */
export interface INotificationCommandChild {
  readonly stdout: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  } | null
  readonly stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  } | null
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}

export interface INotificationCommandDependencies {
  readonly env: Record<string, string>
  readonly platform: NodeJS.Platform
  readonly resolveExecutable: (
    exe: string,
    env: Record<string, string>
  ) => Promise<string>
  readonly spawn: (
    exe: string,
    args: ReadonlyArray<string>,
    options: SpawnOptions
  ) => INotificationCommandChild
}

/**
 * Spawn a rule's command with `shell: false`. Templated argv values are
 * substituted, then every value is re-validated against the batch-spawn
 * allow-list; a value carrying a shell metacharacter causes the run to be
 * refused (never escaped). Returns `{ ok, code }` on completion or
 * `{ ok: false, reason }` when refused or unable to spawn.
 */
export async function runCommand(
  rule: INotificationAutomationRule,
  entry: NotificationAutomationEntry,
  deps: INotificationCommandDependencies = defaultCommandDependencies()
): Promise<INotificationCommandResult> {
  if (rule.action.type !== 'command') {
    return { ok: false, reason: 'The rule does not define a command action.' }
  }

  const action = rule.action
  const args = action.argTemplates.map(template =>
    fillNotificationTemplate(template, entry)
  )

  // SAFETY: refuse any substituted arg that could be reinterpreted by a shell.
  const unsafe = args.find(arg => !SAFE_NOTIFICATION_ARG.test(arg))
  if (unsafe !== undefined) {
    return {
      ok: false,
      reason: `Refusing to run "${action.exe}": the argument "${unsafe}" contains characters that are not allowed.`,
    }
  }

  const resolved = await deps.resolveExecutable(action.exe, deps.env)

  let exe = resolved
  let spawnArgs: ReadonlyArray<string> = args
  let verbatim = false
  if (deps.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const spec = batchSpawnSpec(
      resolved,
      args,
      deps.env.ComSpec ?? deps.env.COMSPEC
    )
    if ('error' in spec) {
      return { ok: false, reason: spec.error }
    }
    exe = spec.exe
    spawnArgs = spec.args
    verbatim = true
  }

  return await new Promise<INotificationCommandResult>(resolve => {
    let child: INotificationCommandChild
    try {
      child = deps.spawn(exe, [...spawnArgs], {
        env: deps.env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
      })
    } catch (err) {
      resolve({
        ok: false,
        code: -1,
        reason: err instanceof Error ? err.message : String(err),
      })
      return
    }

    let output = ''
    const append = (text: string) => {
      output = (output + text).slice(-CommandOutputCap)
    }
    child.stdout?.on('data', chunk => append(chunk.toString('utf8')))
    child.stderr?.on('data', chunk => append(chunk.toString('utf8')))

    let settled = false
    child.on('error', err => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        ok: false,
        code: -1,
        reason: err instanceof Error ? err.message : String(err),
        output,
      })
    })
    child.on('close', code => {
      if (settled) {
        return
      }
      settled = true
      resolve({ ok: code === 0, code: code ?? -1, output })
    })
  })
}

// --- Defaults & IPC ---------------------------------------------------------

let webhookSession: Electron.Session | null = null
function getWebhookSession(): Electron.Session {
  return (webhookSession ??= session.fromPartition(
    `persist:${WebhookPartition}`,
    {
      cache: false,
    }
  ))
}

/**
 * The production webhook transport: `net.request` on an isolated partition with
 * credentials omitted, manual redirects, no referrer, no cache, and a hard
 * response byte cap.
 */
export const createElectronNotificationWebhookRequest =
  (
    requestFactory: (
      options: Electron.ClientRequestConstructorOptions
    ) => Electron.ClientRequest = options => net.request(options)
  ): NotificationWebhookRequestFn =>
  async (url, init, signal) =>
    await new Promise<INotificationWebhookResponse>(
      (resolvePromise, rejectPromise) => {
        if (signal.aborted) {
          rejectPromise(new DOMException('Webhook aborted.', 'AbortError'))
          return
        }
        const request = requestFactory({
          url,
          method: init.method,
          session: getWebhookSession(),
          redirect: 'manual',
          credentials: 'omit',
          useSessionCookies: false,
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        })
        for (const [name, value] of Object.entries(init.headers)) {
          request.setHeader(name, value)
        }

        let settled = false
        const settle = (callback: () => void) => {
          if (!settled) {
            settled = true
            signal.removeEventListener('abort', onAbort)
            callback()
          }
        }
        const onAbort = () => {
          request.abort()
          settle(() =>
            rejectPromise(new DOMException('Webhook aborted.', 'AbortError'))
          )
        }
        signal.addEventListener('abort', onAbort, { once: true })

        request.on('redirect', (statusCode, _method, redirectUrl) => {
          request.abort()
          settle(() =>
            resolvePromise({
              status: statusCode,
              location: typeof redirectUrl === 'string' ? redirectUrl : null,
              text: async () => '',
            })
          )
        })

        request.on('response', response => {
          const chunks = new Array<Buffer>()
          let length = 0
          response.on('data', (chunk: Buffer) => {
            length += chunk.byteLength
            if (length > WebhookResponseByteCap) {
              request.abort()
              const bounded = Buffer.concat(chunks)
              settle(() =>
                resolvePromise({
                  status: response.statusCode,
                  location: null,
                  text: async () => bounded.toString('utf8'),
                })
              )
            } else {
              chunks.push(chunk)
            }
          })
          response.on('end', () =>
            settle(() =>
              resolvePromise({
                status: response.statusCode,
                location: headerValue(response.headers, 'location'),
                text: async () => Buffer.concat(chunks).toString('utf8'),
              })
            )
          )
          response.on('error', error => settle(() => rejectPromise(error)))
        })
        request.on('error', error => settle(() => rejectPromise(error)))

        try {
          if (init.body !== null) {
            request.write(Buffer.from(init.body))
          }
          request.end()
        } catch (error) {
          request.abort()
          settle(() => rejectPromise(error))
        }
      }
    )

function headerValue(
  headers: Record<string, string | string[]>,
  name: string
): string | null {
  const value = headers[name]
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return typeof value === 'string' ? value : null
}

function defaultWebhookDependencies(): INotificationWebhookDependencies {
  return { request: createElectronNotificationWebhookRequest() }
}

function defaultCommandDependencies(): INotificationCommandDependencies {
  return {
    env: process.env as Record<string, string>,
    platform: process.platform,
    resolveExecutable,
    spawn: (exe, args, options) => spawn(exe, [...args], options),
  }
}

/**
 * Register the notification-automation runner IPC. Handlers are dormant until a
 * renderer invokes them, and each re-validates the rule in the main process.
 */
export function registerNotificationAutomationIpc(): void {
  ipcMain.handle(
    'notification-automation-run-webhook',
    async (_event, request) => runWebhook(request.rule, request.entry)
  )
  ipcMain.handle(
    'notification-automation-run-command',
    async (_event, request) => runCommand(request.rule, request.entry)
  )
}
