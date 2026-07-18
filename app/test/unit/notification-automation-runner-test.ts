import { describe, it } from 'node:test'
import assert from 'node:assert'
import { EventEmitter } from 'events'

import {
  runWebhook,
  runCommand,
  INotificationWebhookResponse,
  NotificationWebhookRequestFn,
  INotificationCommandChild,
  INotificationCommandDependencies,
} from '../../src/main-process/notification-automation-runner'
import {
  INotificationAutomationRule,
  NotificationAutomationEntry,
} from '../../src/lib/notifications/automation/notification-automation'

const entry: NotificationAutomationEntry = {
  id: 'e1',
  kind: 'pr-checks-failed',
  title: 'Checks failed',
  body: 'red',
  createdAt: '2026-07-17T12:00:00.000Z',
  repositoryId: 42,
}

const webhookRule = (
  url: string,
  bodyTemplate = '{"title":"{title}"}'
): INotificationAutomationRule => ({
  id: 'w',
  name: 'Webhook',
  enabled: true,
  kinds: 'all',
  action: { type: 'webhook', url, bodyTemplate },
})

const commandRule = (
  exe: string,
  argTemplates: ReadonlyArray<string>
): INotificationAutomationRule => ({
  id: 'c',
  name: 'Command',
  enabled: true,
  kinds: 'all',
  action: { type: 'command', exe, argTemplates },
})

const response = (
  partial: Partial<INotificationWebhookResponse> & { readonly status: number }
): INotificationWebhookResponse => ({
  location: null,
  text: async () => '',
  ...partial,
})

describe('runWebhook', () => {
  it('POSTs the templated JSON body and reports the status', async () => {
    const seen: Array<{ url: string; init: any }> = []
    const request: NotificationWebhookRequestFn = async (url, init) => {
      seen.push({ url, init })
      return response({ status: 204 })
    }

    const result = await runWebhook(
      webhookRule('https://example.com/hook'),
      entry,
      { request }
    )

    assert.equal(result.ok, true)
    assert.equal(result.status, 204)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, 'https://example.com/hook')
    assert.equal(seen[0].init.method, 'POST')
    assert.equal(seen[0].init.headers['Content-Type'], 'application/json')
    assert.equal(seen[0].init.body, '{"title":"Checks failed"}')
  })

  it('uses text/plain when the body is not JSON', async () => {
    let contentType = ''
    const request: NotificationWebhookRequestFn = async (_url, init) => {
      contentType = init.headers['Content-Type']
      return response({ status: 200 })
    }
    await runWebhook(
      webhookRule('https://example.com/hook', 'plain {title}'),
      entry,
      { request }
    )
    assert.match(contentType, /text\/plain/)
  })

  it('refuses a URL with embedded credentials without calling the transport', async () => {
    let called = false
    const request: NotificationWebhookRequestFn = async () => {
      called = true
      return response({ status: 200 })
    }
    const result = await runWebhook(
      webhookRule('https://user:pass@example.com/hook'),
      entry,
      { request }
    )
    assert.equal(result.ok, false)
    assert.equal(called, false)
  })

  it('refuses a URL with a query string without calling the transport', async () => {
    let called = false
    const request: NotificationWebhookRequestFn = async () => {
      called = true
      return response({ status: 200 })
    }
    const result = await runWebhook(
      webhookRule('https://example.com/hook?secret=1'),
      entry,
      { request }
    )
    assert.equal(result.ok, false)
    assert.equal(called, false)
  })

  it('rejects a redirect to a non-https location', async () => {
    const request: NotificationWebhookRequestFn = async () =>
      response({ status: 302, location: 'http://internal.local/steal' })
    const result = await runWebhook(
      webhookRule('https://example.com/hook'),
      entry,
      { request }
    )
    assert.equal(result.ok, false)
    assert.match(result.reason ?? '', /unsafe/i)
  })

  it('follows an https redirect and loop-guards repeats', async () => {
    const urls: Array<string> = []
    const request: NotificationWebhookRequestFn = async url => {
      urls.push(url)
      if (urls.length === 1) {
        return response({ status: 307, location: 'https://example.com/hook' })
      }
      return response({ status: 307, location: 'https://example.com/hook' })
    }
    const result = await runWebhook(
      webhookRule('https://example.com/start'),
      entry,
      { request }
    )
    assert.equal(result.ok, false)
    assert.match(result.reason ?? '', /loop/i)
  })

  it('caps the response body carried back to the receipt', async () => {
    const request: NotificationWebhookRequestFn = async () =>
      response({ status: 200, text: async () => 'y'.repeat(1_000_000) })
    const result = await runWebhook(
      webhookRule('https://example.com/hook'),
      entry,
      { request }
    )
    assert.equal(result.ok, true)
    assert.ok(
      (result.body?.length ?? 0) <= 4 * 1024,
      'the response snippet must be bounded'
    )
  })
})

/** A fake child process whose exit is driven by the test. */
class FakeChild extends EventEmitter implements INotificationCommandChild {
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
}

function commandDeps(
  overrides: Partial<INotificationCommandDependencies> = {}
): {
  deps: INotificationCommandDependencies
  spawns: Array<{ exe: string; args: ReadonlyArray<string> }>
  child: FakeChild
} {
  const spawns: Array<{ exe: string; args: ReadonlyArray<string> }> = []
  const child = new FakeChild()
  const deps: INotificationCommandDependencies = {
    env: {},
    platform: 'linux',
    resolveExecutable: async exe => exe,
    spawn: (exe, args) => {
      spawns.push({ exe, args })
      return child
    },
    ...overrides,
  }
  return { deps, spawns, child }
}

describe('runCommand', () => {
  it('spawns with substituted argv and reports a clean exit', async () => {
    const { deps, spawns, child } = commandDeps()
    const promise = runCommand(
      commandRule('notify-send', ['--id', 'run-{id}', 'repo-{repositoryId}']),
      entry,
      deps
    )
    // Let the spawn happen, then drive stdout and a clean close.
    await Promise.resolve()
    child.stdout.emit('data', Buffer.from('ok'))
    child.emit('close', 0)

    const result = await promise
    assert.equal(result.ok, true)
    assert.equal(result.code, 0)
    assert.equal(spawns.length, 1)
    assert.deepEqual(spawns[0].args, ['--id', 'run-e1', 'repo-42'])
  })

  it('refuses a metacharacter-bearing arg after substitution (never escapes)', async () => {
    const { deps, spawns } = commandDeps()
    // The title expands to a value containing spaces/metacharacters.
    const hostile = { ...entry, title: 'a; rm -rf /' }
    const result = await runCommand(
      commandRule('notify-send', ['{title}']),
      hostile,
      deps
    )
    assert.equal(result.ok, false)
    assert.equal(spawns.length, 0, 'the run must be refused before spawning')
    assert.match(result.reason ?? '', /not allowed/i)
  })

  it('reports a non-zero exit as a failure', async () => {
    const { deps, child } = commandDeps()
    const promise = runCommand(commandRule('false', []), entry, deps)
    await Promise.resolve()
    child.emit('close', 3)
    const result = await promise
    assert.equal(result.ok, false)
    assert.equal(result.code, 3)
  })

  it('reports a spawn error as a failure', async () => {
    const { deps } = commandDeps({
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    const result = await runCommand(commandRule('missing', []), entry, deps)
    assert.equal(result.ok, false)
    assert.match(result.reason ?? '', /ENOENT/)
  })

  it('refuses a webhook rule and vice versa', async () => {
    const { deps } = commandDeps()
    const result = await runCommand(
      webhookRule('https://example.com/hook'),
      entry,
      deps
    )
    assert.equal(result.ok, false)
  })
})
