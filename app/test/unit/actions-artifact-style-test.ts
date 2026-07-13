import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const source = readFileSync(
  join(process.cwd(), 'app/styles/ui/_actions-view.scss'),
  'utf8'
)

describe('Actions artifact responsive styles', () => {
  it('keeps the run pager inside a vertically scrolling, zero-min-width column', () => {
    assert.match(
      source,
      /\.actions-run-column\s*\{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?min-width: min\(360px, 100%\);[\s\S]*?min-height: 0;/
    )
    assert.match(
      source,
      /\.actions-run-pagination\s*\{[\s\S]*?min-width: 0;[\s\S]*?flex-wrap: wrap;[\s\S]*?> span\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      source,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-run-pagination\s*\{[\s\S]*?flex-direction: column;[\s\S]*?width: 100%;/
    )
  })

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
      /\.actions-run-summary[\s\S]*?> strong\s*\{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      source,
      /\.branch-chip\s*\{[\s\S]*?max-width: 100%;[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      source,
      /\.actions-actor\s*\{[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      source,
      /\.actions-details-header\s*\{[\s\S]*?> \.button-component\s*\{[\s\S]*?max-width: 100%;[\s\S]*?flex: 0 0 auto;/
    )
    assert.match(
      source,
      /\.actions-artifact-pagination\s*\{[\s\S]*?min-width: 0;[\s\S]*?flex-wrap: wrap;[\s\S]*?overflow-wrap: anywhere;/
    )
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
    assert.match(
      source,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-artifact-pagination\s*\{[\s\S]*?flex-direction: column;[\s\S]*?width: 100%;/
    )
  })
})
