import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  CLICommandOutputLimiter,
  createCLICommandValidationDependencies,
  ICLICommandValidationDependencies,
  revalidateCLICommandBeforeSpawn,
  validateCLICommandRequest,
} from '../../src/main-process/cli-workbench/runner-helpers'

function fakeDependencies(
  rootPath: string,
  overrides: Partial<ICLICommandValidationDependencies> = {}
): ICLICommandValidationDependencies {
  return {
    inspectRepository: async () => ({
      rootPath,
      gitDirectory: join(rootPath, '.git'),
      gitCommonDirectory: join(rootPath, '.git'),
    }),
    listRemotes: async () => ['origin', 'upstream'],
    canonicalizePath: async path => resolve(path),
    ...overrides,
  }
}

function request(
  repositoryPath: string,
  recipe: unknown,
  confirmed = false,
  id = 'guided-1'
) {
  return { id, repositoryPath, recipe, confirmed }
}

function runGit(repositoryPath: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', [...args], {
    cwd: repositoryPath,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function createRepositoryFixture() {
  const fixture = await mkdtemp(join(tmpdir(), 'desktop-guided-runner-'))
  const repository = join(fixture, 'repository')
  const linkedWorktree = join(fixture, 'linked-worktree')
  const exportsDirectory = join(fixture, 'exports')
  await mkdir(repository)
  await mkdir(exportsDirectory)
  runGit(repository, ['init'])
  await writeFile(join(repository, 'README.md'), 'fixture\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, [
    '-c',
    'user.name=Desktop Material Tests',
    '-c',
    'user.email=tests@example.invalid',
    'commit',
    '-m',
    'fixture',
  ])
  runGit(repository, [
    'worktree',
    'add',
    '-b',
    'linked-fixture',
    linkedWorktree,
  ])
  const dependencies = createCLICommandValidationDependencies({
    executable: 'git',
    env: process.env,
  })
  return {
    fixture,
    repository,
    linkedWorktree,
    exportsDirectory,
    dependencies,
  }
}

describe('CLI workbench runner helpers', () => {
  it('reconstructs every shipped guided family from structured parameters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-cli-recipes-'))
    const destination = join(tmpdir(), 'desktop-cli-export')
    const bundlePath = join(tmpdir(), 'desktop-cli-input.bundle')
    const source = { oid: 'a'.repeat(40), ref: 'refs/heads/main' }
    const dependencies = fakeDependencies(root)
    try {
      const allowed = [
        {
          recipe: { kind: 'repository-tool', operation: 'status-summary' },
          confirmed: false,
          args: ['status', '--short', '--branch'],
        },
        {
          recipe: {
            kind: 'repository-tool',
            operation: 'repository-health',
          },
          confirmed: false,
          args: ['fsck', '--full'],
        },
        {
          recipe: {
            kind: 'repository-tool',
            operation: 'signature-audit',
          },
          confirmed: false,
          args: [
            'log',
            '--format=%h%x09%G?%x09%GS%x09%s',
            '--show-signature',
            '-50',
          ],
        },
        {
          recipe: {
            kind: 'repository-tool',
            operation: 'maintenance-preview',
          },
          confirmed: false,
          args: ['count-objects', '-vH'],
        },
        {
          recipe: { kind: 'repository-tool', operation: 'maintenance-run' },
          confirmed: true,
          args: ['maintenance', 'run'],
        },
        {
          recipe: { kind: 'repository-tool', operation: 'reflog-view' },
          confirmed: false,
          args: ['reflog', 'show', '--date=local', '-50'],
        },
        {
          recipe: {
            kind: 'repository-archive',
            format: 'zip',
            destination,
          },
          confirmed: true,
          args: [
            'archive',
            '--format=zip',
            `--output=${destination}.zip`,
            'HEAD',
          ],
        },
        {
          recipe: {
            kind: 'repository-archive',
            format: 'tar',
            destination,
          },
          confirmed: true,
          args: [
            'archive',
            '--format=tar',
            `--output=${destination}.tar`,
            'HEAD',
          ],
        },
        {
          recipe: { kind: 'repository-bundle-export', destination },
          confirmed: true,
          args: ['bundle', 'create', `${destination}.bundle`, '--all'],
        },
        {
          recipe: {
            kind: 'repository-bundle-inspection',
            operation: 'verify',
            bundlePath,
          },
          confirmed: false,
          args: ['bundle', 'verify', bundlePath],
        },
        {
          recipe: {
            kind: 'repository-bundle-inspection',
            operation: 'list-heads',
            bundlePath,
          },
          confirmed: false,
          args: ['bundle', 'list-heads', bundlePath],
        },
        {
          recipe: {
            kind: 'repository-bundle-import',
            operation: 'validate-destination',
            bundlePath,
            source,
            branchName: 'imported/main',
          },
          confirmed: false,
          args: ['check-ref-format', '--branch', 'imported/main'],
        },
        {
          recipe: {
            kind: 'repository-bundle-import',
            operation: 'check-destination',
            bundlePath,
            source,
            branchName: 'imported/main',
          },
          confirmed: false,
          args: ['show-ref', '--verify', '--quiet', 'refs/heads/imported/main'],
        },
        {
          recipe: {
            kind: 'repository-bundle-import',
            operation: 'fetch-objects',
            bundlePath,
            source,
            branchName: 'imported/main',
          },
          confirmed: true,
          args: [
            'fetch',
            '--no-write-fetch-head',
            '--no-tags',
            '--no-auto-maintenance',
            bundlePath,
            source.ref,
          ],
        },
        {
          recipe: {
            kind: 'repository-bundle-import',
            operation: 'validate-commit',
            bundlePath,
            source,
            branchName: 'imported/main',
          },
          confirmed: false,
          args: ['cat-file', '-e', `${source.oid}^{commit}`],
        },
        {
          recipe: {
            kind: 'repository-bundle-import',
            operation: 'create-branch',
            bundlePath,
            source,
            branchName: 'imported/main',
          },
          confirmed: true,
          args: ['branch', '--no-track', '--', 'imported/main', source.oid],
        },
        {
          recipe: {
            kind: 'repository-shallow-inspection',
            operation: 'status',
          },
          confirmed: false,
          args: ['rev-parse', '--is-shallow-repository'],
        },
        {
          recipe: {
            kind: 'repository-shallow-inspection',
            operation: 'remotes',
          },
          confirmed: false,
          args: ['remote'],
        },
        {
          recipe: {
            kind: 'repository-shallow-fetch',
            action: 'deepen',
            remote: 'origin',
            deepenBy: 75,
          },
          confirmed: true,
          args: [
            'fetch',
            '--no-auto-maintenance',
            '--no-recurse-submodules',
            '--no-write-fetch-head',
            '--deepen=75',
            '--',
            'origin',
          ],
        },
        {
          recipe: {
            kind: 'repository-shallow-fetch',
            action: 'unshallow',
            remote: 'upstream',
            deepenBy: null,
          },
          confirmed: true,
          args: [
            'fetch',
            '--no-auto-maintenance',
            '--no-recurse-submodules',
            '--no-write-fetch-head',
            '--unshallow',
            '--',
            'upstream',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-inspection',
            scope: 'local',
            operation: 'settings',
          },
          confirmed: false,
          args: [
            'config',
            '--local',
            '--null',
            '--get-regexp',
            '^(gpg\\.format|commit\\.gpgsign|tag\\.gpgsign)$',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-inspection',
            scope: 'global',
            operation: 'settings',
          },
          confirmed: false,
          args: [
            'config',
            '--global',
            '--null',
            '--get-regexp',
            '^(gpg\\.format|commit\\.gpgsign|tag\\.gpgsign)$',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-inspection',
            scope: 'local',
            operation: 'key-presence',
          },
          confirmed: false,
          args: [
            'config',
            '--local',
            '--null',
            '--name-only',
            '--get-regexp',
            '^user\\.signingkey$',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-inspection',
            scope: 'global',
            operation: 'key-presence',
          },
          confirmed: false,
          args: [
            'config',
            '--global',
            '--null',
            '--name-only',
            '--get-regexp',
            '^user\\.signingkey$',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-update',
            scope: 'local',
            operation: 'set-format',
            format: 'ssh',
          },
          confirmed: true,
          args: ['config', '--local', '--replace-all', 'gpg.format', 'ssh'],
        },
        {
          recipe: {
            kind: 'repository-signing-update',
            scope: 'global',
            operation: 'set-key',
            format: 'openpgp',
            key: '0x0123456789abcdef',
          },
          confirmed: true,
          args: [
            'config',
            '--global',
            '--replace-all',
            'user.signingkey',
            '0123456789ABCDEF',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-update',
            scope: 'local',
            operation: 'set-commit-signing',
            enabled: true,
          },
          confirmed: true,
          args: [
            'config',
            '--local',
            '--type=bool',
            '--replace-all',
            'commit.gpgsign',
            'true',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-update',
            scope: 'local',
            operation: 'set-tag-signing',
            enabled: false,
          },
          confirmed: true,
          args: [
            'config',
            '--local',
            '--type=bool',
            '--replace-all',
            'tag.gpgsign',
            'false',
          ],
        },
        {
          recipe: { kind: 'repository-signing-list-tags' },
          confirmed: false,
          args: [
            'for-each-ref',
            '--count=100',
            '--sort=-creatordate',
            '--format=%(refname:strip=2)%00%(objecttype)%00%(objectname)',
            'refs/tags',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-verify',
            target: 'head',
            tagName: null,
            expectedObject: null,
          },
          confirmed: false,
          args: [
            'log',
            '-1',
            '--no-show-signature',
            '--format=%H%x00%G?%x00%GF%x00%GK',
            'HEAD',
          ],
        },
        {
          recipe: {
            kind: 'repository-signing-verify',
            target: 'tag',
            tagName: 'v2.0.0',
            expectedObject: 'b'.repeat(40),
          },
          confirmed: false,
          args: [
            'for-each-ref',
            '--count=1',
            '--format=%(objectname)%00%(signature:grade)%00%(signature:fingerprint)%00%(signature:key)',
            'refs/tags/v2.0.0',
          ],
        },
        ...(
          [
            ['version', ['lfs', 'version']],
            ['patterns', ['lfs', 'track', '--json']],
            ['status', ['lfs', 'status', '--json']],
            ['prune-preview', ['lfs', 'prune', '--dry-run', '--verify-remote']],
          ] as const
        ).map(([operation, args]) => ({
          recipe: { kind: 'repository-lfs-inspection' as const, operation },
          confirmed: false,
          args,
        })),
        {
          recipe: {
            kind: 'repository-lfs-pattern',
            operation: 'track',
            pattern: 'assets/**/*.psd',
          },
          confirmed: true,
          args: ['lfs', 'track', '--', 'assets/**/*.psd'],
        },
        {
          recipe: {
            kind: 'repository-lfs-pattern',
            operation: 'untrack',
            pattern: '*.zip',
          },
          confirmed: true,
          args: ['lfs', 'untrack', '--', '*.zip'],
        },
        ...(
          [
            ['install', ['lfs', 'install', '--local']],
            ['uninstall', ['lfs', 'uninstall', '--local']],
            ['fetch', ['lfs', 'fetch']],
            ['pull', ['lfs', 'pull']],
            ['prune', ['lfs', 'prune', '--verify-remote']],
          ] as const
        ).map(([operation, args]) => ({
          recipe: { kind: 'repository-lfs-operation' as const, operation },
          confirmed: true,
          args,
        })),
      ] as const

      for (const [index, candidate] of allowed.entries()) {
        const validated = await validateCLICommandRequest(
          request(
            root,
            candidate.recipe,
            candidate.confirmed,
            `allowed-${index}`
          ),
          dependencies
        )
        assert.deepStrictEqual(validated.args, candidate.args)
        assert.equal(validated.tool, 'git')
        assert.equal(validated.cwd, root)
        assert.deepStrictEqual(
          validated.environment,
          candidate.recipe.kind.startsWith('repository-lfs-')
            ? { GIT_LFS_TRACK_NO_INSTALL_HOOKS: '1' }
            : {}
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed for malformed signing and Git LFS recipes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-admin-deny-'))
    const dependencies = fakeDependencies(root)
    const invalidRecipes: ReadonlyArray<unknown> = [
      {
        kind: 'repository-signing-inspection',
        scope: 'system',
        operation: 'settings',
      },
      {
        kind: 'repository-signing-inspection',
        scope: 'local',
        operation: 'settings',
        argv: ['config', '--global', '--list'],
      },
      {
        kind: 'repository-signing-inspection',
        scope: 'local',
        operation: 'raw-key',
      },
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-format',
        format: 'custom',
      },
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-key',
        format: 'ssh',
        key: 'C:/private/id_ed25519',
      },
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-commit-signing',
        enabled: 'true',
      },
      {
        kind: 'repository-signing-verify',
        target: 'tag',
        tagName: '--upload-pack=payload',
        expectedObject: 'a'.repeat(40),
      },
      {
        kind: 'repository-signing-verify',
        target: 'tag',
        tagName: 'v1.0.0',
        expectedObject: '../HEAD',
      },
      {
        kind: 'repository-signing-verify',
        target: 'head',
        tagName: 'v1.0.0',
        expectedObject: null,
      },
      { kind: 'repository-lfs-inspection', operation: 'env' },
      {
        kind: 'repository-lfs-pattern',
        operation: 'track',
        pattern: '../outside.bin',
      },
      {
        kind: 'repository-lfs-pattern',
        operation: 'track',
        pattern: '*.bin',
        environment: { GIT_EXEC_PATH: 'C:/payload' },
      },
      { kind: 'repository-lfs-operation', operation: 'push' },
    ]
    try {
      for (const [index, recipe] of invalidRecipes.entries()) {
        await assert.rejects(
          validateCLICommandRequest(
            request(root, recipe, true, `invalid-admin-${index}`),
            dependencies
          )
        )
      }
      await assert.rejects(
        validateCLICommandRequest(
          request(
            root,
            {
              kind: 'repository-lfs-operation',
              operation: 'prune',
            },
            false,
            'unconfirmed-lfs-prune'
          ),
          dependencies
        ),
        /confirmation/i
      )
      await assert.rejects(
        validateCLICommandRequest(
          {
            ...request(
              root,
              { kind: 'repository-lfs-inspection', operation: 'version' },
              false,
              'forged-environment'
            ),
            environment: { GIT_EXEC_PATH: 'C:/payload' },
          },
          dependencies
        ),
        /Invalid CLI command request/
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects every legacy argv/tool/cwd bypass even with forged confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-cli-deny-'))
    const dependencies = fakeDependencies(root)
    try {
      const bypasses: ReadonlyArray<ReadonlyArray<string>> = [
        ['-c', 'alias.pwn=!echo executed', 'pwn'],
        ['--exec-path=C:\\payload', 'pwn'],
        ['--git-dir=C:\\repo\\.git', '--work-tree=C:\\Windows', 'status'],
        ['-c', 'diff.external=payload', 'diff'],
        ['-c', 'core.pager=payload', '--paginate', 'log'],
        ['-c', 'filter.pwn.smudge=payload', 'cat-file', '--filters'],
        ['-c', 'credential.helper=!payload', 'credential', 'approve'],
        ['upload-pack', '--advertise-refs', '.'],
        ['receive-pack', '--advertise-refs', '.'],
      ]
      for (const [index, args] of bypasses.entries()) {
        await assert.rejects(
          validateCLICommandRequest(
            {
              id: `legacy-git-${index}`,
              tool: 'git',
              args,
              cwd: root,
              confirmed: true,
            },
            dependencies
          ),
          /Invalid CLI command request/
        )
      }
      for (const [index, args] of [
        ['alias', 'set', 'pwn', 'payload', '--shell'],
        ['pwn'],
        ['api', '--input', 'C:\\Windows\\win.ini', '--method', 'DELETE'],
        ['extension', 'exec', 'payload'],
      ].entries()) {
        await assert.rejects(
          validateCLICommandRequest(
            {
              id: `legacy-gh-${index}`,
              tool: 'gh',
              args,
              cwd: root,
              confirmed: true,
            },
            dependencies
          ),
          /Invalid CLI command request/
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed on unknown recipes, extra argv fields, and mismatched confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-cli-schema-'))
    const dependencies = fakeDependencies(root)
    try {
      await assert.rejects(
        validateCLICommandRequest(
          {
            ...request(root, {
              kind: 'repository-tool',
              operation: 'status-summary',
            }),
            args: ['status'],
          },
          dependencies
        ),
        /Invalid CLI command request/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(
            root,
            { kind: 'repository-tool', operation: 'upload-pack' },
            true
          ),
          dependencies
        ),
        /Unknown guided repository tool recipe/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(
            root,
            { kind: 'repository-tool', operation: 'status-summary' },
            true
          ),
          dependencies
        ),
        /Confirmation is not valid/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(root, {
            kind: 'repository-tool',
            operation: 'maintenance-run',
          }),
          dependencies
        ),
        /requires confirmation/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(root, { kind: 'github-api', input: 'payload' }, true),
          dependencies
        ),
        /Unknown guided CLI command recipe/
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects non-repositories, subdirectory cwd values, and forged remotes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-cli-context-'))
    const subdirectory = join(root, 'subdirectory')
    await mkdir(subdirectory)
    try {
      await assert.rejects(
        validateCLICommandRequest(
          request(root, {
            kind: 'repository-tool',
            operation: 'status-summary',
          }),
          fakeDependencies(root, {
            inspectRepository: async () => {
              throw new Error('not a repository')
            },
          })
        ),
        /require a repository verified by bundled Git/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(subdirectory, {
            kind: 'repository-tool',
            operation: 'status-summary',
          }),
          fakeDependencies(root)
        ),
        /exact repository root/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(
            root,
            {
              kind: 'repository-shallow-fetch',
              action: 'deepen',
              remote: 'forged-local-path',
              deepenBy: 50,
            },
            true
          ),
          fakeDependencies(root)
        ),
        /configured fetch remote/
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses canonical repository and destination paths and rechecks mutations', async t => {
    const fixture = await createRepositoryFixture()
    const repositoryAlias = join(fixture.fixture, 'repository-alias')
    const alternateRepository = join(fixture.fixture, 'alternate-repository')
    const safeParent = join(fixture.fixture, 'safe-parent')
    const movedSafeParent = join(fixture.fixture, 'moved-safe-parent')
    await mkdir(alternateRepository)
    runGit(alternateRepository, ['init'])
    await mkdir(safeParent)
    try {
      try {
        await symlink(
          fixture.repository,
          repositoryAlias,
          process.platform === 'win32' ? 'junction' : 'dir'
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          t.skip('directory links are not supported in this environment')
          return
        }
        throw error
      }

      const selectedDestination = join(
        safeParent,
        'repository-through-alias.bundle'
      )
      const validated = await validateCLICommandRequest(
        request(
          repositoryAlias,
          {
            kind: 'repository-bundle-export',
            destination: selectedDestination,
          },
          true
        ),
        fixture.dependencies
      )
      assert.equal(validated.cwd, await realpath(fixture.repository))
      assert.equal(
        validated.outputDestination,
        await realpath(safeParent).then(parent =>
          join(parent, 'repository-through-alias.bundle')
        )
      )
      assert.deepStrictEqual(validated.args, [
        'bundle',
        'create',
        validated.outputDestination,
        '--all',
      ])

      await rm(repositoryAlias, { recursive: true, force: true })
      await symlink(
        alternateRepository,
        repositoryAlias,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      await revalidateCLICommandBeforeSpawn(validated, fixture.dependencies)
      assert.equal(validated.cwd, await realpath(fixture.repository))

      await rename(safeParent, movedSafeParent)
      await symlink(
        join(fixture.repository, '.git'),
        safeParent,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      await assert.rejects(
        revalidateCLICommandBeforeSpawn(validated, fixture.dependencies),
        /inside Git storage|destination path changed/
      )
    } finally {
      await rm(fixture.fixture, { recursive: true, force: true })
    }
  })

  it('uses create-new-only exports and rechecks destination creation before spawn', async () => {
    const fixture = await createRepositoryFixture()
    try {
      const existingArchive = join(fixture.exportsDirectory, 'existing.zip')
      const existingBundle = join(fixture.exportsDirectory, 'existing.bundle')
      await writeFile(existingArchive, 'existing archive sentinel\n')
      await writeFile(existingBundle, 'existing bundle sentinel\n')

      await assert.rejects(
        validateCLICommandRequest(
          request(
            fixture.repository,
            {
              kind: 'repository-archive',
              format: 'zip',
              destination: existingArchive,
            },
            true
          ),
          fixture.dependencies
        ),
        /cannot overwrite an existing destination/
      )
      await assert.rejects(
        validateCLICommandRequest(
          request(
            fixture.repository,
            {
              kind: 'repository-bundle-export',
              destination: existingBundle,
            },
            true
          ),
          fixture.dependencies
        ),
        /cannot overwrite an existing destination/
      )

      const missingArchive = join(fixture.exportsDirectory, 'missing.zip')
      const missingBundle = join(fixture.exportsDirectory, 'missing.bundle')
      const validatedArchive = await validateCLICommandRequest(
        request(
          fixture.repository,
          {
            kind: 'repository-archive',
            format: 'zip',
            destination: missingArchive,
          },
          true
        ),
        fixture.dependencies
      )
      const validatedBundle = await validateCLICommandRequest(
        request(
          fixture.repository,
          {
            kind: 'repository-bundle-export',
            destination: missingBundle,
          },
          true
        ),
        fixture.dependencies
      )
      assert.equal(validatedArchive.outputDestination, missingArchive)
      assert.equal(validatedBundle.outputDestination, missingBundle)
      await revalidateCLICommandBeforeSpawn(
        validatedArchive,
        fixture.dependencies
      )
      await revalidateCLICommandBeforeSpawn(
        validatedBundle,
        fixture.dependencies
      )

      await writeFile(missingArchive, 'created after archive review\n')
      await writeFile(missingBundle, 'created after bundle review\n')
      await assert.rejects(
        revalidateCLICommandBeforeSpawn(validatedArchive, fixture.dependencies),
        /cannot overwrite an existing destination/
      )
      await assert.rejects(
        revalidateCLICommandBeforeSpawn(validatedBundle, fixture.dependencies),
        /cannot overwrite an existing destination/
      )
    } finally {
      await rm(fixture.fixture, { recursive: true, force: true })
    }
  })

  it('rejects archive and bundle hard links without changing Git config', async t => {
    const fixture = await createRepositoryFixture()
    try {
      const configPath = join(fixture.repository, '.git', 'config')
      const archiveAlias = join(fixture.exportsDirectory, 'config-alias.zip')
      const bundleAlias = join(fixture.exportsDirectory, 'config-alias.bundle')
      const before = await readFile(configPath)
      const beforeHash = createHash('sha256').update(before).digest('hex')
      try {
        await link(configPath, archiveAlias)
        await link(configPath, bundleAlias)
      } catch (error) {
        if (
          ['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(
            (error as NodeJS.ErrnoException).code ?? ''
          )
        ) {
          t.skip('hard links are not supported in this environment')
          return
        }
        throw error
      }

      const recipes = [
        {
          kind: 'repository-archive',
          format: 'zip',
          destination: archiveAlias,
        },
        {
          kind: 'repository-bundle-export',
          destination: bundleAlias,
        },
      ] as const
      for (const [index, recipe] of recipes.entries()) {
        await assert.rejects(
          validateCLICommandRequest(
            request(fixture.repository, recipe, true, `hardlink-${index}`),
            fixture.dependencies
          ),
          /cannot overwrite an existing destination/
        )
        const after = await readFile(configPath)
        assert.deepStrictEqual(after, before)
        assert.equal(
          createHash('sha256').update(after).digest('hex'),
          beforeHash
        )
      }
    } finally {
      await rm(fixture.fixture, { recursive: true, force: true })
    }
  })

  it('rejects main, linked-worktree, common-dir, and link aliases into Git storage', async t => {
    const fixture = await createRepositoryFixture()
    try {
      const mainContext = await fixture.dependencies.inspectRepository(
        fixture.repository
      )
      const linkedContext = await fixture.dependencies.inspectRepository(
        fixture.linkedWorktree
      )
      const forbidden = [
        join(mainContext.gitDirectory, 'audit.bundle'),
        join(linkedContext.gitDirectory, 'audit.bundle'),
        join(linkedContext.gitCommonDirectory, 'refs', 'heads', 'audit.bundle'),
      ]
      for (const [index, destination] of forbidden.entries()) {
        await assert.rejects(
          validateCLICommandRequest(
            request(
              fixture.linkedWorktree,
              { kind: 'repository-bundle-export', destination },
              true,
              `forbidden-${index}`
            ),
            fixture.dependencies
          ),
          /inside Git storage/
        )
      }
      await assert.rejects(
        validateCLICommandRequest(
          request(
            fixture.linkedWorktree,
            {
              kind: 'repository-archive',
              format: 'zip',
              destination: join(
                linkedContext.gitCommonDirectory,
                'refs',
                'heads',
                'archive.zip'
              ),
            },
            true,
            'forbidden-archive'
          ),
          fixture.dependencies
        ),
        /inside Git storage/
      )

      const gitAlias = join(fixture.fixture, 'git-storage-alias')
      try {
        await symlink(
          linkedContext.gitCommonDirectory,
          gitAlias,
          process.platform === 'win32' ? 'junction' : 'dir'
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          t.skip('directory links are not supported in this environment')
          return
        }
        throw error
      }
      await assert.rejects(
        validateCLICommandRequest(
          request(
            fixture.linkedWorktree,
            {
              kind: 'repository-bundle-export',
              destination: join(gitAlias, 'refs', 'heads', 'alias.bundle'),
            },
            true
          ),
          fixture.dependencies
        ),
        /inside Git storage/
      )
    } finally {
      await rm(fixture.fixture, { recursive: true, force: true })
    }
  })

  it('fails closed when destination canonicalization fails before spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-cli-path-failure-'))
    const destination = join(tmpdir(), 'desktop-cli-path-failure.bundle')
    const base = fakeDependencies(root)
    try {
      const validated = await validateCLICommandRequest(
        request(root, { kind: 'repository-bundle-export', destination }, true),
        base
      )
      await assert.rejects(
        revalidateCLICommandBeforeSpawn(validated, {
          ...base,
          canonicalizePath: async path => {
            if (path === validated.outputDestination) {
              throw new Error('path failure')
            }
            return resolve(path)
          },
        }),
        /Unable to verify the selected destination path/
      )
    } finally {
      await rm(root, { recursive: true, force: true })
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
