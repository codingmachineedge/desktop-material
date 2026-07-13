import { describe, it } from 'node:test'
import assert from 'node:assert'
import { join, resolve } from 'node:path'
import {
  assertRepositoryBundleSourceUnchanged,
  getRepositoryToolOperation,
  normalizeBundleImportBranchName,
  parseRepositoryBundleHeads,
  prepareRepositoryArchive,
  prepareRepositoryBundle,
  prepareRepositoryBundleImport,
  prepareRepositoryBundleInspection,
  prepareRepositoryBundleVerification,
  prepareRepositoryPatchExport,
  prepareRepositoryPatchImport,
  RepositoryToolOperations,
} from '../../src/ui/repository-tools'
import { RepositorySectionTab } from '../../src/lib/app-state'
import {
  getRepositorySections,
  getRepositorySectionVisualIndex,
} from '../../src/ui/repository-sections'

const repositoryPath = resolve('repository-tool-fixtures', 'repository')
const exportsDirectory = resolve('repository-tool-fixtures', 'exports')
const patchesDirectory = resolve('repository-tool-fixtures', 'patches')

describe('repository tool recipes', () => {
  it('exposes only reviewed, named fixed Git functions', () => {
    assert.deepStrictEqual(
      RepositoryToolOperations.map(operation => operation.id),
      [
        'status-summary',
        'repository-health',
        'signature-audit',
        'maintenance-preview',
        'maintenance-run',
        'reflog-view',
      ]
    )
    assert.ok(
      RepositoryToolOperations.every(operation => operation.args.length > 0)
    )
    assert.ok(
      RepositoryToolOperations.every(
        operation =>
          !operation.args.some(argument =>
            /credential|password|token|--exec|^!/.test(argument)
          )
      )
    )
  })

  it('keeps every diagnostic and recovery view non-mutating', () => {
    for (const id of [
      'status-summary',
      'repository-health',
      'signature-audit',
      'maintenance-preview',
      'reflog-view',
    ] as const) {
      const operation = getRepositoryToolOperation(id)
      assert.equal(operation.mutatesRepository, false)
      assert.equal(operation.requiresConfirmation, false)
    }
    assert.deepStrictEqual(getRepositoryToolOperation('reflog-view').args, [
      'reflog',
      'show',
      '--date=local',
      '-50',
    ])
    assert.deepStrictEqual(getRepositoryToolOperation('signature-audit').args, [
      'log',
      '--format=%h%x09%G?%x09%GS%x09%s',
      '--show-signature',
      '-50',
    ])
  })

  it('requires confirmation for repository maintenance', () => {
    const maintenance = getRepositoryToolOperation('maintenance-run')
    assert.equal(maintenance.mutatesRepository, true)
    assert.equal(maintenance.requiresConfirmation, true)
    assert.match(
      maintenance.confirmationDescription ?? '',
      /rewrite object packs/i
    )
  })

  it('prepares only contained ZIP and TAR exports from HEAD', () => {
    const zipBase = join(exportsDirectory, 'repo')
    const zipDestination = `${zipBase}.zip`
    assert.deepStrictEqual(
      prepareRepositoryArchive(repositoryPath, zipBase, 'zip'),
      {
        format: 'zip',
        destination: zipDestination,
        args: ['archive', '--format=zip', `--output=${zipDestination}`, 'HEAD'],
      }
    )
    const tarDestination = join(exportsDirectory, 'repo.TAR')
    assert.equal(
      prepareRepositoryArchive(repositoryPath, tarDestination, 'tar')
        .destination,
      tarDestination
    )
    assert.throws(() =>
      prepareRepositoryArchive(repositoryPath, 'relative.zip', 'zip')
    )
    assert.throws(() =>
      prepareRepositoryArchive(
        repositoryPath,
        join(repositoryPath, '.git', 'private.zip'),
        'zip'
      )
    )
  })

  it('prepares a contained full-history bundle with no editable ref', () => {
    const bundleBase = join(exportsDirectory, 'backup')
    const bundleDestination = `${bundleBase}.bundle`
    assert.deepStrictEqual(
      prepareRepositoryBundle(repositoryPath, bundleBase),
      {
        format: 'bundle',
        destination: bundleDestination,
        args: ['bundle', 'create', bundleDestination, '--all'],
      }
    )
    assert.throws(() =>
      prepareRepositoryBundle(
        repositoryPath,
        join(repositoryPath, '.git', 'backup.bundle')
      )
    )
  })

  it('prepares create-new upstream patch export and bounded patch import', () => {
    const patchExportBase = join(exportsDirectory, 'review-series')
    const patchExportDestination = `${patchExportBase}.patches`
    assert.deepStrictEqual(
      prepareRepositoryPatchExport(repositoryPath, patchExportBase),
      {
        destination: patchExportDestination,
        args: [
          'format-patch',
          '--no-signature',
          '--numbered',
          `--output-directory=${patchExportDestination}`,
          '@{upstream}..HEAD',
        ],
      }
    )
    const patchPaths = [
      join(patchesDirectory, '0001.patch'),
      join(patchesDirectory, '0002.patch'),
    ]
    assert.deepStrictEqual(prepareRepositoryPatchImport(patchPaths), {
      patchPaths,
      args: ['am', '--3way', '--keep-cr', '--no-gpg-sign', '--', ...patchPaths],
    })
    assert.throws(() => prepareRepositoryPatchImport([]))
    assert.throws(() =>
      prepareRepositoryPatchImport([join(patchesDirectory, 'not-a-patch.txt')])
    )
    const duplicatePatch = join(patchesDirectory, 'same.patch')
    assert.throws(() =>
      prepareRepositoryPatchImport([duplicatePatch, duplicatePatch])
    )
  })

  it('prepares only an absolute bundle for read-only verification', () => {
    const bundlePath = join(exportsDirectory, 'backup.bundle')
    assert.deepStrictEqual(prepareRepositoryBundleVerification(bundlePath), [
      'bundle',
      'verify',
      bundlePath,
    ])
    for (const path of [
      'backup.bundle',
      join(exportsDirectory, 'backup.zip'),
      '',
    ]) {
      assert.throws(() => prepareRepositoryBundleVerification(path))
    }
  })

  it('strictly parses bounded advertised bundle refs', () => {
    const sha = 'A'.repeat(40)
    const sha256 = 'b'.repeat(64)
    assert.deepStrictEqual(
      parseRepositoryBundleHeads(
        `${sha} refs/heads/main\r\n${sha} HEAD\n${sha256} refs/tags/v2\n`
      ),
      [
        { oid: sha.toLowerCase(), ref: 'refs/heads/main' },
        { oid: sha256, ref: 'refs/tags/v2' },
      ]
    )
    for (const output of [
      '',
      `${sha} HEAD\n`,
      `${sha} refs/heads/bad ref\n`,
      `not-an-oid refs/heads/main\n`,
      `${sha} refs/heads/main\n${'b'.repeat(40)} refs/heads/main\n`,
    ]) {
      assert.throws(() => parseRepositoryBundleHeads(output))
    }
  })

  it('validates local branch destinations without accepting refspecs', () => {
    assert.equal(
      normalizeBundleImportBranchName(' feature/from-bundle '),
      'feature/from-bundle'
    )
    for (const branch of [
      '',
      '-force',
      'HEAD',
      'refs/heads/main:refs/heads/other',
      'bad..branch',
      'bad@{branch',
      'bad\\branch',
      '.hidden/main',
      'topic.lock',
    ]) {
      assert.throws(() => normalizeBundleImportBranchName(branch))
    }
  })

  it('prepares a fixed import recipe that cannot overwrite a branch', () => {
    const source = {
      oid: 'a'.repeat(40),
      ref: 'refs/heads/release',
    }
    const bundlePath = join(exportsDirectory, 'backup.bundle')
    const request = prepareRepositoryBundleImport(
      bundlePath,
      source,
      'restored/release'
    )
    assert.deepStrictEqual(request, {
      bundlePath,
      verifyArgs: ['bundle', 'verify', bundlePath],
      listHeadsArgs: ['bundle', 'list-heads', bundlePath],
      source,
      branchName: 'restored/release',
      destinationRef: 'refs/heads/restored/release',
      validateDestinationArgs: [
        'check-ref-format',
        '--branch',
        'restored/release',
      ],
      checkDestinationArgs: [
        'show-ref',
        '--verify',
        '--quiet',
        'refs/heads/restored/release',
      ],
      fetchObjectsArgs: [
        'fetch',
        '--no-write-fetch-head',
        '--no-tags',
        '--no-auto-maintenance',
        bundlePath,
        'refs/heads/release',
      ],
      validateCommitArgs: ['cat-file', '-e', `${'a'.repeat(40)}^{commit}`],
      createBranchArgs: [
        'branch',
        '--no-track',
        '--',
        'restored/release',
        'a'.repeat(40),
      ],
    })
    assert.ok(
      request.createBranchArgs.every(argument => !argument.includes(':'))
    )
    assert.deepStrictEqual(prepareRepositoryBundleInspection(bundlePath), {
      bundlePath,
      verifyArgs: ['bundle', 'verify', bundlePath],
      listHeadsArgs: ['bundle', 'list-heads', bundlePath],
    })
  })

  it('fails closed if the selected advertised source changes', () => {
    const source = { oid: 'a'.repeat(40), ref: 'refs/heads/main' }
    assert.doesNotThrow(() =>
      assertRepositoryBundleSourceUnchanged([source], source)
    )
    assert.throws(() =>
      assertRepositoryBundleSourceUnchanged(
        [{ oid: 'b'.repeat(40), ref: source.ref }],
        source
      )
    )
    assert.throws(() => assertRepositoryBundleSourceUnchanged([], source))
  })
})

describe('repository section order', () => {
  it('places provider triage before Repository Tools when Actions is unavailable', () => {
    assert.deepStrictEqual(getRepositorySections(false), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.Triage,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.RepositoryTools,
        false
      ),
      3
    )
  })

  it('places provider triage before Repository Tools when Actions is available', () => {
    assert.deepStrictEqual(getRepositorySections(true), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.Actions,
      RepositorySectionTab.Triage,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.RepositoryTools,
        true
      ),
      4
    )
  })

  it('places Releases and triage before Repository Tools when provider views are available', () => {
    assert.deepStrictEqual(getRepositorySections(true, true), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.Actions,
      RepositorySectionTab.Releases,
      RepositorySectionTab.Triage,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.RepositoryTools,
        true,
        true
      ),
      5
    )
  })

  it('places Issues and triage after Releases and before Repository Tools', () => {
    assert.deepStrictEqual(getRepositorySections(true, true, true), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.Actions,
      RepositorySectionTab.Releases,
      RepositorySectionTab.Issues,
      RepositorySectionTab.Triage,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.RepositoryTools,
        true,
        true,
        true
      ),
      6
    )
  })
})
