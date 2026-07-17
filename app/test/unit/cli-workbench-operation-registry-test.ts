import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { CLIWorkbenchOperation } from '../../src/lib/cli-workbench'
import { resolveCLIWorkbenchOperation } from '../../src/main-process/cli-workbench/operation-registry'

async function createFixture(): Promise<{
  readonly root: string
  readonly repositoryPath: string
  readonly exportDirectory: string
  readonly bundlePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-operation-registry-'))
  const repositoryPath = join(root, 'repository')
  const exportDirectory = join(root, 'exports')
  const bundlePath = join(exportDirectory, 'source.bundle')
  await mkdir(join(repositoryPath, '.git'), { recursive: true })
  await mkdir(exportDirectory, { recursive: true })
  await writeFile(bundlePath, 'fixture')
  return { root, repositoryPath, exportDirectory, bundlePath }
}

describe('CLI workbench operation registry', () => {
  it('owns every fixed repository-tool argv recipe', async () => {
    const fixture = await createFixture()
    try {
      const expected = new Map<string, ReadonlyArray<string>>([
        ['status-summary', ['status', '--short', '--branch']],
        ['repository-health', ['fsck', '--full']],
        [
          'signature-audit',
          ['log', '--format=%h%x09%G?%x09%GS%x09%s', '--show-signature', '-50'],
        ],
        ['maintenance-preview', ['count-objects', '-vH']],
        ['maintenance-run', ['maintenance', 'run']],
        ['reflog-view', ['reflog', 'show', '--date=local', '-50']],
        [
          'branch-overview',
          [
            'branch',
            '--list',
            '--verbose',
            '--verbose',
            '--sort=-committerdate',
          ],
        ],
        [
          'contributor-summary',
          ['shortlog', '--summary', '--numbered', 'HEAD'],
        ],
        [
          'version-describe',
          ['describe', '--tags', '--always', '--long', '--dirty'],
        ],
        ['whitespace-audit', ['diff', '--check', 'HEAD']],
        [
          'ignored-files-view',
          [
            'ls-files',
            '--others',
            '--ignored',
            '--exclude-standard',
            '--directory',
          ],
        ],
        ['merged-branch-audit', ['branch', '--list', '--verbose', '--merged']],
        ['prune-preview', ['prune', '--dry-run', '--verbose']],
        ['clean-preview', ['clean', '--dry-run', '-d']],
        ['clean-run', ['clean', '--force', '-d']],
        [
          'unreachable-commits',
          ['fsck', '--unreachable', '--no-reflogs', '--no-progress'],
        ],
        ['notes-view', ['log', '--notes', '--format=%h %s%n%N', '-50']],
      ])

      for (const [id, args] of expected) {
        const result = await resolveCLIWorkbenchOperation(
          { id },
          fixture.repositoryPath
        )
        assert.equal(result.tool, 'git')
        assert.deepEqual(result.args, args)
        assert.equal(result.operation.id, id)
        assert.equal(
          result.requiresConfirmation,
          id === 'maintenance-run' || id === 'clean-run'
        )
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('constructs bounded export, bundle, and history recipes', async () => {
    const fixture = await createFixture()
    try {
      const oid = 'a'.repeat(40)
      const cases: ReadonlyArray<
        readonly [CLIWorkbenchOperation, ReadonlyArray<string>, boolean]
      > = [
        [
          {
            id: 'archive-export',
            format: 'zip',
            destination: join(fixture.exportDirectory, 'source'),
          },
          [
            'archive',
            '--format=zip',
            `--output=${join(fixture.exportDirectory, 'source.zip')}`,
            'HEAD',
          ],
          true,
        ],
        [
          {
            id: 'bundle-export',
            destination: join(fixture.exportDirectory, 'history'),
          },
          [
            'bundle',
            'create',
            join(fixture.exportDirectory, 'history.bundle'),
            '--all',
          ],
          true,
        ],
        [
          { id: 'bundle-verify', bundlePath: fixture.bundlePath },
          ['bundle', 'verify', fixture.bundlePath],
          false,
        ],
        [
          { id: 'bundle-list-heads', bundlePath: fixture.bundlePath },
          ['bundle', 'list-heads', fixture.bundlePath],
          false,
        ],
        [
          {
            id: 'bundle-import-validate-destination',
            branchName: 'imported/main',
          },
          ['check-ref-format', '--branch', 'imported/main'],
          false,
        ],
        [
          {
            id: 'bundle-import-check-destination',
            branchName: 'imported/main',
          },
          ['show-ref', '--verify', '--quiet', 'refs/heads/imported/main'],
          false,
        ],
        [
          {
            id: 'bundle-import-fetch-objects',
            bundlePath: fixture.bundlePath,
            sourceRef: 'refs/heads/main',
          },
          [
            'fetch',
            '--no-write-fetch-head',
            '--no-tags',
            '--no-auto-maintenance',
            fixture.bundlePath,
            'refs/heads/main',
          ],
          true,
        ],
        [
          { id: 'bundle-import-validate-commit', oid },
          ['cat-file', '-e', `${oid}^{commit}`],
          false,
        ],
        [
          {
            id: 'bundle-import-create-branch',
            branchName: 'imported/main',
            oid,
          },
          ['branch', '--no-track', '--', 'imported/main', oid],
          true,
        ],
        [
          { id: 'shallow-history-status' },
          ['rev-parse', '--is-shallow-repository'],
          false,
        ],
        [{ id: 'fetch-remote-list' }, ['remote'], false],
        [
          { id: 'history-deepen', remote: 'origin', deepenBy: 75 },
          [
            'fetch',
            '--no-auto-maintenance',
            '--no-recurse-submodules',
            '--no-write-fetch-head',
            '--deepen=75',
            '--',
            'origin',
          ],
          true,
        ],
        [
          { id: 'history-unshallow', remote: 'upstream' },
          [
            'fetch',
            '--no-auto-maintenance',
            '--no-recurse-submodules',
            '--no-write-fetch-head',
            '--unshallow',
            '--',
            'upstream',
          ],
          true,
        ],
        [
          { id: 'file-blame', path: 'app/src/ui/app.tsx' },
          ['blame', '--date=short', '--', 'app/src/ui/app.tsx'],
          false,
        ],
        [
          { id: 'content-search', pattern: 'TODO: follow up' },
          [
            'grep',
            '--line-number',
            '--fixed-strings',
            '-e',
            'TODO: follow up',
            '--',
          ],
          false,
        ],
        [
          { id: 'content-search', pattern: 'render()', ref: 'release/2.0' },
          [
            'grep',
            '--line-number',
            '--fixed-strings',
            '-e',
            'render()',
            'release/2.0',
            '--',
          ],
          false,
        ],
        [
          { id: 'content-search', pattern: 'main', ref: 'HEAD' },
          [
            'grep',
            '--line-number',
            '--fixed-strings',
            '-e',
            'main',
            'HEAD',
            '--',
          ],
          false,
        ],
        [
          { id: 'notes-edit', oid: 'AbCdEf1', message: 'reviewed for release' },
          [
            'notes',
            'add',
            '--force',
            '-m',
            'reviewed for release',
            '--',
            'abcdef1',
          ],
          true,
        ],
        [
          { id: 'notes-remove', oid: 'HEAD' },
          ['notes', 'remove', '--', 'HEAD'],
          true,
        ],
      ]

      for (const [operation, args, requiresConfirmation] of cases) {
        const result = await resolveCLIWorkbenchOperation(
          operation,
          fixture.repositoryPath
        )
        assert.deepEqual(result.args, args, operation.id)
        assert.equal(
          result.requiresConfirmation,
          requiresConfirmation,
          operation.id
        )
        assert.ok(result.args.length > 0, operation.id)
        assert.ok(
          Buffer.byteLength(JSON.stringify(result.args), 'utf8') < 32 * 1024,
          operation.id
        )
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects unknown IDs, extra fields, and injection-shaped values', async () => {
    const fixture = await createFixture()
    try {
      const rejected: ReadonlyArray<unknown> = [
        null,
        { id: 'unknown-operation' },
        { id: 'status-summary', args: ['clean', '-fd'] },
        { id: 'status-summary', tool: 'gh' },
        { id: 'status-summary', shell: true },
        { id: 'maintenance-run', requiresConfirmation: false },
        { id: 'clean-run', requiresConfirmation: false },
        { id: 'clean-run', args: ['clean', '-fdx'] },
        { id: 'clean-preview', paths: ['..'] },
        { id: 'file-blame', path: '/absolute/file.ts' },
        { id: 'file-blame', path: 'C:/absolute/file.ts' },
        { id: 'file-blame', path: '../outside.ts' },
        { id: 'file-blame', path: 'src/../../outside.ts' },
        { id: 'file-blame', path: '.git/config' },
        { id: 'file-blame', path: '-c=core.pager=payload' },
        { id: 'file-blame', path: 'src\\main.ts' },
        { id: 'file-blame', path: 'ok.ts', extra: true },
        { id: 'content-search', pattern: '' },
        { id: 'content-search', pattern: 'a'.repeat(257) },
        { id: 'content-search', pattern: 'line\nbreak' },
        { id: 'content-search', pattern: 'nul\0byte' },
        { id: 'content-search', pattern: 42 },
        { id: 'content-search', pattern: 'x', ref: '--all' },
        { id: 'content-search', pattern: 'x', ref: 'main..dev' },
        { id: 'content-search', pattern: 'x', ref: 'main@{1}' },
        { id: 'content-search', pattern: 'x', ref: 'bad name' },
        { id: 'content-search', pattern: 'x', ref: '' },
        { id: 'notes-edit', oid: 'HEAD~1', message: 'note' },
        { id: 'notes-edit', oid: 'abc', message: 'note' },
        { id: 'notes-edit', oid: 'a'.repeat(40), message: '' },
        { id: 'notes-edit', oid: 'a'.repeat(40), message: 'a'.repeat(1025) },
        { id: 'notes-edit', oid: 'a'.repeat(40), message: 'bell\x07' },
        { id: 'notes-remove', oid: 'refs/notes/commits' },
        { id: 'notes-remove', oid: 'HEAD', force: true },
        { id: 'history-deepen', remote: '--upload-pack=payload', deepenBy: 1 },
        { id: 'history-deepen', remote: 'origin', deepenBy: 0 },
        { id: 'history-deepen', remote: 'origin', deepenBy: 1_000_001 },
        { id: 'history-deepen', remote: 'origin', deepenBy: '50' },
        { id: 'history-unshallow', remote: '../outside' },
        { id: 'bundle-verify', bundlePath: 'relative.bundle' },
        { id: 'bundle-verify', bundlePath: join(fixture.root, 'wrong.zip') },
        {
          id: 'bundle-import-fetch-objects',
          bundlePath: fixture.bundlePath,
          sourceRef: 'refs/heads/main:refs/heads/other',
        },
        {
          id: 'bundle-import-create-branch',
          branchName: '-force',
          oid: 'a'.repeat(40),
        },
        {
          id: 'bundle-import-create-branch',
          branchName: 'safe',
          oid: 'not-an-object',
        },
        {
          id: 'archive-export',
          format: 'zip',
          destination: join(fixture.repositoryPath, '.git', 'private.zip'),
        },
      ]

      for (const operation of rejected) {
        await assert.rejects(
          resolveCLIWorkbenchOperation(operation, fixture.repositoryPath)
        )
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
