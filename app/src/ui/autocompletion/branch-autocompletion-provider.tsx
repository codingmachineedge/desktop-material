import * as React from 'react'

import { IAutocompletionProvider } from './index'
import { Branch } from '../../models/branch'
import { HighlightText } from '../lib/highlight-text'
import { match } from '../../lib/fuzzy-find'

/** An autocompletion hit for a branch. */
export interface IBranchHit {
  /** The branch name. */
  readonly name: string

  /** Match offsets for highlighting, empty if no filter was applied. */
  readonly highlight: ReadonlyArray<number>
}

/** Autocompletion provider for git branches. */
export class BranchAutocompletionProvider
  implements IAutocompletionProvider<IBranchHit>
{
  public readonly kind = 'branch' as const

  private readonly allBranches: ReadonlyArray<Branch>

  public constructor(allBranches: ReadonlyArray<Branch>) {
    this.allBranches = allBranches
  }

  public getRegExp(): RegExp {
    // Match the entire input as a single capture group. The `g` flag is
    // required by the autocompletion framework.
    return /^(.*)$/g
  }

  public async getAutocompletionItems(
    text: string
  ): Promise<ReadonlyArray<IBranchHit>> {
    if (text.length === 0) {
      return this.allBranches.slice(0, 25).map(b => ({
        name: b.name,
        highlight: [],
      }))
    }

    const matches = match(text, this.allBranches, b => [b.name])

    return matches.slice(0, 25).map(m => ({
      name: m.item.name,
      highlight: m.matches.title,
    }))
  }

  public renderItem(item: IBranchHit): JSX.Element {
    if (item.highlight.length > 0) {
      return <HighlightText text={item.name} highlight={item.highlight} />
    }

    return (
      <div className="branch">
        <div className="title">{item.name}</div>
      </div>
    )
  }

  public getItemAriaLabel(item: IBranchHit): string {
    return item.name
  }

  public getCompletionText(item: IBranchHit): string {
    return item.name
  }
}
