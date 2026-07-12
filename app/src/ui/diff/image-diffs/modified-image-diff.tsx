import * as React from 'react'

import { Image, ImageDiffType } from '../../../models/diff'
import { TabBar, TabBarType } from '../../tab-bar'
import { TwoUp } from './two-up'
import { DifferenceBlend } from './difference-blend'
import { OnionSkin } from './onion-skin'
import { Swipe } from './swipe'
import { assertNever } from '../../../lib/fatal-error'
import { ISize, getMaxFitSize } from './sizing'
import { getSvgDiffShowCode, saveSvgDiffShowCode } from './svg-diff-preferences'

interface IModifiedImageDiffProps {
  readonly previous: Image
  readonly current: Image
  readonly diffType: ImageDiffType
  /**
   * Called when the user is viewing an image diff and requests
   * to change the diff presentation mode.
   */
  readonly onChangeDiffType: (type: ImageDiffType) => void
  readonly codeDiff?: React.ReactNode
}

export interface ICommonImageDiffProperties {
  /** The biggest size to fit both the previous and current images. */
  readonly maxSize: ISize

  /** The previous image. */
  readonly previous: Image

  /** The current image. */
  readonly current: Image

  /** A function to call when the previous image has loaded. */
  readonly onPreviousImageLoad: (img: HTMLImageElement) => void

  /** A function to call when the current image has loaded. */
  readonly onCurrentImageLoad: (img: HTMLImageElement) => void

  /**
   * A function to call which provides the element that will contain the
   * images. This container element is used to measure the available space for
   * the images, which is then used to calculate the aspect fit size.
   */
  readonly onContainerRef: (e: HTMLElement | null) => void
}

interface IModifiedImageDiffState {
  /** The size of the previous image. */
  readonly previousImageSize: ISize | null

  /** The size of the current image. */
  readonly currentImageSize: ISize | null

  /** The size of the container element. */
  readonly containerSize: ISize | null

  readonly showCode: boolean
}

/** A component which renders the changes to an image in the repository */
export class ModifiedImageDiff extends React.Component<
  IModifiedImageDiffProps,
  IModifiedImageDiffState
> {
  private container: HTMLElement | null = null

  private readonly resizeObserver: ResizeObserver
  private resizedTimeoutID: NodeJS.Immediate | null = null

  public constructor(props: IModifiedImageDiffProps) {
    super(props)

    this.resizeObserver = new ResizeObserver(entries => {
      for (const { target, contentRect } of entries) {
        if (target === this.container && target instanceof HTMLElement) {
          // We might end up causing a recursive update by updating the state
          // when we're reacting to a resize so we'll defer it until after
          // react is done with this frame.
          if (this.resizedTimeoutID !== null) {
            clearImmediate(this.resizedTimeoutID)
          }

          this.resizedTimeoutID = setImmediate(
            this.onResized,
            target,
            contentRect
          )
        }
      }
    })

    this.state = {
      previousImageSize: null,
      currentImageSize: null,
      containerSize: null,
      showCode: props.codeDiff !== undefined && getSvgDiffShowCode(),
    }
  }

  private onPreviousImageLoad = (img: HTMLImageElement) => {
    const size = { width: img.naturalWidth, height: img.naturalHeight }
    this.setState({ previousImageSize: size })
  }

  private onCurrentImageLoad = (img: HTMLImageElement) => {
    const size = { width: img.naturalWidth, height: img.naturalHeight }
    this.setState({ currentImageSize: size })
  }

  private onResized = (target: HTMLElement, contentRect: ClientRect) => {
    this.resizedTimeoutID = null

    const containerSize = {
      width: target.offsetWidth,
      height: target.offsetHeight,
    }
    this.setState({ containerSize })
  }

  private getMaxSize(): ISize {
    const zeroSize = { width: 0, height: 0, containerWidth: 0 }
    const containerSize = this.state.containerSize
    if (!containerSize) {
      return zeroSize
    }

    const { previousImageSize, currentImageSize } = this.state
    if (!previousImageSize || !currentImageSize) {
      return zeroSize
    }

    const maxFitSize = getMaxFitSize(
      previousImageSize,
      currentImageSize,
      containerSize
    )

    return maxFitSize
  }

  private onContainerRef = (c: HTMLElement | null) => {
    this.container = c

    this.resizeObserver.disconnect()

    if (c) {
      this.resizeObserver.observe(c)
    }
  }

  public componentDidUpdate(prevProps: IModifiedImageDiffProps) {
    if (prevProps.codeDiff === undefined && this.props.codeDiff !== undefined) {
      this.setState({ showCode: getSvgDiffShowCode() })
    }
  }

  public render() {
    return this.props.codeDiff === undefined
      ? this.renderImageDiff()
      : this.renderSvgDiff()
  }

  private renderSvgDiff() {
    if (this.state.showCode) {
      return (
        <div className="panel svg-diff-container">
          {this.renderTabs(0, this.onSvgTabClicked, true)}
          {this.props.codeDiff}
        </div>
      )
    }

    return (
      <div className="panel image svg-image" id="diff">
        {this.renderTabs(1 + this.props.diffType, this.onSvgTabClicked, true)}
        {this.renderCurrentDiffType()}
      </div>
    )
  }

  private renderImageDiff() {
    return (
      <div className="panel image" id="diff">
        {this.renderTabs(
          this.props.diffType,
          this.props.onChangeDiffType,
          false
        )}
        {this.renderCurrentDiffType()}
      </div>
    )
  }

  private renderTabs(
    selectedIndex: number,
    onTabClicked: (index: number) => void,
    includeCode: boolean
  ) {
    return (
      <TabBar
        selectedIndex={selectedIndex}
        onTabClicked={onTabClicked}
        type={TabBarType.Switch}
      >
        {includeCode ? <span>Code</span> : null}
        <span>2-up</span>
        <span>Swipe</span>
        <span>Onion Skin</span>
        <span>Difference</span>
      </TabBar>
    )
  }

  private onSvgTabClicked = (index: number) => {
    const showCode = index === 0
    saveSvgDiffShowCode(showCode)
    this.setState({ showCode })
    if (!showCode) {
      this.props.onChangeDiffType((index - 1) as ImageDiffType)
    }
  }

  private renderCurrentDiffType() {
    const maxSize = this.getMaxSize()
    const type = this.props.diffType
    switch (type) {
      case ImageDiffType.TwoUp:
        return (
          <TwoUp
            {...this.getCommonProps(maxSize)}
            previousImageSize={this.state.previousImageSize}
            currentImageSize={this.state.currentImageSize}
          />
        )

      case ImageDiffType.Swipe:
        return <Swipe {...this.getCommonProps(maxSize)} />

      case ImageDiffType.OnionSkin:
        return <OnionSkin {...this.getCommonProps(maxSize)} />

      case ImageDiffType.Difference:
        return <DifferenceBlend {...this.getCommonProps(maxSize)} />

      default:
        return assertNever(type, `Unknown diff type: ${type}`)
    }
  }

  private getCommonProps(maxSize: ISize): ICommonImageDiffProperties {
    return {
      maxSize,
      previous: this.props.previous,
      current: this.props.current,
      onPreviousImageLoad: this.onPreviousImageLoad,
      onCurrentImageLoad: this.onCurrentImageLoad,
      onContainerRef: this.onContainerRef,
    }
  }
}
