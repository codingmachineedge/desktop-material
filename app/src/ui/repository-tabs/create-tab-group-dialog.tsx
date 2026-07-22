import * as React from 'react'
import classNames from 'classnames'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'
import {
  DefaultTabGroupColor,
  TabGroupColor,
  TabGroupColors,
  normalizeTabGroupName,
} from '../../models/repository-tab'

interface ICreateTabGroupDialogProps {
  /** The tab that will become the group's first member. */
  readonly tabLabel: string
  readonly onCreate: (name: string, color: TabGroupColor) => void
  readonly onDismissed: () => void
}

interface ICreateTabGroupDialogState {
  readonly name: string
  readonly color: TabGroupColor
}

/** Name and color a new tab group before its first tab joins it. */
export class CreateTabGroupDialog extends React.Component<
  ICreateTabGroupDialogProps,
  ICreateTabGroupDialogState
> {
  public constructor(props: ICreateTabGroupDialogProps) {
    super(props)
    this.state = { name: '', color: DefaultTabGroupColor }
  }

  private onNameChanged = (name: string) => {
    this.setState({ name })
  }

  private onSubmit = () => {
    const name = normalizeTabGroupName(this.state.name)
    if (name === null) {
      return
    }
    this.props.onCreate(name, this.state.color)
  }

  private onColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const color = event.currentTarget.dataset.color as TabGroupColor | undefined
    if (color !== undefined) {
      this.setState({ color })
    }
  }

  private renderColor(color: TabGroupColor) {
    const selected = this.state.color === color
    return (
      <button
        key={color}
        type="button"
        className={classNames('tab-group-color', `tab-group-color--${color}`, {
          selected,
        })}
        aria-label={`${color} group color`}
        aria-pressed={selected}
        data-color={color}
        onClick={this.onColorClick}
      />
    )
  }

  public render() {
    const disabled = normalizeTabGroupName(this.state.name) === null

    return (
      <Dialog
        id="create-tab-group"
        title="New tab group"
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <p className="tab-group-intro">
            “{this.props.tabLabel}” becomes the first tab in this group.
            Grouping only organizes the strip; it never closes a tab.
          </p>
          <TextBox
            label="Group name"
            value={this.state.name}
            autoFocus={true}
            onValueChanged={this.onNameChanged}
          />
          <div
            className="tab-group-colors"
            role="group"
            aria-label="Group color"
          >
            {TabGroupColors.map(color => this.renderColor(color))}
          </div>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Create group"
            okButtonDisabled={disabled}
            onCancelButtonClick={this.props.onDismissed}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
