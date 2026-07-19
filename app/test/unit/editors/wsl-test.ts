import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  decodeWslOutput,
  getWslDistributions,
  getWslEditorArguments,
  parseWslUNCPath,
  resolveWslPath,
  WslRunner,
} from '../../../src/lib/editors/wsl'
import { ExternalEditorError } from '../../../src/lib/editors/shared'
import { getExternalEditorDisplayName } from '../../../src/lib/editors/display-name'

describe('WSL editor integration', () => {
  it('localizes WSL labels without changing ordinary editor identities', () => {
    const editor = 'Visual Studio Code — WSL: Ubuntu'
    assert.equal(
      getExternalEditorDisplayName(editor, 'english'),
      'Visual Studio Code — WSL: Ubuntu'
    )
    assert.equal(
      getExternalEditorDisplayName(editor, 'cantonese'),
      'Visual Studio Code — WSL：Ubuntu'
    )
    assert.equal(
      getExternalEditorDisplayName(editor, 'bilingual'),
      'Visual Studio Code — WSL: Ubuntu · Visual Studio Code — WSL：Ubuntu'
    )
    assert.equal(
      getExternalEditorDisplayName('Visual Studio Code', 'cantonese'),
      'Visual Studio Code'
    )
  })

  it('decodes UTF-8 and redirected UTF-16LE output', () => {
    assert.equal(decodeWslOutput(Buffer.from('Ubuntu\n')), 'Ubuntu\n')
    assert.equal(
      decodeWslOutput(Buffer.from('\uFEFFUbuntu\r\n', 'utf16le')),
      'Ubuntu\r\n'
    )
  })

  it('discovers bounded unique printable distribution names', async () => {
    const runner: WslRunner = async () =>
      Buffer.from('Ubuntu\r\nDebian\r\nubuntu\r\nBad\0Name\r\n', 'utf16le')

    assert.deepEqual(await getWslDistributions(runner), ['Ubuntu', 'Debian'])
  })

  it('maps matching WSL UNC shares without a process', () => {
    assert.equal(
      parseWslUNCPath('\\\\wsl.localhost\\Ubuntu\\home\\octo\\repo', 'ubuntu'),
      '/home/octo/repo'
    )
    assert.throws(
      () => parseWslUNCPath('\\\\wsl$\\Debian\\home\\repo', 'Ubuntu'),
      ExternalEditorError
    )
  })

  it('translates Windows paths with reviewed, positional WSL arguments', async () => {
    let args: ReadonlyArray<string> = []
    const runner: WslRunner = async current => {
      args = current
      return Buffer.from('/mnt/c/work/repo\n')
    }

    assert.equal(
      await resolveWslPath('C:\\work\\repo', 'Ubuntu', runner),
      '/mnt/c/work/repo'
    )
    assert.deepEqual(args, [
      '--distribution',
      'Ubuntu',
      '--exec',
      'wslpath',
      '-a',
      '-u',
      'C:\\work\\repo',
    ])
    assert.deepEqual(getWslEditorArguments('Ubuntu', '/mnt/c/work/repo'), [
      '--remote',
      'wsl+Ubuntu',
      '/mnt/c/work/repo',
    ])
  })

  it('rejects unsafe names and malformed translated paths', async () => {
    await assert.rejects(
      resolveWslPath('C:\\repo', 'Bad\nDistro', async () => Buffer.from('/x')),
      ExternalEditorError
    )
    await assert.rejects(
      resolveWslPath('C:\\repo', 'Ubuntu', async () =>
        Buffer.from('relative/path\n')
      ),
      ExternalEditorError
    )
  })
})
