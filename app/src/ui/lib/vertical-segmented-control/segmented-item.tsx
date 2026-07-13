import * as React from 'react'
import classNames from 'classnames'

interface ISegmentedItemProps {
  /**
   * The title for the segmented item. This should be kept short.
   */
  readonly title: string

  /**
   * An optional description which explains the consequences of
   * selecting this item.
   */
  readonly description?: string | JSX.Element

  readonly expandText?: boolean
}

export class SegmentedItem extends React.Component<ISegmentedItemProps> {
  private renderDescription() {
    if (!this.props.description) {
      return null
    }

    return <p>{this.props.description}</p>
  }

  public render() {
    const titleClassName = classNames('title', {
      'expand-text': this.props.expandText === true,
    })
    return (
      <>
        <div className={titleClassName}>{this.props.title}</div>
        {this.renderDescription()}
      </>
    )
  }
}
