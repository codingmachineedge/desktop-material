import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Repository } from '../../src/models/repository'
import { LanguageMode } from '../../src/models/language-mode'
import { generateRepositoryListContextMenu } from '../../src/ui/repositories-list/repository-list-item-context-menu'

const repository = new Repository('/work/material', 1, null, false)

const menu = (
  isHidden: boolean,
  onHideRepository: (repository: Repository) => void,
  onUnhideRepository: (repository: Repository) => void,
  languageMode?: LanguageMode
) =>
  generateRepositoryListContextMenu({
    repository,
    accounts: [],
    shellLabel: undefined,
    externalEditorLabel: undefined,
    askForConfirmationOnRemoveRepository: false,
    onViewOnGitHub: () => undefined,
    onOpenInNewWindow: () => undefined,
    onOpenInShell: () => undefined,
    onShowRepository: () => undefined,
    onOpenInExternalEditor: () => undefined,
    onRemoveRepository: () => undefined,
    onChangeRepositoryAlias: () => undefined,
    onRemoveRepositoryAlias: () => undefined,
    onChangeRepositoryGroupName: () => undefined,
    onRemoveRepositoryGroupName: () => undefined,
    isHidden,
    onHideRepository,
    onUnhideRepository,
    languageMode,
  })

describe('repository list visibility context menu', () => {
  it('offers the exact reversible visibility action', () => {
    const calls = new Array<string>()

    const hide = menu(
      false,
      item => calls.push(`hide:${item.id}`),
      item => calls.push(`unhide:${item.id}`)
    ).find(item => item.label === 'Hide repository')
    assert.ok(hide && 'action' in hide && hide.action)
    hide.action()

    const unhide = menu(
      true,
      item => calls.push(`hide:${item.id}`),
      item => calls.push(`unhide:${item.id}`)
    ).find(item => item.label === 'Unhide repository')
    assert.ok(unhide && 'action' in unhide && unhide.action)
    unhide.action()

    assert.deepEqual(calls, ['hide:1', 'unhide:1'])
  })

  it('localizes visibility actions for Cantonese and bilingual menus', () => {
    const noop = () => undefined
    const cantonese = menu(false, noop, noop, 'cantonese')
    const bilingual = menu(true, noop, noop, 'bilingual')

    assert.ok(cantonese.some(item => item.label === '隱藏 repo'))
    assert.ok(
      bilingual.some(item => item.label === 'Unhide repository · 取消隱藏 repo')
    )
  })
})
