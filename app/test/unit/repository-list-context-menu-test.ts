import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Repository } from '../../src/models/repository'
import { LanguageMode } from '../../src/models/language-mode'
import { Repositoryish } from '../../src/ui/repositories-list/group-repositories'
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

const customizeMenu = (
  onCustomizeNameAppearance?: (repository: Repositoryish) => void,
  onCustomizeLogoAppearance?: (repository: Repositoryish) => void,
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
    onCustomizeNameAppearance,
    onCustomizeLogoAppearance,
    languageMode,
  })

describe('repository list appearance context menu', () => {
  it('offers customize name and logo items that open the anchored editors', () => {
    const calls = new Array<string>()

    const items = customizeMenu(
      repo => calls.push(`name:${repo.id}`),
      repo => calls.push(`logo:${repo.id}`)
    )

    const name = items.find(item => item.label === 'Customize name appearance')
    const logo = items.find(item => item.label === 'Customize logo appearance')

    assert.ok(name && 'action' in name && name.action)
    assert.ok(logo && 'action' in logo && logo.action)

    name.action()
    logo.action()

    assert.deepEqual(calls, ['name:1', 'logo:1'])
  })

  it('omits the customize items when their callbacks are not supplied', () => {
    const items = customizeMenu(undefined, undefined)

    assert.ok(!items.some(item => item.label === 'Customize name appearance'))
    assert.ok(!items.some(item => item.label === 'Customize logo appearance'))
  })

  it('localizes the customize items for Cantonese and bilingual menus', () => {
    const noop = () => undefined
    const cantonese = customizeMenu(noop, noop, 'cantonese')
    const bilingual = customizeMenu(noop, noop, 'bilingual')

    assert.ok(cantonese.some(item => item.label === '自訂名稱外觀'))
    assert.ok(
      bilingual.some(
        item => item.label === 'Customize logo appearance · 自訂標誌外觀'
      )
    )
  })
})
