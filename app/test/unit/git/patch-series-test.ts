import { execFileSync } from 'child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  prepareRepositoryPatchExport,
  prepareRepositoryPatchImport,
} from '../../../src/ui/repository-tools'

function git(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

function configureIdentity(repositoryPath: string) {
  git(repositoryPath, ['config', 'user.name', 'Patch Series Test'])
  git(repositoryPath, ['config', 'user.email', 'patches@example.invalid'])
  git(repositoryPath, ['config', 'commit.gpgsign', 'false'])
}

describe('Git patch-series exchange', () => {
  it('exports commits ahead of upstream and applies them in reviewed order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-patch-series-'))
    const source = join(root, 'source')
    const target = join(root, 'target')
    const destination = join(root, 'review-series')
    try {
      git(root, ['init', '--initial-branch=main', source])
      configureIdentity(source)
      await writeFile(join(source, 'base.txt'), 'base\n')
      git(source, ['add', 'base.txt'])
      git(source, ['commit', '-m', 'base'])
      git(source, ['checkout', '-b', 'feature'])
      await writeFile(join(source, 'feature.txt'), 'feature\n')
      git(source, ['add', 'feature.txt'])
      git(source, ['commit', '-m', 'add feature'])
      git(source, ['branch', '--set-upstream-to=main', 'feature'])

      const exportRequest = prepareRepositoryPatchExport(source, destination)
      git(source, exportRequest.args)
      const patchNames = (await readdir(exportRequest.destination)).filter(
        name => name.endsWith('.patch')
      )
      assert.equal(patchNames.length, 1)
      const patchPath = join(exportRequest.destination, patchNames[0])
      assert.match(
        await readFile(patchPath, 'utf8'),
        /Subject: \[PATCH 1\/1\] add feature/
      )

      git(root, ['clone', '--branch', 'main', source, target])
      configureIdentity(target)
      const importRequest = prepareRepositoryPatchImport([patchPath])
      git(target, importRequest.args)
      assert.equal(
        (await readFile(join(target, 'feature.txt'), 'utf8')).replace(
          /\r\n/g,
          '\n'
        ),
        'feature\n'
      )
      assert.equal(
        git(target, ['log', '-1', '--format=%s']).trim(),
        'add feature'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
