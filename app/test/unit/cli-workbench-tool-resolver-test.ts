import { describe, it } from 'node:test'
import assert from 'node:assert'
import { resolveGitBinary, resolveGitExecPath } from 'dugite'
import { resolve } from 'path'
import { resolveCLIWorkbenchTool } from '../../src/main-process/cli-workbench/tool-resolver'

describe('CLI workbench tool resolver', () => {
  it('resolves staged Git beside the bundled main process', () => {
    const runtimeDirectory = resolve('staged-app')
    const gitDirectory = resolve(runtimeDirectory, 'git')
    const resolved = resolveCLIWorkbenchTool(
      'git',
      { PATH: 'C:\\system-bin' },
      runtimeDirectory
    )

    assert.equal(resolved.executable, resolveGitBinary(gitDirectory))
    assert.equal(resolved.env.LOCAL_GIT_DIRECTORY, gitDirectory)
    assert.match(resolved.env.GIT_EXEC_PATH ?? '', /git-core$/)
    if (process.platform === 'win32') {
      assert.ok((resolved.env.PATH ?? '').includes(gitDirectory))
    } else {
      assert.equal(resolved.env.PATH, 'C:\\system-bin')
    }
  })

  it('does not let ambient Git paths redirect the staged executable', () => {
    const runtimeDirectory = resolve('staged-app')
    const gitDirectory = resolve(runtimeDirectory, 'git')
    const resolved = resolveCLIWorkbenchTool(
      'git',
      {
        LOCAL_GIT_DIRECTORY: resolve('wrong-git'),
        GIT_EXEC_PATH: resolve('wrong-git-core'),
        GIT_DIR: resolve('wrong-repository'),
        GIT_WORK_TREE: resolve('wrong-worktree'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'alias.pwn',
        GIT_CONFIG_VALUE_0: '!payload',
        GIT_EXTERNAL_DIFF: 'payload',
        GIT_SSH: 'payload',
        GIT_SSH_COMMAND: 'payload --option',
        GIT_PROXY_COMMAND: 'payload',
        GIT_ASKPASS: 'payload',
        SSH_ASKPASS: 'payload',
        GIT_EDITOR: 'payload',
        GIT_SEQUENCE_EDITOR: 'payload',
        PAGER: 'payload',
        GIT_TRACE: 'C:\\private\\trace.log',
        GIT_TRACE2_EVENT: 'C:\\private\\trace2.log',
        GIT_REDIRECT_STDERR: 'C:\\private\\stderr.log',
        GIT_SHALLOW_FILE: 'C:\\private\\shallow',
        GIT_TERMINAL_PROMPT: '1',
        GCM_INTERACTIVE: 'Always',
        GIT_SSL_CAINFO: 'C:\\trusted\\git-ca.pem',
        SSL_CERT_FILE: 'C:\\trusted\\ssl-ca.pem',
        NODE_EXTRA_CA_CERTS: 'C:\\trusted\\node-ca.pem',
      },
      runtimeDirectory
    )

    assert.equal(resolved.executable, resolveGitBinary(gitDirectory))
    assert.equal(resolved.env.LOCAL_GIT_DIRECTORY, gitDirectory)
    assert.equal(resolved.env.GIT_EXEC_PATH, resolveGitExecPath(gitDirectory))
    assert.equal(resolved.env.GIT_DIR, undefined)
    assert.equal(resolved.env.GIT_WORK_TREE, undefined)
    assert.equal(resolved.env.GIT_CONFIG_COUNT, undefined)
    assert.equal(resolved.env.GIT_CONFIG_KEY_0, undefined)
    assert.equal(resolved.env.GIT_CONFIG_VALUE_0, undefined)
    assert.equal(resolved.env.GIT_EXTERNAL_DIFF, undefined)
    assert.equal(resolved.env.GIT_SSH, undefined)
    assert.equal(resolved.env.GIT_SSH_COMMAND, undefined)
    assert.equal(resolved.env.GIT_PROXY_COMMAND, undefined)
    assert.equal(resolved.env.GIT_ASKPASS, undefined)
    assert.equal(resolved.env.SSH_ASKPASS, undefined)
    assert.equal(resolved.env.GIT_EDITOR, undefined)
    assert.equal(resolved.env.GIT_SEQUENCE_EDITOR, undefined)
    assert.equal(resolved.env.PAGER, undefined)
    assert.equal(resolved.env.GIT_TRACE, undefined)
    assert.equal(resolved.env.GIT_TRACE2_EVENT, undefined)
    assert.equal(resolved.env.GIT_REDIRECT_STDERR, undefined)
    assert.equal(resolved.env.GIT_SHALLOW_FILE, undefined)
    assert.equal(resolved.env.GIT_PAGER, '')
    assert.equal(resolved.env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(resolved.env.GCM_INTERACTIVE, 'Never')
    assert.equal(resolved.env.GIT_SSL_CAINFO, 'C:\\trusted\\git-ca.pem')
    assert.equal(resolved.env.SSL_CERT_FILE, 'C:\\trusted\\ssl-ca.pem')
    assert.equal(resolved.env.NODE_EXTRA_CA_CERTS, 'C:\\trusted\\node-ca.pem')
  })

  it('scrubs unsafe Git environment names regardless of casing', () => {
    const runtimeDirectory = resolve('staged-app')
    const gitDirectory = resolve(runtimeDirectory, 'git')
    const resolved = resolveCLIWorkbenchTool(
      'git',
      {
        git_exec_path: resolve('wrong-git-core'),
        git_pager: 'payload',
        git_ssh_command: 'payload --option',
        Git_Config_Key_7: 'alias.pwn',
        gIt_CoNfIg_VaLuE_7: '!payload',
        git_trace2_event: 'C:\\private\\trace.json',
        GiT_RedirECT_STDERR: 'C:\\private\\stderr.log',
        gIt_ShAlLoW_FiLe: 'C:\\private\\shallow',
        git_terminal_prompt: '1',
        gcm_interactive: 'Always',
      },
      runtimeDirectory
    )

    assert.equal(resolved.env.git_exec_path, undefined)
    assert.equal(resolved.env.git_pager, undefined)
    assert.equal(resolved.env.git_ssh_command, undefined)
    assert.equal(resolved.env.Git_Config_Key_7, undefined)
    assert.equal(resolved.env.gIt_CoNfIg_VaLuE_7, undefined)
    assert.equal(resolved.env.git_trace2_event, undefined)
    assert.equal(resolved.env.GiT_RedirECT_STDERR, undefined)
    assert.equal(resolved.env.gIt_ShAlLoW_FiLe, undefined)
    assert.equal(resolved.env.git_terminal_prompt, undefined)
    assert.equal(resolved.env.gcm_interactive, undefined)
    assert.equal(resolved.env.GIT_EXEC_PATH, resolveGitExecPath(gitDirectory))
    assert.equal(resolved.env.GIT_PAGER, '')
    assert.equal(resolved.env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(resolved.env.GCM_INTERACTIVE, 'Never')
  })

  it('keeps GitHub CLI feature detection on the supplied PATH', () => {
    const environment = { PATH: 'C:\\gh-bin' }
    const resolved = resolveCLIWorkbenchTool(
      'gh',
      environment,
      resolve('ignored-runtime')
    )

    assert.equal(resolved.executable, 'gh')
    assert.strictEqual(resolved.env, environment)
  })
})
