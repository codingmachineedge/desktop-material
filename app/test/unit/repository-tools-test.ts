import { describe, it } from 'node:test'
import assert from 'node:assert'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  RepositoryToolOperations,
} from '../../src/ui/repository-tools'
import { RepositorySectionTab } from '../../src/lib/app-state'
import {
  getRepositorySections,
  getRepositorySectionVisualIndex,
} from '../../src/ui/repository-sections'

const fixtureRoot = join(tmpdir(), 'desktop-material-repository-tools')
const repositoryPath = join(fixtureRoot, 'work', 'repo')
const exportPath = join(fixtureRoot, 'exports')
const archiveDestination = join(exportPath, 'repo')
const tarDestination = join(exportPath, 'repo.TAR')
const privateArchiveDestination = join(repositoryPath, '.git', 'private.zip')
const bundleDestination = join(exportPath, 'backup')
const bundlePath = join(exportPath, 'backup.bundle')
const privateBundleDestination = join(repositoryPath, '.git', 'backup.bundle')

describe('repository tool recipes', () => {
  it('exposes only reviewed, named fixed Git functions', () => {
    assert.deepStrictEqual(
      RepositoryToolOperations.map(operation => operation.id),
      [
        'status-summary',
        'repository-health',
        'signature-audit',
        'maintenance-preview',
        'branch-overview',
        'contributor-summary',
        'version-describe',
        'whitespace-audit',
        'ignored-files-view',
        'maintenance-run',
        'merged-branch-audit',
        'prune-preview',
        'clean-preview',
        'clean-run',
        'reflog-view',
        'unreachable-commits',
      ]
    )
    assert.ok(
      RepositoryToolOperations.every(operation => !('args' in operation))
    )
  })

  it('keeps every diagnostic and recovery view non-mutating', () => {
    for (const id of [
      'status-summary',
      'repository-health',
      'signature-audit',
      'maintenance-preview',
      'branch-overview',
      'contributor-summary',
      'version-describe',
      'whitespace-audit',
      'ignored-files-view',
      'merged-branch-audit',
      'prune-preview',
      'clean-preview',
      'reflog-view',
      'unreachable-commits',
    ] as const) {
      const operation = getRepositoryToolOperation(id)
      assert.equal(operation.mutatesRepository, false)
      assert.equal(operation.requiresConfirmation, false)
    }
    assert.equal('args' in getRepositoryToolOperation('reflog-view'), false)
    assert.equal('args' in getRepositoryToolOperation('signature-audit'), false)
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

  it('requires an explicit destructive confirmation for untracked cleanup', () => {
    const clean = getRepositoryToolOperation('clean-run')
    assert.equal(clean.mutatesRepository, true)
    assert.equal(clean.requiresConfirmation, true)
    assert.equal(clean.confirmationActionLabel, 'Delete untracked files')
    assert.match(clean.confirmationDescription ?? '', /deleted permanently/i)
    assert.match(
      clean.confirmationDescription ?? '',
      /ignored files are preserved/i
    )

    const preview = getRepositoryToolOperation('clean-preview')
    assert.equal(preview.mutatesRepository, false)
    assert.equal(preview.requiresConfirmation, false)
  })

  it('prepares only contained ZIP and TAR exports from HEAD', () => {
    assert.deepStrictEqual(
      prepareRepositoryArchive(repositoryPath, archiveDestination, 'zip'),
      {
        format: 'zip',
        destination: `${archiveDestination}.zip`,
        operation: {
          id: 'archive-export',
          format: 'zip',
          destination: `${archiveDestination}.zip`,
        },
      }
    )
    assert.equal(
      prepareRepositoryArchive(repositoryPath, tarDestination, 'tar')
        .destination,
      tarDestination
    )
    assert.throws(() =>
      prepareRepositoryArchive(repositoryPath, 'relative.zip', 'zip')
    )
    assert.throws(() =>
      prepareRepositoryArchive(repositoryPath, privateArchiveDestination, 'zip')
    )
  })

  it('prepares a contained full-history bundle with no editable ref', () => {
    assert.deepStrictEqual(
      prepareRepositoryBundle(repositoryPath, bundleDestination),
      {
        format: 'bundle',
        destination: bundlePath,
        operation: {
          id: 'bundle-export',
          destination: bundlePath,
        },
      }
    )
    assert.throws(() =>
      prepareRepositoryBundle(repositoryPath, privateBundleDestination)
    )
  })

  it('prepares only an absolute bundle for read-only verification', () => {
    assert.deepStrictEqual(prepareRepositoryBundleVerification(bundlePath), {
      id: 'bundle-verify',
      bundlePath,
    })
    for (const path of ['backup.bundle', join(exportPath, 'backup.zip'), '']) {
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
    const request = prepareRepositoryBundleImport(
      bundlePath,
      source,
      'restored/release'
    )
    assert.deepStrictEqual(request, {
      bundlePath,
      verifyOperation: {
        id: 'bundle-verify',
        bundlePath,
      },
      listHeadsOperation: {
        id: 'bundle-list-heads',
        bundlePath,
      },
      source,
      branchName: 'restored/release',
      destinationRef: 'refs/heads/restored/release',
      validateDestinationOperation: {
        id: 'bundle-import-validate-destination',
        branchName: 'restored/release',
      },
      checkDestinationOperation: {
        id: 'bundle-import-check-destination',
        branchName: 'restored/release',
      },
      fetchObjectsOperation: {
        id: 'bundle-import-fetch-objects',
        bundlePath,
        sourceRef: 'refs/heads/release',
      },
      validateCommitOperation: {
        id: 'bundle-import-validate-commit',
        oid: 'a'.repeat(40),
      },
      createBranchOperation: {
        id: 'bundle-import-create-branch',
        branchName: 'restored/release',
        oid: 'a'.repeat(40),
      },
    })
    assert.ok(
      request.createBranchOperation.id === 'bundle-import-create-branch' &&
        !request.createBranchOperation.branchName.includes(':')
    )
    assert.deepStrictEqual(prepareRepositoryBundleInspection(bundlePath), {
      bundlePath,
      verifyOperation: {
        id: 'bundle-verify',
        bundlePath,
      },
      listHeadsOperation: {
        id: 'bundle-list-heads',
        bundlePath,
      },
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
  it('keeps Repository Tools at visual index 2 when Actions is unavailable', () => {
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

  it('keeps Repository Tools at visual index 3 when Actions is available', () => {
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

  it('orders every optional GitHub section before provider triage and tools', () => {
    assert.deepStrictEqual(getRepositorySections(true, true, true, true), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.Actions,
      RepositorySectionTab.Releases,
      RepositorySectionTab.Issues,
      RepositorySectionTab.GitHubAPI,
      RepositorySectionTab.Triage,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.GitHubAPI,
        true,
        true,
        true,
        true
      ),
      5
    )
  })
})
