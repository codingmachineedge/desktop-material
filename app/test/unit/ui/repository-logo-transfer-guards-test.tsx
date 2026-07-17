import assert from 'node:assert'
import { afterEach, describe, it, mock } from 'node:test'
import * as React from 'react'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
  serializeRepositoryLogoDesign,
} from '../../../src/models/repository-logo'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

type OpenDialogBehavior = () => Promise<string | null>
type ReadBehavior = (path: string, encoding: string) => Promise<string>
type StatBehavior = (path: string) => Promise<{ readonly size: number }>
type WriteBehavior = (
  path: string,
  data: string,
  encoding: string
) => Promise<void>

let openDialogBehavior: OpenDialogBehavior = async () => null
let saveDialogBehavior: OpenDialogBehavior = async () => null
let readBehavior: ReadBehavior = async () => ''
let statBehavior: StatBehavior = async () => ({ size: 0 })
let writeBehavior: WriteBehavior = async () => undefined

mock.module('fs/promises', {
  namedExports: {
    readFile: (path: string, encoding: string) => readBehavior(path, encoding),
    stat: (path: string) => statBehavior(path),
    writeFile: (path: string, data: string, encoding: string) =>
      writeBehavior(path, data, encoding),
  },
})

mock.module('../../../src/ui/main-process-proxy', {
  namedExports: {
    showOpenDialog: () => openDialogBehavior(),
    showSaveDialog: () => saveDialogBehavior(),
  },
})

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): IDeferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function designWithColor(primaryColor: string): IRepositoryLogoDesign {
  return {
    ...DefaultRepositoryLogoDesign,
    background: {
      ...DefaultRepositoryLogoDesign.background,
      primaryColor,
    },
  }
}

async function getStudio() {
  return (
    await import('../../../src/ui/repository-logo/repository-logo-studio')
  ).RepositoryLogoStudio
}

afterEach(() => {
  openDialogBehavior = async () => null
  saveDialogBehavior = async () => null
  readBehavior = async () => ''
  statBehavior = async () => ({ size: 0 })
  writeBehavior = async () => undefined
})

describe('RepositoryLogoStudio transfer guards', () => {
  it('does not apply an import after the studio unmounts', async () => {
    const RepositoryLogoStudio = await getStudio()
    const read = deferred<string>()
    let readCount = 0
    let changeCount = 0
    openDialogBehavior = async () => 'logo.json'
    statBehavior = async () => ({ size: 128 })
    readBehavior = async () => {
      readCount++
      return read.promise
    }

    const view = render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="first"
        onChange={() => changeCount++}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON…' }))
    await waitFor(() => assert.equal(readCount, 1))

    view.unmount()
    read.resolve(serializeRepositoryLogoDesign(designWithColor('#aa0000')))
    await read.promise
    await Promise.resolve()

    assert.equal(changeCount, 0)
  })

  it('invalidates an import when the repository and value change', async () => {
    const RepositoryLogoStudio = await getStudio()
    const read = deferred<string>()
    let readCount = 0
    let changeCount = 0
    openDialogBehavior = async () => 'logo.json'
    statBehavior = async () => ({ size: 128 })
    readBehavior = async () => {
      readCount++
      return read.promise
    }

    const view = render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="first"
        onChange={() => changeCount++}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON…' }))
    await waitFor(() => assert.equal(readCount, 1))

    const replacement = designWithColor('#445566')
    view.rerender(
      <RepositoryLogoStudio
        value={replacement}
        repositoryName="second"
        onChange={() => changeCount++}
      />
    )
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#445566"]'))
    )

    read.resolve(serializeRepositoryLogoDesign(designWithColor('#aa0000')))
    await read.promise
    await Promise.resolve()

    assert.equal(changeCount, 0)
    assert.equal(view.container.querySelector('[fill="#aa0000"]'), null)
    assert.equal(
      screen
        .getByRole('button', { name: 'Import JSON…' })
        .hasAttribute('disabled'),
      false
    )
  })

  it('invalidates an import when an equal-looking profile value is replaced', async () => {
    const RepositoryLogoStudio = await getStudio()
    const read = deferred<string>()
    let readCount = 0
    let changeCount = 0
    openDialogBehavior = async () => 'logo.json'
    statBehavior = async () => ({ size: 128 })
    readBehavior = async () => {
      readCount++
      return read.promise
    }

    const view = render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="same-name"
        onChange={() => changeCount++}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON…' }))
    await waitFor(() => assert.equal(readCount, 1))

    view.rerender(
      <RepositoryLogoStudio
        value={{
          ...DefaultRepositoryLogoDesign,
          background: { ...DefaultRepositoryLogoDesign.background },
          layers: [...DefaultRepositoryLogoDesign.layers],
        }}
        repositoryName="same-name"
        onChange={() => changeCount++}
      />
    )
    read.resolve(serializeRepositoryLogoDesign(designWithColor('#aa0000')))
    await read.promise
    await Promise.resolve()

    assert.equal(changeCount, 0)
    assert.equal(view.container.querySelector('[fill="#aa0000"]'), null)
  })

  it('ignores export completion after the repository changes', async () => {
    const RepositoryLogoStudio = await getStudio()
    const write = deferred<void>()
    let writeCount = 0
    saveDialogBehavior = async () => 'logo.json'
    writeBehavior = async () => {
      writeCount++
      return write.promise
    }

    const view = render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="first"
        onChange={() => undefined}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON…' }))
    await waitFor(() => assert.equal(writeCount, 1))

    view.rerender(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="second"
        onChange={() => undefined}
      />
    )
    write.resolve()
    await write.promise
    await Promise.resolve()

    assert.equal(screen.queryByText('Logo JSON exported.'), null)
    assert.equal(
      screen
        .getByRole('button', { name: 'Export JSON…' })
        .hasAttribute('disabled'),
      false
    )
  })
})
