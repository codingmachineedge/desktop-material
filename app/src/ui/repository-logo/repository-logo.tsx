import * as React from 'react'
import {
  getRepositoryLogoMonogram,
  IRepositoryLogoDesign,
  IRepositoryLogoMarkLayer,
  IRepositoryLogoTextLayer,
  normalizeRepositoryLogoDesign,
  repositoryLogoText,
  RepositoryLogoShape,
} from '../../models/repository-logo'

interface IRepositoryLogoProps {
  readonly design: IRepositoryLogoDesign
  readonly repositoryName: string
  readonly className?: string
  readonly size?: number
  readonly title?: string
}

let nextRepositoryLogoId = 0

function shapeElement(shape: RepositoryLogoShape, props: object) {
  switch (shape) {
    case 'circle':
      return <circle cx={50} cy={50} r={46} {...props} />
    case 'hexagon':
      return <path d="M50 3 91 26.5v47L50 97 9 73.5v-47z" {...props} />
    case 'square':
      return <rect x={4} y={4} width={92} height={92} rx={5} {...props} />
    case 'rounded':
      return <rect x={4} y={4} width={92} height={92} rx={21} {...props} />
  }
}

function renderMark(layer: IRepositoryLogoMarkLayer, repositoryName: string) {
  switch (layer.mark) {
    case 'repository':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={4.5}>
          <path d="M-16-19h25a7 7 0 0 1 7 7v31h-26a7 7 0 0 1-7-7v-25a6 6 0 0 1 6-6" />
          <path d="M-16 11a8 8 0 0 1 7-4h25M-7-10H7" />
        </g>
      )
    case 'code':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={5}>
          <path d="m-5-17-13 17 13 17M5-17 18 0 5 17" />
        </g>
      )
    case 'terminal':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={4}>
          <rect x={-22} y={-17} width={44} height={34} rx={5} />
          <path d="m-13-7 8 7-8 7M1 8h11" />
        </g>
      )
    case 'branch':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={4}>
          <circle cx={-10} cy={-15} r={5} />
          <circle cx={12} cy={-13} r={5} />
          <circle cx={-10} cy={16} r={5} />
          <path d="M-10-10v21M-5 4C8 4 12-1 12-8" />
        </g>
      )
    case 'star':
      return (
        <path
          d="m0-23 6.5 14 15.5 2-11.5 10.5L14 19 0 11-14 19l3.5-15.5L-22-7l15.5-2z"
          fill="currentColor"
        />
      )
    case 'sparkle':
      return (
        <g fill="currentColor">
          <path d="M-5-24c2 13 5 16 18 18C0-4-3-1-5 12-7-1-10-4-23-6-10-8-7-11-5-24Z" />
          <path d="M14 4c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10Z" />
        </g>
      )
    case 'monogram':
      return (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="system-ui, sans-serif"
          fontSize={31}
          fontWeight={800}
          fill="currentColor"
        >
          {getRepositoryLogoMonogram(repositoryName)}
        </text>
      )
  }
}

function fontStack(layer: IRepositoryLogoTextLayer): string {
  switch (layer.font) {
    case 'serif':
      return "Georgia, 'Times New Roman', serif"
    case 'monospace':
      return "Consolas, 'SFMono-Regular', monospace"
    case 'sans':
      return "'Segoe UI', Roboto, system-ui, sans-serif"
  }
}

/** A safe SVG renderer for normalized repository-logo documents. */
export class RepositoryLogo extends React.PureComponent<IRepositoryLogoProps> {
  private readonly documentId = `repository-logo-${++nextRepositoryLogoId}`

  private renderLayer(
    layer: IRepositoryLogoMarkLayer | IRepositoryLogoTextLayer
  ) {
    const transform = `translate(${layer.x} ${layer.y}) rotate(${layer.rotation}) scale(${layer.scale})`
    const style = { color: layer.color, opacity: layer.opacity }
    if (layer.type === 'mark') {
      return (
        <g key={layer.id} transform={transform} style={style}>
          {renderMark(layer, this.props.repositoryName)}
        </g>
      )
    }
    const text = repositoryLogoText(layer, this.props.repositoryName)
    return (
      <text
        key={layer.id}
        transform={transform}
        textAnchor="middle"
        dominantBaseline="central"
        fill={layer.color}
        opacity={layer.opacity}
        fontFamily={fontStack(layer)}
        fontSize={18}
        fontWeight={layer.fontWeight}
        letterSpacing={layer.letterSpacing}
      >
        {text}
      </text>
    )
  }

  public render() {
    const design = normalizeRepositoryLogoDesign(this.props.design)
    const { background } = design
    const angle = (background.gradientAngle * Math.PI) / 180
    const x = Math.cos(angle) * 50
    const y = Math.sin(angle) * 50
    const fill =
      background.fill === 'gradient'
        ? `url(#${this.documentId}-gradient)`
        : background.primaryColor
    const filter =
      background.shadow === 'none'
        ? undefined
        : `url(#${this.documentId}-${background.shadow}-shadow)`
    const size = this.props.size ?? 96
    const ariaHidden = this.props.title === undefined ? true : undefined

    return (
      <svg
        className={this.props.className}
        viewBox="-8 -8 116 116"
        width={size}
        height={size}
        role={this.props.title === undefined ? undefined : 'img'}
        aria-hidden={ariaHidden}
        aria-label={this.props.title}
        focusable="false"
      >
        <defs>
          <linearGradient
            id={`${this.documentId}-gradient`}
            x1={50 - x}
            y1={50 - y}
            x2={50 + x}
            y2={50 + y}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={background.primaryColor} />
            <stop offset="1" stopColor={background.secondaryColor} />
          </linearGradient>
          <filter
            id={`${this.documentId}-soft-shadow`}
            x="-25%"
            y="-25%"
            width="150%"
            height="160%"
          >
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity="0.28" />
          </filter>
          <filter
            id={`${this.documentId}-strong-shadow`}
            x="-35%"
            y="-35%"
            width="170%"
            height="180%"
          >
            <feDropShadow dx="0" dy="6" stdDeviation="5" floodOpacity="0.42" />
          </filter>
          <clipPath id={`${this.documentId}-clip`}>
            {shapeElement(background.shape, {})}
          </clipPath>
        </defs>
        <g filter={filter}>
          {shapeElement(background.shape, {
            fill,
            stroke: background.borderColor,
            strokeWidth: background.borderWidth,
            vectorEffect: 'non-scaling-stroke',
          })}
          <g clipPath={`url(#${this.documentId}-clip)`}>
            {design.layers.map(layer => this.renderLayer(layer))}
          </g>
        </g>
      </svg>
    )
  }
}
