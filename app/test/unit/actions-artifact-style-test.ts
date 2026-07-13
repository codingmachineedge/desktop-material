import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const source = readFileSync(
  join(process.cwd(), 'app/styles/ui/_actions-view.scss'),
  'utf8'
)

describe('Actions artifact responsive styles', () => {
  it('constrains nested panels and artifact cards without horizontal scrolling', () => {
    assert.match(
      source,
      /\.actions-run-details\s*\{[\s\S]*?min-width: min\(300px, 100%\);[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/
    )
    assert.match(
      source,
      /\.actions-artifact-grid\s*\{[\s\S]*?min-width: 0;[\s\S]*?minmax\(min\(100%, 280px\), 1fr\)/
    )
    assert.match(
      source,
      /\.actions-artifact-card\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/
    )
    assert.doesNotMatch(
      source.slice(source.indexOf('.actions-artifacts')),
      /overflow-x:\s*(?:auto|scroll)/
    )
  })

  it('wraps oversized names, digests, controls, and stacks at minimum width', () => {
    assert.match(
      source,
      /\.actions-artifact-card[\s\S]*?h4\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      source,
      /code\s*\{[\s\S]*?white-space: normal;[\s\S]*?word-break: break-all;/
    )
    assert.match(
      source,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-artifact-grid\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      source,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-artifact-buttons\s*\{[\s\S]*?flex: 1 1 100%;/
    )
  })

  it('keeps the branch-rules inspector bounded and stacked at minimum width', () => {
    assert.match(
      source,
      /\.actions-branch-rules\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-height: min\(260px, 35vh\);[\s\S]*?overflow: hidden;/
    )
    assert.match(
      source,
      /\.actions-branch-rules-result[\s\S]*?ul\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      source,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-branch-rules\s*\{[\s\S]*?flex-direction: column;/
    )
    assert.match(
      source,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-branch-rules-result li\s*\{[\s\S]*?flex-direction: column;/
    )
  })
})
