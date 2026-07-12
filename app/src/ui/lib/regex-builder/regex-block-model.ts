/**
 * A structured, composable model of a regular expression. The regex builder UI
 * lets the user assemble a pattern from these blocks; {@link blocksToPattern}
 * serialises them into a JavaScript regular expression source string and
 * {@link explainBlocks} produces a plain-language description.
 */

/** The set of block kinds that make up a {@link RegexBlock}. */
export enum RegexBlockKind {
  Literal = 'literal',
  CharClass = 'charClass',
  Anchor = 'anchor',
  Quantifier = 'quantifier',
  Group = 'group',
  Alternation = 'alternation',
  Lookaround = 'lookaround',
  Raw = 'raw',
}

/** A literal run of text. The value is escaped when serialised. */
export interface ILiteralBlock {
  readonly kind: RegexBlockKind.Literal
  readonly value: string
}

/**
 * A character class such as `\d`, `\w`, `.` or a bracketed class like `[a-z]`.
 * The value is emitted verbatim.
 */
export interface ICharClassBlock {
  readonly kind: RegexBlockKind.CharClass
  readonly value: string
}

/** One of the zero-width anchors. */
export type AnchorValue = '^' | '$' | '\\b' | '\\B'

export interface IAnchorBlock {
  readonly kind: RegexBlockKind.Anchor
  readonly value: AnchorValue
}

/** The supported quantifier shapes. */
export type QuantifierKind =
  | 'star' // *
  | 'plus' // +
  | 'optional' // ?
  | 'exact' // {n}
  | 'atLeast' // {n,}
  | 'range' // {n,m}

/**
 * A quantifier which applies to whatever precedes it in the pattern. `min` and
 * `max` are only consulted for the `exact`, `atLeast` and `range` kinds.
 */
export interface IQuantifierBlock {
  readonly kind: RegexBlockKind.Quantifier
  readonly quantifier: QuantifierKind
  readonly min?: number
  readonly max?: number
  /** Whether the quantifier is lazy (suffixed with `?`). */
  readonly lazy: boolean
}

export type GroupType = 'capturing' | 'nonCapturing' | 'named'

export interface IGroupBlock {
  readonly kind: RegexBlockKind.Group
  readonly groupType: GroupType
  /** Only used for named groups. */
  readonly name?: string
  readonly children: ReadonlyArray<RegexBlock>
}

/** An alternation between two or more branches (joined with `|`). */
export interface IAlternationBlock {
  readonly kind: RegexBlockKind.Alternation
  readonly options: ReadonlyArray<ReadonlyArray<RegexBlock>>
}

export type LookaroundDirection = 'ahead' | 'behind'

export interface ILookaroundBlock {
  readonly kind: RegexBlockKind.Lookaround
  readonly direction: LookaroundDirection
  readonly negated: boolean
  readonly children: ReadonlyArray<RegexBlock>
}

/**
 * An escape hatch for raw pattern text that the user has typed directly. Emitted
 * verbatim and never escaped.
 */
export interface IRawBlock {
  readonly kind: RegexBlockKind.Raw
  readonly value: string
}

/** The discriminated union of every block kind. */
export type RegexBlock =
  | ILiteralBlock
  | ICharClassBlock
  | IAnchorBlock
  | IQuantifierBlock
  | IGroupBlock
  | IAlternationBlock
  | ILookaroundBlock
  | IRawBlock

/** The regular expression flags supported by the builder. */
export interface IRegexFlags {
  readonly g: boolean
  readonly i: boolean
  readonly m: boolean
  readonly s: boolean
  readonly u: boolean
  readonly y: boolean
}

/** The order flags are emitted in a `/pattern/flags` literal. */
const FlagOrder: ReadonlyArray<keyof IRegexFlags> = [
  'g',
  'i',
  'm',
  's',
  'u',
  'y',
]

/** Serialise a set of flags into the trailing portion of a regex literal. */
export function flagsToString(flags: IRegexFlags): string {
  return FlagOrder.filter(f => flags[f]).join('')
}

/** Characters that carry special meaning in a regular expression. */
const RegexMetaCharacters = /[.*+?^${}()|[\]\\]/g

/** Escape a literal string so it matches itself when used in a pattern. */
export function escapeLiteral(value: string): string {
  return value.replace(RegexMetaCharacters, '\\$&')
}

function quantifierToPattern(block: IQuantifierBlock): string {
  let base: string
  switch (block.quantifier) {
    case 'star':
      base = '*'
      break
    case 'plus':
      base = '+'
      break
    case 'optional':
      base = '?'
      break
    case 'exact':
      base = `{${block.min ?? 0}}`
      break
    case 'atLeast':
      base = `{${block.min ?? 0},}`
      break
    case 'range':
      base = `{${block.min ?? 0},${block.max ?? 0}}`
      break
    default:
      base = ''
  }

  return base + (block.lazy ? '?' : '')
}

function blockToPattern(block: RegexBlock): string {
  switch (block.kind) {
    case RegexBlockKind.Literal:
      return escapeLiteral(block.value)
    case RegexBlockKind.CharClass:
      return block.value
    case RegexBlockKind.Anchor:
      return block.value
    case RegexBlockKind.Raw:
      return block.value
    case RegexBlockKind.Quantifier:
      return quantifierToPattern(block)
    case RegexBlockKind.Group: {
      const inner = blocksToPattern(block.children)
      const prefix =
        block.groupType === 'capturing'
          ? '('
          : block.groupType === 'nonCapturing'
          ? '(?:'
          : `(?<${block.name ?? ''}>`
      return `${prefix}${inner})`
    }
    case RegexBlockKind.Alternation: {
      const branches = block.options.map(o => blocksToPattern(o)).join('|')
      return `(?:${branches})`
    }
    case RegexBlockKind.Lookaround: {
      const inner = blocksToPattern(block.children)
      const prefix =
        block.direction === 'ahead'
          ? block.negated
            ? '(?!'
            : '(?='
          : block.negated
          ? '(?<!'
          : '(?<='
      return `${prefix}${inner})`
    }
    default:
      return ''
  }
}

/** Serialise an ordered list of blocks into a regex source string. */
export function blocksToPattern(blocks: ReadonlyArray<RegexBlock>): string {
  return blocks.map(blockToPattern).join('')
}

const AnchorExplanations: Record<AnchorValue, string> = {
  '^': 'start of line',
  $: 'end of line',
  '\\b': 'a word boundary',
  '\\B': 'a non-word-boundary',
}

function quantifierToExplanation(block: IQuantifierBlock): string {
  const lazy = block.lazy ? ' (as few as possible)' : ''
  switch (block.quantifier) {
    case 'star':
      return `repeated zero or more times${lazy}`
    case 'plus':
      return `repeated one or more times${lazy}`
    case 'optional':
      return `optional${lazy}`
    case 'exact':
      return `repeated exactly ${block.min ?? 0} times${lazy}`
    case 'atLeast':
      return `repeated at least ${block.min ?? 0} times${lazy}`
    case 'range':
      return `repeated between ${block.min ?? 0} and ${
        block.max ?? 0
      } times${lazy}`
    default:
      return 'repeated'
  }
}

function blockToExplanation(block: RegexBlock): string {
  switch (block.kind) {
    case RegexBlockKind.Literal:
      return `the text "${block.value}"`
    case RegexBlockKind.CharClass:
      return `a character matching ${block.value}`
    case RegexBlockKind.Anchor:
      return AnchorExplanations[block.value]
    case RegexBlockKind.Raw:
      return `the pattern ${block.value}`
    case RegexBlockKind.Quantifier:
      return `the previous item ${quantifierToExplanation(block)}`
    case RegexBlockKind.Group: {
      const inner = explainBlocks(block.children)
      const label =
        block.groupType === 'capturing'
          ? 'a captured group of'
          : block.groupType === 'named'
          ? `a group named "${block.name ?? ''}" of`
          : 'a group of'
      return `${label} (${inner})`
    }
    case RegexBlockKind.Alternation: {
      const branches = block.options.map(o => explainBlocks(o))
      return `either ${branches.join(' or ')}`
    }
    case RegexBlockKind.Lookaround: {
      const inner = explainBlocks(block.children)
      const dir = block.direction === 'ahead' ? 'followed by' : 'preceded by'
      const neg = block.negated ? 'not ' : ''
      return `${neg}${dir} (${inner})`
    }
    default:
      return ''
  }
}

/** Produce a plain-language description of an ordered list of blocks. */
export function explainBlocks(blocks: ReadonlyArray<RegexBlock>): string {
  if (blocks.length === 0) {
    return 'an empty pattern (matches everything)'
  }

  return blocks.map(blockToExplanation).join(', then ')
}
