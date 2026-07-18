import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import {
  IGitModulesEntry,
  resolveSubmoduleCloneUrl,
} from '../../lib/git/gitmodules'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Ref } from '../lib/ref'
import { TooltippedContent } from '../lib/tooltipped-content'

interface ICloneableSubmodulesDialogProps {
  /** The `owner/name` (or friendly name) of the inspected repository. */
  readonly parentName: string

  /** The clone URL relative submodule URLs are resolved against. */
  readonly parentCloneUrl: string

  /** The parsed `.gitmodules` entries of the inspected repository. */
  readonly entries: ReadonlyArray<IGitModulesEntry>

  /** Called with the resolved URL when a submodule should be cloned. */
  readonly onCloneUrl: (url: string) => void

  readonly onDismissed: () => void
}

/**
 * Lists the submodules a hosted repository declares in `.gitmodules` before
 * it has been cloned, and lets each one be cloned on its own as a standalone
 * repository. Cloning the parent normally recurses into every submodule;
 * this dialog is the escape hatch for picking out individual pieces.
 */
export class CloneableSubmodulesDialog extends React.Component<ICloneableSubmodulesDialogProps> {
  private onCloneEntry = (entry: IGitModulesEntry) => {
    const url = resolveSubmoduleCloneUrl(this.props.parentCloneUrl, entry.url)
    if (url !== null) {
      this.props.onCloneUrl(url)
      this.props.onDismissed()
    }
  }

  public render() {
    const { parentName, entries } = this.props
    const count = entries.length

    return (
      <Dialog
        id="cloneable-submodules"
        title={__DARWIN__ ? 'Repository Submodules' : 'Repository submodules'}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <p className="cloneable-submodules-summary">
            <Ref>{parentName}</Ref> declares {count}{' '}
            {count === 1 ? 'submodule' : 'submodules'}. Cloning the repository
            downloads all of them; each can also be cloned on its own as a
            separate repository.
          </p>
          <ul className="cloneable-submodule-list">
            {entries.map(entry => (
              <CloneableSubmoduleRow
                key={`${entry.name}-${entry.path}`}
                entry={entry}
                parentCloneUrl={this.props.parentCloneUrl}
                onClone={this.onCloneEntry}
              />
            ))}
          </ul>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Close"
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}

interface ICloneableSubmoduleRowProps {
  readonly entry: IGitModulesEntry
  readonly parentCloneUrl: string
  readonly onClone: (entry: IGitModulesEntry) => void
}

/**
 * A single pre-clone submodule row. Extracted so the clone handler can be a
 * stable callback bound to the entry rather than an inline arrow.
 */
function CloneableSubmoduleRow(props: ICloneableSubmoduleRowProps) {
  const { entry, parentCloneUrl } = props
  const onClone = React.useCallback(
    () => props.onClone(entry),
    [props.onClone, entry]
  )
  const resolvedUrl = resolveSubmoduleCloneUrl(parentCloneUrl, entry.url)

  return (
    <li className="cloneable-submodule-row">
      <div className="cloneable-submodule-main">
        <div className="cloneable-submodule-heading">
          <Octicon
            className="cloneable-submodule-icon"
            symbol={octicons.fileSubmodule}
          />
          <span className="cloneable-submodule-path">{entry.path}</span>
          {entry.branch !== null && (
            <span className="cloneable-submodule-branch">
              <Octicon symbol={octicons.gitBranch} />
              {entry.branch}
            </span>
          )}
        </div>
        <TooltippedContent
          tagName="div"
          className="cloneable-submodule-url"
          tooltip={resolvedUrl ?? entry.url}
          onlyWhenOverflowed={true}
        >
          {resolvedUrl ?? entry.url}
        </TooltippedContent>
      </div>
      <Button
        type="button"
        disabled={resolvedUrl === null}
        onClick={onClone}
        tooltip={
          resolvedUrl === null
            ? 'This submodule has no resolvable clone URL'
            : 'Clone this submodule as a standalone repository'
        }
      >
        {__DARWIN__ ? 'Clone as Repository' : 'Clone as repository'}
      </Button>
    </li>
  )
}
