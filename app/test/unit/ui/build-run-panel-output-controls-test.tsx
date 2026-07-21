import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import { defaultBuildRunPreferences } from '../../../src/models/build-run-preferences'
import {
  BuildRunStore,
  IRepositoryBuildRunState,
} from '../../../src/lib/stores/build-run-store'
import { Dispatcher } from '../../../src/ui/dispatcher'
import {
  BuildRunAutoScrollStorageKey,
  BuildRunPanel,
  BuildRunTruncateOutputStorageKey,
} from '../../../src/ui/build-run/build-run-panel'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const LongOutput =
  'C:/source/deep/project/file.cpp(100): warning C4999: this output remains complete'

function buildState(
  lines: ReadonlyArray<string> = [LongOutput]
): IRepositoryBuildRunState {
  return {
    phase: 'building',
    detectedProfiles: [],
    selectedProfileId: null,
    logLines: lines.map(text => ({ stage: 'build', stream: 'stdout', text })),
    activeRunId: 'run-1',
    exitCode: null,
    runPid: 123,
    panelOpen: true,
    panelMinimized: false,
    detected: true,
    opencodeRunning: false,
    opencodeOperationId: null,
  }
}

function repository(): Repository {
  return new Repository(
    'C:/build-output-repo',
    1,
    null,
    false,
    null,
    {},
    false,
    undefined,
    null,
    defaultBuildRunPreferences
  )
}

function mutableStore(initial: IRepositoryBuildRunState): {
  readonly store: BuildRunStore
  readonly update: (next: IRepositoryBuildRunState) => void
} {
  let state = initial
  let listener: ((repositoryId: number | null) => void) | null = null
  return {
    store: {
      getStateForRepository: () => state,
      onDidUpdate: (callback: (repositoryId: number | null) => void) => {
        listener = callback
        return {
          dispose: () => {
            listener = null
          },
        }
      },
    } as unknown as BuildRunStore,
    update: next => {
      state = next
      listener?.(1)
    },
  }
}

function renderPanel(state: IRepositoryBuildRunState = buildState()) {
  const mutable = mutableStore(state)
  const result = render(
    <BuildRunPanel
      repository={repository()}
      dispatcher={{} as Dispatcher}
      buildRunStore={mutable.store}
    />
  )
  return { ...result, ...mutable }
}

function outputControl(
  container: HTMLElement,
  verification: string
): HTMLButtonElement {
  const control = container.querySelector(
    `[data-verification="${verification}"]`
  )
  assert.ok(control instanceof HTMLButtonElement)
  return control
}

function outputLog(container: HTMLElement): HTMLDivElement {
  const log = container.querySelector('.build-run-log')
  assert.ok(log instanceof HTMLDivElement)
  return log
}

function setScrollMetrics(
  log: HTMLDivElement,
  scrollHeight: number,
  clientHeight: number
): void {
  Object.defineProperty(log, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  })
  Object.defineProperty(log, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  })
}

describe('BuildRunPanel output controls', () => {
  beforeEach(() => {
    localStorage.removeItem(BuildRunAutoScrollStorageKey)
    localStorage.removeItem(BuildRunTruncateOutputStorageKey)
  })

  afterEach(() => {
    localStorage.removeItem(BuildRunAutoScrollStorageKey)
    localStorage.removeItem(BuildRunTruncateOutputStorageKey)
  })

  it('exposes a jump button and explicit toggle states', () => {
    const { container } = renderPanel()

    assert.equal(
      outputControl(container, 'build-run-auto-scroll').getAttribute(
        'aria-pressed'
      ),
      'true'
    )
    assert.equal(
      outputControl(container, 'build-run-truncate-output').getAttribute(
        'aria-pressed'
      ),
      'false'
    )
    assert.ok(outputControl(container, 'build-run-scroll-to-bottom'))
  })

  it('jumps to the bottom without changing the auto-scroll preference', () => {
    const { container } = renderPanel()
    const log = outputLog(container)
    setScrollMetrics(log, 900, 180)
    log.scrollTop = 25

    fireEvent.click(outputControl(container, 'build-run-scroll-to-bottom'))

    assert.equal(log.scrollTop, 900)
    assert.equal(
      outputControl(container, 'build-run-auto-scroll').getAttribute(
        'aria-pressed'
      ),
      'true'
    )
  })

  it('pauses auto-scroll when reading history and resumes at the tail', () => {
    const { container } = renderPanel()
    const log = outputLog(container)
    const toggle = outputControl(container, 'build-run-auto-scroll')
    setScrollMetrics(log, 900, 180)
    log.scrollTop = 100

    fireEvent.scroll(log)

    assert.equal(toggle.getAttribute('aria-pressed'), 'false')
    assert.equal(localStorage.getItem(BuildRunAutoScrollStorageKey), '0')

    fireEvent.click(toggle)

    assert.equal(toggle.getAttribute('aria-pressed'), 'true')
    assert.equal(localStorage.getItem(BuildRunAutoScrollStorageKey), '1')
    assert.equal(log.scrollTop, 900)
  })

  it('follows new output only while auto-scroll is enabled', async () => {
    const first = buildState(['first'])
    const { container, update } = renderPanel(first)
    const log = outputLog(container)
    setScrollMetrics(log, 900, 180)
    log.scrollTop = 0

    update(buildState(['first', 'second']))
    await waitFor(() => assert.equal(log.scrollTop, 900))

    fireEvent.click(outputControl(container, 'build-run-auto-scroll'))
    log.scrollTop = 100
    update(buildState(['first', 'second', 'third']))
    await screen.findByText('third')

    assert.equal(log.scrollTop, 100)
  })

  it('persists visual truncation without discarding the output text', () => {
    const first = renderPanel()
    const toggle = outputControl(first.container, 'build-run-truncate-output')

    fireEvent.click(toggle)

    const firstLog = outputLog(first.container)
    const text = firstLog.querySelector('.line-text')
    assert.equal(toggle.getAttribute('aria-pressed'), 'true')
    assert.ok(firstLog.classList.contains('truncate-output'))
    assert.equal(text?.textContent, LongOutput)
    assert.equal(localStorage.getItem(BuildRunTruncateOutputStorageKey), '1')

    first.unmount()
    const second = renderPanel()
    assert.equal(
      outputControl(second.container, 'build-run-truncate-output').getAttribute(
        'aria-pressed'
      ),
      'true'
    )
    assert.ok(outputLog(second.container).classList.contains('truncate-output'))
  })
})
