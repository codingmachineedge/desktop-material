import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  buildChangedFileTreeGroups,
  buildChangedFileTreeRows,
  ChangedFileViewModeChangedEvent,
  ChangedFileViewStorageKey,
  getSafeChangedFilePathParts,
  readChangedFileViewMode,
} from '../../src/ui/lib/changed-file-view'
import { ChangedFileViewToggle } from '../../src/ui/lib/changed-file-view-toggle'
import { FileList } from '../../src/ui/history/file-list'
import { AppFileStatusKind, CommittedFileChange } from '../../src/models/status'
import { LanguageModeChangedEvent } from '../../src/lib/i18n'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'

interface ITestFile {
  readonly id: string
  readonly path: string
}

const files: ReadonlyArray<ITestFile> = [
  { id: 'readme', path: 'README.md' },
  { id: 'z', path: 'src/z.ts' },
  { id: 'nested', path: 'src/ui/button.tsx' },
  { id: 'a', path: 'src/a.ts' },
  { id: 'escape', path: '../escape.txt' },
  { id: 'empty-segment', path: 'src//unsafe.ts' },
]

describe('changed-file tree model', () => {
  it('groups safe paths deterministically and keeps unsafe paths at the root', () => {
    const rows = buildChangedFileTreeRows(files, file => file.path)
    assert.deepEqual(
      rows.map(row =>
        row.kind === 'directory'
          ? `directory:${row.path}:${row.depth}`
          : `file:${row.file.id}:${row.depth}:${row.sourceIndex}`
      ),
      [
        'file:escape:0:4',
        'file:readme:0:0',
        'file:empty-segment:0:5',
        'directory:src:0',
        'file:a:1:3',
        'file:z:1:1',
        'directory:src/ui:1',
        'file:nested:2:2',
      ]
    )

    const groups = buildChangedFileTreeGroups(files, file => file.path)
    assert.deepEqual(
      groups.map(group => ({
        path: group.directoryPath,
        depth: group.depth,
        ids: group.files.map(file => file.id),
      })),
      [
        { path: null, depth: 0, ids: ['escape', 'readme', 'empty-segment'] },
        { path: 'src', depth: 0, ids: ['a', 'z'] },
        { path: 'src/ui', depth: 1, ids: ['nested'] },
      ]
    )
  })

  it('rejects traversal, absolute, empty, and control-character segments', () => {
    assert.deepEqual(getSafeChangedFilePathParts('src/ui/file.ts'), [
      'src',
      'ui',
      'file.ts',
    ])
    assert.equal(getSafeChangedFilePathParts('../file.ts'), null)
    assert.equal(getSafeChangedFilePathParts('/file.ts'), null)
    assert.equal(getSafeChangedFilePathParts('src//file.ts'), null)
    assert.equal(getSafeChangedFilePathParts('src/./file.ts'), null)
    assert.equal(getSafeChangedFilePathParts('src/line\nbreak.ts'), null)
  })

  it('preserves selected-file, context-menu, and double-click targets', () => {
    const committed = [
      new CommittedFileChange(
        'src/z.ts',
        { kind: AppFileStatusKind.Modified },
        'head',
        'parent'
      ),
      new CommittedFileChange(
        'src/ui/button.tsx',
        { kind: AppFileStatusKind.New },
        'head',
        'parent'
      ),
    ]
    let selected: CommittedFileChange | null = null
    let contextual: CommittedFileChange | null = null
    let doubleClickedSourceIndex = -1
    const list = new FileList({
      files: committed,
      selectedFile: committed[1],
      onSelectedFileChanged: file => (selected = file),
      onRowDoubleClick: row => (doubleClickedSourceIndex = row),
      availableWidth: 240,
      onContextMenu: file => (contextual = file),
      showViewToggle: true,
    })
    ;(list as any).state = {
      ...(list as any).state,
      fileViewMode: 'tree',
    }

    const rows = (list as any).getRows() as ReadonlyArray<{
      readonly kind: string
      readonly file?: CommittedFileChange
    }>
    const nestedRow = rows.findIndex(row => row.file === committed[1])
    assert.ok(nestedRow > 0)
    assert.deepEqual((list as any).selectedRowsForFile(), [nestedRow])
    ;(list as any).onSelectedRowChanged(nestedRow)
    ;(list as any).onRowContextMenu(nestedRow, {})
    ;(list as any).onRowDoubleClick(nestedRow, {
      kind: 'mouseclick',
      event: {},
    })
    assert.equal(selected, committed[1])
    assert.equal(contextual, committed[1])
    assert.equal(doubleClickedSourceIndex, 1)
  })
})

describe('ChangedFileViewToggle', () => {
  it('persists the choice and switches English, Cantonese, and bilingual copy', async () => {
    localStorage.removeItem(ChangedFileViewStorageKey)
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    let eventMode: unknown = null
    const onModeChanged = (event: Event) => {
      eventMode = (event as CustomEvent<unknown>).detail
    }
    document.addEventListener(ChangedFileViewModeChangedEvent, onModeChanged)
    const view = render(<ChangedFileViewToggle mode="flat" />)

    try {
      assert.ok(screen.getByRole('group', { name: 'Changed-files layout' }))
      fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
      assert.equal(eventMode, 'tree')
      assert.equal(readChangedFileViewMode(), 'tree')

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('button', { name: '檔案樹' }))
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() => {
        assert.ok(screen.getByRole('button', { name: 'Tree' }))
        assert.match(view.container.textContent ?? '', /Flat · 平鋪/)
        assert.match(view.container.textContent ?? '', /Tree · 檔案樹/)
      })
    } finally {
      view.unmount()
      document.removeEventListener(
        ChangedFileViewModeChangedEvent,
        onModeChanged
      )
      localStorage.removeItem(ChangedFileViewStorageKey)
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
