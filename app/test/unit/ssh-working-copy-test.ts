import assert from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

import {
  buildSSHWorkingCopyArguments,
  buildSSHWorkingCopyCommand,
  getSSHWorkingCopyCredentialScope,
  getSSHWorkingCopyStorageKey,
  ISSHWorkingCopyDefinition,
  ISSHWorkingCopyStorage,
  loadSSHDockerDeploymentsForPush,
  loadSSHWorkingCopies,
  quotePOSIXShellWord,
  sanitizeSSHWorkingCopyOutput,
  saveSSHWorkingCopies,
  validateSSHCloneSourceUrl,
  validateSSHRemoteDestinationPath,
  validateSSHWorkingCopyDefinition,
} from '../../src/lib/ssh/ssh-working-copy'
import { getSSHUserPasswordAccountKey } from '../../src/lib/ssh/ssh-user-password'

class MemoryStorage implements ISSHWorkingCopyStorage {
  public readonly values = new Map<string, string>()

  public getItem(key: string) {
    return this.values.get(key) ?? null
  }

  public setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  public removeItem(key: string) {
    this.values.delete(key)
  }
}

const definition: ISSHWorkingCopyDefinition = {
  id: '1'.repeat(32),
  label: 'Build host',
  host: 'build.example.test',
  port: 2222,
  user: 'deploy',
  authenticationReference: resolve('fixtures', 'id_ed25519'),
  destinationPath: "/srv/work/project's canonical checkout",
  sourceRemoteName: 'origin',
  deployOnPush: true,
}

describe('SSH working-copy safety boundary', () => {
  it('validates connection metadata and rejects option and path traversal input', () => {
    assert.deepEqual(validateSSHWorkingCopyDefinition(definition), definition)
    assert.throws(
      () =>
        validateSSHWorkingCopyDefinition({
          ...definition,
          host: '-oProxyCommand=malicious',
        }),
      /hostname or OpenSSH config alias/
    )
    assert.throws(
      () => validateSSHRemoteDestinationPath('/srv/work/../admin'),
      /parent segments/
    )
    assert.throws(
      () => validateSSHRemoteDestinationPath('C:\\work\\project'),
      /absolute POSIX path/
    )
    assert.equal(
      validateSSHWorkingCopyDefinition({
        ...definition,
        host: '[2001:db8::10]',
      }).host,
      '2001:db8::10'
    )
  })

  it('quotes every remote-shell value and keeps host verification enabled', () => {
    assert.equal(quotePOSIXShellWord("a'b"), `'a'"'"'b'`)
    const command = buildSSHWorkingCopyCommand(
      definition,
      'clone',
      'ssh://git@example.test/team/project.git'
    )
    assert.match(
      command,
      /destination='\/srv\/work\/project'"'"'s canonical checkout'/
    )
    assert.match(
      command,
      /git clone -- 'ssh:\/\/git@example\.test\/team\/project\.git'/
    )
    assert.match(command, /test|\[ -e/)

    const renamedRemoteCommand = buildSSHWorkingCopyCommand(
      { ...definition, sourceRemoteName: 'upstream' },
      'clone',
      'ssh://git@example.test/team/project.git'
    )
    assert.match(renamedRemoteCommand, /remote='upstream'/)
    assert.match(renamedRemoteCommand, /remote rename origin "\$remote"/)

    const args = buildSSHWorkingCopyArguments(definition, 'status')
    assert.deepEqual(args.slice(-3, -1), ['--', definition.host])
    assert.ok(args.includes('ForwardAgent=no'))
    assert.ok(args.includes('ClearAllForwardings=yes'))
    assert.ok(args.includes('ControlMaster=no'))
    assert.ok(args.includes('ConnectTimeout=15'))
    assert.equal(
      args.some(value => /StrictHostKeyChecking/i.test(value)),
      false
    )
    assert.equal(
      args.some(value => /UserKnownHostsFile/i.test(value)),
      false
    )
    assert.equal(
      args.some(value => /ProxyCommand/i.test(value)),
      false
    )
  })

  it('fast-forwards the exact pushed branch before a bounded Docker Compose deployment', () => {
    const sourceUrl = 'ssh://git@example.test/team/project.git'
    const command = buildSSHWorkingCopyCommand(
      definition,
      'deploy',
      sourceUrl,
      'feature/docker-deploy'
    )

    assert.match(command, /symbolic-ref --quiet --short HEAD/)
    assert.match(command, /remote get-url -- "\$remote"/)
    assert.match(
      command,
      /source='ssh:\/\/git@example\.test\/team\/project\.git'/
    )
    assert.match(command, /"\$actual_source" != "\$source"/)
    assert.match(command, /check-ref-format --branch "\$expected"/)
    assert.match(command, /"\$branch" != "\$expected"/)
    assert.match(
      command,
      /fetch --prune -- "\$remote" "\+refs\/heads\/\$branch:\$remote_ref"/
    )
    assert.match(command, /merge-base --is-ancestor HEAD "\$remote_ref"/)
    assert.match(command, /merge --ff-only --/)
    assert.match(command, /"\$head" != "\$remote_head"/)
    assert.match(command, /docker compose up --detach --build/)
    assert.ok(
      command.indexOf('merge-base --is-ancestor') <
        command.indexOf('docker compose')
    )
    assert.ok(
      command.indexOf('"$head" != "$remote_head"') <
        command.indexOf('docker compose')
    )
    assert.doesNotMatch(
      command,
      /\bgit(?:\s+-C\s+"\$destination")?\s+(?:reset|checkout)\b|--force\b/
    )

    assert.throws(
      () =>
        buildSSHWorkingCopyCommand(
          definition,
          'deploy',
          sourceUrl,
          'main\nmalicious'
        ),
      /not safe to deploy/
    )
    assert.throws(
      () =>
        buildSSHWorkingCopyCommand(
          { ...definition, sourceRemoteName: null },
          'deploy'
        ),
      /source remote/
    )
    assert.throws(
      () => buildSSHWorkingCopyCommand(definition, 'deploy'),
      /credential-free source remote URL/
    )
    assert.throws(
      () =>
        buildSSHWorkingCopyCommand(
          definition,
          'deploy',
          'https://user:secret@example.test/team/project.git',
          'main'
        ),
      /without embedded credentials/
    )
  })

  it('accepts credential-free network remotes and rejects embedded secrets', () => {
    assert.equal(
      validateSSHCloneSourceUrl('git@example.test:team/project.git'),
      'git@example.test:team/project.git'
    )
    assert.equal(
      validateSSHCloneSourceUrl('ssh://git@example.test/team/project.git'),
      'ssh://git@example.test/team/project.git'
    )
    assert.throws(
      () =>
        validateSSHCloneSourceUrl(
          'https://user:secret@example.test/team/project.git'
        ),
      /without embedded credentials/
    )
    assert.throws(
      () =>
        validateSSHCloneSourceUrl(
          'https://example.test/team/project.git?token=secret'
        ),
      /without embedded credentials/
    )
    assert.throws(
      () => validateSSHCloneSourceUrl('/tmp/repository'),
      /must use/
    )
    assert.throws(
      () => validateSSHCloneSourceUrl('file:///etc/shadow'),
      /must use HTTPS, SSH, or Git/
    )
  })

  it('persists only the exact non-secret schema and fails closed on extra keys', () => {
    const storage = new MemoryStorage()
    const repositoryPath = resolve('repositories', 'project')
    saveSSHWorkingCopies(repositoryPath, [definition], storage)
    assert.deepEqual(loadSSHWorkingCopies(repositoryPath, storage), [
      definition,
    ])

    const key = getSSHWorkingCopyStorageKey(repositoryPath)
    const serialized = storage.getItem(key) ?? ''
    assert.doesNotMatch(serialized, /password|passphrase|privateKey|sourceUrl/i)
    assert.doesNotMatch(serialized, /ssh:\/\//)

    const parsed = JSON.parse(serialized)
    parsed.definitions[0].password = 'must-not-load'
    storage.setItem(key, JSON.stringify(parsed))
    assert.deepEqual(loadSSHWorkingCopies(repositoryPath, storage), [])
  })

  it('selects only enabled Docker targets following the pushed remote', () => {
    const storage = new MemoryStorage()
    const repositoryPath = resolve('repositories', 'deploy-project')
    const disabled = {
      ...definition,
      id: '2'.repeat(32),
      deployOnPush: false,
    }
    const otherRemote = {
      ...definition,
      id: '3'.repeat(32),
      sourceRemoteName: 'upstream',
    }
    saveSSHWorkingCopies(
      repositoryPath,
      [definition, disabled, otherRemote],
      storage
    )

    assert.deepEqual(
      loadSSHDockerDeploymentsForPush(repositoryPath, 'origin', storage),
      [definition]
    )
    assert.deepEqual(
      loadSSHDockerDeploymentsForPush(repositoryPath, 'missing', storage),
      []
    )
  })

  it('isolates remembered passwords by user, host, and port', () => {
    const scope = getSSHWorkingCopyCredentialScope(definition)
    assert.match(scope, /^ssh-working-copy:[a-f0-9]{64}$/)
    assert.notEqual(
      scope,
      getSSHWorkingCopyCredentialScope({ ...definition, port: 22 })
    )
    assert.notEqual(
      scope,
      getSSHWorkingCopyCredentialScope({ ...definition, user: 'other' })
    )
    assert.equal(
      scope,
      getSSHWorkingCopyCredentialScope({
        ...definition,
        host: definition.host.toUpperCase(),
      })
    )
    const account = getSSHUserPasswordAccountKey(
      'deploy@resolved.example.test',
      scope
    )
    assert.match(account, /^ssh-working-copy:[a-f0-9]{64}:[a-f0-9]{64}$/)
    assert.notEqual(
      account,
      getSSHUserPasswordAccountKey('other@resolved.example.test', scope)
    )
    assert.equal(
      getSSHUserPasswordAccountKey('legacy@example.test'),
      'legacy@example.test'
    )
  })

  it('redacts credential-shaped output before presentation', () => {
    const output = sanitizeSSHWorkingCopyOutput(
      'https://user:secret@example.test/repo password=hunter2 Bearer abc.def.ghi ghp_abcdefghijklmnopqrstuvwxyz'
    )
    assert.doesNotMatch(output, /secret|hunter2|abc\.def\.ghi|ghp_/)
    assert.match(output, /\[redacted\]/)
  })
})
