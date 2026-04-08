import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  extractConflictHunks,
  formatConflictContextForPrompt,
  ICopilotConflictContext,
} from '../../src/lib/copilot-conflict-context'

describe('copilot-conflict-context', () => {
  describe('extractConflictHunks', () => {
    it('extracts a standard two-way conflict hunk', () => {
      const content = [
        'line before',
        '<<<<<<< HEAD',
        'our change',
        '=======',
        'their change',
        '>>>>>>> feature',
        'line after',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].oursContent, 'our change')
      assert.equal(hunks[0].theirsContent, 'their change')
      assert.equal(hunks[0].baseContent, null)
    })

    it('extracts a diff3 three-way conflict hunk', () => {
      const content = [
        'unchanged',
        '<<<<<<< HEAD',
        'our version',
        '||||||| merged common ancestors',
        'original version',
        '=======',
        'their version',
        '>>>>>>> feature',
        'more unchanged',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].oursContent, 'our version')
      assert.equal(hunks[0].baseContent, 'original version')
      assert.equal(hunks[0].theirsContent, 'their version')
    })

    it('extracts multiple conflict hunks from one file', () => {
      const content = [
        'start',
        '<<<<<<< HEAD',
        'ours-1',
        '=======',
        'theirs-1',
        '>>>>>>> feature',
        'middle',
        '<<<<<<< HEAD',
        'ours-2',
        '=======',
        'theirs-2',
        '>>>>>>> feature',
        'end',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 2)
      assert.equal(hunks[0].oursContent, 'ours-1')
      assert.equal(hunks[0].theirsContent, 'theirs-1')
      assert.equal(hunks[1].oursContent, 'ours-2')
      assert.equal(hunks[1].theirsContent, 'theirs-2')
    })

    it('returns an empty array when no conflict markers are present', () => {
      const content = 'just a normal file\nwith no conflicts\n'

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 0)
    })

    it('includes surrounding context lines', () => {
      const content = [
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        '<<<<<<< HEAD',
        'our change',
        '=======',
        'their change',
        '>>>>>>> feature',
        'line 5',
        'line 6',
        'line 7',
        'line 8',
      ].join('\n')

      const hunks = extractConflictHunks(content, 3)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].contextBefore, 'line 2\nline 3\nline 4')
      assert.equal(hunks[0].contextAfter, 'line 5\nline 6\nline 7')
    })

    it('respects custom contextLines parameter', () => {
      const content = [
        'line 1',
        'line 2',
        'line 3',
        'line 4',
        '<<<<<<< HEAD',
        'our change',
        '=======',
        'their change',
        '>>>>>>> feature',
        'line 5',
        'line 6',
        'line 7',
        'line 8',
      ].join('\n')

      const hunks = extractConflictHunks(content, 1)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].contextBefore, 'line 4')
      assert.equal(hunks[0].contextAfter, 'line 5')
    })

    it('handles zero context lines', () => {
      const content = [
        'line before',
        '<<<<<<< HEAD',
        'ours',
        '=======',
        'theirs',
        '>>>>>>> feature',
        'line after',
      ].join('\n')

      const hunks = extractConflictHunks(content, 0)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].contextBefore, '')
      assert.equal(hunks[0].contextAfter, '')
    })

    it('handles conflict markers at the start of the file', () => {
      const content = [
        '<<<<<<< HEAD',
        'ours',
        '=======',
        'theirs',
        '>>>>>>> feature',
        'after',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].contextBefore, '')
      assert.equal(hunks[0].oursContent, 'ours')
      assert.equal(hunks[0].theirsContent, 'theirs')
      assert.equal(hunks[0].contextAfter, 'after')
    })

    it('handles conflict markers at the end of the file', () => {
      const content = [
        'before',
        '<<<<<<< HEAD',
        'ours',
        '=======',
        'theirs',
        '>>>>>>> feature',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].contextBefore, 'before')
      assert.equal(hunks[0].oursContent, 'ours')
      assert.equal(hunks[0].theirsContent, 'theirs')
      assert.equal(hunks[0].contextAfter, '')
    })

    it('handles multi-line content in each section', () => {
      const content = [
        '<<<<<<< HEAD',
        'our line 1',
        'our line 2',
        'our line 3',
        '=======',
        'their line 1',
        'their line 2',
        '>>>>>>> feature',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].oursContent, 'our line 1\nour line 2\nour line 3')
      assert.equal(hunks[0].theirsContent, 'their line 1\ntheir line 2')
    })

    it('handles empty ours content', () => {
      const content = [
        '<<<<<<< HEAD',
        '=======',
        'their change',
        '>>>>>>> feature',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].oursContent, '')
      assert.equal(hunks[0].theirsContent, 'their change')
    })

    it('handles empty theirs content', () => {
      const content = [
        '<<<<<<< HEAD',
        'our change',
        '=======',
        '>>>>>>> feature',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].oursContent, 'our change')
      assert.equal(hunks[0].theirsContent, '')
    })

    it('does not treat markers inside content as boundaries', () => {
      // Conflict markers must start at column 0 with exactly 7 characters
      const content = [
        '<<<<<<< HEAD',
        'const s = "<<<<<<< not a real marker"',
        '=======',
        'const s = ">>>>>>> also not real"',
        '>>>>>>> feature',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(
        hunks[0].oursContent,
        'const s = "<<<<<<< not a real marker"'
      )
      assert.equal(hunks[0].theirsContent, 'const s = ">>>>>>> also not real"')
    })

    it('skips a malformed hunk with no closing marker', () => {
      const content = [
        '<<<<<<< HEAD',
        'ours',
        '=======',
        'theirs without closing marker',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 0)
    })

    it('handles diff3 with multi-line base content', () => {
      const content = [
        '<<<<<<< HEAD',
        'ours',
        '||||||| base',
        'base line 1',
        'base line 2',
        '=======',
        'theirs',
        '>>>>>>> feature',
      ].join('\n')

      const hunks = extractConflictHunks(content)

      assert.equal(hunks.length, 1)
      assert.equal(hunks[0].baseContent, 'base line 1\nbase line 2')
    })
  })

  describe('formatConflictContextForPrompt', () => {
    it('formats a single file with one conflict', () => {
      const context: ICopilotConflictContext = {
        ourBranch: 'main',
        theirBranch: 'feature',
        files: [
          {
            path: 'src/app.ts',
            extension: 'ts',
            hunks: [
              {
                oursContent: 'const x = 1',
                theirsContent: 'const x = 2',
                baseContent: null,
                contextBefore: 'import foo',
                contextAfter: 'export default',
              },
            ],
          },
        ],
      }

      const result = formatConflictContextForPrompt(context)

      assert.ok(result.includes('branch "main" (ours)'))
      assert.ok(result.includes('"feature" (theirs)'))
      assert.ok(result.includes('## File: src/app.ts'))
      assert.ok(result.includes('Language hint: ts'))
      assert.ok(result.includes('Conflict 1 of 1'))
      assert.ok(result.includes('const x = 1'))
      assert.ok(result.includes('const x = 2'))
      assert.ok(result.includes('import foo'))
      assert.ok(result.includes('export default'))
      // Should not include base section for two-way conflict
      assert.ok(!result.includes('Base (common ancestor)'))
    })

    it('formats multiple files with multiple conflicts', () => {
      const context: ICopilotConflictContext = {
        ourBranch: 'main',
        theirBranch: 'feature',
        files: [
          {
            path: 'src/a.ts',
            extension: 'ts',
            hunks: [
              {
                oursContent: 'a-ours-1',
                theirsContent: 'a-theirs-1',
                baseContent: null,
                contextBefore: '',
                contextAfter: '',
              },
              {
                oursContent: 'a-ours-2',
                theirsContent: 'a-theirs-2',
                baseContent: null,
                contextBefore: '',
                contextAfter: '',
              },
            ],
          },
          {
            path: 'src/b.tsx',
            extension: 'tsx',
            hunks: [
              {
                oursContent: 'b-ours',
                theirsContent: 'b-theirs',
                baseContent: null,
                contextBefore: '',
                contextAfter: '',
              },
            ],
          },
        ],
      }

      const result = formatConflictContextForPrompt(context)

      assert.ok(result.includes('## File: src/a.ts'))
      assert.ok(result.includes('## File: src/b.tsx'))
      assert.ok(result.includes('Conflict 1 of 2'))
      assert.ok(result.includes('Conflict 2 of 2'))
      assert.ok(result.includes('a-ours-1'))
      assert.ok(result.includes('a-ours-2'))
      assert.ok(result.includes('b-ours'))
    })

    it('includes branch names in the header', () => {
      const context: ICopilotConflictContext = {
        ourBranch: 'release/v2.0',
        theirBranch: 'hotfix/crash-fix',
        files: [],
      }

      const result = formatConflictContextForPrompt(context)

      assert.ok(result.includes('"release/v2.0"'))
      assert.ok(result.includes('"hotfix/crash-fix"'))
    })

    it('includes base content for diff3 conflicts', () => {
      const context: ICopilotConflictContext = {
        ourBranch: 'main',
        theirBranch: 'feature',
        files: [
          {
            path: 'file.ts',
            extension: 'ts',
            hunks: [
              {
                oursContent: 'ours',
                theirsContent: 'theirs',
                baseContent: 'original',
                contextBefore: '',
                contextAfter: '',
              },
            ],
          },
        ],
      }

      const result = formatConflictContextForPrompt(context)

      assert.ok(result.includes('Base (common ancestor)'))
      assert.ok(result.includes('original'))
    })

    it('omits language hint when extension is empty', () => {
      const context: ICopilotConflictContext = {
        ourBranch: 'main',
        theirBranch: 'feature',
        files: [
          {
            path: 'Makefile',
            extension: '',
            hunks: [
              {
                oursContent: 'ours',
                theirsContent: 'theirs',
                baseContent: null,
                contextBefore: '',
                contextAfter: '',
              },
            ],
          },
        ],
      }

      const result = formatConflictContextForPrompt(context)

      assert.ok(result.includes('## File: Makefile'))
      assert.ok(!result.includes('Language hint'))
    })

    it('omits context before/after blocks when empty', () => {
      const context: ICopilotConflictContext = {
        ourBranch: 'main',
        theirBranch: 'feature',
        files: [
          {
            path: 'file.ts',
            extension: 'ts',
            hunks: [
              {
                oursContent: 'ours',
                theirsContent: 'theirs',
                baseContent: null,
                contextBefore: '',
                contextAfter: '',
              },
            ],
          },
        ],
      }

      const result = formatConflictContextForPrompt(context)

      assert.ok(!result.includes('Context before'))
      assert.ok(!result.includes('Context after'))
    })
  })
})
