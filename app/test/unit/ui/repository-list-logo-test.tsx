import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  AppearanceCustomizationStorageKey,
  IResolvedRepositoryAppearance,
  RepositoryLogoChangedEvent,
  setAppearanceCustomization,
} from '../../../src/lib/appearance-customization'
import { DefaultAppearanceCustomization } from '../../../src/models/appearance-customization'
import { CloningRepository } from '../../../src/models/cloning-repository'
import { Repository } from '../../../src/models/repository'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
} from '../../../src/models/repository-logo'
import { ITabTitleStyle } from '../../../src/models/repository-tab'
import { ShowBranchNameInRepoListSetting } from '../../../src/models/show-branch-name-in-repo-list'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { IRepositoryLogoLoader } from '../../../src/ui/repository-logo/repository-logo-loader'
import {
  IRepositoryLogoChange,
  RepositoryListItem,
} from '../../../src/ui/repositories-list/repository-list-item'
import { RepositoriesList } from '../../../src/ui/repositories-list/repositories-list'
import { render, waitFor } from '../../helpers/ui/render'

class TestResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    Object.defineProperty(target, 'offsetWidth', {
      configurable: true,
      value: 365,
    })
    Object.defineProperty(target, 'offsetHeight', {
      configurable: true,
      value: 360,
    })
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            width: 365,
            height: 360,
            top: 0,
            right: 365,
            bottom: 360,
            left: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this as unknown as ResizeObserver
    )
  }
  public unobserve() {}
  public disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})
Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})

const noMatches = { title: [], subtitle: [] }

function design(primaryColor: string): IRepositoryLogoDesign {
  return {
    ...DefaultRepositoryLogoDesign,
    background: {
      ...DefaultRepositoryLogoDesign.background,
      primaryColor,
    },
  }
}

class DeferredLogoLoader implements IRepositoryLogoLoader {
  public readonly loadCalls: string[] = []
  public readonly invalidations: Array<string | null> = []
  private readonly pending = new Map<
    string,
    Array<{
      resolve: (value: IResolvedRepositoryAppearance) => void
      promise: Promise<IResolvedRepositoryAppearance>
    }>
  >()

  public loadAppearance(
    repository: Repository
  ): Promise<IResolvedRepositoryAppearance> {
    this.loadCalls.push(repository.path)
    let resolvePromise: (value: IResolvedRepositoryAppearance) => void = () =>
      undefined
    const promise = new Promise<IResolvedRepositoryAppearance>(resolve => {
      resolvePromise = resolve
    })
    const requests = this.pending.get(repository.path) ?? []
    requests.push({ resolve: resolvePromise, promise })
    this.pending.set(repository.path, requests)
    return promise
  }

  public load(repository: Repository): Promise<IRepositoryLogoDesign> {
    return this.loadAppearance(repository).then(appearance => appearance.logo)
  }

  public invalidate(repositoryPath: string | null): void {
    this.invalidations.push(repositoryPath)
  }

  public synchronizeProfile(_profileSignature: string): void {}

  public resolve(
    repositoryPath: string,
    value: IRepositoryLogoDesign,
    request = 0
  ) {
    const pending = this.pending.get(repositoryPath)?.[request]
    assert.notEqual(pending, undefined)
    pending?.resolve({ logo: value, listNameStyle: null })
  }
}

class ImmediateLogoLoader implements IRepositoryLogoLoader {
  public readonly loadCalls: string[] = []
  public readonly invalidations: Array<string | null> = []
  public readonly profileSignatures: string[] = []
  public listNameStyle: ITabTitleStyle | null = null

  public constructor(public value: IRepositoryLogoDesign) {}

  public async loadAppearance(
    repository: Repository
  ): Promise<IResolvedRepositoryAppearance> {
    this.loadCalls.push(repository.path)
    return { logo: this.value, listNameStyle: this.listNameStyle }
  }

  public async load(repository: Repository): Promise<IRepositoryLogoDesign> {
    return (await this.loadAppearance(repository)).logo
  }

  public invalidate(repositoryPath: string | null): void {
    this.invalidations.push(repositoryPath)
  }

  public synchronizeProfile(profileSignature: string): void {
    this.profileSignatures.push(profileSignature)
  }
}

function repository(path: string, id: number, missing = false) {
  return new Repository(path, id, null, missing)
}

function row(
  repo: Repository | CloningRepository,
  loader: IRepositoryLogoLoader,
  repositoryLogoChange: IRepositoryLogoChange = {
    revision: 0,
    repositoryPath: null,
  }
) {
  return (
    <RepositoryListItem
      repository={repo}
      needsDisambiguation={false}
      matches={noMatches}
      aheadBehind={null}
      changedFilesCount={0}
      branchName={null}
      repositoryLogoLoader={loader}
      repositoryLogoChange={repositoryLogoChange}
    />
  )
}

const dispatcher = {
  closeFoldout: () => undefined,
  recordRepoClicked: () => undefined,
  showPopup: () => undefined,
} as unknown as Dispatcher

function list(
  repo: Repository,
  loader: IRepositoryLogoLoader,
  repositories: ReadonlyArray<Repository> = [repo]
) {
  return (
    <RepositoriesList
      selectedRepository={repo}
      repositories={repositories}
      recentRepositories={[]}
      showRecentRepositories={true}
      showBranchNameInRepoList={ShowBranchNameInRepoListSetting.Never}
      localRepositoryStateLookup={new Map()}
      onSelectionChanged={() => undefined}
      askForConfirmationOnRemoveRepository={false}
      onRemoveRepository={() => undefined}
      onShowRepository={() => undefined}
      onViewOnGitHub={() => undefined}
      onOpenInNewWindow={() => undefined}
      onOpenInShell={() => undefined}
      onOpenInExternalEditor={() => undefined}
      onFilterTextChanged={() => undefined}
      filterText=""
      dispatcher={dispatcher}
      repositoryLogoLoader={loader}
    />
  )
}

describe('repository-list custom logos', () => {
  it('ignores an old path result and invalidates the replaced path', async () => {
    const loader = new DeferredLogoLoader()
    const first = repository('/work/first', 1)
    const second = repository('/work/second', 1)
    const view = render(row(first, loader))

    view.rerender(row(second, loader))
    loader.resolve(second.path, design('#222222'))
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#222222"]'))
    )

    loader.resolve(first.path, design('#111111'))
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(view.container.querySelector('[fill="#111111"]'), null)
    assert.deepEqual(loader.invalidations, [first.path])
  })

  it('does not update after unmounting an in-flight row', async () => {
    const loader = new DeferredLogoLoader()
    const repo = repository('/work/unmounted', 2)
    const itemRef = React.createRef<RepositoryListItem>()
    const view = render(
      <RepositoryListItem
        ref={itemRef}
        repository={repo}
        needsDisambiguation={false}
        matches={noMatches}
        aheadBehind={null}
        changedFilesCount={0}
        branchName={null}
        repositoryLogoLoader={loader}
      />
    )
    const mountedItem = itemRef.current
    if (mountedItem === null) {
      throw new Error('Expected the repository row instance to mount')
    }

    view.unmount()
    loader.resolve(repo.path, design('#333333'))
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(mountedItem.state.logoDesign, null)
    assert.equal(mountedItem.state.logoPath, null)
  })

  it('keeps cloning and missing-state icons instead of masking their status', () => {
    const loader = new ImmediateLogoLoader(design('#444444'))
    const missing = repository('/work/missing', 3, true)
    const cloning = new CloningRepository(
      '/work/cloning',
      'https://github.com/desktop/desktop.git'
    )
    const missingView = render(row(missing, loader))
    const cloningView = render(row(cloning, loader))

    assert.ok(
      missingView.container.querySelector('svg.octicon.icon-for-repository')
    )
    assert.ok(
      cloningView.container.querySelector('svg.octicon.icon-for-repository')
    )
    assert.equal(
      missingView.container.querySelector('.repository-list-logo'),
      null
    )
    assert.equal(
      cloningView.container.querySelector('.repository-list-logo'),
      null
    )
    assert.equal(loader.loadCalls.length, 0)
  })

  it('renders resolved logos as decorative row content', async () => {
    const loader = new ImmediateLogoLoader(design('#555555'))
    const view = render(row(repository('/work/logo', 4), loader))

    await waitFor(() => {
      const logo = view.container.querySelector('.repository-list-logo')
      assert.notEqual(logo, null)
      assert.equal(logo?.getAttribute('aria-hidden'), 'true')
      assert.equal(logo?.getAttribute('role'), null)
    })
  })

  it('applies the repository list-name typography to the row name', async () => {
    const loader = new ImmediateLogoLoader(design('#5a5a5a'))
    loader.listNameStyle = {
      fontFamily: 'Georgia',
      fontSize: 16,
      bold: true,
      italic: true,
    }
    const view = render(row(repository('/work/typography', 9), loader))

    await waitFor(() => {
      const name = view.container.querySelector<HTMLElement>('.name')
      assert.notEqual(name, null)
      assert.match(name?.style.fontFamily ?? '', /Georgia/)
      assert.equal(name?.style.fontSize, '16px')
      assert.equal(name?.style.fontWeight, 'bold')
      assert.equal(name?.style.fontStyle, 'italic')
    })
  })

  it('refreshes a matching row after RepositoryLogoChangedEvent', async () => {
    const repo = repository('/work/event', 5)
    const unrelated = repository('/work/unrelated', 7)
    const loader = new ImmediateLogoLoader(design('#666666'))
    const view = render(list(repo, loader, [repo, unrelated]))
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#666666"]'))
    )
    await waitFor(() => assert.equal(loader.loadCalls.length, 2))

    loader.value = design('#777777')
    document.dispatchEvent(
      new CustomEvent(RepositoryLogoChangedEvent, {
        detail: { repositoryPath: repo.path },
      })
    )

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#777777"]'))
    )
    assert.deepEqual(loader.invalidations, [repo.path])
    assert.equal(loader.loadCalls.filter(path => path === repo.path).length, 2)
    assert.equal(
      loader.loadCalls.filter(path => path === unrelated.path).length,
      1
    )
  })

  it('refreshes inherited rows after a raw profile-history restore', async () => {
    const repo = repository('/work/profile', 6)
    setAppearanceCustomization({
      ...DefaultAppearanceCustomization,
      repositoryLogo: design('#888888'),
    })
    const loader = new ImmediateLogoLoader(design('#888888'))
    const view = render(list(repo, loader))
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#888888"]'))
    )

    localStorage.setItem(
      AppearanceCustomizationStorageKey,
      JSON.stringify({
        ...DefaultAppearanceCustomization,
        repositoryLogo: design('#999999'),
      })
    )
    loader.value = design('#999999')
    view.rerender(list(repo, loader, [repo]))

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#999999"]'))
    )
    assert.equal(loader.loadCalls.length, 2)
    assert.ok(loader.profileSignatures.length >= 2)
  })
})
