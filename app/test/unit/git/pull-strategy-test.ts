import assert from 'node:assert'
import { describe, it } from 'node:test'
import { exec } from 'dugite'

import {
  createPullStrategyPlan,
  getFrozenPullStrategyArguments,
  getPullStrategyConfiguration,
  getPullStrategyPlan,
  IPullStrategyConfiguration,
  PullStrategyError,
  PullStrategyOutcome,
  pullStrategyPlansEqual,
} from '../../../src/lib/git/pull-strategy'
import { Repository } from '../../../src/models/repository'
import { setupEmptyRepository } from '../../helpers/repositories'

async function setConfig(
  repository: Repository,
  key: string,
  value: string
): Promise<void> {
  const result = await exec(['config', key, value], repository.path)
  assert.equal(result.exitCode, 0)
}

async function unsetConfig(repository: Repository, key: string): Promise<void> {
  const result = await exec(['config', '--unset-all', key], repository.path)
  assert.ok(result.exitCode === 0 || result.exitCode === 5)
}

interface IStrategyCase {
  readonly name: string
  readonly configuration: IPullStrategyConfiguration
  readonly ahead: number
  readonly behind: number
  readonly outcome: PullStrategyOutcome | null
  readonly canIntegrate: boolean
  readonly arguments: ReadonlyArray<string>
}

describe('git/pull-strategy', () => {
  it('matches Git pull outcomes across fast-forward and divergent topologies', () => {
    const cases: ReadonlyArray<IStrategyCase> = [
      {
        name: 'Desktop default fast-forwards linear history',
        configuration: { rebase: 'false', ff: 'ff' },
        ahead: 0,
        behind: 2,
        outcome: 'fast-forward',
        canIntegrate: true,
        arguments: ['--no-rebase', '--ff'],
      },
      {
        name: 'Desktop default merges divergent history',
        configuration: { rebase: 'false', ff: 'ff' },
        ahead: 1,
        behind: 2,
        outcome: 'merge',
        canIntegrate: true,
        arguments: ['--no-rebase', '--ff'],
      },
      {
        name: 'no-ff creates a merge even when fast-forwarding is possible',
        configuration: { rebase: 'false', ff: 'no-ff' },
        ahead: 0,
        behind: 2,
        outcome: 'merge',
        canIntegrate: true,
        arguments: ['--no-rebase', '--no-ff'],
      },
      {
        name: 'no-ff also merges divergent history',
        configuration: { rebase: 'false', ff: 'no-ff' },
        ahead: 1,
        behind: 2,
        outcome: 'merge',
        canIntegrate: true,
        arguments: ['--no-rebase', '--no-ff'],
      },
      {
        name: 'boolean rebase fast-forwards linear history',
        configuration: { rebase: 'true', ff: 'no-ff' },
        ahead: 0,
        behind: 2,
        outcome: 'fast-forward',
        canIntegrate: true,
        arguments: ['--rebase=true', '--ff'],
      },
      {
        name: 'boolean rebase replays divergent history',
        configuration: { rebase: 'true', ff: 'ff' },
        ahead: 1,
        behind: 2,
        outcome: 'rebase',
        canIntegrate: true,
        arguments: ['--rebase=true', '--ff'],
      },
      {
        name: 'merges mode preserves local merges while rebasing',
        configuration: { rebase: 'merges', ff: 'ff' },
        ahead: 1,
        behind: 2,
        outcome: 'rebase-merges',
        canIntegrate: true,
        arguments: ['--rebase=merges', '--ff'],
      },
      {
        name: 'interactive mode performs an interactive rebase',
        configuration: { rebase: 'interactive', ff: 'ff' },
        ahead: 1,
        behind: 2,
        outcome: 'rebase-interactive',
        canIntegrate: true,
        arguments: ['--rebase=interactive', '--ff'],
      },
      {
        name: 'ff-only fast-forwards linear history and overrides rebase',
        configuration: { rebase: 'true', ff: 'ff-only' },
        ahead: 0,
        behind: 2,
        outcome: 'fast-forward',
        canIntegrate: true,
        arguments: ['--no-rebase', '--ff-only'],
      },
      {
        name: 'ff-only blocks divergent history and overrides rebase',
        configuration: { rebase: 'true', ff: 'ff-only' },
        ahead: 1,
        behind: 2,
        outcome: 'fast-forward-only-blocked',
        canIntegrate: false,
        arguments: ['--no-rebase', '--ff-only'],
      },
      {
        name: 'no incoming commits has no integration outcome',
        configuration: { rebase: 'merges', ff: 'ff' },
        ahead: 3,
        behind: 0,
        outcome: null,
        canIntegrate: false,
        arguments: ['--rebase=merges', '--ff'],
      },
    ]

    for (const testCase of cases) {
      const plan = createPullStrategyPlan(
        testCase.configuration,
        testCase.ahead,
        testCase.behind
      )
      assert.equal(plan.outcome, testCase.outcome, testCase.name)
      assert.equal(plan.canIntegrate, testCase.canIntegrate, testCase.name)
      assert.deepEqual(
        plan.strategyArguments,
        testCase.arguments,
        testCase.name
      )
    }
  })

  it('uses branch rebase configuration before repository-wide configuration', async t => {
    const repository = await setupEmptyRepository(t)
    await setConfig(repository, 'pull.rebase', 'true')
    await setConfig(repository, 'branch.master.rebase', 'false')

    assert.deepEqual(
      await getPullStrategyConfiguration(repository, 'refs/heads/master'),
      { rebase: 'false', ff: 'ff' }
    )

    await setConfig(repository, 'pull.rebase', 'false')
    await setConfig(repository, 'branch.master.rebase', 'm')
    assert.deepEqual(
      await getPullStrategyConfiguration(repository, 'refs/heads/master'),
      { rebase: 'merges', ff: 'ff' }
    )

    await setConfig(repository, 'branch.master.rebase', 'i')
    assert.deepEqual(
      await getPullStrategyConfiguration(repository, 'refs/heads/master'),
      { rebase: 'interactive', ff: 'ff' }
    )

    await unsetConfig(repository, 'branch.master.rebase')
    assert.deepEqual(
      await getPullStrategyConfiguration(repository, 'refs/heads/master'),
      { rebase: 'false', ff: 'ff' }
    )
  })

  it('normalizes Git boolean aliases and non-boolean rebase modes', async t => {
    const repository = await setupEmptyRepository(t)
    const trueValues = ['true', 'TRUE', 'yes', 'on', '1', '2']
    const falseValues = ['false', 'FALSE', 'no', 'off', '0', '']

    for (const value of trueValues) {
      await setConfig(repository, 'pull.rebase', value)
      const actual = await getPullStrategyConfiguration(
        repository,
        'refs/heads/master'
      )
      assert.equal(actual.rebase, 'true', value)
    }

    for (const value of falseValues) {
      await setConfig(repository, 'pull.rebase', value)
      const actual = await getPullStrategyConfiguration(
        repository,
        'refs/heads/master'
      )
      assert.equal(actual.rebase, 'false', `<${value}>`)
    }

    for (const [value, expected] of [
      ['merges', 'merges'],
      ['m', 'merges'],
      ['interactive', 'interactive'],
      ['i', 'interactive'],
    ] as const) {
      await setConfig(repository, 'pull.rebase', value)
      const actual = await getPullStrategyConfiguration(
        repository,
        'refs/heads/master'
      )
      assert.equal(actual.rebase, expected, value)
    }
  })

  it('normalizes pull.ff values and applies Desktop default ff behavior', async t => {
    const repository = await setupEmptyRepository(t)
    assert.equal(
      (await getPullStrategyConfiguration(repository, 'refs/heads/master')).ff,
      'ff'
    )

    for (const value of ['true', 'yes', 'on', '1', '2']) {
      await setConfig(repository, 'pull.ff', value)
      const actual = await getPullStrategyConfiguration(
        repository,
        'refs/heads/master'
      )
      assert.equal(actual.ff, 'ff', value)
    }

    for (const value of ['false', 'no', 'off', '0', '']) {
      await setConfig(repository, 'pull.ff', value)
      const actual = await getPullStrategyConfiguration(
        repository,
        'refs/heads/master'
      )
      assert.equal(actual.ff, 'no-ff', `<${value}>`)
    }

    await setConfig(repository, 'pull.ff', 'only')
    assert.equal(
      (await getPullStrategyConfiguration(repository, 'refs/heads/master')).ff,
      'ff-only'
    )
  })

  it('fails closed for invalid configuration and branch refs', async t => {
    const repository = await setupEmptyRepository(t)

    await setConfig(repository, 'pull.rebase', 'preserve')
    await assert.rejects(
      getPullStrategyConfiguration(repository, 'refs/heads/master'),
      (error: unknown) =>
        error instanceof PullStrategyError &&
        error.code === 'invalid-config' &&
        error.configKey === 'pull.rebase' &&
        error.configValue === 'preserve'
    )

    await setConfig(repository, 'pull.rebase', 'true')
    await setConfig(repository, 'branch.master.rebase', 'unexpected')
    await assert.rejects(
      getPullStrategyConfiguration(repository, 'refs/heads/master'),
      (error: unknown) =>
        error instanceof PullStrategyError &&
        error.code === 'invalid-config' &&
        error.configKey === 'branch.master.rebase'
    )

    await unsetConfig(repository, 'branch.master.rebase')
    await setConfig(repository, 'pull.ff', 'ONLY')
    await assert.rejects(
      getPullStrategyConfiguration(repository, 'refs/heads/master'),
      (error: unknown) =>
        error instanceof PullStrategyError &&
        error.code === 'invalid-config' &&
        error.configKey === 'pull.ff'
    )

    await assert.rejects(
      getPullStrategyConfiguration(repository, 'refs/remotes/origin/master'),
      (error: unknown) =>
        error instanceof PullStrategyError &&
        error.code === 'invalid-branch-ref'
    )
  })

  it('builds plans from repository configuration and compares semantic identity', async t => {
    const repository = await setupEmptyRepository(t)
    await setConfig(repository, 'pull.rebase', 'merges')
    await setConfig(repository, 'pull.ff', 'false')

    const plan = await getPullStrategyPlan(
      repository,
      'refs/heads/master',
      2,
      3
    )
    assert.deepEqual(plan, {
      rebase: 'merges',
      ff: 'no-ff',
      configurationSnapshot: {
        branchRebase: null,
        pullRebase: 'merges',
        pullFF: 'false',
      },
      ahead: 2,
      behind: 3,
      outcome: 'rebase-merges',
      canIntegrate: true,
      strategyArguments: ['--rebase=merges', '--ff'],
    })

    assert.equal(
      pullStrategyPlansEqual(
        plan,
        createPullStrategyPlan(
          { rebase: 'merges', ff: 'no-ff' },
          2,
          3,
          plan.configurationSnapshot
        )
      ),
      true
    )
    assert.equal(
      pullStrategyPlansEqual(
        plan,
        createPullStrategyPlan(
          { rebase: 'true', ff: 'no-ff' },
          2,
          3,
          plan.configurationSnapshot
        )
      ),
      false
    )
    assert.equal(
      pullStrategyPlansEqual(
        plan,
        createPullStrategyPlan(
          { rebase: 'merges', ff: 'no-ff' },
          1,
          3,
          plan.configurationSnapshot
        )
      ),
      false
    )
    assert.equal(
      pullStrategyPlansEqual(plan, {
        ...plan,
        strategyArguments: ['--no-rebase', '--ff-only'],
      }),
      false
    )
  })

  it('invalidates an exact raw configuration change even when semantics stay equal', async t => {
    const repository = await setupEmptyRepository(t)
    await setConfig(repository, 'branch.master.rebase', 'false')
    await setConfig(repository, 'pull.rebase', 'true')
    await setConfig(repository, 'pull.ff', 'false')

    const reviewed = await getPullStrategyPlan(
      repository,
      'refs/heads/master',
      0,
      2
    )
    assert.deepEqual(reviewed.configurationSnapshot, {
      branchRebase: 'false',
      pullRebase: 'true',
      pullFF: 'false',
    })
    assert.equal(reviewed.outcome, 'merge')

    // Both edits preserve the normalized merge plan: branch rebase still
    // overrides pull.rebase, and "no" is another false boolean spelling.
    await setConfig(repository, 'pull.rebase', 'merges')
    await setConfig(repository, 'pull.ff', 'no')
    const current = await getPullStrategyPlan(
      repository,
      'refs/heads/master',
      0,
      2
    )

    assert.equal(current.outcome, 'merge')
    assert.equal(current.rebase, reviewed.rebase)
    assert.equal(current.ff, reviewed.ff)
    assert.equal(pullStrategyPlansEqual(reviewed, current), false)
  })

  it('rejects invalid topology and exposes frozen arguments independently', () => {
    assert.throws(
      () => createPullStrategyPlan({ rebase: 'false', ff: 'ff' }, -1, 1),
      (error: unknown) =>
        error instanceof PullStrategyError && error.code === 'invalid-topology'
    )
    assert.throws(
      () =>
        createPullStrategyPlan(
          { rebase: 'false', ff: 'ff' },
          Number.POSITIVE_INFINITY,
          1
        ),
      (error: unknown) =>
        error instanceof PullStrategyError && error.code === 'invalid-topology'
    )

    assert.deepEqual(
      getFrozenPullStrategyArguments({ rebase: 'interactive', ff: 'no-ff' }),
      ['--rebase=interactive', '--ff']
    )
  })
})
