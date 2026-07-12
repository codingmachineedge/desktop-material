import { describe, it } from 'node:test'
import assert from 'node:assert'
import { ActionsLogParser } from '../../src/lib/actions-log-parser/action-log-parser'
import {
  getActionsLogLineText,
  getVisibleActionsLogLines,
} from '../../src/ui/actions/job-log-viewer'

describe('Actions job log viewer', () => {
  it('uses the Actions parser for ANSI text and searchable line content', () => {
    const lines = new ActionsLogParser(
      '\u001b[31mfailed\u001b[0m at https://example.com',
      ''
    ).getParsedLogLinesTemplateData()

    assert.equal(
      getActionsLogLineText(lines[0]),
      'failed at https://example.com'
    )
    assert(
      lines[0].lineContent.some(content => content.classes.includes('ansifg-r'))
    )
  })

  it('hides lines within collapsed workflow groups', () => {
    const lines = new ActionsLogParser(
      '##[group]Build\ninside\n##[endgroup]\noutside',
      ''
    ).getParsedLogLinesTemplateData()
    const group = lines.find(line => line.isGroup)
    assert(group)

    const visible = getVisibleActionsLogLines(
      lines,
      new Set([group.lineNumber])
    )
    assert.equal(
      visible.some(line => getActionsLogLineText(line).includes('inside')),
      false
    )
    assert.equal(
      visible.some(line => getActionsLogLineText(line).includes('outside')),
      true
    )
  })
})
