/* eslint-disable no-sync */

import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  ArchiveCommandRunner,
  createWindowsPortableZip,
} from './windows-portable-zip'

function withFixture(run: (root: string, source: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'desktop-material-portable-zip-'))
  const source = join(root, 'GitHubDesktop-win32-x64')
  mkdirSync(join(source, 'resources', 'nested'), { recursive: true })
  writeFileSync(join(source, 'GitHubDesktop.exe'), 'portable executable')
  writeFileSync(join(source, 'resources', 'nested', 'app.txt'), 'nested asset')

  try {
    run(root, source)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('Windows portable ZIP packaging', () => {
  it(
    'streams a valid archive containing the complete packaged tree',
    { skip: process.platform !== 'win32' },
    () => {
      withFixture((root, source) => {
        const destination = join(root, 'GitHub Desktop-x64.zip')
        const result = createWindowsPortableZip(source, destination)

        assert.equal(result, destination)
        assert.equal(existsSync(`${destination}.partial.zip`), false)
        const tar = join(process.env.SystemRoot!, 'System32', 'tar.exe')
        const entries = execFileSync(tar, ['-t', '-f', destination], {
          encoding: 'utf8',
          windowsHide: true,
        }).replace(/\\/g, '/')
        assert.match(entries, /GitHubDesktop-win32-x64\/GitHubDesktop\.exe/)
        assert.match(
          entries,
          /GitHubDesktop-win32-x64\/resources\/nested\/app\.txt/
        )

        const extracted = join(root, 'extracted')
        mkdirSync(extracted)
        execFileSync(tar, ['-x', '-f', destination, '-C', extracted], {
          stdio: 'ignore',
          windowsHide: true,
        })
        assert.equal(
          readFileSync(
            join(
              extracted,
              'GitHubDesktop-win32-x64',
              'resources',
              'nested',
              'app.txt'
            ),
            'utf8'
          ),
          'nested asset'
        )
      })
    }
  )

  it('uses an atomic temporary ZIP and removes it when tar fails', () => {
    withFixture((root, source) => {
      const destination = join(root, 'GitHub Desktop-x64.zip')
      writeFileSync(destination, 'stale archive')
      const calls: Array<ReadonlyArray<string>> = []
      const failingRunner: ArchiveCommandRunner = (_file, arguments_) => {
        calls.push(arguments_)
        throw new Error('synthetic tar failure')
      }

      assert.throws(
        () =>
          createWindowsPortableZip(source, destination, {
            tarExecutable: 'tar-test.exe',
            runCommand: failingRunner,
          }),
        /synthetic tar failure/
      )
      assert.deepEqual(calls, [
        [
          '-c',
          '-a',
          '-f',
          `${destination}.partial.zip`,
          '-C',
          root,
          'GitHubDesktop-win32-x64',
        ],
      ])
      assert.equal(existsSync(destination), false)
      assert.equal(existsSync(`${destination}.partial.zip`), false)
    })
  })

  it('rejects an archive destination inside the packaged tree', () => {
    withFixture((_root, source) => {
      assert.throws(
        () =>
          createWindowsPortableZip(source, join(source, 'recursive.zip'), {
            tarExecutable: 'tar-test.exe',
            runCommand: () => undefined,
          }),
        /outside its source tree/
      )
    })
  })
})
