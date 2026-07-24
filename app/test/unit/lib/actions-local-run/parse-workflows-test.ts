import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  findReleaseUploadSteps,
  parseDispatchInputs,
  parseEvents,
  parseJobs,
  parseWorkflow,
} from '../../../../src/lib/actions-local-run/parse-workflows'

describe('parseEvents', () => {
  it('reads a single string trigger', () => {
    assert.deepStrictEqual(parseEvents('push'), ['push'])
  })

  it('reads an array of triggers', () => {
    assert.deepStrictEqual(parseEvents(['push', 'pull_request']), [
      'push',
      'pull_request',
    ])
  })

  it('reads a map of triggers', () => {
    assert.deepStrictEqual(
      parseEvents({ push: { branches: ['main'] }, workflow_dispatch: null }),
      ['push', 'workflow_dispatch']
    )
  })

  it('de-duplicates and ignores non-string entries', () => {
    assert.deepStrictEqual(parseEvents(['push', 'push', 42]), ['push'])
  })

  it('returns an empty list for unknown shapes', () => {
    assert.deepStrictEqual(parseEvents(null), [])
    assert.deepStrictEqual(parseEvents(undefined), [])
  })
})

describe('parseDispatchInputs', () => {
  it('parses declared workflow_dispatch inputs with metadata', () => {
    const inputs = parseDispatchInputs({
      workflow_dispatch: {
        inputs: {
          environment: {
            description: 'Target environment',
            required: true,
            type: 'choice',
            default: 'staging',
            options: ['staging', 'production'],
          },
          verbose: { type: 'boolean' },
        },
      },
    })
    assert.strictEqual(inputs.length, 2)
    const env = inputs[0]
    assert.strictEqual(env.name, 'environment')
    assert.strictEqual(env.description, 'Target environment')
    assert.strictEqual(env.required, true)
    assert.strictEqual(env.type, 'choice')
    assert.strictEqual(env.defaultValue, 'staging')
    assert.deepStrictEqual(env.options, ['staging', 'production'])
    assert.strictEqual(inputs[1].name, 'verbose')
    assert.strictEqual(inputs[1].type, 'boolean')
    assert.strictEqual(inputs[1].required, false)
  })

  it('tolerates a bare input with no spec', () => {
    const inputs = parseDispatchInputs({
      workflow_dispatch: { inputs: { name: null } },
    })
    assert.strictEqual(inputs.length, 1)
    assert.strictEqual(inputs[0].name, 'name')
    assert.strictEqual(inputs[0].type, null)
  })

  it('returns empty when there is no workflow_dispatch', () => {
    assert.deepStrictEqual(parseDispatchInputs({ push: {} }), [])
    assert.deepStrictEqual(parseDispatchInputs('push'), [])
  })
})

describe('parseJobs', () => {
  it('extracts job ids and optional names', () => {
    const jobs = parseJobs({
      build: { name: 'Build the app', steps: [] },
      test: { steps: [] },
    })
    assert.deepStrictEqual(jobs, [
      { id: 'build', name: 'Build the app' },
      { id: 'test', name: null },
    ])
  })

  it('returns empty for non-map jobs', () => {
    assert.deepStrictEqual(parseJobs(null), [])
    assert.deepStrictEqual(parseJobs(['x']), [])
  })
})

describe('findReleaseUploadSteps', () => {
  it('flags a softprops/action-gh-release step', () => {
    const matches = findReleaseUploadSteps({
      release: {
        steps: [
          { name: 'Checkout', uses: 'actions/checkout@v4' },
          { name: 'Publish', uses: 'softprops/action-gh-release@v2' },
        ],
      },
    })
    assert.strictEqual(matches.length, 1)
    assert.match(matches[0], /release: Publish/)
  })

  it('flags a `gh release upload` run step', () => {
    const matches = findReleaseUploadSteps({
      ship: {
        steps: [{ run: 'gh release upload v1.0.0 ./out/app.zip' }],
      },
    })
    assert.strictEqual(matches.length, 1)
  })

  it('returns empty when no step uploads a release', () => {
    const matches = findReleaseUploadSteps({
      build: { steps: [{ run: 'npm run build' }] },
    })
    assert.deepStrictEqual(matches, [])
  })
})

describe('parseWorkflow', () => {
  it('parses a complete workflow file', () => {
    const text = `
name: CI
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      reason:
        description: Why
        required: false
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: softprops/action-gh-release@v2
`
    const workflow = parseWorkflow('.github/workflows/ci.yml', text)
    assert.strictEqual(workflow.parseError, null)
    assert.strictEqual(workflow.fileName, 'ci.yml')
    assert.strictEqual(workflow.name, 'CI')
    assert.deepStrictEqual(workflow.events, ['push', 'workflow_dispatch'])
    assert.deepStrictEqual(
      workflow.jobs.map(j => j.id),
      ['build', 'release']
    )
    assert.strictEqual(workflow.dispatchInputs.length, 1)
    assert.strictEqual(workflow.dispatchInputs[0].name, 'reason')
    assert.strictEqual(workflow.releaseUploadSteps.length, 1)
  })

  it('does not drop a file that fails to parse', () => {
    const workflow = parseWorkflow(
      '.github/workflows/bad.yml',
      ': : not yaml : :'
    )
    assert.notStrictEqual(workflow.parseError, null)
    assert.strictEqual(workflow.fileName, 'bad.yml')
    assert.deepStrictEqual(workflow.events, [])
  })

  it('reports a non-mapping document as a parse error', () => {
    const workflow = parseWorkflow(
      '.github/workflows/list.yml',
      '- just\n- a\n- list'
    )
    assert.notStrictEqual(workflow.parseError, null)
  })
})
