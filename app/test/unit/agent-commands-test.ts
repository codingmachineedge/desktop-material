import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  AgentToolDefinitions,
  assertSafeAgentArgs,
  isAgentCommandName,
  redactAgentValue,
} from '../../src/lib/agent-commands'

describe('agent command contract', () => {
  it('has unique names and object input schemas', () => {
    const names = AgentToolDefinitions.map(x => x.name)
    assert.equal(new Set(names).size, names.length)
    assert.ok(AgentToolDefinitions.every(x => x.inputSchema.type === 'object'))
    assert.equal(isAgentCommandName('push'), true)
    assert.equal(isAgentCommandName('delete-everything'), false)
  })

  it('redacts credential-shaped properties recursively', () => {
    assert.deepEqual(
      redactAgentValue({
        login: 'octocat',
        token: 'never-leak',
        nested: { api_key: 'never-leak-either', value: 42 },
      }),
      {
        login: 'octocat',
        token: '[redacted]',
        nested: { api_key: '[redacted]', value: 42 },
      }
    )

    const text = redactAgentValue(
      'Bearer abc.def https://user:pass@example.test ' + 'a'.repeat(64)
    )
    assert.equal(String(text).includes('abc.def'), false)
    assert.equal(String(text).includes('user:pass'), false)
    assert.equal(String(text).includes('a'.repeat(64)), false)
  })

  it('rejects credentials and excessive argument nesting', () => {
    assert.throws(() => assertSafeAgentArgs({ authorization: 'Bearer x' }))

    let value: unknown = 'leaf'
    for (let i = 0; i < 10; i++) {
      value = { child: value }
    }
    assert.throws(() => assertSafeAgentArgs(value))
  })
})
