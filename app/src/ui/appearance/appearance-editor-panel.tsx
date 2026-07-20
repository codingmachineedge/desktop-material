import * as React from 'react'

import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** Stable keys shared by element-owned editors and their history stores. */
export const AppearanceEditorElementId = {
  AppWorkspace: 'app-workspace',
  UpdateProgress: 'update-progress',
  CodeDiff: 'code-diff',
  Toolbar: 'toolbar',
  RepositoryList: 'repository-list',
  RepositoryTabs: 'repository-tabs',
  FeatureHighlighting: 'feature-highlighting',
  AppIdentity: 'app-identity',
  DefaultRepositoryLogo: 'default-repository-logo',
  RepositoryWorkspace: 'repository-workspace',
  RepositoryToolbar: 'repository-toolbar',
  RepositoryTabsOverride: 'repository-tabs-override',
} as const

export type AppearanceEditorElementId =
  typeof AppearanceEditorElementId[keyof typeof AppearanceEditorElementId]

interface IAppearanceEditorPanelProps {
  readonly elementId: AppearanceEditorElementId
  readonly title: string
  readonly description: string
  readonly onShowHistory: () => void
  readonly wide?: boolean
  readonly children: React.ReactNode
}

/**
 * Bounded content shell for an element-owned, anchored appearance editor.
 * Positioning and dismissal belong to the element's Popover wrapper.
 */
export function AppearanceEditorPanel(
  props: IAppearanceEditorPanelProps
): JSX.Element {
  const className = props.wide
    ? 'element-appearance-editor element-appearance-editor-wide'
    : 'element-appearance-editor'

  return (
    <section
      className={className}
      aria-label={props.title}
      data-appearance-element-id={props.elementId}
    >
      <header className="element-appearance-editor-header">
        <div>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
        </div>
        <Button
          type="button"
          size="small"
          className="element-appearance-editor-history"
          ariaLabel={`Open ${props.title.toLocaleLowerCase()} history`}
          onClick={props.onShowHistory}
        >
          <Octicon symbol={octicons.history} />
          <span>History</span>
        </Button>
      </header>
      <div className="element-appearance-editor-content">{props.children}</div>
    </section>
  )
}
