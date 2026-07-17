/** Version of the portable, code-native repository logo document. */
export const RepositoryLogoDesignVersion = 1 as const
export const MaxRepositoryLogoLayers = 8
export const MaxRepositoryLogoTextLength = 24
export const MaxRepositoryLogoDocumentLength = 16_384

export type RepositoryLogoShape = 'rounded' | 'circle' | 'square' | 'hexagon'
export type RepositoryLogoFill = 'solid' | 'gradient'
export type RepositoryLogoShadow = 'none' | 'soft' | 'strong'
export type RepositoryLogoMark =
  | 'repository'
  | 'code'
  | 'terminal'
  | 'branch'
  | 'star'
  | 'sparkle'
  | 'monogram'
export type RepositoryLogoTextSource = 'repository-name' | 'monogram' | 'custom'
export type RepositoryLogoFont = 'sans' | 'serif' | 'monospace'
export type RepositoryLogoFontWeight = 400 | 500 | 600 | 700 | 800

export interface IRepositoryLogoBackground {
  readonly shape: RepositoryLogoShape
  readonly fill: RepositoryLogoFill
  readonly primaryColor: string
  readonly secondaryColor: string
  readonly gradientAngle: number
  readonly borderWidth: number
  readonly borderColor: string
  readonly shadow: RepositoryLogoShadow
}

interface IRepositoryLogoLayerBase {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly rotation: number
  readonly opacity: number
  readonly color: string
}

export interface IRepositoryLogoMarkLayer extends IRepositoryLogoLayerBase {
  readonly type: 'mark'
  readonly mark: RepositoryLogoMark
}

export interface IRepositoryLogoTextLayer extends IRepositoryLogoLayerBase {
  readonly type: 'text'
  readonly source: RepositoryLogoTextSource
  readonly text: string
  readonly font: RepositoryLogoFont
  readonly fontWeight: RepositoryLogoFontWeight
  readonly letterSpacing: number
}

export type RepositoryLogoLayer =
  | IRepositoryLogoMarkLayer
  | IRepositoryLogoTextLayer

export interface IRepositoryLogoDesign {
  readonly version: typeof RepositoryLogoDesignVersion
  readonly background: IRepositoryLogoBackground
  readonly layers: ReadonlyArray<RepositoryLogoLayer>
}

export const DefaultRepositoryLogoDesign: IRepositoryLogoDesign = {
  version: RepositoryLogoDesignVersion,
  background: {
    shape: 'rounded',
    fill: 'solid',
    primaryColor: '#0969da',
    secondaryColor: '#8250df',
    gradientAngle: 135,
    borderWidth: 0,
    borderColor: '#ffffff',
    shadow: 'soft',
  },
  layers: [
    {
      id: 'repository-mark',
      type: 'mark',
      mark: 'repository',
      x: 50,
      y: 50,
      scale: 1.35,
      rotation: 0,
      opacity: 1,
      color: '#ffffff',
    },
  ],
}

export const repositoryLogoShapes: ReadonlyArray<RepositoryLogoShape> = [
  'rounded',
  'circle',
  'square',
  'hexagon',
]
export const repositoryLogoFills: ReadonlyArray<RepositoryLogoFill> = [
  'solid',
  'gradient',
]
export const repositoryLogoShadows: ReadonlyArray<RepositoryLogoShadow> = [
  'none',
  'soft',
  'strong',
]
export const repositoryLogoMarks: ReadonlyArray<RepositoryLogoMark> = [
  'repository',
  'code',
  'terminal',
  'branch',
  'star',
  'sparkle',
  'monogram',
]
export const repositoryLogoTextSources: ReadonlyArray<RepositoryLogoTextSource> =
  ['repository-name', 'monogram', 'custom']
export const repositoryLogoFonts: ReadonlyArray<RepositoryLogoFont> = [
  'sans',
  'serif',
  'monospace',
]
export const repositoryLogoFontWeights: ReadonlyArray<RepositoryLogoFontWeight> =
  [400, 500, 600, 700, 800]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<T extends string>(
  value: unknown,
  choices: ReadonlyArray<T>
): value is T {
  return typeof value === 'string' && choices.includes(value as T)
}

function clamp(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  step: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const snapped = Math.round(value / step) * step
  return Math.min(max, Math.max(min, snapped))
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback
}

function layerId(value: unknown, index: number, used: Set<string>): string {
  const candidate =
    typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(value)
      ? value
      : `layer-${index + 1}`
  let id = candidate
  let suffix = 2
  while (used.has(id)) {
    id = `${candidate.slice(0, 28)}-${suffix++}`
  }
  used.add(id)
  return id
}

function normalizeBase(
  source: Record<string, unknown>,
  index: number,
  used: Set<string>
): IRepositoryLogoLayerBase {
  return {
    id: layerId(source.id, index, used),
    x: clamp(source.x, 50, 0, 100, 0.5),
    y: clamp(source.y, 50, 0, 100, 0.5),
    scale: clamp(source.scale, 1, 0.25, 3, 0.05),
    rotation: clamp(source.rotation, 0, -180, 180, 1),
    opacity: clamp(source.opacity, 1, 0.1, 1, 0.05),
    color: color(source.color, '#ffffff'),
  }
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return 'DM'
  }
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .slice(0, MaxRepositoryLogoTextLength)
    .join('')
}

function boundedDisplayText(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .slice(0, MaxRepositoryLogoTextLength)
    .join('')
}

function normalizeLayer(
  value: unknown,
  index: number,
  used: Set<string>
): RepositoryLogoLayer | null {
  if (!isRecord(value)) {
    return null
  }
  const base = normalizeBase(value, index, used)
  if (value.type === 'mark') {
    return {
      ...base,
      type: 'mark',
      mark: isOneOf(value.mark, repositoryLogoMarks)
        ? value.mark
        : 'repository',
    }
  }
  if (value.type === 'text') {
    const fontWeight =
      typeof value.fontWeight === 'number' &&
      repositoryLogoFontWeights.includes(
        value.fontWeight as RepositoryLogoFontWeight
      )
        ? (value.fontWeight as RepositoryLogoFontWeight)
        : 700
    return {
      ...base,
      type: 'text',
      source: isOneOf(value.source, repositoryLogoTextSources)
        ? value.source
        : 'custom',
      text: normalizeText(value.text),
      font: isOneOf(value.font, repositoryLogoFonts) ? value.font : 'sans',
      fontWeight,
      letterSpacing: clamp(value.letterSpacing, 0, -1, 4, 0.25),
    }
  }
  return null
}

/** Normalize untrusted design data and enforce all document and layer caps. */
export function normalizeRepositoryLogoDesign(
  value: unknown
): IRepositoryLogoDesign {
  const source = isRecord(value) ? value : {}
  const background = isRecord(source.background) ? source.background : {}
  const defaults = DefaultRepositoryLogoDesign.background
  const used = new Set<string>()
  const layers = Array.isArray(source.layers)
    ? source.layers
        .slice(0, MaxRepositoryLogoLayers)
        .map((layer, index) => normalizeLayer(layer, index, used))
        .filter((layer): layer is RepositoryLogoLayer => layer !== null)
    : DefaultRepositoryLogoDesign.layers

  return {
    version: RepositoryLogoDesignVersion,
    background: {
      shape: isOneOf(background.shape, repositoryLogoShapes)
        ? background.shape
        : defaults.shape,
      fill: isOneOf(background.fill, repositoryLogoFills)
        ? background.fill
        : defaults.fill,
      primaryColor: color(background.primaryColor, defaults.primaryColor),
      secondaryColor: color(background.secondaryColor, defaults.secondaryColor),
      gradientAngle: clamp(
        background.gradientAngle,
        defaults.gradientAngle,
        0,
        360,
        1
      ),
      borderWidth: clamp(background.borderWidth, defaults.borderWidth, 0, 6, 1),
      borderColor: color(background.borderColor, defaults.borderColor),
      shadow: isOneOf(background.shadow, repositoryLogoShadows)
        ? background.shadow
        : defaults.shadow,
    },
    layers,
  }
}

/** Parse a portable logo JSON document. Invalid roots and versions are rejected. */
export function parseRepositoryLogoDesign(
  serialized: string
): IRepositoryLogoDesign | null {
  if (
    serialized.length === 0 ||
    serialized.length > MaxRepositoryLogoDocumentLength
  ) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (
      !isRecord(parsed) ||
      parsed.version !== RepositoryLogoDesignVersion ||
      !isRecord(parsed.background) ||
      !Array.isArray(parsed.layers)
    ) {
      return null
    }
    return normalizeRepositoryLogoDesign(parsed)
  } catch {
    return null
  }
}

export function serializeRepositoryLogoDesign(
  value: IRepositoryLogoDesign
): string {
  return `${JSON.stringify(normalizeRepositoryLogoDesign(value), null, 2)}\n`
}

export function getRepositoryLogoMonogram(repositoryName: string): string {
  const words = repositoryName
    .trim()
    .split(/[\s._-]+/)
    .filter(word => word.length > 0)
  const letters =
    words.length > 1
      ? words.slice(0, 2).map(word => Array.from(word)[0])
      : Array.from(words[0] ?? 'R').slice(0, 2)
  return letters.join('').toLocaleUpperCase() || 'R'
}

export function repositoryLogoText(
  layer: IRepositoryLogoTextLayer,
  repositoryName: string
): string {
  switch (layer.source) {
    case 'repository-name':
      return boundedDisplayText(repositoryName)
    case 'monogram':
      return getRepositoryLogoMonogram(repositoryName)
    case 'custom':
      return layer.text
  }
}
