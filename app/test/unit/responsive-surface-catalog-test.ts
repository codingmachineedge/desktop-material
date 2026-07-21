import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import * as ts from 'typescript'

interface ICatalogSurface {
  readonly member: string
  readonly label: string
  readonly conditional?: boolean
}

interface ICatalogGroup {
  readonly source: string
  readonly kind: string
  readonly risk: string
  readonly surfaces: ReadonlyArray<ICatalogSurface>
}

interface INestedSurface {
  readonly id: string
  readonly parentId: string
  readonly kind: string
  readonly source: string
  readonly label: string
  readonly risk: string
  readonly conditional?: boolean
  readonly ownerSelector?: string
  readonly selector?: string
}

interface IResponsiveSurfaceCatalog {
  readonly schemaVersion: number
  readonly viewportMatrix: ReadonlyArray<{
    readonly id: string
    readonly width: number
    readonly height: number
    readonly zoom: number
  }>
  readonly surfaceGroups: Readonly<Record<string, ICatalogGroup>>
  readonly nestedSurfaces: ReadonlyArray<INestedSurface>
}

interface IVerifierMetadata {
  readonly conditional: boolean
}

interface IVerifierModule {
  readonly buildCatalogMetadata: () => ReadonlyMap<string, IVerifierMetadata>
  readonly decorateLedger: (
    ledger: ReadonlyArray<Record<string, unknown>>,
    metadata: ReadonlyMap<string, IVerifierMetadata>
  ) => ReadonlyArray<Record<string, any>>
  readonly findGateFailures: (
    ledger: ReadonlyArray<Record<string, any>>,
    metadata: ReadonlyMap<string, IVerifierMetadata>
  ) => ReadonlyArray<string>
  readonly validateLedger: (ledger: ReadonlyArray<Record<string, any>>) => void
}

const root = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const catalog = JSON.parse(
  read('.codex/verification/responsive_surface_catalog.json')
) as IResponsiveSurfaceCatalog
const verifierPath = resolve(
  root,
  '.codex/verification/verify_responsive_surface_matrix_cdp.js'
)
const verifierSource = read(
  '.codex/verification/verify_responsive_surface_matrix_cdp.js'
)
const fixtureSeederSource = read(
  '.codex/verification/seed_batch_clone_recovery_fixture.js'
)
const verifier = require(verifierPath) as IVerifierModule

const groupPrefixes = new Map([
  ['repositorySections', 'repository'],
  ['preferences', 'preferences'],
  ['repositorySettings', 'repository-settings'],
  ['cloneTabs', 'clone'],
  ['menuDialogs', 'menu'],
])

const expectedNestedSurfaceIds = [
  'appearance.anchored-element-editor',
  'appearance.element-history',
  'file-history.blame',
  'file-history.history',
  'notifications.github',
  'notifications.local',
  'popup.batch-clone-recovery',
  'preferences.copilot.models',
  'preferences.copilot.providers',
  'preferences.git.author',
  'preferences.git.default-branch',
  'preferences.git.global-ignore',
  'preferences.git.hooks',
  'repository.account-switcher',
  'repository.actions.workflow-catalog',
  'repository.actions.workflow-dispatch',
  'repository.actions.workflow-manager',
  'repository.api.functions',
  'repository.api.graphql',
  'repository.api.rest',
]

const expectedMenuDialogs = [
  'add-local-repository',
  'create-branch',
  'create-repository',
  'create-worktree',
  'export-repository-list',
  'export-tab-session',
  'import-repository-list',
  'import-tab-session',
  'inspect-branch-rules',
  'manage-sparse-checkout',
  'remove-repository',
  'show-about',
  'show-settings-history',
  'test-about-dialog',
  'test-cli-action',
  'test-confirm-committing-conflicted-files',
  'test-discarded-changes-will-be-unrecoverable',
  'test-do-you-want-fork-this-repository',
  'test-files-too-large',
  'test-generic-git-authentication',
  'test-icons',
  'test-invalidated-account-token',
  'test-move-to-application-folder',
  'test-newer-commits-on-remote',
  'test-notification',
  'test-push-rejected',
  'test-re-authorization-required',
  'test-release-notes-popup',
  'test-thank-you-popup',
  'test-unable-to-locate-git',
  'test-untrusted-server',
  'test-update-existing-git-lfs-filters',
  'test-upstream-already-exists',
]

const excludedTestMenuEvents = [
  'boomtown',
  'test-app-error',
  'test-arm64-banner',
  'test-cherry-pick-conflicts-banner',
  'test-merge-successful-banner',
  'test-no-external-editor',
  'test-os-version-no-longer-supported',
  'test-prioritized-update-banner',
  'test-prune-branches',
  'test-reorder-banner',
  'test-showcase-update-banner',
  'test-thank-you-banner',
  'test-unable-to-open-shell',
  'test-undone-banner',
  'test-update-banner',
]

function sourceReference(reference: string) {
  const [sourcePath, symbol, ...extra] = reference.split('#')
  assert.equal(extra.length, 0, `Invalid source reference ${reference}`)
  const source = read(sourcePath)
  if (symbol !== undefined) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(source, new RegExp(`\\b${escaped}\\b`), reference)
  }
  return { sourcePath, symbol, source }
}

function enumMembers(source: string, name: string): ReadonlyArray<string> {
  const sourceFile = ts.createSourceFile(
    'catalog-enum.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const declarations = new Array<ts.EnumDeclaration>()
  const visit = (node: ts.Node) => {
    if (ts.isEnumDeclaration(node) && node.name.text === name) {
      declarations.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.equal(declarations.length, 1, `Could not find enum ${name}`)
  return declarations[0].members.map(member => {
    assert.ok(ts.isIdentifier(member.name), `Unsupported ${name} member`)
    return member.name.text
  })
}

function constStringArrayMembers(
  source: string,
  name: string
): ReadonlyArray<string> {
  const sourceFile = ts.createSourceFile(
    'catalog-array.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const declarations = new Array<ts.VariableDeclaration>()
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === name) {
      declarations.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.equal(declarations.length, 1, `Could not find array ${name}`)
  const initializer = declarations[0].initializer
  if (initializer === undefined) {
    assert.fail(`${name} has no initializer`)
  }
  const array = ts.isAsExpression(initializer)
    ? initializer.expression
    : initializer
  assert.ok(ts.isArrayLiteralExpression(array), `${name} is not an array`)
  return array.elements.map(element => {
    assert.ok(ts.isStringLiteral(element), `Unsupported ${name} member`)
    return element.text
  })
}

function assertGroupMatchesEnum(groupName: string, enumName: string) {
  const group = catalog.surfaceGroups[groupName]
  assert.notEqual(group, undefined, `Missing catalog group ${groupName}`)
  const reference = sourceReference(group.source)
  assert.equal(reference.symbol, enumName)
  const expected = [...enumMembers(reference.source, enumName)].sort()
  const actual = group.surfaces.map(surface => surface.member).sort()
  assert.deepEqual(actual, expected)
}

function metadataRows(
  metadata: ReadonlyMap<string, IVerifierMetadata>,
  override?: Readonly<{ id: string; status: string }>
) {
  return [...metadata.entries()].map(([id, entry]) => {
    const status =
      override?.id === id
        ? override.status
        : entry.conditional
        ? 'not-applicable'
        : 'pass'
    const pass = status === 'pass'
    return {
      id,
      status,
      evidence: pass
        ? catalog.viewportMatrix.map(scenario => ({ scenario }))
        : [],
      capture: pass ? { path: `${id}.png`, sha256: 'a'.repeat(64) } : null,
      ...(id === 'popup.batch-clone-recovery' && pass
        ? {
            fixtureState: {
              title: 'Clone queue paused',
              summary: '0 done, 12 interrupted of 12',
              itemCount: 12,
              interruptedCount: 12,
              resumeEnabled: true,
              hidePresent: true,
            },
          }
        : {}),
    }
  })
}

describe('responsive surface smoke catalog', () => {
  it('tracks every registered top-level page and settings tab exactly', () => {
    assertGroupMatchesEnum('repositorySections', 'RepositorySectionTab')
    assertGroupMatchesEnum('preferences', 'PreferencesTab')
    assertGroupMatchesEnum('repositorySettings', 'RepositorySettingsTab')
    assertGroupMatchesEnum('cloneTabs', 'CloneRepositoryTab')
  })

  it('catalogs every safe menu dialog and excludes destructive test fixtures', () => {
    const menuDialogs = catalog.surfaceGroups.menuDialogs
    assert.notEqual(menuDialogs, undefined)
    sourceReference(menuDialogs.source)
    assert.deepEqual(
      menuDialogs.surfaces.map(surface => surface.member).sort(),
      expectedMenuDialogs
    )

    const productMenuSources = [
      read('app/src/main-process/menu/menu-event.ts'),
      read('app/src/ui/lib/test-ui-components/test-ui-components.ts'),
      read('app/src/ui/app.tsx'),
    ].join('\n')
    for (const surface of menuDialogs.surfaces) {
      assert.ok(
        productMenuSources.includes(`'${surface.member}'`),
        `Unknown menu dialog ${surface.member}`
      )
    }
    for (const excluded of excludedTestMenuEvents) {
      assert.ok(
        !menuDialogs.surfaces.some(surface => surface.member === excluded),
        `${excluded} must not run in the dialog smoke matrix`
      )
    }

    const registeredTestEvents = [
      ...constStringArrayMembers(
        read('app/src/main-process/menu/menu-event.ts'),
        'TestMenuEvents'
      ),
    ].sort()
    const classifiedTestEvents = [
      ...menuDialogs.surfaces
        .map(surface => surface.member)
        .filter(member => member.startsWith('test-')),
      ...excludedTestMenuEvents,
    ].sort()
    assert.deepEqual(classifiedTestEvents, registeredTestEvents)
  })

  it('covers exact nested routes and direct contextual editor selectors', () => {
    assert.deepEqual(
      catalog.nestedSurfaces.map(surface => surface.id).sort(),
      expectedNestedSurfaceIds
    )

    const allIds = new Set<string>()
    for (const [groupName, group] of Object.entries(catalog.surfaceGroups)) {
      sourceReference(group.source)
      const prefix = groupPrefixes.get(groupName)
      assert.notEqual(prefix, undefined, `Unknown group ${groupName}`)
      for (const surface of group.surfaces) {
        const id = `${prefix}.${surface.member}`
        assert.ok(!allIds.has(id), `Duplicate catalog surface ${id}`)
        allIds.add(id)
      }
    }

    const externalParents = new Set([
      'application',
      'popup.FileHistory',
      'notification-centre',
      'repository',
    ])
    for (const surface of catalog.nestedSurfaces) {
      sourceReference(surface.source)
      assert.ok(
        !allIds.has(surface.id),
        `Duplicate nested surface ${surface.id}`
      )
      allIds.add(surface.id)
      assert.ok(
        allIds.has(surface.parentId) || externalParents.has(surface.parentId),
        `Unknown parent ${surface.parentId} for ${surface.id}`
      )
    }

    const direct = new Map(
      catalog.nestedSurfaces
        .filter(surface => surface.ownerSelector !== undefined)
        .map(surface => [surface.id, surface])
    )
    assert.deepEqual([...direct.keys()].sort(), [
      'appearance.anchored-element-editor',
      'appearance.element-history',
      'repository.account-switcher',
      'repository.actions.workflow-catalog',
      'repository.actions.workflow-dispatch',
      'repository.actions.workflow-manager',
      'repository.api.functions',
    ])
    assert.deepEqual(direct.get('repository.account-switcher'), {
      id: 'repository.account-switcher',
      parentId: 'repository',
      kind: 'dialog',
      source:
        'app/src/ui/account-switcher/account-switcher.tsx#AccountSwitcher',
      label: 'Account switcher',
      risk: 'stateful',
      ownerSelector: '#repository',
      selector: '.account-switcher',
    })
    assert.deepEqual(direct.get('repository.actions.workflow-manager'), {
      id: 'repository.actions.workflow-manager',
      parentId: 'repository.Actions',
      kind: 'panel',
      source: 'app/src/ui/actions/workflow-manager.tsx#WorkflowManager',
      label: 'Workflow manager',
      risk: 'stateful',
      ownerSelector: '.actions-view',
      selector: '.actions-workflow-management',
    })
    assert.deepEqual(direct.get('repository.actions.workflow-catalog'), {
      id: 'repository.actions.workflow-catalog',
      parentId: 'repository.actions.workflow-manager',
      kind: 'dialog',
      source:
        'app/src/ui/actions/workflow-catalog-dialog.tsx#WorkflowCatalogDialog',
      label: 'Workflow catalog',
      risk: 'stateful',
      ownerSelector: '.actions-view',
      selector: '.workflow-catalog-dialog',
    })
    assert.deepEqual(direct.get('repository.actions.workflow-dispatch'), {
      id: 'repository.actions.workflow-dispatch',
      parentId: 'repository.Actions',
      kind: 'dialog',
      source:
        'app/src/ui/actions/workflow-dispatch-dialog.tsx#WorkflowDispatchDialog',
      label: 'Run workflow',
      risk: 'external',
      ownerSelector: '.actions-view',
      selector: '.workflow-dispatch-dialog',
    })
    assert.equal(
      direct.get('repository.api.functions')?.ownerSelector,
      '.github-api-explorer'
    )
    assert.equal(
      direct.get('repository.api.functions')?.selector,
      '.github-api-functions'
    )
    assert.equal(
      direct.get('appearance.anchored-element-editor')?.ownerSelector,
      '.anchored-appearance-editor'
    )
    assert.equal(
      direct.get('appearance.anchored-element-editor')?.selector,
      '.element-appearance-editor'
    )
    assert.equal(
      direct.get('appearance.element-history')?.ownerSelector,
      '.appearance-element-history-dialog'
    )
    assert.equal(
      direct.get('appearance.element-history')?.selector,
      '.versioned-store-history-toolbar'
    )
  })

  it('covers unique desktop, compact, short, wide, and zoom boundaries', () => {
    assert.equal(catalog.schemaVersion, 1)
    assert.equal(catalog.viewportMatrix.length, 8)
    const ids = catalog.viewportMatrix.map(scenario => scenario.id)
    assert.equal(new Set(ids).size, ids.length, 'Viewport ids must be unique')
    for (const required of [
      'desktop',
      'minimum',
      'narrow',
      'short',
      'wide',
      'zoom-125',
      'zoom-150',
      'minimum-zoom-200',
    ]) {
      assert.ok(
        ids.includes(required),
        `${required} is missing from the matrix`
      )
    }
    for (const scenario of catalog.viewportMatrix) {
      assert.ok(Number.isSafeInteger(scenario.width) && scenario.width > 0)
      assert.ok(Number.isSafeInteger(scenario.height) && scenario.height > 0)
      assert.ok(scenario.zoom >= 0.5 && scenario.zoom <= 2)
    }

    const minimumZoom = catalog.viewportMatrix.find(
      scenario => scenario.id === 'minimum-zoom-200'
    )
    if (minimumZoom === undefined) {
      assert.fail('minimum-zoom-200 is missing from the matrix')
    }
    assert.deepEqual(minimumZoom, {
      id: 'minimum-zoom-200',
      width: 640,
      height: 480,
      zoom: 2,
    })
    assert.ok(minimumZoom.width / minimumZoom.zoom <= 320)
    assert.ok(minimumZoom.height / minimumZoom.zoom <= 240)
  })

  it('makes every non-conditional catalog and menu surface a required gate', () => {
    const metadata = verifier.buildCatalogMetadata()
    const catalogCount =
      Object.values(catalog.surfaceGroups).reduce(
        (count, group) => count + group.surfaces.length,
        0
      ) + catalog.nestedSurfaces.length
    assert.equal(metadata.size, catalogCount)
    assert.equal(metadata.size, 85)
    assert.equal(
      [...metadata.keys()].filter(id => id !== 'popup.batch-clone-recovery')
        .length,
      84,
      'The 84 product surfaces remain cataloged beside the recovery popup.'
    )

    const baseline = verifier.decorateLedger(metadataRows(metadata), metadata)
    verifier.validateLedger(baseline)
    assert.deepEqual(verifier.findGateFailures(baseline, metadata), [])

    const blockedMenu = verifier.decorateLedger(
      metadataRows(metadata, {
        id: 'menu.add-local-repository',
        status: 'blocked',
      }),
      metadata
    )
    verifier.validateLedger(blockedMenu)
    assert.deepEqual(verifier.findGateFailures(blockedMenu, metadata), [
      'menu.add-local-repository:blocked',
    ])

    const missingRequired = baseline.filter(
      row => row.id !== 'file-history.history'
    )
    assert.deepEqual(verifier.findGateFailures(missingRequired, metadata), [
      'file-history.history:missing',
    ])

    const conditionalBlocked = verifier.decorateLedger(
      metadataRows(metadata, {
        id: 'preferences.Copilot',
        status: 'blocked',
      }),
      metadata
    )
    verifier.validateLedger(conditionalBlocked)
    assert.deepEqual(
      verifier.findGateFailures(conditionalBlocked, metadata),
      []
    )

    const conditionalFailed = verifier.decorateLedger(
      metadataRows(metadata, {
        id: 'preferences.Copilot',
        status: 'failed',
      }),
      metadata
    )
    verifier.validateLedger(conditionalFailed)
    assert.deepEqual(verifier.findGateFailures(conditionalFailed, metadata), [
      'preferences.Copilot',
    ])
  })

  it('enforces one stable schema row per surface', () => {
    const metadata = verifier.buildCatalogMetadata()
    const baseline = verifier.decorateLedger(metadataRows(metadata), metadata)
    const duplicate = [...baseline, baseline[0]]
    assert.throws(() => verifier.validateLedger(duplicate), /Duplicate/)

    const invalidStatus = baseline.map((row, index) =>
      index === 0 ? { ...row, status: 'skipped' } : row
    )
    assert.throws(() => verifier.validateLedger(invalidStatus), /status/)

    const incompletePass = baseline.map((row, index) =>
      index === 0 ? { ...row, evidence: [] } : row
    )
    assert.throws(() => verifier.validateLedger(incompletePass), /Incomplete/)

    const missingRecoveryFixture = baseline.map(row =>
      row.id === 'popup.batch-clone-recovery'
        ? { ...row, fixtureState: undefined }
        : row
    )
    assert.throws(
      () => verifier.validateLedger(missingRecoveryFixture),
      /fixture state/
    )
  })

  it('binds fixture mutation and every output to the owned Temp root', () => {
    assert.match(
      verifierSource,
      /const realpathSync = fs\.realpathSync\.native \?\? fs\.realpathSync/
    )
    assert.match(
      verifierSource,
      /realpathSync\(path\.resolve\(os\.tmpdir\(\)\)\)/
    )
    assert.match(verifierSource, /isWithin\(tempRoot, runRoot\)/)
    assert.match(verifierSource, /isWithin\(runRoot, repositoryPath\)/)
    assert.match(verifierSource, /isWithin\(runRoot, realParent, true\)/)
    assert.match(
      verifierSource,
      /prepareFileHistoryFixture\(options\.repositoryPath\)/
    )
    assert.ok(
      verifierSource.indexOf(
        'prepareFileHistoryFixture(options.repositoryPath)'
      ) < verifierSource.indexOf('const browser = await connect(options.port)')
    )
    assert.match(verifierSource, /responsive-file-history-probe\.txt/)
    assert.match(verifierSource, /status', '--porcelain=v1'/)
    assert.match(verifierSource, /Material Responsive Verifier\\u0000/)
    assert.match(
      verifierSource,
      /const nonModalDialogSelector = '\[role="dialog"\]\[aria-modal="false"\]'/
    )
    assert.match(
      verifierSource,
      /!scrollOwners\.some\([\s\S]*owner !== element && element\.contains\(owner\)/
    )
    assert.match(
      verifierSource,
      /decorativeOverlays[\s\S]*canvas, \[role="tooltip"\][\s\S]*style\.position === 'absolute'[\s\S]*style\.pointerEvents === 'none'[\s\S]*measureLayout/
    )
    assert.match(
      verifierSource,
      /visibleTab\(page, 'Changes', '#changes-tab'\)/
    )
    assert.match(
      verifierSource,
      /const rootBounds = root\.getBoundingClientRect\(\)[\s\S]*rect\.bottom > rootBounds\.top[\s\S]*const lastControl/
    )
    assert.match(
      verifierSource,
      /!element\.classList\.contains\('ReactVirtualized__Grid'\)/
    )
    assert.match(
      verifierSource,
      /#repository-sidebar \.panel[\s\S]*element\.scrollTop = 0[\s\S]*hasText: fileHistoryProbe/
    )
    assert.match(verifierSource, /for \(const id of metadata\.keys\(\)\)/)
    assert.match(
      verifierSource,
      /auditBatchCloneRecoveryPopup\(page, session, options, ledger\)/
    )
    assert.ok(
      verifierSource.indexOf(
        'await auditBatchCloneRecoveryPopup(page, session, options, ledger)'
      ) <
        verifierSource.indexOf(
          'await prepareApp(page, options.repositoryPath)'
        ),
      'The initially visible recovery popup must be audited before app preparation.'
    )
    assert.match(verifierSource, /dialog#batch-clone-progress/)
    assert.match(verifierSource, /fixtureState\.title !== 'Clone queue paused'/)
    assert.match(
      verifierSource,
      /fixtureState\.interruptedCount !== fixtureState\.itemCount/
    )
    assert.match(verifierSource, /!fixtureState\.resumeEnabled/)
    assert.match(verifierSource, /!fixtureState\.hidePresent/)
    assert.match(verifierSource, /row = \{ \.\.\.matrixRow, fixtureState \}/)
    assert.match(
      verifierSource,
      /owner\.label\.split\('\.'\)\.includes\('batch-clone-list'\)/
    )
    assert.match(verifierSource, /receipt\.lastControl\?\.label !== 'Hide'/)
    assert.match(
      verifierSource,
      /getByRole\('button', \{ name: 'Hide', exact: true \}\)/
    )
    assert.match(fixtureSeederSource, /RecoveryIdBytes = 24/)
    assert.match(fixtureSeederSource, /\^\[a-f\\d\]\{48\}\$/)
    assert.match(fixtureSeederSource, /version: 2/)
    assert.match(fixtureSeederSource, /kind: 'interrupted'/)
    assert.match(fixtureSeederSource, /paused: true/)
    assert.match(fixtureSeederSource, /source: 'manual'/)
    assert.match(fixtureSeederSource, /!isWithin\(runRoot, candidate\)/)
    assert.match(fixtureSeederSource, /openSync\(journalPath, 'wx', 0o600\)/)
    assert.doesNotMatch(fixtureSeederSource, /(?:ghp_|github_pat_|Bearer )/)
  })
})
