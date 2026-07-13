import * as React from 'react'

import { Image } from '../../../models/diff'
import { convertDDSImage } from './dds-converter'
import { sanitizeSVG } from './svg-sanitizer'

interface IImageProps {
  /** The image contents to render */
  readonly image: Image

  /** Optional styles to apply to the image container */
  readonly style?: React.CSSProperties

  /** callback to fire after the image has been loaded */
  readonly onElementLoad?: (img: HTMLImageElement) => void
}

interface IImageState {
  readonly imageSource: string | null
}

export class ImageContainer extends React.Component<IImageProps, IImageState> {
  public constructor(props: IImageProps) {
    super(props)
    this.state = {
      imageSource: null,
    }
  }

  public loadImage(image: Image) {
    if (image.mediaType === 'image/vnd-ms.dds') {
      try {
        const dataURL = convertDDSImage(image.rawContents)
        this.setState({
          imageSource: dataURL,
        })
      } catch (error) {
        console.error('Error loading DDS image:', error)
        this.setState({ imageSource: null })
      }
    } else if (image.mediaType === 'image/svg+xml') {
      const source = Buffer.from(image.contents, 'base64').toString('utf8')
      const sanitized = sanitizeSVG(source)
      this.setState({
        imageSource:
          sanitized.length === 0
            ? null
            : `data:image/svg+xml;base64,${Buffer.from(
                sanitized,
                'utf8'
              ).toString('base64')}`,
      })
    } else {
      this.setState({
        imageSource: `data:${image.mediaType};base64,${image.contents}`,
      })
    }
  }

  public componentDidMount() {
    const { image } = this.props
    this.loadImage(image)
  }

  public componentDidUpdate(prevProps: IImageProps) {
    const { image } = this.props
    if (image === prevProps.image) {
      return
    }

    this.loadImage(image)
  }

  public render() {
    const { imageSource } = this.state
    if (!imageSource) {
      return null
    }

    return (
      <div className="image-wrapper">
        <img
          src={imageSource}
          style={this.props.style}
          onLoad={this.onLoad}
          alt=""
        />
      </div>
    )
  }

  private onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (this.props.onElementLoad) {
      this.props.onElementLoad(e.currentTarget)
    }
  }
}
