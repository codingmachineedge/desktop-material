import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  fillNotificationTemplate,
  matchNotificationRule,
  parseNotificationAutomationConfig,
  serializeNotificationAutomationConfig,
  validateWebhookUrl,
  validateCommandTemplate,
  NotificationTemplateMaxLength,
  INotificationAutomationRule,
  NotificationAutomationEntry,
} from '../../src/lib/notifications/automation/notification-automation'

const entry = (
  overrides: Partial<NotificationAutomationEntry> = {}
): NotificationAutomationEntry => ({
  id: 'entry-1',
  kind: 'pr-checks-failed',
  title: 'Checks failed on main',
  body: 'The build is red.',
  createdAt: '2026-07-17T12:00:00.000Z',
  repositoryId: 42,
  ...overrides,
})

const webhookRule = (
  overrides: Partial<INotificationAutomationRule> = {}
): INotificationAutomationRule => ({
  id: 'rule-1',
  name: 'Ping ops',
  enabled: false,
  kinds: 'all',
  action: {
    type: 'webhook',
    url: 'https://example.com/hook',
    bodyTemplate: '{}',
  },
  ...overrides,
})

describe('fillNotificationTemplate', () => {
  it('substitutes every supported placeholder', () => {
    const filled = fillNotificationTemplate(
      '{id}|{kind}|{title}|{body}|{repositoryId}|{createdAt}',
      entry()
    )
    assert.equal(
      filled,
      'entry-1|pr-checks-failed|Checks failed on main|The build is red.|42|2026-07-17T12:00:00.000Z'
    )
  })

  it('leaves unresolved {repo}/{owner} tokens verbatim', () => {
    assert.equal(
      fillNotificationTemplate('{owner}/{repo}#{id}', entry()),
      '{owner}/{repo}#entry-1'
    )
  })

  it('renders a missing repositoryId as an empty string', () => {
    assert.equal(
      fillNotificationTemplate(
        '[{repositoryId}]',
        entry({ repositoryId: undefined })
      ),
      '[]'
    )
  })

  it('bounds the filled output', () => {
    const filled = fillNotificationTemplate(
      '{body}',
      entry({ body: 'x'.repeat(NotificationTemplateMaxLength * 2) })
    )
    assert.equal(filled.length, NotificationTemplateMaxLength)
  })
})

describe('matchNotificationRule', () => {
  it("matches kind 'all'", () => {
    assert.equal(
      matchNotificationRule(webhookRule({ kinds: 'all' }), entry()),
      true
    )
  })

  it('matches a listed kind and rejects an unlisted one', () => {
    assert.equal(
      matchNotificationRule(
        webhookRule({ kinds: ['pr-checks-failed'] }),
        entry()
      ),
      true
    )
    assert.equal(
      matchNotificationRule(webhookRule({ kinds: ['pr-comment'] }), entry()),
      false
    )
  })

  it('treats an undefined repositoryId as any repository', () => {
    assert.equal(
      matchNotificationRule(webhookRule({ repositoryId: undefined }), entry()),
      true
    )
  })

  it('requires an exact repositoryId when set', () => {
    assert.equal(
      matchNotificationRule(webhookRule({ repositoryId: 42 }), entry()),
      true
    )
    assert.equal(
      matchNotificationRule(webhookRule({ repositoryId: 7 }), entry()),
      false
    )
  })

  it('matches a title via regex and a plain substring', () => {
    assert.equal(
      matchNotificationRule(webhookRule({ titlePattern: '^Checks' }), entry()),
      true
    )
    assert.equal(
      matchNotificationRule(
        webhookRule({ titlePattern: 'failed on' }),
        entry()
      ),
      true
    )
    assert.equal(
      matchNotificationRule(webhookRule({ titlePattern: 'passed' }), entry()),
      false
    )
  })

  it('never matches an invalid title pattern', () => {
    assert.equal(
      matchNotificationRule(webhookRule({ titlePattern: '(' }), entry()),
      false
    )
  })
})

describe('parseNotificationAutomationConfig', () => {
  it('returns an empty config for non-JSON', () => {
    assert.deepEqual(parseNotificationAutomationConfig('not json'), {
      version: 1,
      rules: [],
    })
  })

  it('returns an empty config for the wrong version', () => {
    assert.deepEqual(
      parseNotificationAutomationConfig(
        JSON.stringify({ version: 2, rules: [webhookRule()] })
      ),
      { version: 1, rules: [] }
    )
  })

  it('drops malformed rules but keeps valid ones', () => {
    const text = JSON.stringify({
      version: 1,
      rules: [
        {
          id: 'ok',
          name: 'Ok',
          kinds: 'all',
          action: { type: 'command', exe: 'echo', argTemplates: ['hi'] },
        },
        { id: 'no-action', name: 'Bad', kinds: 'all' },
        {
          name: 'no-id',
          kinds: 'all',
          action: { type: 'webhook', url: 'https://x', bodyTemplate: '' },
        },
        'nonsense',
      ],
    })
    const parsed = parseNotificationAutomationConfig(text)
    assert.equal(parsed.rules.length, 1)
    assert.equal(parsed.rules[0].id, 'ok')
  })

  it('clamps enabled to false on load (untrusted-on-load)', () => {
    const text = JSON.stringify({
      version: 1,
      rules: [
        {
          id: 'armed-on-disk',
          name: 'Armed',
          enabled: true,
          kinds: 'all',
          action: { type: 'webhook', url: 'https://x', bodyTemplate: '' },
        },
      ],
    })
    const parsed = parseNotificationAutomationConfig(text)
    assert.equal(parsed.rules.length, 1)
    assert.equal(
      parsed.rules[0].enabled,
      false,
      'a rule persisted as enabled must load disarmed'
    )
  })

  it('filters unknown kinds out of a kinds array', () => {
    const text = JSON.stringify({
      version: 1,
      rules: [
        {
          id: 'k',
          name: 'K',
          kinds: ['pr-comment', 'not-a-kind', 'auto-pull'],
          action: { type: 'command', exe: 'echo', argTemplates: [] },
        },
      ],
    })
    const parsed = parseNotificationAutomationConfig(text)
    assert.deepEqual(parsed.rules[0].kinds, ['pr-comment', 'auto-pull'])
  })

  it('round-trips through serialize/parse (re-clamping enabled)', () => {
    const config = {
      version: 1 as const,
      rules: [webhookRule({ enabled: true, name: 'Round trip' })],
    }
    const parsed = parseNotificationAutomationConfig(
      serializeNotificationAutomationConfig(config)
    )
    assert.equal(parsed.rules.length, 1)
    assert.equal(parsed.rules[0].name, 'Round trip')
    assert.equal(parsed.rules[0].enabled, false)
  })
})

describe('validateWebhookUrl', () => {
  it('accepts a clean https URL', () => {
    assert.equal(validateWebhookUrl('https://example.com/hook'), null)
  })

  it('accepts a clean http URL', () => {
    assert.equal(validateWebhookUrl('http://example.com/hook'), null)
  })

  it('rejects a non-http(s) scheme', () => {
    assert.notEqual(validateWebhookUrl('file:///etc/passwd'), null)
    assert.notEqual(validateWebhookUrl('ftp://example.com/x'), null)
  })

  it('rejects embedded credentials', () => {
    assert.notEqual(
      validateWebhookUrl('https://user:pass@example.com/hook'),
      null
    )
  })

  it('rejects a query string or fragment', () => {
    assert.notEqual(
      validateWebhookUrl('https://example.com/hook?token=abc'),
      null
    )
    assert.notEqual(validateWebhookUrl('https://example.com/hook#frag'), null)
  })

  it('rejects an empty or unparseable URL', () => {
    assert.notEqual(validateWebhookUrl(''), null)
    assert.notEqual(validateWebhookUrl('::::'), null)
  })
})

describe('validateCommandTemplate', () => {
  it('accepts a clean exe with placeholder-bearing args', () => {
    assert.equal(
      validateCommandTemplate('notify-send', ['--title', '{title}', 'id-{id}']),
      null
    )
  })

  it('rejects an empty exe', () => {
    assert.notEqual(validateCommandTemplate('', ['x']), null)
  })

  it('rejects an exe with shell metacharacters', () => {
    assert.notEqual(validateCommandTemplate('rm & echo', ['x']), null)
  })

  it('rejects a static arg part with disallowed characters', () => {
    // A space or shell metacharacter in the STATIC portion is refused up front.
    assert.notEqual(validateCommandTemplate('echo', ['hello world']), null)
    assert.notEqual(validateCommandTemplate('echo', ['$(whoami)']), null)
    assert.notEqual(validateCommandTemplate('echo', ['a|b']), null)
  })

  it('rejects an unknown {token} because its braces are not allowed', () => {
    assert.notEqual(validateCommandTemplate('echo', ['{unknownToken}']), null)
  })
})
