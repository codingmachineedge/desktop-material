import * as React from 'react'

import { Image } from '../../../models/diff'
import { ImageContainer } from './image-container'
import { TabBar, TabBarType } from '../../tab-bar'
import { getSvgDiffShowCode, saveSvgDiffShowCode } from './svg-diff-preferences'

interface INewImageDiffProps {
  readonly current: Image
  readonly codeDiff?: React.ReactNode
}

interface INewImageDiffState {
  readonly showCode: boolean
}

/** A component to render when a new image has been added to the repository */
export class NewImageDiff extends React.Component<
  INewImageDiffProps,
  INewImageDiffState
> {
  public constructor(props: INewImageDiffProps) {
    super(props)
    this.state = {
      showCode: props.codeDiff !== undefined && getSvgDiffShowCode(),
    }
  }

  public componentDidUpdate(prevProps: INewImageDiffProps) {
    if (prevProps.codeDiff === undefined && this.props.codeDiff !== undefined) {
      this.setState({ showCode: getSvgDiffShowCode() })
    }
  }

  private onTabClicked = (index: number) => {
    const showCode = index === 0
    saveSvgDiffShowCode(showCode)
    this.setState({ showCode })
  }

  public render() {
    const { codeDiff } = this.props
    if (codeDiff === undefined) {
      return this.renderImage()
    }

    if (this.state.showCode) {
      return (
        <div className="panel svg-diff-container svg-2tab">
          {this.renderTabs(0)}
          {codeDiff}
        </div>
      )
    }

    return (
      <div className="panel image svg-image svg-2tab" id="diff">
        {this.renderTabs(1)}
        <div className="image-diff-current">
          <div className="image-diff-header">Added</div>
          <ImageContainer image={this.props.current} />
        </div>
      </div>
    )
  }

  private renderImage() {
    return (
      <div className="panel image" id="diff">
        <div className="image-diff-current">
          <div className="image-diff-header">Added</div>
          <ImageContainer image={this.props.current} />
        </div>
      </div>
    )
  }

  private renderTabs(selectedIndex: number) {
    return (
      <TabBar
        selectedIndex={selectedIndex}
        onTabClicked={this.onTabClicked}
        type={TabBarType.Switch}
      >
        <span>Code</span>
        <span>Image</span>
      </TabBar>
    )
  }
}
