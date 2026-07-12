import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  parseFreeformWorkflowInputs,
  parseWorkflowDispatchInputs,
} from '../../src/lib/actions-workflow-inputs'

describe('workflow dispatch inputs', () => {
  it('parses typed workflow_dispatch inputs', () => {
    const result = parseWorkflowDispatchInputs(`
name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Where to deploy
        required: true
        type: choice
        options: [staging, production]
      dry_run:
        type: boolean
        default: true
`)

    assert.equal(result.available, true)
    assert.deepEqual(result.inputs, [
      {
        name: 'environment',
        description: 'Where to deploy',
        required: true,
        type: 'choice',
        defaultValue: '',
        options: ['staging', 'production'],
      },
      {
        name: 'dry_run',
        description: '',
        required: false,
        type: 'boolean',
        defaultValue: 'true',
        options: [],
      },
    ])
  })

  it('degrades to freeform name=value input parsing', () => {
    assert.deepEqual(
      parseFreeformWorkflowInputs('target=prod\ndry_run=false'),
      {
        target: 'prod',
        dry_run: 'false',
      }
    )
    assert.throws(() => parseFreeformWorkflowInputs('invalid'))
  })
})
