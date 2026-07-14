import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CLICommandOutputLimiter,
  validateCLICommandRequest,
} from '../../src/main-process/cli-workbench/runner-helpers'

describe('CLI workbench runner helpers', () => {
  it('accepts only normalized git/gh argv in an existing absolute cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'desktop-cli-runner-'))
    try {
      assert.deepEqual(
        await validateCLICommandRequest({
          id: 'run-1',
          tool: 'git',
          args: ['status', '--short'],
          cwd,
        }),
        {
          id: 'run-1',
          tool: 'git',
          args: ['status', '--short'],
          cwd,
          confirmed: false,
        }
      )
      await assert.rejects(
        validateCLICommandRequest({
          id: 'run-2',
          tool: 'powershell',
          args: ['-Command', 'echo unsafe'],
          cwd,
        }),
        /tool is invalid/
      )
      await assert.rejects(
        validateCLICommandRequest({
          id: 'run-3',
          tool: 'git',
          args: ['status\0--short'],
          cwd,
        }),
        /arguments are invalid/
      )
      await assert.rejects(
        validateCLICommandRequest({
          id: 'run-4',
          tool: 'gh',
          args: ['status'],
          cwd: join(cwd, 'missing'),
        }),
        /does not exist/
      )
      await assert.rejects(
        validateCLICommandRequest({
          id: 'run-relative',
          tool: 'git',
          args: ['status'],
          cwd: '.',
        }),
        /working directory is invalid/
      )
      await assert.rejects(
        validateCLICommandRequest({
          id: 'run-large',
          tool: 'git',
          args: ['status', 'x'.repeat(31 * 1024)],
          cwd,
        }),
        /arguments are too large/
      )
      await assert.rejects(
        validateCLICommandRequest({
          id: 'run-secret',
          tool: 'gh',
          args: ['auth', 'status', '--show-token'],
          cwd,
        }),
        /cannot display stored authentication tokens/
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('enforces destructive confirmation again at the main-process boundary', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'desktop-cli-runner-'))
    try {
      const request = {
        id: 'run-destructive',
        tool: 'git',
        args: ['clean', '-fd'],
        cwd,
      } as const
      await assert.rejects(
        validateCLICommandRequest(request),
        /requires confirmation/
      )
      assert.equal(
        (
          await validateCLICommandRequest({
            ...request,
            confirmed: true,
          })
        ).confirmed,
        true
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('caps combined output and preserves split UTF-8 code points', () => {
    const utf8 = new CLICommandOutputLimiter(10)
    assert.equal(utf8.write('stdout', Buffer.from([0xe2])).data, '')
    assert.equal(utf8.write('stdout', Buffer.from([0x82, 0xac])).data, '€')

    const bounded = new CLICommandOutputLimiter(4)
    assert.deepEqual(bounded.write('stdout', Buffer.from('abc')), {
      data: 'abc',
      didTruncate: false,
    })
    assert.deepEqual(bounded.write('stderr', Buffer.from('def')), {
      data: 'd',
      didTruncate: true,
    })
    assert.deepEqual(bounded.write('stdout', Buffer.from('more')), {
      data: '',
      didTruncate: false,
    })
  })
})
